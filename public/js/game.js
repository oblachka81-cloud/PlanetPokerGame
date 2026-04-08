const params = new URLSearchParams(window.location.search);
const TABLE_ID = params.get('table');
const TOKEN = params.get('token');
const WAITING = params.get('waiting') === '1';

let socket = null;
let gameState = null;
let myUserId = null;
let actionTimer = null;
let raiseConfirmPending = false;

document.addEventListener('DOMContentLoaded', () => {
    myUserId = window.TG?.getId() || params.get('userId');
    if (!TABLE_ID || !TOKEN) {
        showError('Неверная ссылка на игру');
        return;
    }
    initRaiseSlider();
    connectSocket();
    window.TG?.showBack(() => {
        if (confirm('Покинуть стол?')) leaveTable();
    });
    document.getElementById('btnBackLobby').onclick = () => {
        window.location.href = 'lobby.html';
    };
});

// ========== СЛАЙДЕР РЕЙЗА ==========
function initRaiseSlider() {
    const slider = document.getElementById('raiseSlider');
    const amount = document.getElementById('raiseAmount');
    const raiseWrap = document.getElementById('raiseWrap');
    raiseWrap.style.display = 'none';

    slider.addEventListener('input', () => {
        amount.textContent = slider.value;
    });

    document.getElementById('btnRaise').addEventListener('click', () => {
        if (raiseWrap.style.display === 'none') {
            raiseWrap.style.display = 'flex';
            raiseConfirmPending = true;
        } else {
            const val = parseInt(slider.value);
            sendAction('raise', { amount: val });
            hideActionButtons();
            raiseWrap.style.display = 'none';
            raiseConfirmPending = false;
        }
    });
}

// ========== ПОДКЛЮЧЕНИЕ ==========
function connectSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.io не загружен — demo-режим');
        startDemoMode();
        return;
    }

    socket = io(window.location.origin, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        const uid = myUserId || window.TG?.getId() || params.get('userId');
        myUserId = uid;
        console.log('Подключён:', socket.id, '| userId:', uid);
        socket.emit('table:ready', { tableId: TABLE_ID, userId: uid });
    });

    socket.on('disconnect', () => {
        updateStatus('Соединение потеряно...');
    });

    socket.on('game:round', (data) => {
        hideWaitingOverlay();
        handleRound(data);
    });

    // ← НОВОЕ: повтор если стол ещё не готов
    socket.on('table:notReady', () => {
        console.log('Стол не готов, повторяем через 1 сек...');
        setTimeout(() => {
            const uid = myUserId || window.TG?.getId() || params.get('userId');
            socket.emit('table:ready', { tableId: TABLE_ID, userId: uid });
        }, 1000);
    });

    socket.on('game:action', (data) => {
        logAction(data.text || `${data.name}: ${data.action}`);
        updateGameState(data);
    });

    socket.on('game:yourTurn', (data) => {
        handleYourTurn(data);
    });

    socket.on('game:roundEnd', (data) => {
        handleRoundEnd(data);
    });

    socket.on('game:end', (data) => {
        handleGameEnd(data);
    });

    socket.on('game:showdown', (data) => {
        handleShowdown(data);
    });

    socket.on('table:playerJoined', (data) => {
        logAction(`${data.player.name} подсел за стол`);
        updateSeats(data.players);
    });

    socket.on('table:playerLeft', (data) => {
        logAction('Игрок покинул стол');
        updateSeats(data.players);
    });
}

// ========== РАУНД ==========
function handleRound(data) {
    gameState = data;
    clearActionTimer();
    hideActionButtons();
    updateSeats(data.players);
    updatePot(data.pot || 0);
    updateBoard(data.board || []);
    updateStatus(data.stage || 'Preflop');
    clearLog();
    logAction(`Раунд начался · ${data.stage || 'Preflop'}`);

    const me = data.players?.find(p => String(p.userId) === String(myUserId));
    if (me?.cards) renderMyCards(me.cards);
}

function handleYourTurn(data) {
    gameState = { ...gameState, ...data };
    showActionButtons(data);
    startActionTimer(data.timeLimit || 30, () => {
        sendAction('fold');
        hideActionButtons();
    });
}

function handleRoundEnd(data) {
    clearActionTimer();
    hideActionButtons();
    updatePot(0);
    if (data.winners) {
        data.winners.forEach(w => logAction(`${w.name} забирает ${w.amount} фишек`));
    }
    showRoundResult(data);
    setTimeout(hideRoundResult, 3000);
}

function handleGameEnd(data) {
    clearActionTimer();
    hideActionButtons();
    showGameEnd(data);
}

