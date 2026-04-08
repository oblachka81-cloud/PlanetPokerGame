// ========== GAME.JS ==========
// Planet Poker — клиентская логика игрового стола

const params = new URLSearchParams(window.location.search);
const TABLE_ID = params.get('table');
const TOKEN = params.get('token');
const WAITING = params.get('waiting') === '1'; // подсел к активной игре

let socket = null;
let gameState = null;
let myUserId = null;
let actionTimer = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
document.addEventListener('DOMContentLoaded', () => {
    myUserId = window.TG?.getId();
    if (!TABLE_ID || !TOKEN) {
        showError('Неверная ссылка на игру');
        return;
    }
    initUI();
    connectSocket();
    window.TG?.showBack(() => {
        if (confirm('Покинуть стол?')) leaveTable();
    });
});

function initUI() {
    document.getElementById('tableTitle').textContent = TABLE_ID;
    if (WAITING) {
        showWaitingOverlay('Ожидаем следующего раунда...');
    }
}

// ========== ПОДКЛЮЧЕНИЕ ==========
function connectSocket() {
    if (typeof io === 'undefined') {
        // Оффлайн-режим
        console.warn('Socket.io не загружен — demo-режим');
        startDemoMode();
        return;
    }

    socket = io(window.location.origin, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log('Подключён к серверу');
        socket.emit('table:ready', { tableId: TABLE_ID });
    });

    socket.on('disconnect', () => {
        console.log('Отключён');
        showStatusBar('Соединение потеряно...');
    });

    // ---- СОБЫТИЯ ИГРЫ ----
    // Старт раунда
    socket.on('game:round', (data) => {
        hideWaitingOverlay();
        handleRound(data);
    });

    // Ход другого игрока
    socket.on('game:action', (data) => {
        logAction(data);
        updateGameState(data);
    });

    // Твой ход
    socket.on('game:yourTurn', (data) => {
        handleYourTurn(data);
    });

    // Итоги раунда
    socket.on('game:roundEnd', (data) => {
        handleRoundEnd(data);
    });

    // Итоги турнира / конец игры
    socket.on('game:end', (data) => {
        handleGameEnd(data);
    });

    // Новый игрок подсел
    socket.on('table:playerJoined', (data) => {
        logAction({ text: `${data.player.name} подсел за стол` });
        updateSeats(data.players);
    });

    // Игрок ушёл
    socket.on('table:playerLeft', (data) => {
        logAction({ text: 'Игрок покинул стол' });
        updateSeats(data.players);
    });

    // Вскрытие карт
    socket.on('game:showdown', (data) => {
        handleShowdown(data);
    });
}

// ========== ОБРАБОТЧИКИ РАУНДА ==========
function handleRound(data) {
    gameState = data;
    clearActionTimer();

    // Обновляем состояние стола
    updateSeats(data.players);
    updatePot(data.pot || 0);
    updateBoard(data.board || []);
    updateStatusBar(data.stage || 'Preflop');
    clearLog();

    // Карты игрока
    const me = data.players.find(p => String(p.userId) === String(myUserId));
    if (me && me.cards) {
        renderMyCards(me.cards);
    }

    logAction({ text: `Раунд начался · ${data.stage || 'Preflop'}` });
}

function handleYourTurn(data) {
    gameState = { ...gameState, ...data };
    showActionButtons(data);
    startActionTimer(data.timeLimit || 30, () => {
        // Автофолд
        sendAction('fold');
        hideActionButtons();
    });
}

function handleRoundEnd(data) {
    clearActionTimer();
    hideActionButtons();
    updatePot(0);

    if (data.winners) {
        data.winners.forEach(w => {
            logAction({ text: `${w.name} забирает ${w.amount} фишек` });
        });
    }

    // Показываем overlay результатов
    showRoundResult(data);

    // Через 3 секунды прячем
    setTimeout(() => {
        hideRoundResult();
        // Если есть ожидающие игроки — они садятся в следующем раунде
    }, 3000);
}

function handleGameEnd(data) {
    clearActionTimer();
    hideActionButtons();
    showGameEndOverlay(data);
}

function handleShowdown(data) {
    // Показываем карты всех игроков
    if (!data.players) return;
    data.players.forEach(p => {
        const seat = document.querySelector(`[data-userid="${p.userId}"]`);
        if (seat && p.cards) {
            const cardsEl = seat.querySelector('.seat-cards');
            if (cardsEl) cardsEl.innerHTML = renderCards(p.cards);
        }
    });
}

