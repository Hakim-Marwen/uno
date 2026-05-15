/**
 * UNO Multijoueur — Client JavaScript
 * Gère la connexion WebSocket, l'interface et les interactions
 */

'use strict';

// ══════════════════════════════════════════════════════════════
//  ÉTAT CLIENT
// ══════════════════════════════════════════════════════════════
const state = {
  ws: null,
  connected: false,
  myId: null,
  myName: '',
  roomCode: null,
  isHost: false,
  gameState: null,
  pendingWildCardId: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  pingInterval: null
};

const MAX_RECONNECT = 8;
const RECONNECT_DELAY_MS = [1000, 2000, 3000, 5000, 5000, 8000, 8000, 10000];

// ══════════════════════════════════════════════════════════════
//  CONNEXION WEBSOCKET
// ══════════════════════════════════════════════════════════════
function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function connect() {
  setLoadMsg('Connexion au serveur…');
  showScreen('loading');

  try {
    state.ws = new WebSocket(getWsUrl());
  } catch (e) {
    handleConnectFailure();
    return;
  }

  state.ws.onopen = () => {
    console.log('[WS] Connecté');
    state.connected = true;
    state.reconnectAttempts = 0;
    hideOverlay('disconnect');
    clearInterval(state.pingInterval);
    state.pingInterval = setInterval(sendPing, 25000);

    if (state.roomCode && state.myName) {
      // Tentative de reconnexion à la salle
      setLoadMsg('Reconnexion à la partie…');
    } else {
      showScreen('lobby');
    }
  };

  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error('[WS] Message invalide', err);
    }
  };

  state.ws.onclose = (e) => {
    console.warn('[WS] Fermeture', e.code);
    state.connected = false;
    clearInterval(state.pingInterval);
    if (e.code !== 1000) handleConnectFailure();
  };

  state.ws.onerror = () => {
    console.error('[WS] Erreur');
  };
}

function handleConnectFailure() {
  if (state.reconnectAttempts >= MAX_RECONNECT) {
    showOverlay('disconnect');
    setLoadMsg('Connexion impossible. Rechargez la page.');
    return;
  }
  const delay = RECONNECT_DELAY_MS[state.reconnectAttempts] || 10000;
  state.reconnectAttempts++;
  if (state.gameState) showOverlay('disconnect');
  console.log(`[WS] Reconnexion dans ${delay}ms (tentative ${state.reconnectAttempts})`);
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(connect, delay);
}

function sendPing() {
  send({ type: 'PING' });
}

function send(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
  }
}

// ══════════════════════════════════════════════════════════════
//  GESTION DES MESSAGES SERVEUR
// ══════════════════════════════════════════════════════════════
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ROOM_CREATED':
      state.myId = msg.playerId;
      state.roomCode = msg.roomCode;
      state.isHost = true;
      renderWaiting(msg.room);
      showScreen('waiting');
      break;

    case 'ROOM_JOINED':
      state.myId = msg.playerId;
      state.roomCode = msg.roomCode;
      state.isHost = false;
      renderWaiting(msg.room);
      showScreen('waiting');
      break;

    case 'ROOM_UPDATE':
      // handled via GAME_STATE
      break;

    case 'GAME_STATE':
      handleGameState(msg.room);
      break;

    case 'UNO_CALLED':
      showToast(`🔥 ${msg.playerName} crie UNO !`);
      break;

    case 'PONG':
      break;

    case 'error':
      showToast('⚠️ ' + msg.message);
      break;

    default:
      console.warn('[WS] Type inconnu:', msg.type);
  }
}

function handleGameState(room) {
  if (!room) return;
  state.gameState = room;

  if (room.phase === 'waiting') {
    renderWaiting(room);
    if (getCurrentScreen() !== 'waiting') showScreen('waiting');
  } else if (room.phase === 'playing') {
    if (getCurrentScreen() !== 'game') showScreen('game');
    renderGame(room);
  } else if (room.phase === 'finished') {
    if (getCurrentScreen() !== 'game') showScreen('game');
    renderGame(room);
    showGameOver(room);
  }
}

