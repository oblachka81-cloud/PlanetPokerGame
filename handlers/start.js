// handlers/start.js
// Команда /start — сразу открывает кнопку с мини-аппом

const { Markup } = require('telegraf');

module.exports = (bot) => {
    bot.start((ctx) => {
        const url = 'https://planetpokergame.bothost.tech';
        ctx.reply(
            '🃏 Добро пожаловать в Planet Poker!\n\nНажми на кнопку, чтобы открыть стол:',
            Markup.inlineKeyboard([
                Markup.button.webApp('🎮 Играть', url)
            ])
        );
    });
};
