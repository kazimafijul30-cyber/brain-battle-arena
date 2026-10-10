import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { io as connect } from 'socket.io-client';

let child, baseUrl, logs = '';
const clients = [];
function waitFor(socket, event, predicate = () => true, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, ms);
    const handler = value => { if (!predicate(value)) return; clearTimeout(timer); socket.off(event, handler); resolve(value); };
    socket.on(event, handler);
  });
}
function makeClient(token) {
  const socket = connect(baseUrl, { autoConnect: false, reconnection: false, auth: token ? { token } : {} });
  clients.push(socket); socket.connect(); return socket;
}
async function clientReady() {
  const socket = makeClient();
  const [session] = await Promise.all([waitFor(socket, 'session'), waitFor(socket, 'connect')]);
  return { socket, session };
}
function answerFor(puzzle) {
  const p = puzzle.prompt;
  if (p.includes('2, 4, 8, 16')) return '32';
  if (p.includes('Mira is taller')) return 'Lee';
  if (p.includes('3 trays with 4 bolts')) return '12';
  if (p.includes('Memorize this sequence')) return 'Blue, purple, green, yellow';
  if (p.includes('R A E T H')) return 'heart';
  if (p.includes('most sides')) return 'Hexagon';
  if (p.includes('27 − 9')) return '18';
  if (p.includes('today is Tuesday')) return 'Friday';
  if (p.includes('opposite of')) return 'hot';
  if (p.includes('3, 6, 9, 11, 12')) return '11';
  if (p.includes('5 rows of 5')) return '25';
  if (p.includes('runner in second place')) return 'Second';
  if (p.includes('stitch in time')) return 'nine';
  throw new Error(`No test answer for puzzle: ${p}`);
}
function answerRounds(socket, onFirstRound) {
  let first = true;
  socket.on('round:start', puzzle => {
    if (first) { first = false; onFirstRound?.(puzzle); }
    socket.emit('answer:submit', { answer: answerFor(puzzle) });
  });
}

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '0', BBA_QUICK_MS: '700', BBA_FINAL_MS: '700', BBA_HUMAN_WAIT_MS: '220', BBA_REVEAL_MS: '12', BBA_READY_MS: '12', BBA_AI_MIN_MS: '8', BBA_AI_MAX_MS: '30' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const match = logs.match(/listening on (\d+)/);
    if (match) { baseUrl = `http://127.0.0.1:${match[1]}`; return; }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not start. Output: ${logs}`);
});
after(() => { for (const c of clients) c.disconnect(); child?.kill(); });

test('serves installable PWA assets and fails Google sign-in safely when unconfigured', async () => {
  const [health, page, manifest, worker, icon192, icon512, config, auth] = await Promise.all([
    fetch(`${baseUrl}/health`), fetch(`${baseUrl}/`), fetch(`${baseUrl}/manifest.webmanifest`), fetch(`${baseUrl}/sw.js`),
    fetch(`${baseUrl}/icon-192.png`), fetch(`${baseUrl}/icon-512.png`),
    fetch(`${baseUrl}/api/config`), fetch(`${baseUrl}/api/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: 'fake' }) })
  ]);
  assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
  assert.equal(page.status, 200); assert.match(await page.text(), /Brain Battle Arena/);
  assert.equal(manifest.status, 200); const pwa = await manifest.json(); assert.equal(pwa.display, 'standalone');
  assert.ok(pwa.icons.some(icon => icon.sizes.includes('192'))); assert.ok(pwa.icons.some(icon => icon.sizes.includes('512')));
  for (const [response, expectedSize] of [[icon192,192],[icon512,512]]) {
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
    const bytes = await response.arrayBuffer(); const view = new DataView(bytes);
    assert.equal(view.getUint32(16), expectedSize); assert.equal(view.getUint32(20), expectedSize);
  }
  assert.equal(worker.status, 200); assert.match(await worker.text(), /addEventListener\('fetch'/);
  assert.equal((await config.json()).googleClientId, '');
  assert.equal(auth.status, 503); assert.match((await auth.json()).error, /not configured/);
});

