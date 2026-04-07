/* ============================================
   PLANET POKER — UTILS/GAMES.JS
   Работа с играми в БД
============================================ */

const { pool } = require('./db');
const { addWinnings, chargeBuyin, updateStats } = require('./users');

// ---- СОЗДАТЬ ИГРУ ----
async function createGame(tableId) {
    const result = await pool.query(
        `INSERT INTO games (table_id) VALUES ($1) RETURNING *`,
        [tableId]
    );
    console.log(`Игра создана: id=${result.rows[0].id} table=${tableId}`);
    return result.rows[0];
}

// ---- ЗАВЕРШИТЬ ИГРУ ----
async function finishGame(gameId) {
    await pool.query(
        `UPDATE games SET finished_at = NOW() WHERE id = $1`,
        [gameId]
    );
}

// ---- ЗАПИСАТЬ УЧАСТНИКА ----
async function addGamePlayer(gameId, userId, chipsStart) {
    const result = await pool.query(
        `INSERT INTO game_players (game_id, user_id, chips_start) 
         VALUES ($1, $2, $3) RETURNING *`,
        [gameId, userId, chipsStart]
    );
    return result.rows[0];
}

// ---- ЗАПИСАТЬ РЕЗУЛЬТАТ ИГРОКА ----
async function setPlayerResult(gameId, userId, place, chipsEnd, starsWon) {
    await pool.query(
        `UPDATE game_players 
         SET place = $1, chips_end = $2, stars_won = $3 
         WHERE game_id = $4 AND user_id = $5`,
        [place, chipsEnd, starsWon, gameId, userId]
    );
}

// ---- ПРИЗОВЫЕ ЗА МЕСТО ----
const PRIZE_STRUCTURE = {
    'stars-50': {
        6: [180, 90, 30], // 1-е, 2-е, 3-е место
    },
    'stars-100': {
        9: [540, 270, 90],
    },
};

function getPrizes(tableId, playerCount) {
    return PRIZE_STRUCTURE[tableId]?.[playerCount] || null;
}

// ---- ЗАВЕРШИТЬ ТУРНИР И РАЗДАТЬ ПРИЗЫ ----
async function finalizeTournament(gameId, tableId, results) {
    // results = [ { telegramId, userId, place, chipsEnd } ]
    // отсортированы по месту
    const prizes = getPrizes(tableId, results.length);

    for (const player of results) {
        const starsWon = prizes?.[player.place - 1] || 0;

        // Записать результат в БД
        await setPlayerResult(
            gameId,
            player.userId,
            player.place,
            player.chipsEnd,
            starsWon
        );

        // Начислить выигрыш
        if (starsWon > 0) {
            await addWinnings(player.telegramId, starsWon, gameId);
        }

        // Обновить статистику
        await updateStats(player.telegramId, player.place === 1);
    }

    // Завершить игру
    await finishGame(gameId);
    console.log(`Турнир завершён: gameId=${gameId}`);
    return prizes;
}

// ---- СТАРТ ТУРНИРА (списать взносы) ----
async function startTournament(tableId, players) {
    // players = [ { telegramId, userId, name } ]
    const BUYINS = {
        'stars-50': 50,
        'stars-100': 100,
    };
    const buyin = BUYINS[tableId] || 0;

    // Создать игру
    const game = await createGame(tableId);

    // Списать взносы и записать участников
    for (const player of players) {
        if (buyin > 0) {
            const charge = await chargeBuyin(player.telegramId, buyin, game.id);
            if (!charge.ok) {
                console.warn(`Не удалось списать взнос у ${player.name}: ${charge.reason}`);
            }
        }

        const CHIPS = {
            'free-6': 1000,
            'free-9': 5000,
            'stars-50': 1500,
            'stars-100': 3000,
        };
        await addGamePlayer(game.id, player.userId, CHIPS[tableId] || 1000);
    }

    return game;
}

// ---- ИСТОРИЯ ИГР ИГРОКА ----
async function getPlayerHistory(telegramId, limit = 10) {
    const result = await pool.query(
        `SELECT g.table_id, g.started_at, g.finished_at, gp.place, 
                gp.chips_start, gp.chips_end, gp.stars_won
         FROM game_players gp
         JOIN games g ON g.id = gp.game_id
         JOIN users u ON u.id = gp.user_id
         WHERE u.telegram_id = $1
         ORDER BY g.started_at DESC
         LIMIT $2`,
        [telegramId, limit]
    );
    return result.rows;
}

// ---- СТАТИСТИКА СТОЛА ----
async function getTableStats(tableId) {
    const result = await pool.query(
        `SELECT COUNT(*) as total_games, 
                AVG(EXTRACT(EPOCH FROM (finished_at - started_at))/60) as avg_duration_min
         FROM games 
         WHERE table_id = $1 AND finished_at IS NOT NULL`,
        [tableId]
    );
    return result.rows[0];
}

module.exports = {
    createGame,
    finishGame,
    addGamePlayer,
    setPlayerResult,
    getPrizes,
    finalizeTournament,
    startTournament,
    getPlayerHistory,
    getTableStats,
};
