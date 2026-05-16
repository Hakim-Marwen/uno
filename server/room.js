/**
 * Room - Contient toute la logique d'une partie UNO
 */

const COLORS = ['red', 'blue', 'green', 'yellow'];
const SPECIAL = ['skip', 'reverse', '+2'];
const WILD_CARDS = ['wild', 'wild+4'];

class Room {
  constructor(code, hostId, hostName) {
    this.code = code;
    this.hostId = hostId;
    this.createdAt = Date.now();
    this.phase = 'waiting'; // waiting | playing | awaiting_color | finished
    this.direction = 1; // 1 = normal, -1 = inversé
    this.currentPlayerIndex = 0;
    this.wildColor = null;
    this.winner = null;
    this.deck = [];
    this.discard = [];
    this.lastAction = '';
    this.unoCalledBy = null;
    this.pendingWild = null; // { playerId, cardIdx } en attente de couleur

    this.players = [{
      id: hostId,
      name: hostName,
      hand: [],
      avatarColor: this._pickAvatarColor(0)
    }];
  }

  // ─── Joueurs ───────────────────────────────────────────────────────────────

  addPlayer(playerId, playerName) {
    this.players.push({
      id: playerId,
      name: playerName,
      hand: [],
      avatarColor: this._pickAvatarColor(this.players.length)
    });
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    this.players.splice(idx, 1);

    // Transférer l'hôte si nécessaire
    if (this.hostId === playerId && this.players.length > 0) {
      this.hostId = this.players[0].id;
    }

    // Ajuster currentPlayerIndex
    if (this.phase === 'playing') {
      if (this.currentPlayerIndex >= this.players.length) {
        this.currentPlayerIndex = 0;
      }
    }
  }

  getPlayerName(playerId) {
    return this.players.find(p => p.id === playerId)?.name || null;
  }

  _playerIndex(playerId) {
    return this.players.findIndex(p => p.id === playerId);
  }

  _pickAvatarColor(idx) {
    const colors = ['#E63946', '#457B9D', '#2D9E6B', '#F4A261', '#A78BFA', '#F48C06', '#2EC4B6', '#E76F51', '#9B2226', '#606C38'];
    return colors[idx % colors.length];
  }

  // ─── Deck ──────────────────────────────────────────────────────────────────

  _createDeck() {
    const deck = [];
    for (const color of COLORS) {
      deck.push({ id: this._cardId(), color, value: '0' });
      for (let i = 0; i < 2; i++) {
        for (let v = 1; v <= 9; v++) deck.push({ id: this._cardId(), color, value: String(v) });
        for (const s of SPECIAL) deck.push({ id: this._cardId(), color, value: s });
      }
    }
    for (let i = 0; i < 4; i++) {
      deck.push({ id: this._cardId(), color: 'wild', value: 'wild' });
      deck.push({ id: this._cardId(), color: 'wild', value: 'wild+4' });
    }
    return this._shuffle(deck);
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _cardId() {
    return Math.random().toString(36).slice(2, 9);
  }

  _reshuffleDeck() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.deck = this._shuffle(this.discard.map(c => {
      if (WILD_CARDS.includes(c.value)) return { ...c, color: 'wild' };
      return c;
    }));
    this.discard = top ? [top] : [];
  }

  // ─── Démarrage ─────────────────────────────────────────────────────────────

  startGame() {
    this.deck = this._createDeck();
    this.discard = [];
    this.direction = 1;
    this.currentPlayerIndex = 0;
    this.wildColor = null;
    this.winner = null;
    this.unoCalledBy = null;
    this.pendingWild = null;

    // Distribuer 7 cartes
    for (const player of this.players) {
      player.hand = this.deck.splice(0, 7);
    }

    // Première carte (non-wild)
    let firstCard;
    for (let i = 0; i < this.deck.length; i++) {
      if (!WILD_CARDS.includes(this.deck[i].value)) {
        firstCard = this.deck.splice(i, 1)[0];
        break;
      }
    }
    if (!firstCard) firstCard = this.deck.splice(0, 1)[0];
    this.discard.push(firstCard);

    this.phase = 'playing';
    this.lastAction = `La partie commence ! ${this.players[0].name} joue en premier.`;

    // Appliquer effet de la première carte
    this._applyStartCardEffect(firstCard);
  }

