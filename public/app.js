const $=id=>document.getElementById(id);
const COLORS=['#20e6ff','#bd70ff','#ff6d9a','#ffd166'];
const TOKEN_KEY='bba.resume.v1', PROFILE_KEY='bba.profile.v1';
let token=localStorage.getItem(TOKEN_KEY),profile=JSON.parse(localStorage.getItem(PROFILE_KEY)||'{}'),me=null,room=null,roundEnds=0,timerTick=null,locked=false,selectedColor=profile.color||COLORS[0],toastTimer;
let googleClientId='',googleConfigLoaded=false;
const socket=io({auth:{token}});
const screens=['home-screen','lobby-screen','game-screen','results-screen'];
function show(id){for(const s of screens)$(s).classList.toggle('hidden',s!==id);}
function toast(message){const t=$('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),2300);}
function connection(online){$('connection').classList.toggle('offline',!online);$('connection').innerHTML=`<i></i> ${online?'Connected':'Reconnecting'}`;}
function showProfile(){ $('player-name').value=profile.name||me?.name||'';selectedColor=profile.color||me?.color||COLORS[0];document.querySelectorAll('.color-options button').forEach(b=>b.classList.toggle('selected',b.dataset.color===selectedColor));$('profile-dialog').showModal();}
function saveProfile(){const name=$('player-name').value.trim().slice(0,16)||`Player ${(me?.id||'').slice(0,4)}`;profile={name,color:selectedColor};localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));socket.emit('profile:update',{...profile,avatar:0});$('profile-dialog').close();toast('Player card saved');}
function renderPlayers(containerId,players){const el=$(containerId);el.innerHTML='';for(let i=0;i<4;i++){const p=players[i];const d=document.createElement('div');d.className=`player-slot${p?'':' empty'}`;if(p){d.innerHTML=`<div class="player-orb" style="--pc:${safe(p.color)}">${p.isAI?'✦':'●'}</div><strong>${esc(p.name)} ${p.id===me?.id?'<small>(YOU)</small>':''}</strong><small>${p.isAI?'AI OPPONENT':'PLAYER'}</small>`;}else d.innerHTML='<span>＋</span><small>OPEN SEAT</small>';el.append(d);}}
function safe(s){return COLORS.includes(s)?s:COLORS[0]}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function roomUpdate(r){room=r;$('lobby-code').textContent=r.code;$('lobby-message').textContent=r.mode==='wait'&&r.players.length<4?'Waiting for all four invited players…':`${r.players.length} / 4 players in the arena`;$('host-controls').classList.toggle('hidden',r.hostId!==me?.id);$('guest-wait').classList.toggle('hidden',r.hostId===me?.id);renderPlayers('lobby-players',r.players);if(r.phase!=='lobby')renderScores(r.players);if(r.phase==='lobby')show('lobby-screen');}
function renderScores(list){const sorted=[...list].sort((a,b)=>b.score-a.score);$('scoreboard').innerHTML=sorted.map((p,i)=>`<div class="score-row ${p.id===me?.id?'me':''}"><div class="score-dot" style="--pc:${safe(p.color)}">${i+1}</div><div class="score-name">${esc(p.name)}${p.isAI?'<small>AI</small>':''}</div><div class="score-value">${Number(p.score)||0}</div></div>`).join('');}
function startClock(duration,deadline){clearInterval(timerTick);roundEnds=deadline||Date.now()+duration;const circumference=113.1;const tick=()=>{const remain=Math.max(0,roundEnds-Date.now());const fraction=Math.min(1,remain/duration);$('timer').textContent=String(Math.ceil(remain/1000));$('timer-progress').style.strokeDashoffset=String(circumference*(1-fraction));if(remain<=0)clearInterval(timerTick);};tick();timerTick=setInterval(tick,100);}
function beginPuzzle(data){show('game-screen');locked=false;$('round-label').textContent=`${data.final?'FINAL CHALLENGE':'PUZZLE'} ${data.round} OF ${data.totalRounds}`;$('match-tag').textContent=data.final?'FINAL · BONUS ROUND':'QUICK ROUND';$('puzzle-category').textContent=data.category.toUpperCase();$('stage-label').textContent=data.final?`STAGE ${data.round-5} / 3`:'FINAL STAGE';$('stage-label').classList.toggle('hidden',!data.final);$('puzzle-prompt').textContent=data.prompt;$('answer-feedback').textContent='';$('answer-feedback').className='answer-feedback';$('reveal').classList.add('hidden');$('answer-area').innerHTML='';
 const showChoices=()=>{ $('answer-area').innerHTML='';for(const answer of data.options||[]){const b=document.createElement('button');b.className='answer-option';b.textContent=answer;b.onclick=()=>submit(answer,b);$('answer-area').append(b);}};
 if(data.type==='choice')showChoices();
 else if(data.type==='memory'){setTimeout(()=>{$('puzzle-prompt').textContent=data.question||'Which sequence did you see?';showChoices();},3500);}
 else {const row=document.createElement('div');row.className='entry-row';const input=document.createElement('input');input.id='answer-input';input.autocomplete='off';input.maxLength=32;input.placeholder=data.type==='number'?'Type your number':'Type your answer';input.inputMode=data.type==='number'?'numeric':'text';input.setAttribute('aria-label','Your answer');const b=document.createElement('button');b.className='button primary';b.textContent='Submit';b.onclick=()=>submit(input.value,b);input.addEventListener('keydown',e=>{if(e.key==='Enter')submit(input.value,b)});row.append(input,b);$('answer-area').append(row);setTimeout(()=>input.focus({preventScroll:true}),80);}
 startClock(data.duration,data.deadline);}
