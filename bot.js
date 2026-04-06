const { Telegraf } = require('telegraf');
const config = require('./utils/config');
const path = require('path');
const express = require('express');

const bot = new Telegraf(config.botToken);

// Подключаем обработчик /start
require('./handlers/start')(bot);

// Запускаем Express для раздачи мини-аппа
const app = express();
const PORT = config.port || 3000;

// Раздаём статику из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Для всех остальных запросов — index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🌐 Мини-апп доступен на порту ${PORT}`);
});

bot.launch();
console.log(`✅ Бот Planet Poker запущен`);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