test('four human sessions share and finish a fully scored match; reconnect and duplicate submits stay idempotent', async () => {
  const group = await Promise.all(Array.from({ length: 4 }, () => clientReady()));
  const results = group.map(({ socket }) => waitFor(socket, 'match:results', undefined, 20000));
  const starts = group.map(({ socket }) => waitFor(socket, 'match:start'));
  const firstScore = waitFor(group[0].socket, 'score:update', update => update.players.find(p => p.id === group[0].session.player.id)?.score > 0);
  const firstAccepted = waitFor(group[0].socket, 'answer:accepted');
  const scoreHistory = [];
  const recordScore = update => scoreHistory.push(update.players.find(p => p.id === group[0].session.player.id)?.score ?? 0);
  group[0].socket.on('score:update', recordScore);
  for (const { socket } of group) answerRounds(socket);
  group[0].socket.emit('match:find');
  for (const { socket } of group.slice(1)) socket.emit('match:find');
  const rooms = await Promise.all(starts);
  assert.ok(rooms.every(x => x.room.players.length === 4 && x.room.players.every(p => !p.isAI)));
  const round0 = await Promise.all(group.map(({ socket }) => waitFor(socket, 'round:start')));
  assert.equal(new Set(round0.map(x => x.deadline)).size, 1, 'all players receive the same authoritative deadline');
  await firstAccepted;
  group[0].socket.emit('answer:submit', { answer: answerFor(round0[0]) });
  await firstScore;
  const oldSocket = group[0].socket;
  const replacement = makeClient(group[0].session.resumeToken);
  group[0].socket = replacement;
  replacement.on('score:update', recordScore);
  answerRounds(replacement);
  const resumedAck = waitFor(replacement, 'answer:accepted', value => value.resumed === true);
  await waitFor(replacement, 'session');
  oldSocket.off('score:update', recordScore);
  await resumedAck;
  oldSocket.emit('answer:submit', { answer: answerFor(round0[0]) });
  const all = await Promise.all(results);
  assert.equal(all[0].players.length, 4); assert.equal(all[0].players.every(p => p.score > 0), true);
  assert.equal(scoreHistory.filter((score, index) => score > (scoreHistory[index - 1] || 0)).length, 8, `each of eight rounds should award this player exactly once: ${JSON.stringify(scoreHistory)}`);
  assert.equal(all[0].winnerIds.length > 0, true);
  assert.deepEqual(all[0].players.map(p => p.id).sort(), group.map(x => x.session.player.id).sort());
});

test('20-second queue policy adds labeled AI seats, and private host can start with AI or wait for friends', async () => {
  const queued = await clientReady();
  const aiStart = waitFor(queued.socket, 'match:start', data => data.room.players.length === 4, 5000);
  const aiScore = waitFor(queued.socket, 'score:update', data => data.players.some(p => p.id.startsWith('ai-') && p.score > 0), 5000);
  queued.socket.emit('match:find');
  const started = await aiStart;
  assert.equal(started.room.players.filter(p => p.isAI).length, 3);
  assert.ok(started.room.players.filter(p => p.isAI).every(p => p.name && p.isAI === true));
  const aiUpdate = await aiScore;
  assert.ok(aiUpdate.players.some(p => p.id.startsWith('ai-') && p.score > 0), 'AI opponents submit answers and score through the shared scoring function');

  const host = await clientReady();
  const created = waitFor(host.socket, 'room:update', room => room.phase === 'lobby');
  host.socket.emit('room:create', { mode: 'wait' });
  const privateRoom = await created;
  assert.equal(privateRoom.private, true); assert.match(privateRoom.code, /^[A-F0-9]{6}$/);
  const friends = await Promise.all(Array.from({ length: 3 }, () => clientReady()));
  const waitingStart = waitFor(host.socket, 'room:update', room => room.players.length === 2);
  friends[0].socket.emit('room:join', { code: privateRoom.code });
  await waitingStart;
  host.socket.emit('room:start', { code: privateRoom.code, fillAI: false });
  const began = waitFor(host.socket, 'match:start', data => data.room.private);
  // Joining the fourth seat auto-starts a room placed into wait mode.
  for (const friend of friends.slice(1)) friend.socket.emit('room:join', { code: privateRoom.code });
  const roomStarted = await began;
  assert.equal(roomStarted.room.players.length, 4); assert.ok(roomStarted.room.players.every(p => !p.isAI));

  const host2 = await clientReady();
  const created2 = waitFor(host2.socket, 'room:update', room => room.phase === 'lobby');
  host2.socket.emit('room:create', {}); const room2 = await created2;
  const aiPrivate = waitFor(host2.socket, 'match:start', data => data.room.private);
  host2.socket.emit('room:start', { code: room2.code, fillAI: true });
  const early = await aiPrivate;
  assert.equal(early.room.players.length, 4); assert.equal(early.room.players.filter(p => p.isAI).length, 3);
});
