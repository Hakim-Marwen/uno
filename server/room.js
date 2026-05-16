const COLORS    = ['red','blue','green','yellow'];
const SPECIALS  = ['skip','reverse','+2'];
const WILDS     = ['wild','wild+4'];
const AVATAR_COLORS = ['#E63946','#457B9D','#2D9E6B','#F4A261','#A78BFA','#F48C06','#2EC4B6','#E76F51','#9B2226','#606C38'];

class Room {
  constructor(code, hostId, hostName) {
    this.code       = code;
    this.hostId     = hostId;
    this.createdAt  = Date.now();
    this.phase      = 'waiting';   // waiting | playing | finished
    this.direction  = 1;
    this.currentIdx = 0;
    this.wildColor  = null;
    this.winner     = null;
    this.deck       = [];
    this.discard    = [];
    this.lastAction = '';
    this.players    = [{ id: hostId, name: hostName, hand: [], avatarColor: AVATAR_COLORS[0] }];
  }

  // ── Joueurs ─────────────────────────────────────────────────
  addPlayer(id, name) {
    this.players.push({ id, name, hand: [], avatarColor: AVATAR_COLORS[this.players.length % AVATAR_COLORS.length] });
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;
    this.players.splice(idx, 1);
    if (this.hostId === playerId && this.players.length > 0) this.hostId = this.players[0].id;
    if (this.currentIdx >= this.players.length) this.currentIdx = 0;
  }

  getPlayerName(id) { return this.players.find(p => p.id === id)?.name || null; }

  _idx(playerId) { return this.players.findIndex(p => p.id === playerId); }

  // ── Deck ────────────────────────────────────────────────────
  _buildDeck() {
    const d = [];
    const id = () => Math.random().toString(36).slice(2, 9);
    for (const c of COLORS) {
      d.push({ id: id(), color: c, value: '0' });
      for (let i = 0; i < 2; i++) {
        for (let v = 1; v <= 9; v++) d.push({ id: id(), color: c, value: String(v) });
        for (const s of SPECIALS)    d.push({ id: id(), color: c, value: s });
      }
    }
    for (let i = 0; i < 4; i++) {
      d.push({ id: id(), color: 'wild', value: 'wild' });
      d.push({ id: id(), color: 'wild', value: 'wild+4' });
    }
    return this._shuffle(d);
  }

  _shuffle(a) {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  _reshuffle() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.deck = this._shuffle(this.discard.map(c => WILDS.includes(c.value) ? { ...c, color: 'wild' } : c));
    this.discard = top ? [top] : [];
  }

  // ── Démarrage ───────────────────────────────────────────────
  startGame() {
    this.deck       = this._buildDeck();
    this.discard    = [];
    this.direction  = 1;
    this.currentIdx = 0;
    this.wildColor  = null;
    this.winner     = null;

    for (const p of this.players) p.hand = this.deck.splice(0, 7);

    // Première carte non-wild
    let first;
    for (let i = 0; i < this.deck.length; i++) {
      if (!WILDS.includes(this.deck[i].value)) { first = this.deck.splice(i, 1)[0]; break; }
    }
    if (!first) first = this.deck.splice(0, 1)[0];
    this.discard.push(first);
    this.phase      = 'playing';
    this.lastAction = `C'est parti ! ${this.players[0].name} commence.`;
    this._applyFirstCard(first);
  }

  _applyFirstCard(card) {
    const n = this.players.length;
    if (card.value === 'skip') {
      this.currentIdx = 1 % n;
      this.lastAction = `Première carte Skip — ${this.players[0].name} passe son tour.`;
    } else if (card.value === 'reverse') {
      this.direction = -1;
      this.currentIdx = n === 2 ? 0 : n - 1;
      this.lastAction = 'Première carte Reverse — sens inversé !';
    } else if (card.value === '+2') {
      this._give(0, 2);
      this.currentIdx = 1 % n;
      this.lastAction = `Première carte +2 — ${this.players[0].name} pioche 2 cartes.`;
    }
  }

  resetGame() {
    for (const p of this.players) p.hand = [];
    this.deck = []; this.discard = [];
    this.phase = 'waiting'; this.direction = 1;
    this.currentIdx = 0; this.wildColor = null;
    this.winner = null; this.lastAction = '';
  }

