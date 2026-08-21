// package.json comments: 
// name: WackyChefShowdown, express 4.18, socket.io 4.6, better-sqlite3 9.0
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const PORT = 3000;
const TICK_RATE = 50; // 20Hz
const WORLD_W = 3000;
const WORLD_H = 3000;
const MAX_ROOM = 10;
const BOT_COUNT = 5;
const SPEED = 4; // moves per tick
const ATTACK_RANGE = 60;
const ATTACK_DMG = 10;

// Database Initialization
const db = new Database('game.db');

// Create tables
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  level INTEGER,
  xp INTEGER,
  allTimeScore INTEGER,
  gamesPlayed INTEGER,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  playerId INTEGER,
  score INTEGER,
  xp INTEGER,
  duration INTEGER,
  endedAt INTEGER
);
`);

// Prepared statements
const upsertPlayer = db.prepare(`
INSERT INTO players (username, level, xp, allTimeScore, gamesPlayed, createdAt)
VALUES (?, 1, 0, 0, 0, strftime('%s','now'))
ON CONFLICT(username) DO UPDATE SET 
  allTimeScore = allTimeScore + excluded.allTimeScore,
  gamesPlayed = gamesPlayed + 1
`);

const insertSession = db.prepare(`
INSERT INTO sessions (playerId, score, xp, duration, endedAt)
VALUES (?, ?, ?, ?, ?)
`);

const getTopPlayers = db.prepare(`
SELECT username, allTimeScore FROM players ORDER BY allTimeScore DESC LIMIT 10
`);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

class Player {
    constructor(id, username) {
        this.id = id;
        this.username = username;
        this.x = Math.random() * WORLD_W;
        this.y = Math.random() * WORLD_H;
        this.health = 100;
        this.score = 0;
        this.level = 1;
        this.xp = 0;
    }
}

class Bot {
    constructor(id) {
        this.id = id;
        this.x = Math.random() * WORLD_W;
        this.y = Math.random() * WORLD_H;
        this.state = 'idle';
    }

    update(players) {
        // Bot logic: idle/wander/chase/attack/flee
        switch (this.state) {
            case 'idle':
                // Wander randomly
                if (Math.random() < 0.05) {
                    this.state = 'wander';
                }
                break;
            case 'wander':
                this.x += (Math.random() - 0.5) * SPEED;
                this.y += (Math.random() - 0.5) * SPEED;
                if (Math.random() < 0.1) {
                    this.state = 'idle';
                }
                break;
            case 'chase':
                // Chase logic
                const target = players[Math.floor(Math.random() * players.length)];
                if (target) {
                    const dx = target.x - this.x;
                    const dy = target.y - this.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < ATTACK_RANGE) {
                        this.state = 'attack';
                    } else {
                        this.x += (dx / distance) * SPEED;
                        this.y += (dy / distance) * SPEED;
                    }
                }
                break;
            case 'attack':
                // Attack logic
                break;
            case 'flee':
                // Flee logic
                break;
        }
    }
}

class CollectibleManager {
    constructor() {
        this.collectibles = [];
    }

    spawnCollectibles() {
        // Spawn logic for collectibles
    }

    checkPickups(player) {
        // Check if player has picked up any collectibles
    }
}

class Room {
    constructor(id) {
        this.id = id;
        this.players = new Map();
        this.bots = [];
        this.tickCount = 0;
        this.gracePeriod = 30; // Seconds
        this.lastPlayerCount = 0;
        this.isActive = false;

        this.populateBots();
        this.startGameLoop();
    }

    addPlayer(player) {
        this.players.set(player.id, player);
        player.x = Math.random() * WORLD_W;
        player.y = Math.random() * WORLD_H;
    }

    removePlayer(player) {
        this.players.delete(player.id);
        if (this.players.size === 0) {
            this.destroyRoom();
        }
    }

    populateBots() {
        for (let i = 0; i < BOT_COUNT; i++) {
            this.bots.push(new Bot(i));
        }
    }

    startGameLoop() {
        const tick = () => {
            this.gameLoop();
            setTimeout(tick, TICK_RATE);
        };
        tick();
    }

    gameLoop() {
        this.tickCount++;
        this.bots.forEach(bot => bot.update(Array.from(this.players.values())));
        // Broadcast current game state
        if (this.tickCount % 5 === 0) {
            this.broadcastState();
        }
    }

    broadcastState() {
        const state = Array.from(this.players.values()).map(player => ({
            id: player.id,
            x: player.x,
            y: player.y,
            health: player.health,
            score: player.score
        }));
        io.to(this.id).emit('gameState', { players: state });
    }

    destroyRoom() {
        if (this.lastPlayerCount === 0) {
            setTimeout(() => {
                if (this.lastPlayerCount === 0) {
                    // Cleanup and remove room
                }
            }, this.gracePeriod * 1000);
        }
    }
}

class RoomManager {
    constructor() {
        this.rooms = new Map();
    }

    findOrCreateRoom() {
        for (let i = 0; i < MAX_ROOM; i++) {
            if (!this.rooms.has(i)) {
                const room = new Room(i);
                this.rooms.set(i, room);
                return room;
            }
        }
        return null; // No available rooms
    }

    // Additional methods as needed
}

const roomManager = new RoomManager();

function savePlayerSession(player) {
    const sessionId = Date.now();
    insertSession.run(player.id, player.score, player.xp, Math.random() * 300, sessionId);
}

function loadPlayerProfile(username) {
    const playerData = db.prepare('SELECT * FROM players WHERE username = ?').get(username);
    if (playerData) {
        return new Player(playerData.id, playerData.username);
    }
    return null;
}

function getGlobalLeaderboard() {
    return getTopPlayers.all();
}

// Socket event handlers
io.on('connection', (socket) => {
    socket.on('joinRoom', ({ playerId, roomId }) => {
        const player = loadPlayerProfile(playerId);
        const room = roomManager.rooms.get(roomId);
        if (room && player) {
            room.addPlayer(player);
            socket.currentRoomId = room.id;
            socket.currentPlayerId = socket.id;
            socket.join(room.id);
            io.to(room.id).emit('roomJoined', { roomId: room.id, playerId: player.id });
        }
    });

    socket.on('playerInput', ({ dx, dy }) => {
        const room = roomManager.rooms.get(socket.currentRoomId);
        if (!room) return;

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return; // Input validation
        const player = room.players.get(socket.currentPlayerId);
        player.x += dx * SPEED;
        player.y += dy * SPEED;
    });

    socket.on('respawn', () => {
        const room = roomManager.rooms.get(socket.currentRoomId);
        if (!room) return;

        const player = loadPlayerProfile(socket.currentPlayerId);
        if (player) {
            room.addPlayer(player);
        }
    });

    socket.on('disconnect', () => {
        const room = roomManager.rooms.get(socket.currentRoomId);
        if (room) {
            const player = room.players.get(socket.currentPlayerId);
            if (player) {
                room.removePlayer(player);
                savePlayerSession(player);
            }
        }
    });
});

app.use(express.static('public'));

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});