function submit(answer,button){if(locked)return;if(!String(answer||'').trim()){const f=$('answer-feedback');f.textContent='Add an answer before submitting.';f.className='answer-feedback error';return;}locked=true;document.querySelectorAll('#answer-area button,#answer-input').forEach(x=>x.disabled=true);if(button)button.classList.add('selected');socket.emit('answer:submit',{answer:String(answer).slice(0,80)});}
function result(data){clearInterval(timerTick);show('results-screen');const ranked=data.players;const mine=ranked.find(p=>p.id===me?.id);const winners=ranked.filter(p=>data.winnerIds.includes(p.id));const winner=winners[0];$('result-title').textContent=winners.length>1?(data.winnerIds.includes(me?.id)?'You are tied for the crown!':'It’s a tie!'):winner?.id===me?.id?'You are the Brain Battle champion!':`${winner?.name||'A player'} takes the crown!`;$('result-subtitle').textContent=mine?`You scored ${mine.score} points. Ready for another brain battle?`:'The arena has spoken!';$('final-standings').innerHTML=ranked.map((p,i)=>`<div class="standing ${data.winnerIds.includes(p.id)?'winner':''}"><div class="rank">${data.winnerIds.includes(p.id)?'✦':`0${i+1}`}</div><div class="score-dot" style="--pc:${safe(p.color)}">${i+1}</div><div class="standing-name">${esc(p.name)}${p.isAI?' · AI':''}${p.id===me?.id?' · YOU':''}</div><div class="standing-points">${p.score} PTS</div></div>`).join('');}
socket.on('connect',()=>{connection(true);const loading=$('loading');if(loading){loading.classList.add('done');setTimeout(()=>loading.remove(),450);}if(profile.name)socket.emit('profile:update',{...profile,avatar:0});});
socket.on('disconnect',()=>connection(false));
socket.on('session',data=>{me=data.player;token=data.resumeToken;localStorage.setItem(TOKEN_KEY,token);$('account-note').textContent=data.player.provider==='google'?'Google account connected.':googleConfigLoaded?(googleClientId?'Guest account is ready, or connect Google for a verified identity.':'Guest account is ready. Google sign-in is not configured on this server.'):'Guest account is ready.';if(profile.name)socket.emit('profile:update',{...profile,avatar:0});});
socket.on('queue:status',data=>{if(data.queued){show('lobby-screen');$('lobby-code').textContent='…';$('lobby-message').textContent='Finding players… AI joins after 20 seconds';$('host-controls').classList.add('hidden');$('guest-wait').classList.remove('hidden');renderPlayers('lobby-players',[]);}else if(!room)show('home-screen');});
socket.on('room:update',r=>roomUpdate(r));
socket.on('room:error',e=>toast(e.message));
socket.on('room:wait',data=>{$('lobby-message').textContent=data.message;});
socket.on('match:start',data=>{room=data.room;renderScores(room.players);show('game-screen');toast('Match starting — brains ready!');});
socket.on('round:start',beginPuzzle);
socket.on('answer:accepted',data=>{const f=$('answer-feedback');f.textContent=data.correct?`Correct! +${data.points} points`:'Answer locked in';f.className=`answer-feedback ${data.correct?'success':''}`;if(data.resumed){locked=true;document.querySelectorAll('#answer-area button,#answer-input').forEach(x=>x.disabled=true);}});
socket.on('score:update',data=>{if(room)renderScores(room.players.map(p=>({...p,...data.players.find(s=>s.id===p.id)})));});
socket.on('round:reveal',data=>{locked=true;clearInterval(timerTick);document.querySelectorAll('#answer-area button,#answer-input').forEach(x=>x.disabled=true);$('reveal').textContent=`Answer: ${data.correctAnswer} · ${data.explanation}`;$('reveal').classList.remove('hidden');if(room){room.players=room.players.map(p=>({...p,...data.players.find(s=>s.id===p.id)}));renderScores(room.players);}});
socket.on('match:results',result);
socket.on('reaction',data=>{const n=document.createElement('div');n.className='reaction-toast';n.textContent=`${room?.players.find(p=>p.id===data.playerId)?.name||'Player'}: ${data.message}`;document.body.append(n);setTimeout(()=>n.remove(),1800);});

