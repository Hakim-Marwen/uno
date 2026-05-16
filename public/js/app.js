/**
 * UNO Multijoueur — Client JavaScript
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  ÉTAT
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
  pingInterval: null,
};

// ══════════════════════════════════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════════════════════════════════
function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function connect() {
  // Afficher le lobby immédiatement — la connexion WS se fait en arrière-plan
  if (!state.roomCode) showScreen('lobby');

  clearTimeout(state.reconnectTimer);
  if (state.ws) {
    try { state.ws.close(); } catch(e) {}
    state.ws = null;
  }

  try {
    state.ws = new WebSocket(getWsUrl());
  } catch (e) {
    console.error('[WS] Impossible de créer le WebSocket:', e);
    scheduleReconnect();
    return;
  }

  state.ws.onopen = () => {
    console.log('[WS] Connecté');
    state.connected = true;
    state.reconnectAttempts = 0;
    hideOverlay('disconnect');
    clearInterval(state.pingInterval);
    state.pingInterval = setInterval(sendPing, 25000);
    showStatus('');
  };

  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error('[WS] Message invalide:', err);
    }
  };

  state.ws.onclose = (e) => {
    console.warn('[WS] Fermé, code=', e.code);
    state.connected = false;
    clearInterval(state.pingInterval);
    // Ne pas reconnecter si fermeture propre
    if (e.code === 1000 || e.code === 1001) return;
    scheduleReconnect();
  };

  state.ws.onerror = (e) => {
    console.error('[WS] Erreur WebSocket');
    // onclose sera appelé juste après
  };
}

function scheduleReconnect() {
  state.reconnectAttempts++;
  const delays = [1000, 2000, 3000, 5000, 8000, 10000];
  const delay = delays[Math.min(state.reconnectAttempts - 1, delays.length - 1)];

  if (state.reconnectAttempts > 10) {
    showStatus('❌ Impossible de se connecter au serveur');
    if (getCurrentScreen() === 'game' || getCurrentScreen() === 'waiting') {
      showOverlay('disconnect');
    }
    return;
  }

  showStatus(`🔄 Reconnexion… (${state.reconnectAttempts})`);
  console.log(`[WS] Reconnexion dans ${delay}ms`);
  state.reconnectTimer = setTimeout(connect, delay);
}

function sendPing() {
  if (state.connected) send({ type: 'PING' });
}

function send(data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(data));
    return true;
  }
  showToast('⚠️ Pas de connexion au serveur');
  return false;
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES SERVEUR
// ══════════════════════════════════════════════════════════════
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'CONNECTED':
      console.log('[WS] Serveur confirmé, id=', msg.id);
      break;

    case 'ROOM_CREATED':
      state.myId     = msg.playerId;
      state.roomCode = msg.roomCode;
      state.isHost   = true;
      renderWaiting(msg.room);
      showScreen('waiting');
      break;

    case 'ROOM_JOINED':
      state.myId     = msg.playerId;
      state.roomCode = msg.roomCode;
      state.isHost   = (msg.room.hostId === msg.playerId);
      renderWaiting(msg.room);
      showScreen('waiting');
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
      // Réactiver les boutons lobby si erreur à la création/join
      document.getElementById('btn-create').disabled = false;
      document.getElementById('btn-join').disabled = false;
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
    if (document.getElementById('overlay-gameover').hidden) showGameOver(room);
  }
}

// ══════════════════════════════════════════════════════════════
//  LOBBY
// ══════════════════════════════════════════════════════════════
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  if (!name) { showToast('⚠️ Entrez votre pseudo'); return; }
  if (!state.connected) { showToast('⚠️ Pas de connexion au serveur'); return; }
  if (state.roomCode) { showToast('⚠️ Déjà dans une salle'); return; }
  state.myName = name;
  document.getElementById('btn-create').disabled = true;
  const ok = send({ type: 'CREATE_ROOM', playerName: name });
  if (!ok) document.getElementById('btn-create').disabled = false;
  else setTimeout(() => { document.getElementById('btn-create').disabled = false; }, 3000);
});

document.getElementById('btn-join').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!name) { showToast('⚠️ Entrez votre pseudo'); return; }
  if (code.length < 4) { showToast('⚠️ Entrez le code de la salle'); return; }
  if (!state.connected) { showToast('⚠️ Pas de connexion au serveur'); return; }
  if (state.roomCode) { showToast('⚠️ Déjà dans une salle'); return; }
  state.myName = name;
  document.getElementById('btn-join').disabled = true;
  const ok = send({ type: 'JOIN_ROOM', playerName: name, roomCode: code });
  if (!ok) document.getElementById('btn-join').disabled = false;
  else setTimeout(() => { document.getElementById('btn-join').disabled = false; }, 3000);
});

document.getElementById('input-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-create').click();
});
document.getElementById('input-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join').click();
});
document.getElementById('input-code').addEventListener('input', e => {
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
    const me    = p.id === state.myId ? ' <span style="color:var(--accent)">(vous)</span>' : '';
    html += `<div class="player-item">
      <div class="player-avatar" style="background:${p.avatarColor}25;color:${p.avatarColor}">${initials}</div>
      <span class="player-name">${escHtml(p.name)}${me}</span>
      ${badge}
    </div>`;
  }
  list.innerHTML = html;

  // Source de vérité : le serveur
  state.isHost = (room.hostId === state.myId);

  const startBtn = document.getElementById('btn-start');
  const canStart = state.isHost && room.players.length >= 2;
  startBtn.disabled = !canStart;

  document.getElementById('waiting-hint').textContent = state.isHost
    ? (room.players.length >= 2 ? '✅ Prêt à démarrer !' : 'En attente d\'autres joueurs…')
    : "En attente de l'hôte…";
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
  state.myId     = null;
  state.isHost   = false;
  state.gameState = null;
  showScreen('lobby');
});

// ══════════════════════════════════════════════════════════════
//  JEU
// ══════════════════════════════════════════════════════════════
function renderGame(room) {
  const myPlayer = room.players.find(p => p.id === state.myId);
  if (!myPlayer) return;

  const isMyTurn = room.currentPlayerId === state.myId;
  const topCard  = room.topCard;

  // Header
  const badge = document.getElementById('turn-badge');
  if (isMyTurn) {
    badge.textContent = '⭐ Votre tour !';
    badge.className = 'turn-badge my-turn';
  } else {
    const cp = room.players.find(p => p.id === room.currentPlayerId);
    badge.textContent = cp ? `Tour de ${cp.name}` : '…';
    badge.className = 'turn-badge';
  }
  document.getElementById('dir-badge').textContent = room.direction === 1 ? '↻' : '↺';

  // Adversaires
  let oppHtml = '';
  for (const p of room.players) {
    if (p.id === state.myId) continue;
    const initials = p.name.slice(0, 2).toUpperCase();
    oppHtml += `<div class="opponent-chip ${p.isCurrent ? 'active' : ''}">
      <div class="opp-avatar" style="background:${p.avatarColor}30;color:${p.avatarColor}">${initials}</div>
      <span class="opp-name">${escHtml(p.name)}</span>
      <span class="opp-count">${p.cardCount} 🃏</span>
    </div>`;
  }
  document.getElementById('opponents-row').innerHTML = oppHtml;

  // Pioche
  document.getElementById('deck-count').textContent = room.deckCount;

  // Défausse
  const discardEl = document.getElementById('discard-pile-card');
  discardEl.innerHTML = topCard ? buildCard(topCard, room.wildColor, false) : '';

  // Couleur wild active
  const wcBadge = document.getElementById('wild-color-badge');
  if (topCard && isWild(topCard.value) && room.wildColor) {
    wcBadge.hidden = false;
    const colorMap = { red:'#E63946', blue:'#457B9D', green:'#2D9E6B', yellow:'#F4A261' };
    document.getElementById('wcb-dot').style.background = colorMap[room.wildColor] || '#888';
  } else {
    wcBadge.hidden = true;
  }

  // Main du joueur
  const hand = myPlayer.hand || [];
  document.getElementById('my-card-count').textContent = hand.length;
  const handEl = document.getElementById('my-hand');
  let handHtml = '';
  for (const card of hand) {
    const playable = isMyTurn && canPlay(card, topCard, room.wildColor);
    handHtml += buildCard(card, null, true, playable ? card.id : null, isMyTurn ? (playable ? 'card-playable' : 'card-disabled') : '');
  }
  handEl.innerHTML = handHtml;

  if (isMyTurn) {
    handEl.querySelectorAll('.card-playable[data-id]').forEach(el => {
      el.addEventListener('click', () => onCardClick(el.dataset.id));
    });
  }

  // Pioche
  const drawBtn = document.getElementById('btn-draw');
  drawBtn.onclick = isMyTurn ? onDrawCard : null;
  drawBtn.style.opacity = isMyTurn ? '1' : '0.6';

  // Bouton UNO
  document.getElementById('btn-uno').hidden = !(isMyTurn && hand.length === 1);

  // Toast action
  if (room.lastAction && room.lastAction !== renderGame._last) {
    renderGame._last = room.lastAction;
    showToast(room.lastAction);
  }
}
renderGame._last = '';

// ── Actions ─────────────────────────────────────────────────
function onCardClick(cardId) {
  const room = state.gameState;
  if (!room) return;
  const myPlayer = room.players.find(p => p.id === state.myId);
  if (!myPlayer || !myPlayer.hand) return;
  const card = myPlayer.hand.find(c => c.id === cardId);
  if (!card) return;

  if (isWild(card.value)) {
    state.pendingWildCardId = cardId;
    showOverlay('color');
  } else {
    send({ type: 'PLAY_CARD', cardId });
  }
}

function onDrawCard() {
  send({ type: 'DRAW_CARD' });
}

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    hideOverlay('color');
    if (state.pendingWildCardId) {
      send({ type: 'PLAY_CARD', cardId: state.pendingWildCardId, wildColor: btn.dataset.color });
      state.pendingWildCardId = null;
    }
  });
});

document.getElementById('btn-uno').addEventListener('click', () => {
  send({ type: 'CALL_UNO' });
  showToast('🔥 UNO !');
  document.getElementById('btn-uno').hidden = true;
});

document.getElementById('btn-draw').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') onDrawCard();
});

// ══════════════════════════════════════════════════════════════
//  FIN DE PARTIE
// ══════════════════════════════════════════════════════════════
function showGameOver(room) {
  const isWinner = room.winner === state.myId;
  document.getElementById('go-emoji').textContent  = isWinner ? '🏆' : '😔';
  document.getElementById('go-title').textContent  = isWinner ? 'Victoire !' : 'Défaite !';
  document.getElementById('go-msg').textContent    = isWinner
    ? 'Félicitations ! Vous avez posé toutes vos cartes !'
    : `${escHtml(room.winnerName || '?')} a remporté la partie !`;

  const sorted = [...room.players].sort((a, b) => a.cardCount - b.cardCount);
  let scHtml = '';
  sorted.forEach((p, i) => {
    const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
    scHtml += `<div class="score-row">
      <span class="score-rank">${medal}</span>
      <span class="score-name">${escHtml(p.name)}${p.id===state.myId?' (vous)':''}</span>
      <span class="score-cards">${p.cardCount} carte(s)</span>
    </div>`;
  });
  document.getElementById('go-scores').innerHTML = scHtml;
  document.getElementById('btn-new-game').style.display = state.isHost ? 'block' : 'none';
  showOverlay('gameover');
}

document.getElementById('btn-new-game').addEventListener('click', () => {
  hideOverlay('gameover');
  send({ type: 'NEW_GAME' });
});

document.getElementById('btn-back-lobby').addEventListener('click', () => {
  hideOverlay('gameover');
  send({ type: 'LEAVE_ROOM' });
  state.roomCode  = null;
  state.myId      = null;
  state.isHost    = false;
  state.gameState = null;
  renderGame._last = '';
  showScreen('lobby');
});

// ══════════════════════════════════════════════════════════════
//  CONSTRUCTION CARTES
// ══════════════════════════════════════════════════════════════
function buildCard(card, wildColor, showCorners, clickableId = null, extraClass = '') {
  let colorClass = `card-${card.color}`;
  if (isWild(card.value) && wildColor) colorClass = `card-${wildColor}`;
  const label = cardLabel(card);
  const corners = showCorners
    ? `<span class="card-corner">${label}</span><span class="card-corner card-corner-br">${label}</span>`
    : '';
  const dataId = clickableId ? `data-id="${clickableId}"` : '';
  return `<div class="card ${colorClass} ${extraClass}" ${dataId}>${corners}${label}</div>`;
}

function cardLabel(card) {
  return { skip:'🚫', reverse:'🔄', '+2':'+2', wild:'🌈', 'wild+4':'+4' }[card.value] ?? card.value;
}

function isWild(v) { return v === 'wild' || v === 'wild+4'; }

function canPlay(card, topCard, wildColor) {
  if (!topCard) return true;
  if (isWild(card.value)) return true;
  const eff = (isWild(topCard.value) && wildColor) ? wildColor : topCard.color;
  return card.color === eff || card.value === topCard.value;
}

// ══════════════════════════════════════════════════════════════
//  UI HELPERS
// ══════════════════════════════════════════════════════════════
const SCREENS = {
  loading: 'screen-loading',
  lobby:   'screen-lobby',
  waiting: 'screen-waiting',
  game:    'screen-game',
};

function showScreen(name) {
  for (const [key, id] of Object.entries(SCREENS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (key === name) {
      el.style.display = 'flex';
      el.classList.add('active');
    } else {
      el.style.display = 'none';
      el.classList.remove('active');
    }
  }
}

function getCurrentScreen() {
  for (const [key, id] of Object.entries(SCREENS)) {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none' && el.classList.contains('active')) return key;
  }
  return null;
}

let _statusTimer = null;
function showStatus(msg) {
  const el = document.getElementById('loading-msg');
  if (el) el.textContent = msg;
}

let _toastTimer = null;
function showToast(msg, ms = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function showOverlay(name) {
  const el = document.getElementById('overlay-' + name);
  if (el) el.hidden = false;
}
function hideOverlay(name) {
  const el = document.getElementById('overlay-' + name);
  if (el) el.hidden = true;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ══════════════════════════════════════════════════════════════
//  AUTO-JOIN via URL ?room=CODE
// ══════════════════════════════════════════════════════════════
function checkUrlParams() {
  const params = new URLSearchParams(location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    document.getElementById('input-code').value = roomCode.toUpperCase();
  }
}

// ══════════════════════════════════════════════════════════════
//  INIT — afficher le lobby TOUT DE SUITE, WS en arrière-plan
// ══════════════════════════════════════════════════════════════
checkUrlParams();
showScreen('lobby'); // ← Lobby visible immédiatement, pas de spinner
connect();           // ← WS en arrière-plan