  // ── Jouer ───────────────────────────────────────────────────
  playCard(playerId, cardId, wildColor = null) {
    if (this.phase !== 'playing') return { error: 'Partie non active' };
    const pi = this._idx(playerId);
    if (pi !== this.currentIdx) return { error: "Ce n'est pas votre tour" };

    const player = this.players[pi];
    const ci = player.hand.findIndex(c => c.id === cardId);
    if (ci === -1) return { error: 'Carte introuvable' };

    const card    = player.hand[ci];
    const topCard = this.discard[this.discard.length - 1];
    if (!this._canPlay(card, topCard)) return { error: 'Carte non jouable' };
    if (WILDS.includes(card.value) && !wildColor) return { error: 'Choisissez une couleur' };

    player.hand.splice(ci, 1);
    this.discard.push(card);
    this.wildColor  = WILDS.includes(card.value) ? wildColor : null;
    this.lastAction = `${player.name} joue ${this._label(card)}${wildColor ? ' → ' + this._colorName(wildColor) : ''}`;

    if (player.hand.length === 0) { this.phase = 'finished'; this.winner = playerId; return { ok: true }; }

    this._applyEffect(card, pi);
    return { ok: true };
  }

  _applyEffect(card, pi) {
    const n    = this.players.length;
    let   next = (pi + this.direction + n) % n;
    switch (card.value) {
      case 'skip':
        this.lastAction += ` — ${this.players[next].name} passe !`;
        this.currentIdx = (next + this.direction + n) % n;
        break;
      case 'reverse':
        this.direction *= -1;
        this.currentIdx = n === 2 ? pi : (pi + this.direction + n) % n;
        this.lastAction += ' — Sens inversé !';
        break;
      case '+2':
        this._give(next, 2);
        this.lastAction += ` — ${this.players[next].name} pioche 2 !`;
        this.currentIdx = (next + this.direction + n) % n;
        break;
      case 'wild+4':
        this._give(next, 4);
        this.lastAction += ` — ${this.players[next].name} pioche 4 !`;
        this.currentIdx = (next + this.direction + n) % n;
        break;
      default:
        this.currentIdx = next;
    }
  }

  _give(playerIdx, count) {
    const p = this.players[playerIdx];
    for (let i = 0; i < count; i++) {
      if (!this.deck.length) this._reshuffle();
      const c = this.deck.shift();
      if (c) p.hand.push(c);
    }
  }

  drawCard(playerId) {
    if (this.phase !== 'playing') return { error: 'Partie non active' };
    const pi = this._idx(playerId);
    if (pi !== this.currentIdx) return { error: "Ce n'est pas votre tour" };

    if (!this.deck.length) this._reshuffle();
    if (!this.deck.length) return { error: 'Pioche vide' };

    const card = this.deck.shift();
    this.players[pi].hand.push(card);
    this.lastAction = `${this.players[pi].name} pioche une carte`;

    if (!this._canPlay(card, this.discard[this.discard.length - 1])) {
      const n = this.players.length;
      this.currentIdx = (pi + this.direction + n) % n;
      this.lastAction += ' (non jouable)';
    }
    return { ok: true };
  }

  callUno(playerId) {
    const p = this.players.find(p => p.id === playerId);
    // future: penalize if called without 1 card
  }

  // ── Helpers ─────────────────────────────────────────────────
  _canPlay(card, top) {
    if (!top) return true;
    if (WILDS.includes(card.value)) return true;
    const eff = (WILDS.includes(top.value) && this.wildColor) ? this.wildColor : top.color;
    return card.color === eff || card.value === top.value;
  }

  _label(c) {
    return { skip:'Skip', reverse:'Reverse', '+2':'+2', wild:'Joker', 'wild+4':'Joker+4' }[c.value] || c.value;
  }

  _colorName(c) {
    return { red:'Rouge', blue:'Bleu', green:'Vert', yellow:'Jaune' }[c] || c;
  }

  // ── État envoyé au client ────────────────────────────────────
  stateFor(forId) {
    const top = this.discard[this.discard.length - 1] || null;
    return {
      code:              this.code,
      phase:             this.phase,
      hostId:            this.hostId,
      direction:         this.direction,
      currentPlayerId:   this.players[this.currentIdx]?.id || null,
      wildColor:         this.wildColor,
      winner:            this.winner,
      winnerName:        this.winner ? this.getPlayerName(this.winner) : null,
      lastAction:        this.lastAction,
      deckCount:         this.deck.length,
      topCard:           top,
      players: this.players.map((p, i) => ({
        id:          p.id,
        name:        p.name,
        avatarColor: p.avatarColor,
        cardCount:   p.hand.length,
        isHost:      p.id === this.hostId,
        isCurrent:   i === this.currentIdx,
        hand:        p.id === forId ? p.hand : null,
      })),
    };
  }
}

module.exports = Room;