// ══════════════════════════════════════════════════════════════
//  LOBBY
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('⚠️ Entrez votre pseudo'); return; }
  state.myName = name;
  send({ type: 'CREATE_ROOM', playerName: name });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!name) { showToast('⚠️ Entrez votre pseudo'); return; }
  if (code.length < 4) { showToast('⚠️ Entrez le code de la salle'); return; }
  state.myName = name;
  send({ type: 'JOIN_ROOM', playerName: name, roomCode: code });
});

document.getElementById('input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});
document.getElementById('input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});
document.getElementById('input-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// ══════════════════════════════════════════════════════════════
//  SALLE D'ATTENTE
// ══════════════════════════════════════════════════════════════
function renderWaiting(room) {
  document.getElementById('display-code').textContent = room.code;
  document.getElementById('player-count').textContent = room.players.length;

  const list = document.getElementById('waiting-players');
  let html = `<h3>Joueurs (${room.players.length}/10)</h3>`;
  for (const p of room.players) {
    const initials = p.name.slice(0, 2).toUpperCase();
    const badge = p.isHost ? '<span class="host-badge">Hôte</span>' : '';
    html += `<div class="player-item">
      <div class="player-avatar" style="background:${p.avatarColor}25;color:${p.avatarColor}">${initials}</div>
      <span class="player-name">${escHtml(p.name)}</span>
      ${badge}
    </div>`;
  }
  list.innerHTML = html;

  const isHost = room.hostId === state.myId;
  const startBtn = document.getElementById('btn-start');
  startBtn.disabled = !(isHost && room.players.length >= 2);
  startBtn.textContent = `▶ Démarrer (${room.players.length}/2 min.)`;

  document.getElementById('waiting-hint').textContent = isHost
    ? (room.players.length >= 2 ? 'Prêt à démarrer !' : 'En attente de joueurs…')
    : 'En attente de l\'hôte…';
}

document.getElementById('btn-start').addEventListener('click', () => {
  send({ type: 'START_GAME' });
});

document.getElementById('btn-copy').addEventListener('click', () => {
  const url = `${location.origin}?room=${state.roomCode}`;
  navigator.clipboard.writeText(url).then(() => showToast('✅ Lien copié !')).catch(() => {
    showToast('Code : ' + state.roomCode);
  });
});

document.getElementById('btn-leave-waiting').addEventListener('click', () => {
  send({ type: 'LEAVE_ROOM' });
  state.roomCode = null;
  state.myId = null;
  state.isHost = false;
  state.gameState = null;
  showScreen('lobby');
});

// ══════════════════════════════════════════════════════════════
//  JEU — RENDU
// ══════════════════════════════════════════════════════════════
function renderGame(room) {
  const myPlayer = room.players.find(p => p.id === state.myId);
  if (!myPlayer) return;

  const isMyTurn = room.currentPlayerId === state.myId;
  const topCard = room.topCard;

  // Turn badge
  const badge = document.getElementById('turn-badge');
  if (isMyTurn) {
    badge.textContent = '⭐ Votre tour !';
    badge.className = 'turn-badge my-turn';
  } else {
    const cp = room.players.find(p => p.id === room.currentPlayerId);
    badge.textContent = cp ? `Tour de ${cp.name}` : '…';
    badge.className = 'turn-badge';
  }

  // Direction
  document.getElementById('dir-badge').textContent = room.direction === 1 ? '↻' : '↺';

  // Opponents
  const oppRow = document.getElementById('opponents-row');
  let oppHtml = '';
  for (const p of room.players) {
    if (p.id === state.myId) continue;
    const initials = p.name.slice(0, 2).toUpperCase();
    const active = p.isCurrent ? 'active' : '';
    oppHtml += `<div class="opponent-chip ${active}">
      <div class="opp-avatar" style="background:${p.avatarColor}30;color:${p.avatarColor}">${initials}</div>
      <span class="opp-name">${escHtml(p.name)}</span>
      <span class="opp-count">${p.cardCount} 🃏</span>
    </div>`;
  }
  oppRow.innerHTML = oppHtml;

  // Deck count
  document.getElementById('deck-count').textContent = room.deckCount;

  // Discard pile
  const discardEl = document.getElementById('discard-pile-card');
  if (topCard) {
    discardEl.innerHTML = buildCard(topCard, room.wildColor, false);
  }

  // Wild color indicator
  const wcBadge = document.getElementById('wild-color-badge');
  if (topCard && isWild(topCard.value) && room.wildColor) {
    wcBadge.hidden = false;
    const colorMap = { red: '#E63946', blue: '#457B9D', green: '#2D9E6B', yellow: '#F4A261' };
    document.getElementById('wcb-dot').style.background = colorMap[room.wildColor] || '#888';
  } else {
    wcBadge.hidden = true;
  }

  // My hand
  const hand = myPlayer.hand || [];
  document.getElementById('my-card-count').textContent = hand.length;
  const handEl = document.getElementById('my-hand');
  let handHtml = '';
  for (const card of hand) {
    const playable = isMyTurn && canPlay(card, topCard, room.wildColor);
    const cls = isMyTurn ? (playable ? 'card-playable' : 'card-disabled') : '';
    handHtml += buildCard(card, null, true, playable ? card.id : null, cls);
  }
  handEl.innerHTML = handHtml;

  // Click handlers on hand cards
  if (isMyTurn) {
    handEl.querySelectorAll('.card-playable[data-id]').forEach(el => {
      el.addEventListener('click', () => onCardClick(el.dataset.id));
    });
  }

  // Draw pile click
  const drawBtn = document.getElementById('btn-draw');
  drawBtn.onclick = isMyTurn ? onDrawCard : null;
  drawBtn.style.opacity = isMyTurn ? '1' : '0.6';

  // UNO button
  const unoBtn = document.getElementById('btn-uno');
  unoBtn.hidden = !(isMyTurn && hand.length === 1);

  // Last action toast (only if changed)
  if (room.lastAction && room.lastAction !== renderGame._lastAction) {
    renderGame._lastAction = room.lastAction;
    showToast(room.lastAction);
  }
}
renderGame._lastAction = '';

// ══════════════════════════════════════════════════════════════
//  ACTIONS JEU
// ══════════════════════════════════════════════════════════════
function onCardClick(cardId) {
  const room = state.gameState;
  if (!room) return;
  const myPlayer = room.players.find(p => p.id === state.myId);
  if (!myPlayer || !myPlayer.hand) return;
  const card = myPlayer.hand.find(c => c.id === cardId);
  if (!card) return;

  if (isWild(card.value)) {
    // Afficher le sélecteur de couleur
    state.pendingWildCardId = cardId;
    showOverlay('color');
  } else {
    send({ type: 'PLAY_CARD', cardId });
  }
}

function onDrawCard() {
  send({ type: 'DRAW_CARD' });
}

// Color picker
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    hideOverlay('color');
    if (state.pendingWildCardId) {
      send({ type: 'PLAY_CARD', cardId: state.pendingWildCardId, wildColor: color });
      state.pendingWildCardId = null;
    }
  });
});

