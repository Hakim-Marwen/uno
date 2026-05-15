/**
 * UNO Multijoueur - Serveur Node.js
 * Utilise Express pour le HTTP et ws pour les WebSockets temps réel
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const GameManager = require('./gameManager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const gameManager = new GameManager();

// ─── Serveur de fichiers statiques ────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ─── API REST (optionnel - pour debug) ────────────────────────────────────────
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: gameManager.getRoomList() });
});

// ─── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.id = uuidv4();
  ws.roomCode = null;
  ws.playerId = null;

  console.log(`[WS] Connexion : ${ws.id}`);

  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      handleMessage(ws, msg);
    } catch (e) {
      sendTo(ws, { type: 'error', message: 'Message invalide' });
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Déconnexion : ${ws.id}`);
    if (ws.roomCode && ws.playerId) {
      handleLeave(ws);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Erreur ${ws.id}:`, err.message);
  });
});

// ─── Gestion des messages ─────────────────────────────────────────────────────
function handleMessage(ws, msg) {
  const { type } = msg;

  switch (type) {
    case 'CREATE_ROOM':   return handleCreateRoom(ws, msg);
    case 'JOIN_ROOM':     return handleJoinRoom(ws, msg);
    case 'LEAVE_ROOM':    return handleLeave(ws);
    case 'START_GAME':    return handleStartGame(ws);
    case 'PLAY_CARD':     return handlePlayCard(ws, msg);
    case 'DRAW_CARD':     return handleDrawCard(ws);
    case 'CALL_UNO':      return handleCallUno(ws);
    case 'PICK_COLOR':    return handlePickColor(ws, msg);
    case 'NEW_GAME':      return handleNewGame(ws);
    case 'PING':          return sendTo(ws, { type: 'PONG' });
    default:
      sendTo(ws, { type: 'error', message: `Type inconnu: ${type}` });
  }
}

function handleCreateRoom(ws, msg) {
  const { playerName } = msg;
  if (!playerName || playerName.trim().length === 0) {
    return sendTo(ws, { type: 'error', message: 'Pseudo requis' });
  }

  const playerId = uuidv4();
  const room = gameManager.createRoom(playerId, playerName.trim());

  ws.roomCode = room.code;
  ws.playerId = playerId;

  sendTo(ws, {
    type: 'ROOM_CREATED',
    roomCode: room.code,
    playerId,
    room: room.getPublicState(playerId)
  });

  console.log(`[ROOM] Créée : ${room.code} par ${playerName}`);
}

function handleJoinRoom(ws, msg) {
  const { playerName, roomCode } = msg;
  if (!playerName || !roomCode) {
    return sendTo(ws, { type: 'error', message: 'Pseudo et code requis' });
  }

  const room = gameManager.getRoom(roomCode.toUpperCase());
  if (!room) {
    return sendTo(ws, { type: 'error', message: 'Salle introuvable' });
  }
  if (room.phase !== 'waiting') {
    return sendTo(ws, { type: 'error', message: 'Partie déjà commencée' });
  }
  if (room.players.length >= 10) {
    return sendTo(ws, { type: 'error', message: 'Salle pleine (max 10)' });
  }

  const playerId = uuidv4();
  room.addPlayer(playerId, playerName.trim());

  ws.roomCode = roomCode.toUpperCase();
  ws.playerId = playerId;

  sendTo(ws, {
    type: 'ROOM_JOINED',
    roomCode: room.code,
    playerId,
    room: room.getPublicState(playerId)
  });

  broadcastToRoom(room, { type: 'ROOM_UPDATE', room: null }, ws);
  broadcastRoomState(room);

  console.log(`[ROOM] ${playerName} a rejoint ${room.code}`);
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
    broadcastRoomState(room);
    if (room.phase === 'playing') {
      // Si la partie était en cours et qu'il reste des joueurs, on continue
      // Si un seul joueur reste, il gagne
      if (room.players.length === 1) {
        room.phase = 'finished';
        room.winner = room.players[0].id;
        broadcastRoomState(room);
      }
    }
  }

  ws.roomCode = null;
  ws.playerId = null;
  console.log(`[ROOM] ${playerName || '?'} a quitté`);
}

function handleStartGame(ws) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return sendTo(ws, { type: 'error', message: 'Salle introuvable' });
  if (room.hostId !== ws.playerId) return sendTo(ws, { type: 'error', message: 'Seul l\'hôte peut démarrer' });
  if (room.players.length < 2) return sendTo(ws, { type: 'error', message: 'Minimum 2 joueurs' });
  if (room.phase !== 'waiting') return sendTo(ws, { type: 'error', message: 'Partie déjà en cours' });

  room.startGame();
  broadcastRoomState(room);
  console.log(`[GAME] Démarrée dans ${room.code}`);
}

function handlePlayCard(ws, msg) {
  const room = gameManager.getRoom(ws.roomCode);
  if (!room) return;

  const result = room.playCard(ws.playerId, msg.cardId, msg.wildColor);
  if (result.error) return sendTo(ws, { type: 'error', message: result.error });

  broadcastRoomState(room);

  if (room.phase === 'finished') {
    console.log(`[GAME] Terminée dans ${room.code}. Gagnant: ${room.getPlayerName(room.winner)}`);
  }
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
  broadcastToRoom(room, {
    type: 'UNO_CALLED',
    playerName: room.getPlayerName(ws.playerId)
  });
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
  if (room.hostId !== ws.playerId) return sendTo(ws, { type: 'error', message: 'Seul l\'hôte peut relancer' });

  room.resetGame();
  room.startGame();
  broadcastRoomState(room);
  console.log(`[GAME] Relancée dans ${room.code}`);
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function sendTo(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(room, data, excludeWs = null) {
  wss.clients.forEach((client) => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.roomCode === room.code &&
      client !== excludeWs
    ) {
      client.send(JSON.stringify(data));
    }
  });
}

function broadcastRoomState(room) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === room.code) {
      client.send(JSON.stringify({
        type: 'GAME_STATE',
        room: room.getPublicState(client.playerId)
      }));
    }
  });
}

// ─── Nettoyage des salles inactives (toutes les heures) ───────────────────────
setInterval(() => {
  const deleted = gameManager.cleanupOldRooms(3600000); // 1h
  if (deleted > 0) console.log(`[CLEANUP] ${deleted} salle(s) supprimée(s)`);
}, 600000); // toutes les 10 min

// ─── Démarrage ────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🃏 UNO Serveur démarré sur http://localhost:${PORT}`);
  console.log(`   WebSocket : ws://localhost:${PORT}`);
  console.log(`   Environnement : ${process.env.NODE_ENV || 'development'}\n`);
});
