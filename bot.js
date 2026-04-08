const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./utils/config');
const { initDB } = require('./utils/db');
const { getOrCreateUser, getTopPlayers } = require('./utils/users');
const { getPlayerHistory, startTournament } = require('./utils/games');

// ========== TELEGRAM БОТ ==========
const bot = new Telegraf(config.botToken);

bot.start(async (ctx) => {
    const user = ctx.from;
    const name = user.first_name + (user.last_name ? ' ' + user.last_name : '');

    try {
        const dbUser = await getOrCreateUser(user.id, name, user.photo_url || null);

        await ctx.replyWithHTML(
            `♠️ <b>Planet Poker</b>\n\n` +
            `Привет, <b>${user.first_name}</b>!\n\n` +
            `💰 Твой баланс: <b>${dbUser.stars_balance} ⭐</b>\n` +
            `🎮 Игр сыграно: <b>${dbUser.games_played}</b>\n\n` +
            `Нажми кнопку ниже чтобы войти в лобби:`,
            Markup.inlineKeyboard([
                [Markup.button.webApp('🂡 Открыть Planet Poker', process.env.WEBAPP_URL || 'https://planetpokergame.bothost.tech')]
            ])
        );
    } catch (err) {
        console.error('/start error:', err);
        await ctx.reply('Произошла ошибка. Попробуй ещё раз.');
    }
});

bot.command('balance', async (ctx) => {
    try {
        const dbUser = await getOrCreateUser(ctx.from.id, ctx.from.first_name, null);
        await ctx.replyWithHTML(
            `💰 <b>Твой баланс</b>\n\n` +
            `⭐ Stars: <b>${dbUser.stars_balance}</b>\n` +
            `🎮 Игр сыграно: <b>${dbUser.games_played}</b>\n` +
            `🏆 Побед: <b>${dbUser.games_won}</b>`
        );
    } catch (err) {
        console.error('/balance error:', err);
        await ctx.reply('Ошибка при получении баланса.');
    }
});

bot.command('stats', async (ctx) => {
    try {
        const history = await getPlayerHistory(ctx.from.id, 5);
        if (history.length === 0) return ctx.reply('У тебя ещё нет сыгранных игр. Заходи в лобби!');

        const tableNames = {
            'free-6': 'Стол «Новичок»',
            'free-9': 'Стол «Профи»',
            'stars-50': 'Sit & Go Mini',
            'stars-100': 'Sit & Go Classic',
        };

        const placeEmoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
        let text = `📊 <b>Последние 5 игр:</b>\n\n`;

        for (const g of history) {
            const place = g.place || '?';
            const emoji = placeEmoji[place - 1] || '🃏';
            const table = tableNames[g.table_id] || g.table_id;
            const stars = g.stars_won > 0 ? ` · +${g.stars_won}⭐` : '';
            const date = new Date(g.started_at).toLocaleDateString('ru-RU');
            text += `${emoji} ${table}${stars} <i>${date}</i>\n`;
        }
        await ctx.replyWithHTML(text);
    } catch (err) {
        console.error('/stats error:', err);
        await ctx.reply('Ошибка при получении статистики.');
    }
});

bot.command('top', async (ctx) => {
    try {
        const players = await getTopPlayers(10);
        if (players.length === 0) return ctx.reply('Таблица лидеров пока пуста.');

        const medals = ['🥇', '🥈', '🥉'];
        let text = `🏆 <b>Топ игроков:</b>\n\n`;
        players.forEach((p, i) => {
            const medal = medals[i] || `${i + 1}.`;
            text += `${medal} <b>${p.name}</b> — ${p.stars_balance}⭐\n`;
        });
        await ctx.replyWithHTML(text);
    } catch (err) {
        console.error('/top error:', err);
        await ctx.reply('Ошибка при получении топа.');
    }
});

bot.command('help', async (ctx) => {
    await ctx.replyWithHTML(
        `🃏 <b>Planet Poker — команды:</b>\n\n` +
        `/start — открыть игру\n` +
        `/balance — твой баланс Stars\n` +
        `/stats — последние игры\n` +
        `/top — таблица лидеров\n` +
        `/help — эта справка`
    );
});