$('quick-play').onclick=()=>{room=null;socket.emit('match:find');};
$('create-room').onclick=()=>{room=null;socket.emit('room:create',{mode:'wait'});show('lobby-screen');$('lobby-message').textContent='Creating your private room…';};
$('join-room').onclick=()=>{const code=$('room-code').value.trim();if(!code){toast('Enter an invite code first');return;}room=null;socket.emit('room:join',{code});show('lobby-screen');$('lobby-message').textContent='Joining the arena…';};
$('room-code').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase());
$('leave-room').onclick=()=>{socket.emit('match:cancel');socket.emit('room:leave');room=null;show('home-screen');};
$('copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(room?.code||'');toast('Invite code copied');}catch{toast(`Invite code: ${room?.code||''}`);}};
$('start-wait').onclick=()=>socket.emit('room:start',{code:room?.code,fillAI:false});
$('start-ai').onclick=()=>socket.emit('room:start',{code:room?.code,fillAI:true});
document.querySelectorAll('[data-reaction]').forEach(b=>b.onclick=()=>socket.emit('reaction',{message:b.dataset.reaction}));
$('profile-open').onclick=showProfile;$('save-profile').onclick=e=>{e.preventDefault();saveProfile()};document.querySelector('.dialog-close').onclick=()=> $('profile-dialog').close();
document.querySelectorAll('.color-options button').forEach(b=>{b.style.background=b.dataset.color;b.onclick=()=>{selectedColor=b.dataset.color;document.querySelectorAll('.color-options button').forEach(x=>x.classList.toggle('selected',x===b));}});
$('google-login').hidden=true;
$('rematch').onclick=()=>{if(room)socket.emit('room:rematch');};$('home-button').onclick=()=>{socket.emit('room:leave');room=null;show('home-screen');};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
fetch('/api/config').then(r=>r.json()).then(async config=>{
 googleClientId=config.googleClientId||'';googleConfigLoaded=true;
 $('google-divider').hidden=!googleClientId;
 if(me?.provider==='google')$('account-note').textContent='Google account connected.';
 else $('account-note').textContent=googleClientId?'Guest account is ready, or connect Google for a verified identity.':'Guest account is ready. Google sign-in is not configured on this server.';
 if(!googleClientId)return;
 try{
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=resolve;script.onerror=reject;document.head.append(script);});
  google.accounts.id.initialize({client_id:googleClientId,callback:async response=>{try{const auth=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:response.credential})});const data=await auth.json();if(!auth.ok)throw new Error(data.error||'Sign-in failed');token=data.token;localStorage.setItem(TOKEN_KEY,token);if(data.name&&!profile.name){profile.name=data.name.slice(0,16);localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}$('account-note').textContent='Google account connected.';socket.auth={token};socket.disconnect().connect();$('profile-dialog').close();}catch(error){$('account-note').textContent=error.message;}}});
  google.accounts.id.renderButton($('google-login'),{type:'standard',theme:'outline',size:'large',text:'continue_with',shape:'rectangular',width:340});$('google-login').hidden=false;
 }catch{$('google-login').hidden=true;$('google-divider').hidden=true;$('account-note').textContent='Google sign-in could not load. Guest play is ready.';}
}).catch(()=>{$('google-login').hidden=true;googleConfigLoaded=true;$('account-note').textContent='Google setup status could not be loaded. Guest play is ready.';});
