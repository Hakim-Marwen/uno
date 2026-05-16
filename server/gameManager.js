const Room = require('./room');

class GameManager {
  constructor() { this._rooms = new Map(); }

  create(hostId, hostName) {
    const code = this._genCode();
    const room = new Room(code, hostId, hostName);
    this._rooms.set(code, room);
    return room;
  }

  get(code)    { return this._rooms.get((code||'').toUpperCase()) || null; }
  delete(code) { this._rooms.delete((code||'').toUpperCase()); }
  count()      { return this._rooms.size; }

  cleanup(maxAgeMs) {
    let n = 0;
    const now = Date.now();
    for (const [code, room] of this._rooms) {
      if (now - room.createdAt > maxAgeMs) { this._rooms.delete(code); n++; }
    }
    return n;
  }

  _genCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
    while (this._rooms.has(code));
    return code;
  }
}

module.exports = GameManager;
