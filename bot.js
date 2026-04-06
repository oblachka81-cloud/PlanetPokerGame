const { Telegraf } = require('telegraf');
const config = require('./utils/config');

const bot = new Telegraf(config.botToken);

// Временно: простой ответ на /start
bot.start((ctx) => {
    ctx.reply('🃏 Planet Poker\n\nБот запущен. Мини-апп скоро появится.');
});

bot.launch();
console.log(`✅ Бот Planet Poker запущен`);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