// UNO button
document.getElementById('btn-uno').addEventListener('click', () => {
  send({ type: 'CALL_UNO' });
  showToast('🔥 UNO !');
  document.getElementById('btn-uno').hidden = true;
});

// Draw pile keyboard
document.getElementById('btn-draw').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') onDrawCard();
});

// ══════════════════════════════════════════════════════════════
//  FIN DE PARTIE
// ══════════════════════════════════════════════════════════════
function showGameOver(room) {
  const isWinner = room.winner === state.myId;
  document.getElementById('go-emoji').textContent = isWinner ? '🏆' : '😔';
  document.getElementById('go-title').textContent = isWinner ? 'Victoire !' : 'Défaite !';
  document.getElementById('go-msg').textContent = isWinner
    ? 'Félicitations ! Vous avez posé toutes vos cartes !'
    : `${escHtml(room.winnerName || '?')} a remporté la partie !`;

  // Scores
  const sorted = [...room.players].sort((a, b) => a.cardCount - b.cardCount);
  let scHtml = '';
  sorted.forEach((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const me = p.id === state.myId ? ' (vous)' : '';
    scHtml += `<div class="score-row">
      <span class="score-rank">${medal}</span>
      <span class="score-name">${escHtml(p.name)}${me}</span>
      <span class="score-cards">${p.cardCount} carte(s)</span>
    </div>`;
  });
  document.getElementById('go-scores').innerHTML = scHtml;

  const newGameBtn = document.getElementById('btn-new-game');
  newGameBtn.style.display = state.isHost ? 'block' : 'none';

  showOverlay('gameover');
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  hideOverlay('gameover');
  send({ type: 'NEW_GAME' });
});