// ========== МЕСТА ==========
function updateSeats(players) {
    const container = document.getElementById('seats');
    if (!container || !players) return;

    container.innerHTML = '';
    players.forEach((p, i) => {
        const isMe = String(p.userId) === String(myUserId);
        const dealer = gameState?.dealerIndex === i;
        const active = gameState?.activeIndex === i;
        const photo = p.photo ? `<img src="${p.photo}" alt="${p.name}">` : `<span class="seat-initials">${getInitials(p.name)}</span>`;
        const cards = isMe && gameState?.myCards ? renderCards(gameState.myCards) : (p.cards ? renderCards(p.cards) : renderCardBacks(2));

        container.innerHTML += `
            <div class="seat ${isMe ? 'seat-me' : ''} ${active ? 'seat-active' : ''} ${p.folded ? 'seat-folded' : ''}" data-userid="${p.userId}">
                <div class="seat-avatar">${photo}</div>
                <div class="seat-info">
                    <div class="seat-name">${p.name}${dealer ? ' 🎯' : ''}</div>
                    <div class="seat-chips">${p.chips ?? 0} фишек</div>
                    ${p.bet ? `<div class="seat-bet">${p.bet}</div>` : ''}
                </div>
                <div class="seat-cards">${cards}</div>
                ${p.action ? `<div class="seat-action-badge">${p.action}</div>` : ''}
                ${p.waiting ? `<div class="seat-waiting-badge">Ждёт раунда</div>` : ''}
            </div>
        `;
    });
}

function renderCards(cards) {
    if (!Array.isArray(cards)) return '';
    return cards.map(c => `<div class="card">${formatCard(c)}</div>`).join('');
}

function renderCardBacks(n) {
    return Array(n).fill('<div class="card card-back">🂠</div>').join('');
}

function formatCard(c) {
    if (!c) return '';
    const suits = { s: '♠', h: '♥', d: '♦', c: '♣' };
    const rank = c.slice(0, -1);
    const suit = c.slice(-1);
    const red = suit === 'h' || suit === 'd';
    return `<span class="${red ? 'red' : ''}">${rank}${suits[suit] || suit}</span>`;
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ========== КАРТЫ НА СТОЛЕ ==========
function updateBoard(cards) {
    const el = document.getElementById('board');
    if (!el) return;

    if (!cards || cards.length === 0) {
        el.innerHTML = Array(5).fill('<div class="board-card board-card-empty"></div>').join('');
        return;
    }

    const rendered = cards.map(c => `<div class="board-card">${formatCard(c)}</div>`);
    while (rendered.length < 5) rendered.push('<div class="board-card board-card-empty"></div>');
    el.innerHTML = rendered.join('');
}

// ========== БАНК ==========
function updatePot(amount) {
    const el = document.getElementById('pot');
    if (el) el.textContent = `Банк: ${amount}`;
}

// ========== СТАТУС ==========
function updateStatusBar(text) {
    const el = document.getElementById('statusBar');
    if (el) el.textContent = text;
}

function showStatusBar(text) {
    updateStatusBar(text);
}

// ========== ЛОГ ДЕЙСТВИЙ ==========
function logAction(data) {
    const log = document.getElementById('actionLog');
    if (!log) return;

    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = data.text || JSON.stringify(data);
    log.prepend(line);

    // Максимум 20 строк
    while (log.children.length > 20) log.removeChild(log.lastChild);
}

function clearLog() {
    const log = document.getElementById('actionLog');
    if (log) log.innerHTML = '';
}

// ========== КНОПКИ ДЕЙСТВИЙ ==========
function showActionButtons(data) {
    const wrap = document.getElementById('actionWrap');
    if (!wrap) return;
    wrap.style.display = 'flex';

    const callAmount = data.callAmount || 0;
    const minRaise = data.minRaise || callAmount * 2;

    document.getElementById('btnFold').onclick = () => {
        sendAction('fold');
        hideActionButtons();
    };

    document.getElementById('btnCheck').onclick = () => {
        if (callAmount > 0) return; // нельзя чек если есть ставка
        sendAction('check');
        hideActionButtons();
    };

    document.getElementById('btnCall').onclick = () => {
        sendAction('call', { amount: callAmount });
        hideActionButtons();
    };

    const btnCheck = document.getElementById('btnCheck');
    const btnCall = document.getElementById('btnCall');

    if (btnCheck) btnCheck.style.display = callAmount === 0 ? 'inline-flex' : 'none';
    if (btnCall) {
        btnCall.style.display = callAmount > 0 ? 'inline-flex' : 'none';
        btnCall.textContent = `Колл ${callAmount}`;
    }

    // Рейз
    const raiseWrap = document.getElementById('raiseWrap');
    if (raiseWrap) {
        const input = document.getElementById('raiseInput');
        if (input) {
            input.min = minRaise;
            input.value = minRaise;
        }
        document.getElementById('btnRaise').onclick = () => {
            raiseWrap.style.display = raiseWrap.style.display === 'none' ? 'flex' : 'none';
        };
        document.getElementById('btnRaiseConfirm').onclick = () => {
            const amount = parseInt(input?.value || minRaise);
            sendAction('raise', { amount });
            hideActionButtons();
        };
    }
}

function hideActionButtons() {
    const wrap = document.getElementById('actionWrap');
    if (wrap) wrap.style.display = 'none';
    clearActionTimer();
}

// ========== ТАЙМЕР ДЕЙСТВИЯ ==========
function startActionTimer(seconds, onTimeout) {
    clearActionTimer();
    let remaining = seconds;

    const bar = document.getElementById('timerBar');
    const label = document.getElementById('timerLabel');

    if (bar) {
        bar.style.width = '100%';
        bar.style.transition = `width ${seconds}s linear`;
        // Запускаем анимацию через микрозадачу
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                bar.style.width = '0%';
            });
        });
    }

    if (label) label.textContent = remaining;

    const interval = setInterval(() => {
        remaining--;
        if (label) label.textContent = remaining;
        if (remaining <= 0) {
            clearInterval(interval);
            onTimeout();
        }
    }, 1000);

    actionTimer = interval;
}

