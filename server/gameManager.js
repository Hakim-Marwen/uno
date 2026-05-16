/**
 * GameManager - Gère toutes les salles de jeu en mémoire
 * Pour la production, vous pouvez remplacer par Redis ou une BDD
 */

const Room = require('./room');

class GameManager {
  constructor() {
    this.rooms = new Map(); // code -> Room
  }

  createRoom(hostId, hostName) {
    const code = this.generateUniqueCode();
    const room = new Room(code, hostId, hostName);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code?.toUpperCase()) || null;
  }

  deleteRoom(code) {
    this.rooms.delete(code?.toUpperCase());
  }

  getRoomList() {
    return Array.from(this.rooms.values()).map(r => ({
      code: r.code,
      players: r.players.length,
      phase: r.phase
    }));
  }

  generateUniqueCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  cleanupOldRooms(maxAgeMs) {
    let deleted = 0;
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > maxAgeMs) {
        this.rooms.delete(code);
        deleted++;
      }
    }
    return deleted;
  }
}

module.exports = GameManager;