document.getElementById('btn-back-lobby').addEventListener('click', () => {
  hideOverlay('gameover');
  send({ type: 'LEAVE_ROOM' });
  state.roomCode = null;
  state.myId = null;
  state.isHost = false;
  state.gameState = null;
  renderGame._lastAction = '';
  showScreen('lobby');
});

// ══════════════════════════════════════════════════════════════
//  CONSTRUCTION HTML DES CARTES
// ══════════════════════════════════════════════════════════════
function buildCard(card, wildColor, showCorners, clickableId = null, extraClass = '') {
  let colorClass = `card-${card.color}`;
  if (isWild(card.value) && wildColor) colorClass = `card-${wildColor}`;
  const label = cardLabel(card);
  const corners = showCorners
    ? `<span class="card-corner">${label}</span><span class="card-corner card-corner-br">${label}</span>`
    : '';
  const dataId = clickableId ? `data-id="${clickableId}"` : '';
  return `<div class="card ${colorClass} ${extraClass}" ${dataId} role="${clickableId ? 'button' : 'img'}" aria-label="${label}">${corners}${label}</div>`;
}

function cardLabel(card) {
  const labels = { skip: '🚫', reverse: '🔄', '+2': '+2', wild: '🌈', 'wild+4': '+4' };
  return labels[card.value] !== undefined ? labels[card.value] : card.value;
}

function isWild(value) {
  return value === 'wild' || value === 'wild+4';
}

function canPlay(card, topCard, wildColor) {
  if (!topCard) return true;
  if (isWild(card.value)) return true;
  const effectiveColor = (isWild(topCard.value) && wildColor) ? wildColor : topCard.color;
  return card.color === effectiveColor || card.value === topCard.value;
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
const screens = { loading: 'screen-loading', lobby: 'screen-lobby', waiting: 'screen-waiting', game: 'screen-game' };

function showScreen(name) {
  for (const [key, id] of Object.entries(screens)) {
    const el = document.getElementById(id);
    if (key === name) { el.classList.add('active'); el.style.display = 'flex'; }
    else { el.classList.remove('active'); el.style.display = 'none'; }
  }
}

function getCurrentScreen() {
  for (const [key, id] of Object.entries(screens)) {
    if (document.getElementById(id).classList.contains('active')) return key;
  }
  return null;
}

function setLoadMsg(msg) {
  document.getElementById('loading-msg').textContent = msg;
}

let toastTimer = null;
function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

function showOverlay(name) {
  const overlays = { color: 'overlay-color', gameover: 'overlay-gameover', disconnect: 'overlay-disconnect' };
  const el = document.getElementById('overlay-' + name);
  if (el) el.hidden = false;
}

function hideOverlay(name) {
  const el = document.getElementById('overlay-' + name);
  if (el) el.hidden = true;
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ══════════════════════════════════════════════════════════════
//  AUTO-JOIN via URL (?room=CODE)
// ══════════════════════════════════════════════════════════════
function checkUrlParams() {
  const params = new URLSearchParams(location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    document.getElementById('input-code').value = roomCode.toUpperCase();
    showToast(`🎯 Code pré-rempli : ${roomCode.toUpperCase()}`);
  }
}

// ══════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════
checkUrlParams();
connect();