function clearActionTimer() {
    if (actionTimer) {
        clearInterval(actionTimer);
        actionTimer = null;
    }
    const bar = document.getElementById('timerBar');
    if (bar) {
        bar.style.transition = 'none';
        bar.style.width = '100%';
    }
}

// ========== ОТПРАВКА ДЕЙСТВИЯ ==========
function sendAction(action, extra = {}) {
    if (!socket?.connected) return;
    socket.emit('game:action', {
        tableId: TABLE_ID,
        action,
        ...extra,
    });
    logAction({ text: `Ты: ${action}${extra.amount ? ' ' + extra.amount : ''}` });
}

// ========== КАРТЫ ИГРОКА ==========
function renderMyCards(cards) {
    const el = document.getElementById('myCards');
    if (!el) return;
    el.innerHTML = renderCards(cards);

    // Определяем силу руки если есть 2+ карты на столе
    if (gameState?.board?.length >= 3) {
        const hand = getHandName([...cards, ...gameState.board]);
        const handEl = document.getElementById('handStrength');
        if (handEl) handEl.textContent = hand;
    }
}

// ========== ОПРЕДЕЛЕНИЕ РУКИ (простое) ==========
function getHandName(cards) {
    if (!cards || cards.length < 2) return '';

    const ranks = cards.map(c => c.slice(0, -1));
    const suits = cards.map(c => c.slice(-1));

    const rankCount = {};
    ranks.forEach(r => rankCount[r] = (rankCount[r] || 0) + 1);
    const counts = Object.values(rankCount).sort((a, b) => b - a);

    const flush = suits.length >= 5 && new Set(suits).size === 1;
    const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const rankNums = ranks.map(r => rankOrder.indexOf(r)).sort((a, b) => a - b);
    const straight = rankNums.length >= 5 && (rankNums[rankNums.length - 1] - rankNums[0] === 4) && new Set(rankNums).size === 5;

    if (flush && straight) return 'Стрит-флеш';
    if (counts[0] === 4) return 'Каре';
    if (counts[0] === 3 && counts[1] === 2) return 'Фулл-хаус';
    if (flush) return 'Флеш';
    if (straight) return 'Стрит';
    if (counts[0] === 3) return 'Тройка';
    if (counts[0] === 2 && counts[1] === 2) return 'Две пары';
    if (counts[0] === 2) return 'Пара';
    return 'Старшая карта';
}