function handleShowdown(data) {
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
        const photo = p.photo && p.photo.startsWith('http')
            ? `<img src="${p.photo}" alt="${p.name}">`
            : `<span class="seat-initials">${getInitials(p.name)}</span>`;
        const cards = isMe && gameState?.myCards ? renderCards(gameState.myCards) : (p.cards ? renderCards(p.cards) : renderCardBacks(2));

        container.innerHTML += `
            <div class="seat ${isMe ? 'seat-me' : ''} ${active ? 'seat-active' : ''} ${p.folded ? 'seat-folded' : ''}" data-userid="${p.userId}">
                <div class="seat-avatar">${photo}</div>
                <div class="seat-info">
                    <div class="seat-name">${p.name}${dealer ? ' D' : ''}</div>
                    <div class="seat-chips">${p.chips ?? 0}</div>
                    ${p.bet ? `<div class="seat-bet">${p.bet}</div>` : ''}
                </div>
                <div class="seat-cards">${cards}</div>
                ${p.action ? `<div class="seat-action-badge">${p.action}</div>` : ''}
                ${p.waiting ? `<div class="seat-waiting-badge">Ждёт раунда</div>` : ''}
            </div>
        `;
    });
}

// ========== КАРТЫ ==========
function renderCards(cards) {
    if (!Array.isArray(cards)) return '';
    return cards.map(c => `<div class="card">${formatCard(c)}</div>`).join('');
}

function renderCardBacks(n) {
    return Array(n).fill('<div class="card back"></div>').join('');
}

function formatCard(c) {
    if (!c) return '';
    const suits = { s: '♠', h: '♥', d: '♦', c: '♣' };
    const rank = c.slice(0, -1);
    const suit = c.slice(-1);
    const red = suit === 'h' || suit === 'd';
    return `<span class="${red ? 'red' : ''}">${rank}${suits[suit] || suit}</span>`;
}

function renderMyCards(cards) {
    const el = document.getElementById('handCards');
    if (!el) return;
    el.innerHTML = renderCards(cards);
    if (gameState?.board?.length >= 3) {
        const hand = getHandName([...cards, ...gameState.board]);
        const el2 = document.getElementById('handStrength');
        if (el2) el2.textContent = hand;
    }
}

// ========== БОРД ==========
function updateBoard(cards) {
    const el = document.getElementById('communityCards');
    if (!el) return;
    if (!cards || cards.length === 0) {
        el.innerHTML = Array(5).fill('<div class="board-card board-card-empty"></div>').join('');
        return;
    }
    const rendered = cards.map(c => `<div class="board-card">${formatCard(c)}</div>`);
    while (rendered.length < 5) rendered.push('<div class="board-card board-card-empty"></div>');
    el.innerHTML = rendered.join('');
}

// ========== БАНК И СТАТУС ==========
function updatePot(amount) {
    const el = document.getElementById('potAmount');
    if (el) el.textContent = amount;
}

function updateStatus(text) {
    const el = document.getElementById('statusRound');
    if (el) el.textContent = text;
}

// ========== ЛОГ ==========
function logAction(text) {
    const log = document.getElementById('actionLog');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = text;
    log.prepend(line);
    while (log.children.length > 20) log.removeChild(log.lastChild);
}

function clearLog() {
    const el = document.getElementById('actionLog');
    if (el) el.innerHTML = '';
}

// ========== КНОПКИ ДЕЙСТВИЙ ==========
function showActionButtons(data) {
    const btns = document.getElementById('actionButtons');
    if (!btns) return;

    const callAmount = data.callAmount || 0;
    const minRaise = data.minRaise || Math.max(callAmount * 2, 20);
    const myChips = data.myChips || 0;

    document.getElementById('btnFold').disabled = false;
    document.getElementById('btnFold').onclick = () => {
        sendAction('fold');
        hideActionButtons();
    };

    const btnCheck = document.getElementById('btnCheck');
    const btnCall = document.getElementById('btnCall');

    if (callAmount === 0) {
        btnCheck.disabled = false;
        btnCheck.style.display = '';
        btnCheck.onclick = () => {
            sendAction('check');
            hideActionButtons();
        };
        btnCall.style.display = 'none';
    } else {
        btnCheck.style.display = 'none';
        btnCall.disabled = false;
        btnCall.style.display = '';
        btnCall.textContent = `Call ${callAmount}`;
        btnCall.onclick = () => {
            sendAction('call', { amount: callAmount });
            hideActionButtons();
        };
    }

    const btnRaise = document.getElementById('btnRaise');
    btnRaise.disabled = false;

    const slider = document.getElementById('raiseSlider');
    const raiseAmount = document.getElementById('raiseAmount');
    if (slider) {
        slider.min = minRaise;
        slider.max = myChips || 1000;
        slider.value = minRaise;
        if (raiseAmount) raiseAmount.textContent = minRaise;
    }

    const btnAllIn = document.getElementById('btnAllIn');
    btnAllIn.disabled = false;
    btnAllIn.onclick = () => {
        sendAction('allin');
        hideActionButtons();
    };
}

