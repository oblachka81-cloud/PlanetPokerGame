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
    myUserId = window.TG?.getId()
        || window.Telegram?.WebApp?.initDataUnsafe?.user?.id
        || params.get('userId');

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
        const uid = myUserId
            || window.TG?.getId()
            || window.Telegram?.WebApp?.initDataUnsafe?.user?.id
            || params.get('userId');
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

    socket.on('table:notReady', () => {
        console.log('Стол не готов, повторяем через 1 сек...');
        setTimeout(() => {
            const uid = myUserId || params.get('userId');
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
            const cardsEl = seat.querySelector('.player-seat-cards');
            if (cardsEl) cardsEl.innerHTML = renderMiniCards(p.cards);
        }
    });
}

// ========== МЕСТА ==========
// Порядок мест: наш игрок всегда первым (seat-pos-0 = низ центр)
function updateSeats(players) {
    const container = document.getElementById('seats');
    if (!container || !players) return;

    // Наш игрок всегда на позиции 0 (низ)
    const sorted = [...players];
    const myIndex = sorted.findIndex(p => String(p.userId) === String(myUserId));
    if (myIndex > 0) {
        const [me] = sorted.splice(myIndex, 1);
        sorted.unshift(me);
    }

    container.innerHTML = '';
    sorted.forEach((p, i) => {
        const isMe = String(p.userId) === String(myUserId);
        const originalIndex = players.indexOf(p);
        const dealer = gameState?.dealerIndex === originalIndex;
        const active = gameState?.activeIndex === originalIndex;

        const avatarContent = (p.photo && p.photo.startsWith('http'))
            ? `<img src="${p.photo}" alt="${getInitials(p.name)}" onerror="this.outerHTML='<span>${getInitials(p.name)}</span>'">`
            : `<span>${getInitials(p.name)}</span>`;

        const miniCards = isMe
            ? '' // свои карты показываем в панели снизу, не на месте
            : renderMiniCardBacks(2);

        const classes = [
            'player-seat',
            `seat-pos-${i}`,
            active ? 'active' : '',
            p.folded ? 'folded' : '',
            dealer ? 'dealer' : '',
            isMe ? 'me' : '',
        ].filter(Boolean).join(' ');

        container.innerHTML += `
            <div class="${classes}" data-userid="${p.userId}">
                <div class="player-seat-avatar">${avatarContent}</div>
                <div class="player-seat-name">${p.name}</div>
                <div class="player-seat-chips">${p.chips ?? 0}</div>
                ${p.bet ? `<div class="player-seat-bet">${p.bet}</div>` : ''}
                <div class="player-seat-cards">${miniCards}</div>
                ${p.action ? `<div class="player-seat-action">${p.action}</div>` : ''}
                <div class="player-timer" style="${active ? '' : 'display:none'}">
                    <div class="player-timer-bar" id="timer-bar-${p.userId}"></div>
                </div>
            </div>
        `;
    });
}

// ========== КАРТЫ ==========
function renderCards(cards) {
    if (!Array.isArray(cards)) return '';
    return cards.map(c => {
        const { html, red } = parseCard(c);
        return `<div class="card hand-card${red ? ' red' : ' black'}">${html}</div>`;
    }).join('');
}

function renderMiniCards(cards) {
    if (!Array.isArray(cards)) return '';
    return cards.map(c => {
        const { html, red } = parseCard(c);
        return `<div class="card${red ? ' red' : ' black'}">${html}</div>`;
    }).join('');
}

function renderMiniCardBacks(n) {
    return Array(n).fill('<div class="card back"></div>').join('');
}

function parseCard(c) {
    if (!c) return { html: '', red: false };
    const suits = { s: '♠', h: '♥', d: '♦', c: '♣' };
    const rank = c.slice(0, -1);
    const suit = c.slice(-1);
    const red = suit === 'h' || suit === 'd';
    return { html: `${rank}${suits[suit] || suit}`, red };
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
    const slots = [];
    for (let i = 0; i < 5; i++) {
        if (cards[i]) {
            const { html, red } = parseCard(cards[i]);
            slots.push(`<div class="card community${red ? ' red' : ' black'}">${html}</div>`);
        } else {
            slots.push(`<div class="card community" style="opacity:0.15;background:rgba(255,255,255,0.05);border:1px dashed rgba(255,255,255,0.2);"></div>`);
        }
    }
    el.innerHTML = slots.join('');
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
    line.className = 'action-log-item';
    line.textContent = text;
    log.prepend(line);
    while (log.children.length > 10) log.removeChild(log.lastChild);
}

function clearLog() {
    const el = document.getElementById('actionLog');
    if (el) el.innerHTML = '';
}

// ========== КНОПКИ ДЕЙСТВИЙ ==========
function showActionButtons(data) {
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

    document.getElementById('btnRaise').disabled = false;

    const slider = document.getElementById('raiseSlider');
    const raiseAmount = document.getElementById('raiseAmount');
    if (slider) {
        slider.min = minRaise;
        slider.max = myChips || 1000;
        slider.value = minRaise;
        if (raiseAmount) raiseAmount.textContent = minRaise;
    }

    document.getElementById('btnAllIn').disabled = false;
    document.getElementById('btnAllIn').onclick = () => {
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
    socket.emit('game:action', { tableId: TABLE_ID, action, ...extra });
    logAction(`Ты: ${action}${extra.amount ? ' ' + extra.amount : ''}`);
}

// ========== OVERLAYS ==========
function hideWaitingOverlay() {
    const el = document.getElementById('waitingOverlay');
    if (el) el.style.display = 'none';
}

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
    const rankOrder = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
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
    myUserId = myUserId || 'demo1';
    updateStatus('Demo-режим');
    hideWaitingOverlay();

    const demoPlayers = [
        { userId: myUserId, name: 'Ты', chips: 1000 },
        { userId: 'demo2', name: 'Игрок 2', chips: 950 },
    ];

    gameState = {
        players: demoPlayers,
        pot: 30,
        board: ['7h', 'Qd', '2c'],
        stage: 'Flop',
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
