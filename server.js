import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomInt, createHash, createHmac } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.ALLOWED_ORIGIN || false, methods: ['GET','POST'] } });
app.use(express.json({limit:'10kb'}));
app.use(express.static('public'));
app.get('/health', (_req,res) => res.json({ok:true, service:'Brain Battle Arena'}));
const sessionSecret=process.env.SESSION_SECRET||randomBytes(32).toString('hex');
const googleClientId=process.env.GOOGLE_CLIENT_ID||'';
const googleClient=googleClientId?new OAuth2Client(googleClientId):null;
const b64url=value=>Buffer.from(value).toString('base64url');
function signSession(sub,provider){const payload=b64url(JSON.stringify({sub,provider,exp:Date.now()+1000*60*60*24*30}));const signature=createHmac('sha256',sessionSecret).update(payload).digest('base64url');return `${payload}.${signature}`;}
function verifySession(token){try{const [payload,signature]=String(token||'').split('.');if(!payload||!signature)return null;const expected=createHmac('sha256',sessionSecret).update(payload).digest('base64url');if(signature!==expected)return null;const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.exp>Date.now()?data:null;}catch{return null;}}
app.get('/api/config',(_req,res)=>res.json({googleClientId}));
app.post('/api/auth/google',async(req,res)=>{try{if(!googleClient) return res.status(503).json({error:'Google sign-in is not configured on this server.'});const ticket=await googleClient.verifyIdToken({idToken:String(req.body?.credential||''),audience:googleClientId});const claims=ticket.getPayload();if(!claims?.sub) return res.status(401).json({error:'Google could not verify this account.'});res.json({token:signSession(claims.sub,'google'),name:String(claims.name||'').slice(0,16)});}catch{res.status(401).json({error:'Google sign-in could not be verified.'});}});

const COLORS = ['#20e6ff','#bd70ff','#ff6d9a','#ffd166'];
// These settings also let the integration suite exercise whole matches quickly.
// Production defaults preserve the agreed 20/25 second rounds and 20 second queue.
const QUICK_MS = Math.max(1, Number(process.env.BBA_QUICK_MS) || 20000);
const FINAL_MS = Math.max(1, Number(process.env.BBA_FINAL_MS) || 25000);
const HUMAN_WAIT_MS = Math.max(1, Number(process.env.BBA_HUMAN_WAIT_MS) || 20000);
const REVEAL_MS = Math.max(1, Number(process.env.BBA_REVEAL_MS) || 2300);
const READY_MS = Math.max(1, Number(process.env.BBA_READY_MS) || 1200);
const AI_MIN_MS = Math.max(1, Number(process.env.BBA_AI_MIN_MS) || 4200);
const AI_MAX_MS = Math.max(AI_MIN_MS + 1, Number(process.env.BBA_AI_MAX_MS) || 12000);
const rooms = new Map(), players = new Map(), queue = new Set();
const reactions = new Set(['Good luck!','Nice answer!','Well played!','Rematch?']);
const pick = a => a[randomInt(a.length)];
const roomCode = () => randomBytes(3).toString('hex').toUpperCase();
const hash = s => createHash('sha256').update(s).digest('hex');

