/* ============================================
   PLANET POKER — SERVER.JS
   Socket.io + логика лобби + PostgreSQL
============================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { initDB } = require('./utils/db');
const { getOrCreateUser } = require('./utils/users');
const { startTournament } = require('./utils/games');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
});

// ---- СТАТИКА ----
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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
const lobbies = {};
Object.keys(TABLES).forEach(id => lobbies[id] = []);

// ---- SOCKET.IO ----
io.on('connection', (socket) => {
    console.log('+ подключился:', socket.id);

    // Отправить текущее состояние лобби
    Object.keys(lobbies).forEach(tableId => {
        socket.emit('lobby:update', {
            tableId,
            players: lobbies[tableId].map(p => ({
                name: p.name,
                photo: p.photo,
            })),
        });
    });

    // ---- ВСТУПИТЬ В СТОЛ ----
    socket.on('lobby:join', async ({ tableId, userId, name, photo }) => {
        const cfg = TABLES[tableId];
        if (!cfg) return;

        const lobby = lobbies[tableId];

        // Уже в этом лобби?
        if (lobby.find(p => p.socketId === socket.id)) return;

        // Уже в другом лобби — убрать
        leaveAllLobbies(socket.id);

        try {
            // Получить или создать игрока в БД
            const dbUser = await getOrCreateUser(userId, name, photo);

            // Добавить в лобби
            lobby.push({
                socketId: socket.id,
                userId,
                dbUserId: dbUser.id,
                telegramId: userId,
                name,
                photo,
                starsBalance: dbUser.stars_balance,
            });

            socket.join(tableId);
            console.log(`[${tableId}] ${name} вступил (${lobby.length}/${cfg.max})`);

            // Обновить всех
            io.emit('lobby:update', {
                tableId,
                players: lobby.map(p => ({ name: p.name, photo: p.photo })),
            });

            // Стол заполнен — запускаем игру
            if (lobby.length >= cfg.max) {
                await startGame(tableId);
            }
        } catch (err) {
            console.error('Ошибка при вступлении в лобби:', err);
        }
    });

    // ---- ПОКИНУТЬ СТОЛ ----
    socket.on('lobby:leave', ({ tableId }) => {
        removeFromLobby(tableId, socket.id);
        io.emit('lobby:update', {
            tableId,
            players: lobbies[tableId].map(p => ({ name: p.name, photo: p.photo })),
        });
    });

    // ---- ОТКЛЮЧЕНИЕ ----
    socket.on('disconnect', () => {
        console.log('- отключился:', socket.id);
        leaveAllLobbies(socket.id);
    });
});

// ---- ЗАПУСК ИГРЫ ----
async function startGame(tableId) {
    const lobby = lobbies[tableId];
    const cfg = TABLES[tableId];
    const players = [...lobby];

    // Очистить лобби
    lobbies[tableId] = [];

    const token = Math.random().toString(36).slice(2, 10);

    try {
        // Создать игру в БД + списать взносы
        const game = await startTournament(tableId, players.map(p => ({
            telegramId: p.telegramId,
            userId: p.dbUserId,
            name: p.name,
        })));

        console.log(`[${tableId}] Игра #${game.id} запускается! Игроки: ${players.map(p => p.name).join(', ')}`);

        // Сообщить игрокам
        players.forEach(p => {
            io.to(p.socketId).emit('game:start', {
                tableId,
                gameId: game.id,
                token,
                players: players.map(pl => ({
                    userId: pl.telegramId,
                    dbUserId: pl.dbUserId,
                    name: pl.name,
                    photo: pl.photo,
                    chips: cfg.startChips,
                })),
            });
        });
    } catch (err) {
        console.error('Ошибка при запуске игры:', err);
    }

    // Обновить лобби (стол пустой)
    io.emit('lobby:update', { tableId, players: [] });
}

// ---- HELPERS ----
function removeFromLobby(tableId, socketId) {
    if (!lobbies[tableId]) return;
    lobbies[tableId] = lobbies[tableId].filter(p => p.socketId !== socketId);
}

function leaveAllLobbies(socketId) {
    Object.keys(lobbies).forEach(tableId => {
        const before = lobbies[tableId].length;
        lobbies[tableId] = lobbies[tableId].filter(p => p.socketId !== socketId);
        if (lobbies[tableId].length !== before) {
            io.emit('lobby:update', {
                tableId,
                players: lobbies[tableId].map(p => ({ name: p.name, photo: p.photo })),
            });
        }
    });
}

// ---- СТАРТ ----
const PORT = process.env.PORT || 3000;

initDB()
    .then(() => {
        server.listen(PORT, () => {
            console.log(`Planet Poker сервер запущен на порту ${PORT}`);
        });
    })
    .catch(err => {
        console.error('Ошибка инициализации БД:', err);
        process.exit(1);
    });