function hideActionButtons() {
    ['btnFold', 'btnCheck', 'btnCall', 'btnRaise', 'btnAllIn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });
    document.getElementById('raiseWrap').style.display = 'none';
    raiseConfirmPending = false;
    clearActionTimer();
}

// ========== ТАЙМЕР ==========
function startActionTimer(seconds, onTimeout) {
    clearActionTimer();
    let remaining = seconds;
    const el = document.getElementById('statusPlayers');
    if (el) el.textContent = `${remaining}с`;

    const interval = setInterval(() => {
        remaining--;
        if (el) el.textContent = `${remaining}с`;
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
    const el = document.getElementById('statusPlayers');
    if (el) el.textContent = '';
}

// ========== ОТПРАВКА ДЕЙСТВИЯ ==========
function sendAction(action, extra = {}) {
    if (!socket?.connected) return;
    socket.emit('game:action', {
        tableId: TABLE_ID,
        action,
        ...extra
    });
    logAction(`Ты: ${action}${extra.amount ? ' ' + extra.amount : ''}`);
}

// ========== OVERLAY ОЖИДАНИЕ ==========
function hideWaitingOverlay() {
    const el = document.getElementById('waitingOverlay');
    if (el) el.style.display = 'none';
}

// ========== OVERLAY РЕЗУЛЬТАТ РАУНДА ==========
function showRoundResult(data) {
    const overlay = document.getElementById('roundResult');
    if (!overlay) return;
    const me = data.winners?.find(w => String(w.userId) === String(myUserId));
    document.getElementById('roundResultTitle').textContent = me ? 'Победа!' : 'Раунд завершён';
    document.getElementById('roundResultHand').textContent = data.winners?.[0]?.handName || '';
    document.getElementById('roundResultAmount').textContent = me ? `+${me.amount}` : '';
    overlay.style.display = 'flex';
}

function hideRoundResult() {
    const el = document.getElementById('roundResult');
    if (el) el.style.display = 'none';
}

// ========== OVERLAY КОНЕЦ ИГРЫ ==========
function showGameEnd(data) {
    const overlay = document.getElementById('tournamentEnd');
    if (!overlay) return;
    const me = data.results?.find(p => String(p.userId) === String(myUserId));
    const places = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];
    document.getElementById('tournamentTitle').textContent = 'Игра завершена';
    document.getElementById('tournamentPlace').textContent = places[(me?.place || 1) - 1] || me?.place || '';
    document.getElementById('tournamentPrize').textContent = me?.prize ? `+${me.prize} ⭐` : '';
    overlay.style.display = 'flex';
}

// ========== ОБНОВЛЕНИЕ СОСТОЯНИЯ ==========
function updateGameState(data) {
    if (!gameState) return;
    if (data.players) updateSeats(data.players);
    if (data.pot !== undefined) updatePot(data.pot);
    if (data.board) updateBoard(data.board);
    if (data.stage) updateStatus(data.stage);
}

// ========== ПОКИНУТЬ СТОЛ ==========
function leaveTable() {
    if (socket?.connected) socket.emit('table:leave', { tableId: TABLE_ID });
    window.location.href = 'lobby.html';
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ==========
function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getHandName(cards) {
    if (!cards || cards.length < 2) return '';
    const ranks = cards.map(c => c.slice(0, -1));
    const suits = cards.map(c => c.slice(-1));
    const rankCount = {};
    ranks.forEach(r => rankCount[r] = (rankCount[r] || 0) + 1);
    const counts = Object.values(rankCount).sort((a, b) => b - a);
    const flush = suits.length >= 5 && new Set(suits).size === 1;
    const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    const rankNums = [...new Set(ranks.map(r => rankOrder.indexOf(r)))].sort((a, b) => a - b);
    const straight = rankNums.length >= 5 && (rankNums[rankNums.length - 1] - rankNums[0] === 4);
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

// ========== DEMO-РЕЖИМ ==========
function startDemoMode() {
    updateStatus('Demo-режим');
    hideWaitingOverlay();

    const demoPlayers = [
        { userId: myUserId || '1', name: 'Ты', chips: 1000 },
        { userId: '2', name: 'Игрок 2', chips: 950 },
        { userId: '3', name: 'Игрок 3', chips: 1050 },
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
    renderMyCards(['Ah', 'Kd']);
    showActionButtons({ callAmount: 20, minRaise: 40, myChips: 1000 });
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
