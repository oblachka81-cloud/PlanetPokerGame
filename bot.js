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

// ---- /start ----
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

// ---- /balance ----
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

// ---- /stats ----
bot.command('stats', async (ctx) => {
    try {
        const history = await getPlayerHistory(ctx.from.id, 5);
        if (history.length === 0) {
            return ctx.reply('У тебя ещё нет сыгранных игр. Заходи в лобби!');
        }

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

// ---- /top ----
bot.command('top', async (ctx) => {
    try {
        const players = await getTopPlayers(10);
        if (players.length === 0) {
            return ctx.reply('Таблица лидеров пока пуста.');
        }

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

// ---- /help ----
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

// ---- СТАТИКА ----
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ---- КОНФИГ СТОЛОВ ----
const TABLES = {
    'free-6': { name: 'Стол «Новичок»', max: 6, type: 'free', startChips: 1000 },
    'free-9': { name: 'Стол «Профи»', max: 9, type: 'free', startChips: 5000 },
    'stars-50': { name: 'Sit & Go · Mini', max: 6, type: 'stars', startChips: 1500, buyin: 50 },
    'stars-100': { name: 'Sit & Go · Classic', max: 9, type: 'stars', startChips: 3000, buyin: 100 },
};

// ---- СОСТОЯНИЕ ЛОББИ ----
const lobbies = {};
Object.keys(TABLES).forEach(id => lobbies[id] = []);

// ---- SOCKET.IO ----
io.on('connection', (socket) => {
    console.log('+ подключился:', socket.id);

    Object.keys(lobbies).forEach(tableId => {
        socket.emit('lobby:update', {
            tableId,
            players: lobbies[tableId].map(p => ({ name: p.name, photo: p.photo })),
        });
    });

    socket.on('lobby:join', async ({ tableId, userId, name, photo }) => {
        console.log(`[lobby:join] tableId=${tableId} userId=${userId} name=${name} socketId=${socket.id}`);
        
        const cfg = TABLES[tableId];
        if (!cfg) {
            console.log(`[lobby:join] ОШИБКА: стол ${tableId} не найден`);
            return;
        }

        const lobby = lobbies[tableId];
        if (lobby.find(p => p.socketId === socket.id)) {
            console.log(`[lobby:join] socketId уже в лобби, игнорируем`);
            return;
        }

        leaveAllLobbies(socket.id);

        // ДИАГНОСТИКА ДО
        console.log(`[${tableId}] Лобби перед push:`, lobby.map(p => p.name));

        try {
            const dbUser = await getOrCreateUser(userId, name, photo);
            lobby.push({
                socketId: socket.id,
                userId,
                dbUserId: dbUser.id,
                telegramId: userId,
                name,
                photo,
                starsBalance: dbUser.stars_balance,
            });

            // ДИАГНОСТИКА ПОСЛЕ
            console.log(`[${tableId}] Лобби после push:`, lobby.map(p => p.name));

            socket.join(tableId);
            console.log(`[${tableId}] ${name} (userId=${userId}) вступил. Игроков в лобби: ${lobby.length}/${cfg.max}`);
            console.log(`[${tableId}] Список игроков:`, lobby.map(p => `${p.name}(${p.userId})`).join(', '));

            io.emit('lobby:update', {
                tableId,
                players: lobby.map(p => ({ name: p.name, photo: p.photo })),
            });

            if (lobby.length >= cfg.max) {
                await startGame(tableId);
            }
        } catch (err) {
            console.error('Ошибка при вступлении в лобби:', err);
        }
    });

    socket.on('lobby:leave', ({ tableId }) => {
        console.log(`[lobby:leave] tableId=${tableId} socketId=${socket.id}`);
        removeFromLobby(tableId, socket.id);
        io.emit('lobby:update', {
            tableId,
            players: lobbies[tableId].map(p => ({ name: p.name, photo: p.photo })),
        });
    });

    socket.on('disconnect', () => {
        console.log('- отключился:', socket.id);
        leaveAllLobbies(socket.id);
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
        console.log(`[${tableId}] Игра #${game.id} запускается!`);

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
    io.emit('lobby:update', { tableId, players: [] });
}

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
