require('dotenv').config();

const config = {
    botToken: process.env.BOT_TOKEN,
    port: process.env.PORT || 3000
};

if (!config.botToken) {
    console.error('Ошибка: BOT_TOKEN не найден');
    process.exit(1);
}

module.exports = config;
