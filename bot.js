/* ============================================
   PLANET POKER — BOT.JS
   Telegram бот: команды /start, /balance, /stats, /top
============================================ */

const { Telegraf, Markup } = require('telegraf');
const config = require('./utils/config');
const { initDB } = require('./utils/db');
const { getOrCreateUser, getBalance, getTopPlayers, getTransactions } = require('./utils/users');
const { getPlayerHistory } = require('./utils/games');

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
                [Markup.button.webApp('🂡 Открыть Planet Poker', process.env.WEBAPP_URL)]
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
        const dbUser = await getOrCreateUser(
            ctx.from.id,
            ctx.from.first_name,
            null
        );

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

// ---- ЗАПУСК ----
initDB()
    .then(() => {
        bot.launch();
        console.log('✅ Бот Planet Poker запущен');
    })
    .catch(err => {
        console.error('Ошибка инициализации БД:', err);
        process.exit(1);
    });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