// ========== OVERLAY РЕЗУЛЬТАТОВ РАУНДА ==========
function showRoundResult(data) {
    const overlay = document.getElementById('roundResultOverlay');
    if (!overlay) return;

    const text = document.getElementById('roundResultText');
    if (text && data.winners) {
        text.innerHTML = data.winners.map(w => `<b>${w.name}</b> — ${w.handName || ''} · +${w.amount}`).join('<br>');
    }
    overlay.style.display = 'flex';
}

function hideRoundResult() {
    const overlay = document.getElementById('roundResultOverlay');
    if (overlay) overlay.style.display = 'none';
}

// ========== OVERLAY КОНЕЦ ИГРЫ ==========
function showGameEndOverlay(data) {
    const overlay = document.getElementById('gameEndOverlay');
    if (!overlay) return;

    const me = data.results?.find(p => String(p.userId) === String(myUserId));
    const resultText = document.getElementById('gameEndResult');

    if (resultText) {
        if (me) {
            resultText.textContent = me.place === 1 ? `Победа! +${me.prize || 0}` : `${me.place || '?'} место · ${me.prize ? '+' + me.prize : ''}`;
        } else {
            resultText.textContent = 'Игра окончена';
        }
    }

    const list = document.getElementById('gameEndList');
    if (list && data.results) {
        list.innerHTML = data.results
            .sort((a, b) => (a.place || 99) - (b.place || 99))
            .map(p => `<div>${p.place}. ${p.name} — ${p.chips} фишек ${p.prize ? '· +' + p.prize : ''}</div>`)
            .join('');
    }

    overlay.style.display = 'flex';
    document.getElementById('btnBackToLobby').onclick = () => {
        window.location.href = 'lobby.html';
    };
}

// ========== OVERLAY ОЖИДАНИЕ ==========
function showWaitingOverlay(text) {
    const overlay = document.getElementById('waitingOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
        const label = overlay.querySelector('.waiting-label');
        if (label) label.textContent = text || 'Ожидание...';
    }
}

function hideWaitingOverlay() {
    const overlay = document.getElementById('waitingOverlay');
    if (overlay) overlay.style.display = 'none';
}

// ========== ОБНОВЛЕНИЕ СОСТОЯНИЯ ==========
function updateGameState(data) {
    if (!gameState) return;
    if (data.players) updateSeats(data.players);
    if (data.pot !== undefined) updatePot(data.pot);
    if (data.board) updateBoard(data.board);
    if (data.stage) updateStatusBar(data.stage);
}

// ========== ПОКИНУТЬ СТОЛ ==========
function leaveTable() {
    if (socket?.connected) {
        socket.emit('table:leave', { tableId: TABLE_ID });
    }
    window.location.href = 'lobby.html';
}

// ========== DEMO-РЕЖИМ ==========
function startDemoMode() {
    console.log('Demo-режим: Socket.io не доступен');
    showStatusBar('Demo-режим');

    const demoPlayers = [
        { userId: myUserId || '1', name: 'Ты', chips: 1000, cards: ['Ah', 'Kd'] },
        { userId: '2', name: 'Бот 1', chips: 950 },
        { userId: '3', name: 'Бот 2', chips: 1050 },
    ];

    gameState = {
        players: demoPlayers,
        pot: 30,
        board: ['7h', 'Qd', '2c'],
        stage: 'Flop',
        myCards: ['Ah', 'Kd'],
        dealerIndex: 0,
        activeIndex: 0,
    };

    updateSeats(demoPlayers);
    updatePot(30);
    updateBoard(['7h', 'Qd', '2c']);
    updateStatusBar('Demo · Flop');
    renderMyCards(['Ah', 'Kd']);
    showActionButtons({ callAmount: 20, minRaise: 40 });
    startActionTimer(30, () => hideActionButtons());
}

// ========== ОШИБКА ==========
function showError(msg) {
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#fff;font-family:Inter,sans-serif;text-align:center;padding:20px;">
            <div>
                <div style="font-size:2em;margin-bottom:12px">⚠️</div>
                <div>${msg}</div>
                <button onclick="window.location.href='lobby.html'" style="margin-top:20px;padding:10px 24px;background:#c9a84c;border:none;border-radius:8px;color:#000;cursor:pointer;">
                    В лобби
                </button>
            </div>
        </div>
    `;
}