// ========== EXPRESS + SOCKET.IO ==========
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---- КОНФИГ СТОЛОВ ----
const TABLES = {
    'free-6': { name: 'Стол «Новичок»', max: 6, minPlayers: 2, type: 'free', startChips: 1000 },
    'free-9': { name: 'Стол «Профи»', max: 9, minPlayers: 2, type: 'free', startChips: 5000 },
    'stars-50': { name: 'Sit & Go · Mini', max: 6, minPlayers: 2, type: 'stars', startChips: 1500, buyin: 50 },
    'stars-100': { name: 'Sit & Go · Classic', max: 9, minPlayers: 2, type: 'stars', startChips: 3000, buyin: 100 },
};

// ---- СОСТОЯНИЕ СТОЛОВ ----
// lobbies — игроки ожидающие старта
// tables — активные игры (игра уже идёт)
const lobbies = {};
const tables = {};
Object.keys(TABLES).forEach(id => {
    lobbies[id] = [];
    tables[id] = null; // null = нет активной игры
});

// ---- SOCKET.IO ----
io.on('connection', (socket) => {
    console.log('+ подключился:', socket.id);

    // Отправляем текущее состояние всех столов новому клиенту
    Object.keys(TABLES).forEach(tableId => {
        socket.emit('lobby:update', {
            tableId,
            players: lobbies[tableId].map(p => ({ name: p.name, photo: p.photo })),
            tableActive: !!tables[tableId],
            tablePlayers: tables[tableId] ? tables[tableId].players.map(p => ({ name: p.name, photo: p.photo })) : [],
        });
    });

    socket.on('lobby:join', async ({ tableId, userId, name, photo }) => {
        console.log(`[lobby:join] tableId=${tableId} userId=${userId} name=${name} socketId=${socket.id}`);
        
        const cfg = TABLES[tableId];
        if (!cfg) return;
        
        leaveAllLobbies(socket.id);
        leaveAllTables(socket.id);
        
        const lobby = lobbies[tableId];
        
        // Уже в лобби?
        if (lobby.find(p => p.socketId === socket.id)) return;
        
        // Стол активен — подсаживаемся напрямую (ждём между раундами)
        if (tables[tableId]) {
            const table = tables[tableId];
            if (table.players.length >= cfg.max) {
                socket.emit('lobby:full', { tableId });
                return;
            }
            
            try {
                const dbUser = await getOrCreateUser(userId, name, photo);
                const newPlayer = {
                    socketId: socket.id,
                    userId,
                    dbUserId: dbUser.id,
                    telegramId: userId,
                    name,
                    photo,
                    chips: cfg.startChips,
                    sitting: false, // ждёт следующего раунда
                };
                table.players.push(newPlayer);
                socket.join(tableId);
                console.log(`[${tableId}] ${name} подсел к активной игре. Игроков: ${table.players.length}`);
                
                // Уведомляем всех за столом
                io.to(tableId).emit('table:playerJoined', {
                    tableId,
                    player: { userId, name, photo, chips: cfg.startChips },
                    players: table.players.map(p => ({
                        userId: p.telegramId,
                        name: p.name,
                        photo: p.photo,
                        chips: p.chips,
                        sitting: p.sitting
                    })),
                });
                
                // Отправляем новому игроку текущее состояние игры
                socket.emit('game:join', {
                    tableId,
                    gameId: table.gameId,
                    token: table.token,
                    players: table.players.map(p => ({
                        userId: p.telegramId,
                        dbUserId: p.dbUserId,
                        name: p.name,
                        photo: p.photo,
                        chips: p.chips,
                    })),
                    waiting: true, // ждёт следующего раунда
                });
                
                broadcastLobbyUpdate(tableId);
            } catch (err) {
                console.error('Ошибка при подсадке к активной игре:', err);
            }
            return;
        }
        
        // Стол не активен — идём в лобби
        try {
            const dbUser = await getOrCreateUser(userId, name, photo);
            lobby.push({
                socketId: socket.id,
                userId,
                dbUserId: dbUser.id,
                telegramId: userId,
                name,
                photo,
                chips: cfg.startChips,
                starsBalance: dbUser.stars_balance,
            });
            socket.join(tableId);
            console.log(`[${tableId}] ${name} в лобби. Ожидают: ${lobby.length}/${cfg.max}`);
            broadcastLobbyUpdate(tableId);
            
            // Запускаем игру если набрался минимум
            if (lobby.length >= cfg.minPlayers) {
                await startGame(tableId);
            }
        } catch (err) {
            console.error('Ошибка при вступлении в лобби:', err);
        }
    });

    socket.on('lobby:leave', ({ tableId }) => {
        console.log(`[lobby:leave] tableId=${tableId} socketId=${socket.id}`);
        removeFromLobby(tableId, socket.id);
        broadcastLobbyUpdate(tableId);
    });

    // Игрок сигналит что готов к следующему раунду (вошёл в игру)
    socket.on('table:ready', ({ tableId }) => {
        if (!tables[tableId]) return;
        const player = tables[tableId].players.find(p => p.socketId === socket.id);
        if (player) {
            player.sitting = true;
            console.log(`[${tableId}] ${player.name} готов к игре`);
        }
    });

    // Игрок уходит из активного стола
    socket.on('table:leave', ({ tableId }) => {
        console.log(`[table:leave] tableId=${tableId} socketId=${socket.id}`);
        removeFromTable(tableId, socket.id);
    });

    socket.on('disconnect', () => {
        console.log('- отключился:', socket.id);
        leaveAllLobbies(socket.id);
        leaveAllTables(socket.id);
    });
});

