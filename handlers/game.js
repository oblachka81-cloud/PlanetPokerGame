// handlers/game.js
// Команда /game — открывает мини-апп Planet Poker

const { Markup } = require('telegraf');

module.exports = (bot) => {
    bot.command('game', (ctx) => {
        const url = 'https://planetpokergame.bothost.tech'; // твой домен
        ctx.reply(
            '🃏 Добро пожаловать в Planet Poker!\n\nНажми на кнопку, чтобы открыть стол:',
            Markup.inlineKeyboard([
                Markup.button.webApp('🎮 Играть', url)
            ])
        );
    });
};
