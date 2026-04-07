/* ============================================
   PLANET POKER — SERVER.JS
   Socket.io + логика лобби
============================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
});

// ---- СТАТИКА ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- КОНФИГ СТОЛОВ ----
const TABLES = {
    'free-6': {
        name: 'Стол «Новичок»',
        max: 6,
        type: 'free',
        startChips: 1000
    },
    'free-9': {
        name: 'Стол «Профи»',
        max: 9,
        type: 'free',
        startChips: 5000
    },
    'stars-50': {
        name: 'Sit & Go · Mini',
        max: 6,
        type: 'stars',
        startChips: 1500,
        buyin: 50
    },
    'stars-100': {
        name: 'Sit & Go · Classic',
        max: 9,
        type: 'stars',
        startChips: 3000,
        buyin: 100
    },
};

// ---- СОСТОЯНИЕ ЛОББИ ----
// lobbies[tableId] = [ { socketId, userId, name, photo } ]
const lobbies = {};
Object.keys(TABLES).forEach(id => lobbies[id] = []);

// ---- ПОДКЛЮЧЕНИЕ ----
io.on('connection', (socket) => {
    console.log('+ подключился:', socket.id);

    // Отправить текущее состояние лобби новому игроку
    Object.keys(lobbies).forEach(tableId => {
        socket.emit('lobby:update', {
            tableId,
            players: lobbies[tableId],
        });
    });

    // ---- ВСТУПИТЬ В СТОЛ ----
    socket.on('lobby:join', ({ tableId, userId, name, photo }) => {
        const cfg = TABLES[tableId];
        if (!cfg) return;

        const lobby = lobbies[tableId];

        // Уже в этом лобби?
        if (lobby.find(p => p.socketId === socket.id)) return;

        // Уже в другом лобби — убрать
        leaveAllLobbies(socket.id);

        // Добавить в лобби
        lobby.push({ socketId: socket.id, userId, name, photo });
        socket.join(tableId);

        console.log(`[${tableId}] ${name} вступил (${lobby.length}/${cfg.max})`);

        // Обновить всех в лобби
        io.emit('lobby:update', { tableId, players: lobby });

        // Стол заполнен — запускаем игру
        if (lobby.length >= cfg.max) {
            startGame(tableId);
        }
    });

    // ---- ПОКИНУТЬ СТОЛ ----
    socket.on('lobby:leave', ({ tableId }) => {
        removeFromLobby(tableId, socket.id);
        io.emit('lobby:update', {
            tableId,
            players: lobbies[tableId],
        });
    });

    // ---- ОТКЛЮЧЕНИЕ ----
    socket.on('disconnect', () => {
        console.log('- отключился:', socket.id);
        leaveAllLobbies(socket.id);
    });
});

// ---- ЗАПУСК ИГРЫ ----
function startGame(tableId) {
    const lobby = lobbies[tableId];
    const cfg = TABLES[tableId];
    const players = [...lobby];

    // Очистить лобби
    lobbies[tableId] = [];

    // Токен комнаты
    const token = Math.random().toString(36).slice(2, 10);

    console.log(`[${tableId}] Игра запускается! Игроки: ${players.map(p => p.name).join(', ')}`);

    // Сообщить игрокам
    players.forEach(p => {
        io.to(p.socketId).emit('game:start', {
            tableId,
            token,
            players: players.map(pl => ({
                userId: pl.userId,
                name: pl.name,
                photo: pl.photo,
                chips: cfg.startChips,
            })),
        });
    });

    // Обновить лобби (стол пустой)
    io.emit('lobby:update', { tableId, players: [] });
}

// ---- HELPERS ----
function removeFromLobby(tableId, socketId) {
    if (!lobbies[tableId]) return;
    const before = lobbies[tableId].length;
    lobbies[tableId] = lobbies[tableId].filter(p => p.socketId !== socketId);
    if (lobbies[tableId].length !== before) {
        console.log(`[${tableId}] игрок вышел (${lobbies[tableId].length})`);
    }
}

function leaveAllLobbies(socketId) {
    Object.keys(lobbies).forEach(tableId => {
        const before = lobbies[tableId].length;
        lobbies[tableId] = lobbies[tableId].filter(p => p.socketId !== socketId);
        if (lobbies[tableId].length !== before) {
            io.emit('lobby:update', {
                tableId,
                players: lobbies[tableId],
            });
        }
    });
}

// ---- СТАРТ ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Planet Poker сервер запущен на порту ${PORT}`);
});
