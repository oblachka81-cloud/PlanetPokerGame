/* ============================================
   PLANET POKER — UTILS/USERS.JS
   Работа с игроками в БД
============================================ */

const { pool } = require('./db');

// ---- ПОЛУЧИТЬ ИЛИ СОЗДАТЬ ИГРОКА ----
async function getOrCreateUser(telegramId, name, photoUrl = null) {
    const client = await pool.connect();
    try {
        // Попробовать найти
        const existing = await client.query(
            'SELECT * FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        if (existing.rows.length > 0) {
            // Обновить имя и фото если изменились
            await client.query(
                'UPDATE users SET name = $1, photo_url = $2 WHERE telegram_id = $3',
                [name, photoUrl, telegramId]
            );
            return existing.rows[0];
        }

        // Создать нового
        const result = await client.query(
            `INSERT INTO users (telegram_id, name, photo_url, stars_balance) 
             VALUES ($1, $2, $3, 500) RETURNING *`,
            [telegramId, name, photoUrl]
        );
        console.log(`Новый игрок: ${name} (${telegramId})`);
        return result.rows[0];
    } finally {
        client.release();
    }
}

// ---- ПОЛУЧИТЬ ИГРОКА ПО TELEGRAM ID ----
async function getUserByTelegramId(telegramId) {
    const result = await pool.query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
    );
    return result.rows[0] || null;
}

// ---- ПОЛУЧИТЬ БАЛАНС ----
async function getBalance(telegramId) {
    const user = await getUserByTelegramId(telegramId);
    return user ? user.stars_balance : 0;
}

// ---- ИЗМЕНИТЬ БАЛАНС ----
async function updateBalance(telegramId, amount, type, gameId = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Обновить баланс
        const result = await client.query(
            `UPDATE users SET stars_balance = stars_balance + $1 
             WHERE telegram_id = $2 RETURNING stars_balance`,
            [amount, telegramId]
        );

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const newBalance = result.rows[0].stars_balance;

        // Записать транзакцию
        const user = await client.query(
            'SELECT id FROM users WHERE telegram_id = $1',
            [telegramId]
        );

        await client.query(
            `INSERT INTO transactions (user_id, amount, type, game_id) 
             VALUES ($1, $2, $3, $4)`,
            [user.rows[0].id, amount, type, gameId]
        );

        await client.query('COMMIT');
        return newBalance;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ---- СПИСАТЬ ВЗНОС (buyin) ----
async function chargeBuyin(telegramId, amount, gameId) {
    const user = await getUserByTelegramId(telegramId);
    if (!user) return { ok: false, reason: 'Игрок не найден' };
    if (user.stars_balance < amount) {
        return { ok: false, reason: 'Недостаточно Stars' };
    }

    const newBalance = await updateBalance(telegramId, -amount, 'buyin', gameId);
    return { ok: true, newBalance };
}

// ---- НАЧИСЛИТЬ ВЫИГРЫШ ----
async function addWinnings(telegramId, amount, gameId) {
    const newBalance = await updateBalance(telegramId, amount, 'winnings', gameId);
    return { ok: true, newBalance };
}

// ---- ОБНОВИТЬ СТАТИСТИКУ ----
async function updateStats(telegramId, won = false) {
    await pool.query(
        `UPDATE users 
         SET games_played = games_played + 1, 
             games_won = games_won + $1 
         WHERE telegram_id = $2`,
        [won ? 1 : 0, telegramId]
    );
}

// ---- ТОП ИГРОКОВ ----
async function getTopPlayers(limit = 10) {
    const result = await pool.query(
        `SELECT name, stars_balance, games_played, games_won 
         FROM users 
         ORDER BY stars_balance DESC 
         LIMIT $1`,
        [limit]
    );
    return result.rows;
}

// ---- ИСТОРИЯ ТРАНЗАКЦИЙ ----
async function getTransactions(telegramId, limit = 10) {
    const result = await pool.query(
        `SELECT t.amount, t.type, t.created_at 
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         WHERE u.telegram_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2`,
        [telegramId, limit]
    );
    return result.rows;
}

module.exports = {
    getOrCreateUser,
    getUserByTelegramId,
    getBalance,
    updateBalance,
    chargeBuyin,
    addWinnings,
    updateStats,
    getTopPlayers,
    getTransactions,
};
