/* ============================================
   PLANET POKER — LOBBY.JS
   Логика лобби: столы, ожидание, Socket.io
============================================ */

const SERVER_URL = 'https://planetpokergame.bothost.tech';

// ---- ИНИЦИАЛИЗАЦИЯ ----
document.addEventListener('DOMContentLoaded', () => {
    initUser();
    initTables();
    connectSocket();
});

// ---- ЮЗЕР ----
function initUser() {
    const name = window.TG?.getName() || 'Игрок';
    const initials = window.TG?.getInitials() || '?';
    const photo = window.TG?.getPhoto();

    document.getElementById('userName').textContent = name;

    const avatar = document.getElementById('userAvatar');
    if (photo) {
        avatar.innerHTML = `<img src="${photo}" alt="${name}">`;
    } else {
        avatar.textContent = initials;
    }

    window.TG?.showBack(() => {
        window.location.href = 'index.html';
    });
}

// ---- КОНФИГ СТОЛОВ ----
const TABLES = {
    'free-6': {
        name: 'Стол «Новичок»',
        max: 6,
        type: 'free',
        prizes: null
    },
    'free-9': {
        name: 'Стол «Профи»',
        max: 9,
        type: 'free',
        prizes: null
    },
    'stars-50': {
        name: 'Sit & Go · Mini',
        max: 6,
        type: 'stars',
        prizes: ['180⭐', '90⭐', '30⭐']
    },
    'stars-100': {
        name: 'Sit & Go · Classic',
        max: 9,
        type: 'stars',
        prizes: ['540⭐', '270⭐', '90⭐']
    },
};

// ---- СТОЛЫ: клик ----
function initTables() {
    document.querySelectorAll('.table-card').forEach(card => {
        const tableId = card.dataset.table;
        const cfg = TABLES[tableId];
        const bar = card.querySelector('.seats-bar');

        if (bar && cfg) {
            bar.innerHTML = Array(cfg.max).fill(0)
                .map(() => `<div class="seat-dot"></div>`).join('');
        }

        card.addEventListener('click', () => {
            if (currentTable) return;
            joinTable(tableId);
        });
    });
}

// ---- SOCKET.IO ----
let socket = null;
let currentTable = null;

function connectSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.io не подключён');
        window.TG?.alert('Ошибка подключения к серверу');
        return;
    }

    socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log('Подключён к серверу');
    });

    socket.on('lobby:update', (data) => {
        updateTableUI(data.tableId, data.players);
    });

    socket.on('game:start', (data) => {
        window.TG?.haptic('heavy');
        setTimeout(() => {
            window.location.href = `game.html?table=${data.tableId}&token=${data.token}`;
        }, 1500);
        document.getElementById('startingBanner').style.display = 'block';
    });

    socket.on('disconnect', () => {
        console.log('Отключён от сервера');
    });
}

// ---- ВСТУПИТЬ В СТОЛ ----
function joinTable(tableId) {
    const cfg = TABLES[tableId];
    if (!cfg) return;

    currentTable = tableId;

    document.querySelectorAll('.table-card').forEach(c => {
        c.classList.toggle('active', c.dataset.table === tableId);
    });

    showWaiting(tableId, cfg);

    if (socket?.connected) {
        socket.emit('lobby:join', {
            tableId: tableId,
            userId: window.TG?.getId(),
            name: window.TG?.getName() || 'Игрок',
            photo: window.TG?.getPhoto() || null,
        });
    } else {
        window.TG?.alert('Ошибка подключения к серверу. Попробуй позже.');
        leaveTable();
        return;
    }

    window.TG?.haptic('medium');
}

// ---- ПОКАЗАТЬ ОЖИДАНИЕ ----
function showWaiting(tableId, cfg) {
    document.getElementById('waitingTitle').textContent = 'Ожидание игроков';
    document.getElementById('waitingTableName').textContent = cfg.name;
    document.getElementById('waitingMax').textContent = cfg.max;
    document.getElementById('waitingCount').textContent = '1';

    const prizeRow = document.getElementById('prizeRow');
    if (cfg.prizes) {
        prizeRow.style.display = 'flex';
        document.getElementById('prize1').textContent = cfg.prizes[0];
        document.getElementById('prize2').textContent = cfg.prizes[1];
        document.getElementById('prize3').textContent = cfg.prizes[2];
    } else {
        prizeRow.style.display = 'none';
    }

    renderWaitingSeats([{
        name: window.TG?.getName() || 'Игрок',
        photo: window.TG?.getPhoto(),
        initials: window.TG?.getInitials() || '?',
    }], cfg.max);

    document.getElementById('waitingBlock').style.display = 'block';
    document.getElementById('waitingBlock').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('btnLeave').onclick = leaveTable;
}

// ---- РЕНДЕР МЕСТ ----
function renderWaitingSeats(players, max) {
    const container = document.getElementById('waitingSeats');
    let html = '';

    for (let i = 0; i < max; i++) {
        const p = players[i];
        if (p) {
            const img = p.photo ? `<img src="${p.photo}" alt="${p.name}">` : `<span>${p.initials}</span>`;
            html += `
                <div class="waiting-seat">
                    <div class="waiting-seat-avatar filled">${img}</div>
                    <div class="waiting-seat-name">${p.name}</div>
                </div>`;
        } else {
            html += `
                <div class="waiting-seat">
                    <div class="waiting-seat-avatar">+</div>
                    <div class="waiting-seat-name t-dim">Место</div>
                </div>`;
        }
    }

    container.innerHTML = html;
}

// ---- ОБНОВИТЬ UI СТОЛА (от сервера) ----
function updateTableUI(tableId, players) {
    const cfg = TABLES[tableId];
    if (!cfg) return;

    const bar = document.getElementById(`seats-${tableId}`);
    if (bar) {
        bar.querySelectorAll('.seat-dot').forEach((dot, i) => {
            dot.classList.toggle('filled', i < players.length);
        });
    }

    const counter = document.getElementById(`count-${tableId}`);
    if (counter) counter.textContent = `${players.length}/${cfg.max}`;

    if (tableId === currentTable) {
        document.getElementById('waitingCount').textContent = players.length;
        renderWaitingSeats(players.map(p => ({
            name: p.name,
            photo: p.photo,
            initials: p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
        })), cfg.max);
    }
}

// ---- ПОКИНУТЬ СТОЛ ----
function leaveTable() {
    if (socket?.connected && currentTable) {
        socket.emit('lobby:leave', { tableId: currentTable });
    }

    currentTable = null;
    document.querySelectorAll('.table-card').forEach(c => c.classList.remove('active'));
    document.getElementById('waitingBlock').style.display = 'none';
    document.getElementById('startingBanner').style.display = 'none';
    window.TG?.haptic('light');
}
