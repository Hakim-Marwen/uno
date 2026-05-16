const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const { v4: uuidv4 } = require('uuid');
const GameManager = require('./gameManager');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, clientTracking: true });
const PORT   = process.env.PORT || 3000;
const HOST   = process.env.HOST || '0.0.0.0';
const gm     = new GameManager();

// ── HTTP ──────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.get('/health', (_q, r) => r.json({ ok: true, rooms: gm.count() }));
app.get('*', (_q, r) => r.sendFile(path.join(__dirname, '../public/index.html')));

// ── Heartbeat ─────────────────────────────────────────────────
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

// ── WebSocket ─────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  ws.isAlive  = true;
  ws.roomCode = null;
  ws.playerId = null;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    ws.isAlive = true;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    dispatch(ws, msg);
  });

  ws.on('close', () => {
    if (ws.roomCode && ws.playerId) doLeave(ws.roomCode, ws.playerId);
  });

  ws.on('error', err => console.error('[WSerr]', err.message));
  push(ws, { type: 'CONNECTED' });
});

// ── Dispatch ──────────────────────────────────────────────────
function dispatch(ws, msg) {
  switch (msg.type) {
    case 'CREATE_ROOM': return doCreate(ws, msg);
    case 'JOIN_ROOM':   return doJoin(ws, msg);
    case 'LEAVE_ROOM':  { doLeave(ws.roomCode, ws.playerId); ws.roomCode = null; ws.playerId = null; return; }
    case 'START_GAME':  return doStart(ws);
    case 'PLAY_CARD':   return doPlay(ws, msg);
    case 'DRAW_CARD':   return doDraw(ws);
    case 'CALL_UNO':    return doUno(ws);
    case 'NEW_GAME':    return doNew(ws);
    case 'PING':        return push(ws, { type: 'PONG' });
    default: push(ws, { type: 'error', message: `Type inconnu: ${msg.type}` });
  }
}

// ── Handlers ──────────────────────────────────────────────────
function doCreate(ws, msg) {
  const name = (msg.playerName || '').trim();
  if (!name) return push(ws, { type: 'error', message: 'Pseudo requis' });

  const playerId = uuidv4();
  const room     = gm.create(playerId, name);
  ws.roomCode    = room.code;
  ws.playerId    = playerId;

  push(ws, { type: 'ROOM_CREATED', roomCode: room.code, playerId, room: room.stateFor(playerId) });
  console.log(`[CREATE] ${room.code} by "${name}"`);
}

function doJoin(ws, msg) {
  const name = (msg.playerName || '').trim();
  const code = (msg.roomCode   || '').trim().toUpperCase();
  if (!name || !code) return push(ws, { type: 'error', message: 'Pseudo et code requis' });

  const room = gm.get(code);
  if (!room)                    return push(ws, { type: 'error', message: 'Salle introuvable — vérifiez le code' });
  if (room.phase !== 'waiting') return push(ws, { type: 'error', message: 'Partie déjà commencée' });
  if (room.players.length >= 10) return push(ws, { type: 'error', message: 'Salle pleine (max 10)' });

  const playerId = uuidv4();
  room.addPlayer(playerId, name);

  // ⚠️  Assigner AVANT le broadcast pour que ce client soit inclus
  ws.roomCode = code;
  ws.playerId = playerId;

  push(ws, { type: 'ROOM_JOINED', roomCode: room.code, playerId, room: room.stateFor(playerId) });
  bcast(room);   // envoie GAME_STATE à tous les membres (hôte + nouveaux joueurs)
  console.log(`[JOIN] "${name}" → ${code} (${room.players.length} joueurs)`);
}

function doLeave(roomCode, playerId) {
  if (!roomCode || !playerId) return;
  const room = gm.get(roomCode);
  if (!room) return;

  const name = room.getPlayerName(playerId);
  room.removePlayer(playerId);

  if (room.players.length === 0) {
    gm.delete(roomCode);
    console.log(`[DELETE] ${roomCode} (vide)`);
  } else {
    if (room.phase === 'playing' && room.players.length === 1) {
      room.phase  = 'finished';
      room.winner = room.players[0].id;
    }
    bcast(room);
    console.log(`[LEAVE] "${name}" ← ${roomCode} (${room.players.length} restants)`);
  }
}

function doStart(ws) {
  const room = gm.get(ws.roomCode);
  if (!room)                      return push(ws, { type: 'error', message: 'Salle introuvable' });
  if (room.hostId !== ws.playerId) return push(ws, { type: 'error', message: "Seul l'hôte peut démarrer" });
  if (room.players.length < 2)    return push(ws, { type: 'error', message: 'Il faut au moins 2 joueurs' });
  if (room.phase !== 'waiting')   return push(ws, { type: 'error', message: 'Partie déjà lancée' });

  room.startGame();
  bcast(room);
  console.log(`[START] ${room.code} (${room.players.length} joueurs)`);
}

function doPlay(ws, msg) {
  const room = gm.get(ws.roomCode);
  if (!room) return;
  const r = room.playCard(ws.playerId, msg.cardId, msg.wildColor);
  if (r.error) return push(ws, { type: 'error', message: r.error });
  bcast(room);
}

function doDraw(ws) {
  const room = gm.get(ws.roomCode);
  if (!room) return;
  const r = room.drawCard(ws.playerId);
  if (r.error) return push(ws, { type: 'error', message: r.error });
  bcast(room);
}

function doUno(ws) {
  const room = gm.get(ws.roomCode);
  if (!room) return;
  room.callUno(ws.playerId);
  bcastExtra(room, { type: 'UNO_CALLED', playerName: room.getPlayerName(ws.playerId) });
}

function doNew(ws) {
  const room = gm.get(ws.roomCode);
  if (!room) return;
  if (room.hostId !== ws.playerId) return push(ws, { type: 'error', message: "Seul l'hôte peut relancer" });
  room.resetGame();
  room.startGame();
  bcast(room);
}

// ── Broadcast ─────────────────────────────────────────────────
function bcast(room) {
  let n = 0;
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.roomCode !== room.code) continue;
    ws.send(JSON.stringify({ type: 'GAME_STATE', room: room.stateFor(ws.playerId) }));
    n++;
  }
  console.log(`[BCAST] ${room.code} → ${n} clients | phase=${room.phase} players=${room.players.map(p=>p.name).join(',')}`);
}

function bcastExtra(room, extra) {
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (ws.roomCode !== room.code) continue;
    ws.send(JSON.stringify({ type: 'GAME_STATE', room: room.stateFor(ws.playerId) }));
    ws.send(JSON.stringify(extra));
  }
}

function push(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// ── GC ────────────────────────────────────────────────────────
setInterval(() => {
  const n = gm.cleanup(3_600_000);
  if (n) console.log(`[GC] ${n} salle(s) supprimée(s)`);
}, 600_000);

// ── Start ─────────────────────────────────────────────────────
server.listen(PORT, HOST, () => console.log(`\n🃏  UNO  http://localhost:${PORT}\n`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
