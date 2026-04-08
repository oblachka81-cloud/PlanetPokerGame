let socket = null;
let currentTable = null;

// ---- КОНФИГ СТОЛОВ ----
const TABLES = {
    'free-6': { name: 'Стол «Новичок»', max: 6, minPlayers: 2, type: 'free', prizes: null },
    'free-9': { name: 'Стол «Профи»', max: 9, minPlayers: 2, type: 'free', prizes: null },
    'stars-50': { name: 'Sit & Go · Mini', max: 6, minPlayers: 2, type: 'stars', prizes: ['180⭐', '90⭐', '30⭐'] },
    'stars-100': { name: 'Sit & Go · Classic', max: 9, minPlayers: 2, type: 'stars', prizes: ['540⭐', '270⭐', '90⭐'] },
};

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
    if (photo && photo.startsWith('http')) {
        avatar.innerHTML = `<img src="${photo}" alt="${name}">`;
    } else {
        avatar.textContent = initials;
    }

    window.TG?.showBack(() => {
        window.location.href = 'index.html';
    });
}

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

// ---- ПОДКЛЮЧЕНИЕ К СОКЕТУ ----
function connectSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.io не подключён');
        window.TG?.alert('Ошибка подключения к серверу');
        return;
    }

    socket = io(window.location.origin, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log('Подключён к серверу, socketId:', socket.id);
    });

    socket.on('lobby:update', (data) => {
        updateTableUI(data.tableId, data.players, data.tableActive, data.tablePlayers);
    });

    socket.on('game:start', (data) => {
        window.TG?.haptic('heavy');
        const banner = document.getElementById('startingBanner');
        if (banner) banner.style.display = 'block';
        setTimeout(() => {
            const userId = window.TG?.getId() || '';
            window.location.href = `game.html?table=${data.tableId}&token=${data.token}&userId=${userId}`;
        }, 1500);
    });

    socket.on('game:join', (data) => {
        window.TG?.haptic('heavy');
        const userId = window.TG?.getId() || '';
        window.location.href = `game.html?table=${data.tableId}&token=${data.token}&userId=${userId}&waiting=1`;
    });

    socket.on('lobby:full', ({ tableId }) => {
        const cfg = TABLES[tableId];
        window.TG?.alert(`Стол «${cfg?.name || tableId}» заполнен. Попробуй другой.`);
        leaveTable();
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
            tableId,
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

    const hint = document.getElementById('waitingHint');
    if (hint) {
        hint.textContent = `Игра стартует при ${cfg.minPlayers} игроках, остальные могут подсесть`;
        hint.style.display = 'block';
    }

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
            const img = p.photo && p.photo.startsWith('http')
                ? `<img src="${p.photo}" alt="${p.name}">`
                : `<span>${p.initials}</span>`;
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
function updateTableUI(tableId, players, tableActive, tablePlayers) {
    const cfg = TABLES[tableId];
    if (!cfg) return;

    const allPlayers = tableActive ? tablePlayers : players;
    const totalCount = allPlayers.length;

    const bar = document.getElementById(`seats-${tableId}`);
    if (bar) {
        bar.querySelectorAll('.seat-dot').forEach((dot, i) => {
            dot.classList.toggle('filled', i < totalCount);
        });
    }

    const counter = document.getElementById(`count-${tableId}`);
    if (counter) counter.textContent = `${totalCount}/${cfg.max}`;

    const card = document.querySelector(`[data-table="${tableId}"]`);
    if (card) {
        let statusEl = card.querySelector('.table-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.className = 'table-status';
            card.querySelector('.table-card-info').appendChild(statusEl);
        }
        if (tableActive) {
            statusEl.textContent = 'Идёт игра';
            statusEl.className = 'table-status active';
        } else if (players.length > 0) {
            statusEl.textContent = `Ожидание ${players.length}`;
            statusEl.className = 'table-status waiting';
        } else {
            statusEl.textContent = 'Свободно';
            statusEl.className = 'table-status free';
        }
    }

    if (tableId === currentTable) {
        document.getElementById('waitingCount').textContent = totalCount;
        renderWaitingSeats(allPlayers.map(p => ({
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
    const banner = document.getElementById('startingBanner');
    if (banner) banner.style.display = 'none';
    window.TG?.haptic('light');
}