async function startGame(tableId) {
    const lobby = lobbies[tableId];
    const cfg = TABLES[tableId];
    const players = [...lobby];
    lobbies[tableId] = [];
    const token = Math.random().toString(36).slice(2, 10);
    
    try {
        const game = await startTournament(tableId, players.map(p => ({
            telegramId: p.telegramId,
            userId: p.dbUserId,
            name: p.name,
        })));
        
        // Сохраняем активный стол
        tables[tableId] = {
            gameId: game.id,
            token,
            players: players.map(p => ({ ...p, sitting: true })),
        };
        
        console.log(`[${tableId}] Игра #${game.id} запущена с ${players.length} игроками`);
        
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
        
        broadcastLobbyUpdate(tableId);
    } catch (err) {
        console.error('Ошибка при запуске игры:', err);
        // Если ошибка — возвращаем игроков в лобби
        lobbies[tableId] = players;
    }
}

function broadcastLobbyUpdate(tableId) {
    const table = tables[tableId];
    io.emit('lobby:update', {
        tableId,
        players: lobbies[tableId].map(p => ({ name: p.name, photo: p.photo })),
        tableActive: !!table,
        tablePlayers: table ? table.players.map(p => ({ name: p.name, photo: p.photo })) : [],
    });
}

function removeFromLobby(tableId, socketId) {
    if (!lobbies[tableId]) return;
    lobbies[tableId] = lobbies[tableId].filter(p => p.socketId !== socketId);
}

function removeFromTable(tableId, socketId) {
    if (!tables[tableId]) return;
    const before = tables[tableId].players.length;
    tables[tableId].players = tables[tableId].players.filter(p => p.socketId !== socketId);
    if (tables[tableId].players.length !== before) {
        console.log(`[${tableId}] Игрок ушёл. Осталось: ${tables[tableId].players.length}`);
        io.to(tableId).emit('table:playerLeft', {
            tableId,
            players: tables[tableId].players.map(p => ({
                userId: p.telegramId,
                name: p.name,
                photo: p.photo,
                chips: p.chips,
            })),
        });
        
        // Если никого не осталось — закрываем стол
        if (tables[tableId].players.length < 1) {
            console.log(`[${tableId}] Стол опустел, закрываем`);
            tables[tableId] = null;
        }
        broadcastLobbyUpdate(tableId);
    }
}

function leaveAllLobbies(socketId) {
    Object.keys(lobbies).forEach(tableId => {
        const before = lobbies[tableId].length;
        lobbies[tableId] = lobbies[tableId].filter(p => p.socketId !== socketId);
        if (lobbies[tableId].length !== before) broadcastLobbyUpdate(tableId);
    });
}

function leaveAllTables(socketId) {
    Object.keys(tables).forEach(tableId => {
        if (!tables[tableId]) return;
        const before = tables[tableId].players.length;
        tables[tableId].players = tables[tableId].players.filter(p => p.socketId !== socketId);
        if (tables[tableId].players.length !== before) {
            if (tables[tableId].players.length < 1) tables[tableId] = null;
            broadcastLobbyUpdate(tableId);
        }
    });
}

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;

initDB()
    .then(() => {
        httpServer.listen(PORT, () => {
            console.log(`🌐 Express + Socket.io сервер запущен на порту ${PORT}`);
        });
        bot.launch();
        console.log('✅ Бот Planet Poker запущен');
    })
    .catch(err => {
        console.error('Ошибка инициализации БД:', err);
        process.exit(1);
    });

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
});