  _applyStartCardEffect(card) {
    const n = this.players.length;
    if (card.value === 'skip') {
      this.lastAction = `Première carte Skip ! ${this.players[0].name} passe son tour.`;
      this.currentPlayerIndex = 1 % n;
    } else if (card.value === 'reverse') {
      this.direction = -1;
      if (n === 2) {
        this.lastAction = `Première carte Reverse ! ${this.players[0].name} rejoue.`;
      } else {
        this.currentPlayerIndex = n - 1;
        this.lastAction = 'Première carte Reverse ! Ordre inversé.';
      }
    } else if (card.value === '+2') {
      const target = this.players[0];
      for (let i = 0; i < 2; i++) {
        if (this.deck.length === 0) this._reshuffleDeck();
        const c = this.deck.shift();
        if (c) target.hand.push(c);
      }
      this.lastAction = `Première carte +2 ! ${target.name} pioche 2 cartes.`;
      this.currentPlayerIndex = 1 % n;
    }
  }

  resetGame() {
    for (const player of this.players) {
      player.hand = [];
    }
    this.deck = [];
    this.discard = [];
    this.phase = 'waiting';
    this.direction = 1;
    this.currentPlayerIndex = 0;
    this.wildColor = null;
    this.winner = null;
    this.unoCalledBy = null;
    this.pendingWild = null;
    this.lastAction = '';
  }

  // ─── Jouer une carte ───────────────────────────────────────────────────────

  playCard(playerId, cardId, wildColor = null) {
    if (this.phase === 'finished') return { error: 'Partie terminée' };

    const playerIdx = this._playerIndex(playerId);
    if (playerIdx === -1) return { error: 'Joueur introuvable' };
    if (playerIdx !== this.currentPlayerIndex) return { error: 'Ce n\'est pas votre tour' };

    const player = this.players[playerIdx];
    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return { error: 'Carte introuvable' };

    const card = player.hand[cardIdx];
    const topCard = this.discard[this.discard.length - 1];

    if (!this._canPlay(card, topCard)) return { error: 'Cette carte ne peut pas être jouée' };

    // Wild → besoin d'une couleur
    if (WILD_CARDS.includes(card.value) && !wildColor) {
      // Le client doit renvoyer PICK_COLOR, mais on peut aussi traiter inline
      // Pour simplifier: on attend que le client envoie wildColor avec PLAY_CARD
      return { error: 'Choisissez une couleur pour cette carte' };
    }

    // Retirer la carte de la main
    player.hand.splice(cardIdx, 1);
    this.discard.push(card);
    this.wildColor = WILD_CARDS.includes(card.value) ? wildColor : null;
    this.unoCalledBy = null;

    this.lastAction = `${player.name} a joué ${this._cardLabel(card)}`;
    if (wildColor && WILD_CARDS.includes(card.value)) {
      this.lastAction += ` → ${this._colorName(wildColor)}`;
    }

    // Vérifier victoire
    if (player.hand.length === 0) {
      this.phase = 'finished';
      this.winner = playerId;
      return { ok: true };
    }

    // Appliquer effets
    this._applyCardEffect(card, playerIdx);
    return { ok: true };
  }

  _applyCardEffect(card, playerIdx) {
    const n = this.players.length;
    let nextIdx = (playerIdx + this.direction + n) % n;

    switch (card.value) {
      case 'skip':
        this.lastAction += ` — ${this.players[nextIdx].name} passe son tour !`;
        this.currentPlayerIndex = (nextIdx + this.direction + n) % n;
        break;

      case 'reverse':
        this.direction *= -1;
        if (n === 2) {
          // En 2 joueurs, reverse = skip
          this.currentPlayerIndex = playerIdx;
        } else {
          nextIdx = (playerIdx + this.direction + n) % n;
          this.currentPlayerIndex = nextIdx;
          this.lastAction += ' — Sens inversé !';
        }
        break;

      case '+2':
        this._giveCards(nextIdx, 2);
        this.lastAction += ` — ${this.players[nextIdx].name} pioche 2 cartes !`;
        this.currentPlayerIndex = (nextIdx + this.direction + n) % n;
        break;

      case 'wild+4':
        this._giveCards(nextIdx, 4);
        this.lastAction += ` — ${this.players[nextIdx].name} pioche 4 cartes !`;
        this.currentPlayerIndex = (nextIdx + this.direction + n) % n;
        break;

      default:
        this.currentPlayerIndex = nextIdx;
        break;
    }
  }

