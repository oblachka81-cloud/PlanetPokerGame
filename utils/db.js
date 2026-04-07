/* ============================================
   PLANET POKER — UTILS/DB.JS
   Подключение к PostgreSQL
============================================ */

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
});

// Проверка подключения + создание таблиц
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                photo_url TEXT,
                stars_balance INTEGER DEFAULT 500,
                games_played INTEGER DEFAULT 0,
                games_won INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                table_id VARCHAR(50) NOT NULL,
                started_at TIMESTAMP DEFAULT NOW(),
                finished_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS game_players (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id),
                user_id INTEGER REFERENCES users(id),
                place INTEGER,
                chips_start INTEGER,
                chips_end INTEGER,
                stars_won INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                amount INTEGER NOT NULL,
                type VARCHAR(50) NOT NULL,
                game_id INTEGER REFERENCES games(id),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('БД инициализирована успешно');
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };
