/**
 * UNO Multijoueur - Serveur Node.js
 * Compatible : Render, Railway, Heroku, VPS
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const GameManager = require('./gameManager');

const app = express();
const server = http.createServer(app);

// WebSocket attaché au même serveur HTTP (compatible proxy)
const wss = new WebSocket.Server({
  server,
  // Accepte les connexions sur n'importe quel path (/ws, /, etc.)
  path: undefined,
  // Timeout de ping/pong pour détecter les connexions mortes
  clientTracking: true,
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const gameManager = new GameManager();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

// Fichiers statiques
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '1h',
  etag: true,
}));

// ─── Routes HTTP ─────────────────────────────────────────────────────────────

// Health check (requis par Render, Railway, etc.)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: gameManager.getRoomList().length,
    uptime: Math.floor(process.uptime()),
  });
});

// API debug
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: gameManager.getRoomList() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

// Ping/pong pour maintenir les connexions vivantes (requis sur Render/Heroku)
const PING_INTERVAL = 20000; // 20s
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log(`[WS] Connexion morte supprimée : ${ws.id}`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, PING_INTERVAL);

wss.on('connection', (ws, req) => {
  ws.id = uuidv4();
  ws.roomCode = null;
  ws.playerId = null;
  ws.isAlive = true;

  // Gérer le pong de heartbeat
  ws.on('pong', () => { ws.isAlive = true; });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[WS] Connexion : ${ws.id} (${ip})`);

  ws.on('message', (rawData) => {
    ws.isAlive = true; // Toute activité = connexion vivante
    try {
      const msg = JSON.parse(rawData.toString());
      handleMessage(ws, msg);
    } catch (e) {
      sendTo(ws, { type: 'error', message: 'Message invalide' });
    }
  });

  ws.on('close', (code) => {
    console.log(`[WS] Déconnexion : ${ws.id} (code=${code})`);
    if (ws.roomCode && ws.playerId) {
      handleLeave(ws);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Erreur ${ws.id}:`, err.message);
  });

  // Envoyer un message de bienvenue pour confirmer la connexion
  sendTo(ws, { type: 'CONNECTED', id: ws.id });
});

// ─── Gestion des messages ─────────────────────────────────────────────────────
function handleMessage(ws, msg) {
  const { type } = msg;
  switch (type) {
    case 'CREATE_ROOM':  return handleCreateRoom(ws, msg);
    case 'JOIN_ROOM':    return handleJoinRoom(ws, msg);
    case 'LEAVE_ROOM':   return handleLeave(ws);
    case 'START_GAME':   return handleStartGame(ws);
    case 'PLAY_CARD':    return handlePlayCard(ws, msg);
    case 'DRAW_CARD':    return handleDrawCard(ws);
    case 'CALL_UNO':     return handleCallUno(ws);
    case 'PICK_COLOR':   return handlePickColor(ws, msg);
    case 'NEW_GAME':     return handleNewGame(ws);
    case 'PING':         return sendTo(ws, { type: 'PONG' });
    default:
      sendTo(ws, { type: 'error', message: `Type inconnu: ${type}` });
  }
}

function handleCreateRoom(ws, msg) {
  const { playerName } = msg;
  if (!playerName || !playerName.trim()) {
    return sendTo(ws, { type: 'error', message: 'Pseudo requis' });
  }
  const playerId = uuidv4();
  const room = gameManager.createRoom(playerId, playerName.trim());
  ws.roomCode = room.code;
  ws.playerId = playerId;
  sendTo(ws, { type: 'ROOM_CREATED', roomCode: room.code, playerId, room: room.getPublicState(playerId) });
  console.log(`[ROOM] Créée : ${room.code} par ${playerName}`);
}

function handleJoinRoom(ws, msg) {
  const { playerName, roomCode } = msg;
  if (!playerName || !roomCode) return sendTo(ws, { type: 'error', message: 'Pseudo et code requis' });

  const room = gameManager.getRoom(roomCode.toUpperCase());
  if (!room) return sendTo(ws, { type: 'error', message: 'Salle introuvable' });
  if (room.phase !== 'waiting') return sendTo(ws, { type: 'error', message: 'Partie déjà commencée' });
  if (room.players.length >= 10) return sendTo(ws, { type: 'error', message: 'Salle pleine (max 10)' });

  const playerId = uuidv4();
  room.addPlayer(playerId, playerName.trim());
  ws.roomCode = roomCode.toUpperCase();
  ws.playerId = playerId;

  // D'abord envoyer la confirmation au joueur qui rejoint
  sendTo(ws, { type: 'ROOM_JOINED', roomCode: room.code, playerId, room: room.getPublicState(playerId) });
  // Ensuite broadcaster à tous (y compris le nouveau)
  broadcastRoomState(room);
  console.log(`[ROOM] ${playerName} a rejoint ${room.code} (${room.players.length} joueurs)`);
}

function handleLeave(ws) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;
  const playerName = room.getPlayerName(ws.playerId);
  room.removePlayer(ws.playerId);
  if (room.players.length === 0) {
    gameManager.deleteRoom(ws.roomCode);
    console.log(`[ROOM] Supprimée : ${ws.roomCode}`);
  } else {
    if (room.phase === 'playing' && room.players.length === 1) {
      room.phase = 'finished';
      room.winner = room.players[0].id;
    }
    broadcastRoomState(room);
  }
  ws.roomCode = null;
  ws.playerId = null;
  console.log(`[ROOM] ${playerName || '?'} a quitté`);
}

function handleStartGame(ws) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return sendTo(ws, { type: 'error', message: 'Salle introuvable' });
  if (room.hostId !== ws.playerId) return sendTo(ws, { type: 'error', message: "Seul l'hôte peut démarrer" });
  if (room.players.length < 2) return sendTo(ws, { type: 'error', message: 'Minimum 2 joueurs' });
  if (room.phase !== 'waiting') return sendTo(ws, { type: 'error', message: 'Partie déjà en cours' });
  room.startGame();
  broadcastRoomState(room);
  console.log(`[GAME] Démarrée : ${room.code} (${room.players.length} joueurs)`);
}

function handlePlayCard(ws, msg) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;
  const result = room.playCard(ws.playerId, msg.cardId, msg.wildColor);
  if (result.error) return sendTo(ws, { type: 'error', message: result.error });
  broadcastRoomState(room);
}

function handleDrawCard(ws) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;
  const result = room.drawCard(ws.playerId);
  if (result.error) return sendTo(ws, { type: 'error', message: result.error });
  broadcastRoomState(room);
}

function handleCallUno(ws) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;
  room.callUno(ws.playerId);
  broadcastToRoom(room, { type: 'UNO_CALLED', playerName: room.getPlayerName(ws.playerId) });
}

function handlePickColor(ws, msg) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;
  const result = room.pickColor(ws.playerId, msg.color);
  if (result.error) return sendTo(ws, { type: 'error', message: result.error });
  broadcastRoomState(room);
}

function handleNewGame(ws) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;
  if (room.hostId !== ws.playerId) return sendTo(ws, { type: 'error', message: "Seul l'hôte peut relancer" });
  room.resetGame();
  room.startGame();
  broadcastRoomState(room);
  console.log(`[GAME] Relancée : ${room.code}`);
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(room, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === room.code) {
      client.send(JSON.stringify(data));
    }
  });
}

function broadcastRoomState(room) {
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === room.code) {
      client.send(JSON.stringify({
        type: 'GAME_STATE',
        room: room.getPublicState(client.playerId),
      }));
      sent++;
    }
  });
  console.log(`[BROADCAST] ${room.code} phase=${room.phase} players=${room.players.length} sent=${sent}`);
}

// ─── Nettoyage des salles inactives ──────────────────────────────────────────
setInterval(() => {
  const deleted = gameManager.cleanupOldRooms(3600000);
  if (deleted > 0) console.log(`[CLEANUP] ${deleted} salle(s) supprimée(s)`);
}, 600000);

// ─── Démarrage ───────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`\n🃏  UNO Serveur démarré`);
  console.log(`    http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`    Env : ${process.env.NODE_ENV || 'development'}`);
  console.log(`    PID : ${process.pid}\n`);
});

// Gestion propre des arrêts
process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM reçu, fermeture propre...');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT reçu, fermeture propre...');
  server.close(() => process.exit(0));
});