  _giveCards(playerIdx, count) {
    const player = this.players[playerIdx];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) this._reshuffleDeck();
      const c = this.deck.shift();
      if (c) player.hand.push(c);
    }
  }

  pickColor(playerId, color) {
    // Utilisé si on sépare la sélection de couleur
    if (!COLORS.includes(color)) return { error: 'Couleur invalide' };
    this.wildColor = color;
    return { ok: true };
  }

  // ─── Piocher ───────────────────────────────────────────────────────────────

  drawCard(playerId) {
    const playerIdx = this._playerIndex(playerId);
    if (playerIdx === -1) return { error: 'Joueur introuvable' };
    if (playerIdx !== this.currentPlayerIndex) return { error: 'Ce n\'est pas votre tour' };

    if (this.deck.length === 0) this._reshuffleDeck();
    if (this.deck.length === 0) return { error: 'Pioche vide' };

    const card = this.deck.shift();
    this.players[playerIdx].hand.push(card);
    this.lastAction = `${this.players[playerIdx].name} a pioché une carte`;

    // Règle officielle: après avoir pioché, si la carte est jouable on peut la jouer
    // Sinon on passe le tour
    const topCard = this.discard[this.discard.length - 1];
    if (!this._canPlay(card, topCard)) {
      const n = this.players.length;
      this.currentPlayerIndex = (playerIdx + this.direction + n) % n;
      this.lastAction += ' (non jouable, tour passé)';
    }
    // Si jouable, le joueur peut la jouer (retournera au client qui verra la carte dans sa main)

    return { ok: true, card };
  }

  // ─── UNO ───────────────────────────────────────────────────────────────────

  callUno(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (player && player.hand.length === 1) {
      this.unoCalledBy = playerId;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _canPlay(card, topCard) {
    if (!topCard) return true;
    if (WILD_CARDS.includes(card.value)) return true;
    const effectiveColor = (WILD_CARDS.includes(topCard.value) && this.wildColor)
      ? this.wildColor
      : topCard.color;
    return card.color === effectiveColor || card.value === topCard.value;
  }

  _cardLabel(card) {
    const labels = { skip: 'Skip', reverse: 'Reverse', '+2': '+2', wild: 'Joker', 'wild+4': 'Joker +4' };
    return labels[card.value] || card.value;
  }

  _colorName(color) {
    const names = { red: 'Rouge', blue: 'Bleu', green: 'Vert', yellow: 'Jaune' };
    return names[color] || color;
  }

  // ─── État public (adapté par joueur) ──────────────────────────────────────

  getPublicState(forPlayerId) {
    const myIdx = this._playerIndex(forPlayerId);
    const topCard = this.discard[this.discard.length - 1] || null;

    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      direction: this.direction,
      currentPlayerIndex: this.currentPlayerIndex,
      currentPlayerId: this.players[this.currentPlayerIndex]?.id || null,
      wildColor: this.wildColor,
      winner: this.winner,
      winnerName: this.winner ? this.getPlayerName(this.winner) : null,
      lastAction: this.lastAction,
      deckCount: this.deck.length,
      topCard,
      players: this.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        avatarColor: p.avatarColor,
        cardCount: p.hand.length,
        isHost: p.id === this.hostId,
        isCurrent: idx === this.currentPlayerIndex,
        // La main complète uniquement pour le joueur lui-même
        hand: p.id === forPlayerId ? p.hand : null
      }))
    };
  }
}

module.exports = Room;