// Original built-in puzzle set; answers remain on the server.
const puzzleBank = [
 {type:'choice',category:'Pattern',prompt:'What comes next?  2, 4, 8, 16, __',options:['24','30','32','34'],answer:'32',explain:'Each number doubles.'},
 {type:'choice',category:'Logic',prompt:'Mira is taller than Jo. Jo is taller than Lee. Who is shortest?',options:['Mira','Jo','Lee','Cannot tell'],answer:'Lee',explain:'Lee is shorter than Jo, who is shorter than Mira.'},
 {type:'number',category:'Math',prompt:'A robot has 3 trays with 4 bolts on each. How many bolts?',answer:'12',explain:'3 × 4 = 12.'},
 {type:'memory',category:'Memory',prompt:'Memorize this sequence: 🔵  🟣  🟢  🟡',question:'Which sequence did you see?',options:['Blue, purple, green, yellow','Purple, blue, yellow, green','Blue, green, purple, yellow','Yellow, green, purple, blue'],answer:'Blue, purple, green, yellow',explain:'The sequence was blue, purple, green, yellow.'},
 {type:'word',category:'Word',prompt:'Unscramble the letters: R A E T H. Name the body organ.',answer:'heart',explain:'HEART is the body organ.'},
 {type:'choice',category:'Pattern',prompt:'Which shape has the most sides?',options:['Triangle','Pentagon','Hexagon','Square'],answer:'Hexagon',explain:'A hexagon has six sides.'},
 {type:'number',category:'Math',prompt:'What is 27 − 9?',answer:'18',explain:'27 − 9 = 18.'},
 {type:'choice',category:'Logic',prompt:'If today is Tuesday, what day will it be in 3 days?',options:['Thursday','Friday','Saturday','Sunday'],answer:'Friday',explain:'Wednesday (1), Thursday (2), Friday (3).'},
 {type:'word',category:'Word',prompt:'Type the opposite of “cold”.',answer:'hot',explain:'The opposite of cold is hot.'},
 {type:'choice',category:'Pattern',prompt:'Which number does not fit?  3, 6, 9, 11, 12',options:['3','6','9','11'],answer:'11',explain:'The others are multiples of 3.'},
 {type:'number',category:'Math',prompt:'A puzzle has 5 rows of 5 tiles. How many tiles?',answer:'25',explain:'5 × 5 = 25.'},
 {type:'choice',category:'Logic',prompt:'You pass the runner in second place. What place are you in?',options:['First','Second','Third','Fourth'],answer:'Second',explain:'You take the place of the runner you passed.'},
 {type:'word',category:'Word',prompt:'Type the missing word: “A stitch in time saves ___.”',answer:'nine',explain:'A stitch in time saves nine.'}
];
function buildMatchPuzzles(){
 const pool=[...puzzleBank];
 for(let i=pool.length-1;i>0;i--){const j=randomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
 const quick=pool.slice(0,5);
 const finalPool=[...pool.slice(5),...pool.slice(0,5)];
 const final=finalPool.slice(0,3).map(p=>({...p,stage:true}));
 return [...quick,...final];
}
function publicPlayer(p){return {id:p.id,name:p.name,color:p.color,avatar:p.avatar,isAI:p.isAI,score:p.score,connected:p.connected};}
function roomSnapshot(r){return {code:r.code,hostId:r.hostId,private:r.private,mode:r.mode,phase:r.phase,players:[...r.players.values()].map(publicPlayer),round:r.round,totalRounds:r.puzzles.length,deadline:r.deadline,matchId:r.id};}
function emitRoom(r,event,payload){io.to(r.id).emit(event,payload);}
function findRoomByPlayerId(playerId){for(const r of rooms.values())if(r.players.has(playerId))return r;return null;}
function sendRoom(r){emitRoom(r,'room:update',roomSnapshot(r));}
function closeRound(r){
 if(!r || r.phase!=='answering')return;
 clearTimeout(r.timer); r.phase='reveal';
 const puzzle=r.puzzles[r.round];
 emitRoom(r,'round:reveal',{correctAnswer:puzzle.answer,explanation:puzzle.explain,players:[...r.players.values()].map(p=>({id:p.id,score:p.score,lastCorrect:p.lastCorrect,lastPoints:p.lastPoints,answered:p.answered}))});
 r.timer=setTimeout(()=>{if(r.round+1>=r.puzzles.length)endMatch(r);else startRound(r,r.round+1);},REVEAL_MS);
}
function startRound(r,index){
 clearTimeout(r.timer);r.round=index;r.phase='answering';r.deadline=Date.now()+(index>=5?FINAL_MS:QUICK_MS);
 for(const p of r.players.values()){p.answered=false;p.lastCorrect=false;p.lastPoints=0;p.lastAnswerAt=null;}
 const pz=r.puzzles[index];
 emitRoom(r,'round:start',{round:index+1,totalRounds:r.puzzles.length,final:index>=5,category:pz.category,type:pz.type,prompt:pz.prompt,question:pz.question||null,options:pz.options||null,duration:index>=5?FINAL_MS:QUICK_MS,deadline:r.deadline});
 for(const p of r.players.values())if(p.isAI)setTimeout(()=>aiAnswer(r,p.id,index),randomInt(AI_MIN_MS,AI_MAX_MS));
 r.timer=setTimeout(()=>closeRound(r),index>=5?FINAL_MS:QUICK_MS);
}
function aiAnswer(r,id,index){
 if(r.phase!=='answering'||r.round!==index)return;const p=r.players.get(id);if(!p||p.answered)return;
 const puzzle=r.puzzles[index];const correct=Math.random()<0.62;
 let answer=puzzle.answer;
 if(!correct){if(puzzle.options)answer=pick(puzzle.options.filter(x=>x!==puzzle.answer));else answer=puzzle.type==='number'?String(Number(puzzle.answer)+randomInt(1,5)):'maybe';}
 scoreAnswer(r,p,answer,Date.now());emitRoom(r,'score:update',{players:[...r.players.values()].map(q=>({id:q.id,score:q.score,answered:q.answered}))});
}
function scoreAnswer(r,p,answer,at){
 if(p.answered)return false;p.answered=true;p.lastAnswerAt=at;
 const puzzle=r.puzzles[r.round];
 const norm=x=>String(x??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
 const correct=Boolean(norm(answer))&&norm(answer)===norm(puzzle.answer);
 p.lastCorrect=correct;
 if(correct){const duration=r.round>=5?FINAL_MS:QUICK_MS;const remaining=Math.max(0,r.deadline-at);const base=r.round>=5?500:250;const speed=Math.round(base*remaining/duration);p.lastPoints=base+speed;p.score+=p.lastPoints;}
 return true;
}
function beginMatch(r){
 if(['ready','answering','reveal'].includes(r.phase))return;
 r.phase='ready';r.puzzles=buildMatchPuzzles();r.round=-1;
 emitRoom(r,'match:start',{room:roomSnapshot(r)});
 r.timer=setTimeout(()=>startRound(r,0),READY_MS);
}
function addAI(r){
 while(r.players.size<4){const id=`ai-${randomBytes(4).toString('hex')}`;r.players.set(id,{id,name:pick(['Nova','Byte','Pixel','Cosmo','Zippy','Orbit']),color:COLORS[r.players.size%4],avatar:r.players.size%4,isAI:true,score:0,connected:true,answered:false,lastCorrect:false,lastPoints:0});}
}
function createRoom({privateRoom=true,host,mode='idle'}){
 let code=roomCode();while(rooms.has(code))code=roomCode();
 const r={id:`room-${randomBytes(8).toString('hex')}`,code,private:privateRoom,hostId:host.id,players:new Map(),phase:'lobby',round:-1,puzzles:[],timer:null,createdAt:Date.now(),mode};
 rooms.set(code,r);r.players.set(host.id,host);host.score=0;host.answered=false;
 return r;
}
function startQueueMatch(){
 const ids=[...queue].slice(0,4);if(ids.length<4)return;
 for(const id of ids)queue.delete(id);
 const ps=ids.map(id=>players.get(id)).filter(Boolean);if(!ps.length)return;
 const r=createRoom({privateRoom:false,host:ps[0]});r.code=`Q-${roomCode()}`;
 for(const p of ps.slice(1)){r.players.set(p.id,p);p.score=0;p.answered=false;}
 for(const p of ps)io.sockets.sockets.get(p.socketId)?.join(r.id);
 sendRoom(r);beginMatch(r);
}
function endMatch(r){clearTimeout(r.timer);r.phase='results';const ranked=[...r.players.values()].sort((a,b)=>b.score-a.score);const top=ranked[0]?.score;const winners=ranked.filter(p=>p.score===top).map(p=>p.id);emitRoom(r,'match:results',{players:ranked.map(publicPlayer),winnerIds:winners,rematchAvailable:true});sendRoom(r);}
function resumePlayer(socket,r,playerId){
 if(!r)return;
 socket.emit('room:update',roomSnapshot(r));
 if(r.phase==='answering'){
  const pz=r.puzzles[r.round],duration=r.round>=5?FINAL_MS:QUICK_MS;
  socket.emit('round:start',{round:r.round+1,totalRounds:r.puzzles.length,final:r.round>=5,category:pz.category,type:pz.type,prompt:pz.prompt,question:pz.question||null,options:pz.options||null,duration,deadline:r.deadline});
  const player=r.players.get(playerId);
  if(player?.answered)socket.emit('answer:accepted',{correct:player.lastCorrect,points:player.lastPoints,resumed:true});
 }else if(r.phase==='reveal'){
  const pz=r.puzzles[r.round],duration=r.round>=5?FINAL_MS:QUICK_MS;
  socket.emit('round:start',{round:r.round+1,totalRounds:r.puzzles.length,final:r.round>=5,category:pz.category,type:pz.type,prompt:pz.prompt,question:pz.question||null,options:pz.options||null,duration,deadline:r.deadline});
  socket.emit('round:reveal',{correctAnswer:pz.answer,explanation:pz.explain,players:[...r.players.values()].map(p=>({id:p.id,score:p.score,lastCorrect:p.lastCorrect,lastPoints:p.lastPoints,answered:p.answered}))});
 }else if(r.phase==='results'){
  const ranked=[...r.players.values()].sort((a,b)=>b.score-a.score),top=ranked[0]?.score;
  socket.emit('match:results',{players:ranked.map(publicPlayer),winnerIds:ranked.filter(p=>p.score===top).map(p=>p.id),rematchAvailable:true});
 }
}

io.on('connection',socket=>{
 const verified=verifySession(socket.handshake.auth?.token);
 const sub=verified?.sub||randomBytes(18).toString('base64url');
 const provider=verified?.provider||'guest';
 const token=verified?String(socket.handshake.auth.token):signSession(sub,provider);
 const id=hash(`${provider}:${sub}`).slice(0,24);
 const profile=players.get(id)||{};
 const p={id,name:profile.name||`Player ${id.slice(0,4)}`,color:profile.color||COLORS[players.size%4],avatar:profile.avatar??players.size%4,isAI:false,score:profile.score||0,connected:true,answered:profile.answered||false,provider,socketId:socket.id};
 if(profile.id)Object.assign(p,profile,{socketId:socket.id,connected:true});
 players.set(p.id,p);
 const priorRoom=findRoomByPlayerId(p.id);
 if(priorRoom){priorRoom.players.set(p.id,p);socket.join(priorRoom.id);}
 socket.emit('session',{player:{id:p.id,name:p.name,color:p.color,avatar:p.avatar,provider},resumeToken:token});
 if(priorRoom)resumePlayer(socket,priorRoom,p.id);
 socket.on('profile:update',data=>{const cleanName=String(data?.name||'').trim().replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,16);if(cleanName)p.name=cleanName;p.color=COLORS.includes(data?.color)?data.color:p.color;p.avatar=Math.max(0,Math.min(3,Number(data?.avatar)||0));players.set(p.id,p);const r=findRoomByPlayerId(p.id);if(r)sendRoom(r);});
 socket.on('match:find',()=>{if(findRoomByPlayerId(p.id))return;queue.add(p.id);socket.emit('queue:status',{queued:true,humans:queue.size,waitMs:HUMAN_WAIT_MS});startQueueMatch();p.queueTimer=setTimeout(()=>{if(queue.has(p.id)){const waiting=[...queue].slice(0,4);for(const id of waiting)queue.delete(id);const ps=waiting.map(x=>players.get(x)).filter(Boolean);if(!ps.length)return;const r=createRoom({privateRoom:false,host:ps[0]});r.code=`Q-${roomCode()}`;for(const other of ps.slice(1)){r.players.set(other.id,other);other.score=0;}for(const other of ps){io.sockets.sockets.get(other.socketId)?.join(r.id);}addAI(r);sendRoom(r);beginMatch(r);}},HUMAN_WAIT_MS);});
 socket.on('match:cancel',()=>{queue.delete(p.id);clearTimeout(p.queueTimer);socket.emit('queue:status',{queued:false});});
 socket.on('room:create',data=>{if(findRoomByPlayerId(p.id))return;const r=createRoom({privateRoom:true,host:p,mode:data?.mode==='ai'?'ai':'idle'});socket.join(r.id);sendRoom(r);});
 socket.on('room:join',data=>{const code=String(data?.code||'').trim().toUpperCase();const r=rooms.get(code);if(!r||!r.private||r.phase!=='lobby'||r.players.size>=4){socket.emit('room:error',{message:'Room not found, already started, or full.'});return;}if(findRoomByPlayerId(p.id))return;r.players.set(p.id,p);p.score=0;socket.join(r.id);sendRoom(r);if(r.mode==='wait'&&r.players.size===4)beginMatch(r);});
 socket.on('room:start',data=>{const r=rooms.get(String(data?.code||'').toUpperCase());if(!r||r.hostId!==p.id||!r.private||r.phase!=='lobby')return;if(r.players.size<4&&data?.fillAI){addAI(r);}if(r.players.size===4)beginMatch(r);else{r.mode='wait';emitRoom(r,'room:wait',{message:'Waiting for all four invited players. The match will start when everyone joins.'});sendRoom(r);}});
 socket.on('answer:submit',data=>{if(players.get(p.id)?.socketId!==socket.id)return;const r=findRoomByPlayerId(p.id);const activePlayer=r?.players.get(p.id);if(!r||!activePlayer||r.phase!=='answering'||activePlayer.answered||Date.now()>r.deadline)return;const raw=String(data?.answer??'').slice(0,80);const accepted=scoreAnswer(r,activePlayer,raw,Date.now());if(accepted){socket.emit('answer:accepted',{correct:activePlayer.lastCorrect,points:activePlayer.lastPoints});emitRoom(r,'score:update',{players:[...r.players.values()].map(q=>({id:q.id,score:q.score,answered:q.answered}))});}});
 socket.on('reaction',data=>{const message=String(data?.message||'');if(!reactions.has(message))return;const r=findRoomByPlayerId(p.id);if(r)emitRoom(r,'reaction',{playerId:p.id,message});});
 socket.on('room:rematch',()=>{const r=findRoomByPlayerId(p.id);if(r?.phase==='results'){for(const q of r.players.values())q.score=0;beginMatch(r);}});
 socket.on('room:leave',()=>{const r=findRoomByPlayerId(p.id);if(!r)return;socket.leave(r.id);r.players.delete(p.id);if(r.hostId===p.id){r.hostId=r.players.keys().next().value||null;}if(r.players.size===0){clearTimeout(r.timer);for(const [key,value] of rooms)if(value===r)rooms.delete(key);}else sendRoom(r);});
 socket.on('disconnect',()=>{if(p.socketId!==socket.id)return;p.connected=false;players.set(p.id,p);queue.delete(p.id);const r=findRoomByPlayerId(p.id);if(r){sendRoom(r);setTimeout(()=>{if(!p.connected&&r.phase==='lobby'&&p.id!==r.hostId){r.players.delete(p.id);sendRoom(r);}},30000);}});
});

server.listen(PORT,()=>console.log(`Brain Battle Arena listening on ${server.address().port}`));
