const { Telegraf } = require('telegraf');
const config = require('./utils/config');

const bot = new Telegraf(config.botToken);

// Подключаем обработчик /start с кнопкой мини-аппа
require('./handlers/start')(bot);

bot.launch();
console.log(`✅ Бот Planet Poker запущен`);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
