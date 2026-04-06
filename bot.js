const { Telegraf } = require('telegraf');
const config = require('./utils/config');

const bot = new Telegraf(config.botToken);

// Подключаем обработчики команд
require('./handlers/game')(bot);

// Временный /start (потом вынесем в отдельный файл)
bot.start((ctx) => {
    ctx.reply('🃏 Planet Poker\n\nОтправь /game чтобы открыть стол');
});

bot.launch();
console.log(`✅ Бот Planet Poker запущен`);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
