/* ============================================
   PLANET POKER — GAME.JS
   Часть 1: инициализация, стол, карты
============================================ */

const SERVER_URL = 'https://planetpokergame.bothost.tech';

// ---- ПАРАМЕТРЫ ИЗ URL ----
const urlParams = new URLSearchParams(window.location.search);
const TABLE_ID = urlParams.get('table') || 'free-6';
const GAME_TOKEN = urlParams.get('token') || null;

// ---- СОСТОЯНИЕ ИГРЫ ----
let gameState = {
    gameId: null,
    players: [],           // все игроки за столом
    myIndex: -1,          // индекс нашего игрока
    myCards: [],          // наши 2 карты
    communityCards: [],   // общие карты
    pot: 0,
    currentBet: 0,
    myChips: 0,
    myBet: 0,
    isMyTurn: false,
    phase: 'waiting',     // waiting | preflop | flop | turn | river | showdown
    dealerIndex: 0,
    timerInterval: null,
    timerSeconds: 30,
};

// ---- SOCKET ----
let socket = null;

// ---- СТАРТ ----
document.addEventListener('DOMContentLoaded', () => {
    initTG();
    connectSocket();
    initButtons();
});

// ---- TELEGRAM ----
function initTG() {
    window.TG?.showBack(() => {
        window.TG?.confirm('Покинуть стол?', (ok) => {
            if (ok) {
                socket?.emit('game:leave', { token: GAME_TOKEN });
                window.location.href = 'lobby.html';
            }
        });
    });
}

// ---- ПОДКЛЮЧЕНИЕ К СЕРВЕРУ ----
function connectSocket() {
    if (typeof io === 'undefined') {
        console.warn('Socket.io не загружен');
        showOfflineMode();
        return;
    }

    socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
        console.log('Подключён к игровому серверу');

        // Войти в игровую комнату
        socket.emit('game:join', {
            token: GAME_TOKEN,
            tableId: TABLE_ID,
            userId: window.TG?.getId(),
            name: window.TG?.getName() || 'Игрок',
            photo: window.TG?.getPhoto() || null,
        });
    });

    socket.on('game:state', (state) => {
        applyGameState(state);
    });

    socket.on('game:deal', (data) => {
        onDeal(data);
    });

    socket.on('game:action', (data) => {
        onPlayerAction(data);
    });

    socket.on('game:community', (data) => {
        onCommunityCards(data);
    });

    socket.on('game:your-turn', (data) => {
        onYourTurn(data);
    });

    socket.on('game:round-end', (data) => {
        onRoundEnd(data);
    });

    socket.on('game:tournament-end', (data) => {
        onTournamentEnd(data);
    });

    socket.on('disconnect', () => {
        console.log('Отключён от сервера');
    });
}

// ---- ОФЛАЙН РЕЖИМ (демо) ----
function showOfflineMode() {
    const fakePlayers = [
        { name: window.TG?.getName() || 'Игрок', photo: null, chips: 1000, bet: 0, folded: false },
        { name: 'Алексей', photo: null, chips: 950, bet: 0, folded: false },
        { name: 'Мария', photo: null, chips: 1200, bet: 0, folded: false },
        { name: 'Дмитрий', photo: null, chips: 800, bet: 0, folded: false },
        { name: 'Анна', photo: null, chips: 1100, bet: 0, folded: false },
        { name: 'Сергей', photo: null, chips: 900, bet: 0, folded: false },
    ];

    gameState.players = fakePlayers;
    gameState.myIndex = 0;
    gameState.myChips = 1000;
    gameState.phase = 'preflop';
    gameState.dealerIndex = 1;

    renderSeats();
    hideWaiting();

    // Выдать демо-карты
    setTimeout(() => {
        dealMyCards([
            { rank: 'A', suit: '♠' },
            { rank: 'K', suit: '♥' },
        ]);
        Sounds?.card();
    }, 800);

    // Демо-ход
    setTimeout(() => {
        enableActions({ canCheck: true, canCall: false, callAmount: 0, minRaise: 50 });
        startTimer(30);
    }, 1200);

    updateStatusBar('Preflop · Демо режим', `${fakePlayers.length} игроков`);
}

// ---- ПРИМЕНИТЬ СОСТОЯНИЕ ИГРЫ ----
function applyGameState(state) {
    gameState.gameId = state.gameId;
    gameState.players = state.players;
    gameState.myIndex = gameState.players.findIndex(p => p.userId === window.TG?.getId());
    gameState.pot = state.pot || 0;
    gameState.phase = state.phase || 'waiting';
    gameState.dealerIndex = state.dealerIndex || 0;
    gameState.communityCards = state.communityCards || [];

    renderSeats();
    renderCommunityCards(gameState.communityCards);
    updatePot(gameState.pot);
    updateStatusBar(phaseLabel(gameState.phase), `${gameState.players.length} игроков`);

    if (gameState.phase !== 'waiting') {
        hideWaiting();
    }
}

// ---- РЕНДЕР МЕСТ ----
function renderSeats() {
    const container = document.getElementById('seats');
    container.innerHTML = '';

    gameState.players.forEach((player, i) => {
        // Перестановка: наш игрок всегда снизу (seat-0)
        const seatIndex = (i - gameState.myIndex + gameState.players.length) % gameState.players.length;
        const isMe = i === gameState.myIndex;
        const isDealer = i === gameState.dealerIndex;

        const div = document.createElement('div');
        div.className = [
            'player-seat',
            `seat-${seatIndex}`,
            player.folded ? 'folded' : '',
            isDealer ? 'dealer' : '',
        ].filter(Boolean).join(' ');

        div.id = `seat-${i}`;

        const initials = player.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const avatarContent = player.photo ? `<img src="${player.photo}" alt="${player.name}">` : initials;

        div.innerHTML = `
            <div class="player-seat-avatar">${avatarContent}</div>
            <div class="player-seat-name">${isMe ? 'Ты' : player.name}</div>
            <div class="player-seat-chips" id="chips-${i}">${player.chips}</div>
            <div class="player-seat-cards" id="cards-${i}"></div>
            <div class="player-timer" id="timer-wrap-${i}" style="display:none">
                <div class="player-timer-bar" id="timer-bar-${i}"></div>
            </div>
        `;

        container.appendChild(div);
    });
}

// ---- РАЗДАЧА КАРТ (нам) ----
function onDeal(data) {
    gameState.myCards = data.cards;
    dealMyCards(data.cards);

    // Показать рубашки другим игрокам
    gameState.players.forEach((p, i) => {
        if (i !== gameState.myIndex) {
            showBackCards(i);
        }
    });

    Sounds?.card();
    hideWaiting();
}

function dealMyCards(cards) {
    const container = document.getElementById('handCards');
    container.innerHTML = '';

    cards.forEach(card => {
        const div = document.createElement('div');
        const isRed = card.suit === '♥' || card.suit === '♦';
        div.className = `card hand-card ${isRed ? 'red' : 'black'}`;
        div.textContent = card.rank + card.suit;
        container.appendChild(div);
    });

    updateHandStrength(cards);
}

function showBackCards(playerIndex) {
    const container = document.getElementById(`cards-${playerIndex}`);
    if (!container) return;

    container.innerHTML = `
        <div class="card back" style="width:18px;height:26px;font-size:8px"></div>
        <div class="card back" style="width:18px;height:26px;font-size:8px"></div>
    `;
}

// ---- ОБЩИЕ КАРТЫ ----
function onCommunityCards(data) {
    gameState.communityCards = data.cards;
    renderCommunityCards(data.cards);
    updatePot(data.pot || gameState.pot);
    Sounds?.card();

    const labels = { flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };
    addLog(`${labels[data.phase] || ''}`, true);

    if (gameState.myCards.length > 0) {
        updateHandStrength(gameState.myCards, data.cards);
    }
}

function renderCommunityCards(cards) {
    const container = document.getElementById('communityCards');
    container.innerHTML = '';

    cards.forEach(card => {
        const div = document.createElement('div');
        const isRed = card.suit === '♥' || card.suit === '♦';
        div.className = `card community ${isRed ? 'red' : 'black'}`;
        div.textContent = card.rank + card.suit;
        container.appendChild(div);
    });

    // Пустые слоты
    for (let i = cards.length; i < 5; i++) {
        const div = document.createElement('div');
        div.className = 'card hidden community';
        container.appendChild(div);
    }
}

// ---- ОПРЕДЕЛЕНИЕ СИЛЫ РУКИ ----
function updateHandStrength(holeCards, communityCards = []) {
    const all = [...holeCards, ...communityCards];
    const el = document.getElementById('handStrength');
    if (!el) return;
    const strength = getHandStrength(all);
    el.textContent = strength;
}

function getHandStrength(cards) {
    if (cards.length < 2) return '';
    if (cards.length < 5) return evaluatePartial(cards);
    return evaluateFull(cards);
}

function evaluatePartial(cards) {
    const ranks = cards.map(c => c.rank);
    const hasPair = ranks.some((r, i) => ranks.indexOf(r) !== i);
    const suited = cards.length === 2 && cards[0].suit === cards[1].suit;
    const highCards = ['A', 'K', 'Q', 'J'];
    const highCount = ranks.filter(r => highCards.includes(r)).length;

    if (hasPair) return '🃏 Пара';
    if (suited && highCount === 2) return '✨ Suited';
    if (highCount === 2) return '💪 Два туза/короля';
    if (highCount === 1) return '👍 Высокая';
    return '';
}

function evaluateFull(cards) {
    const ranks = cards.map(c => c.rank);
    const suits = cards.map(c => c.suit);
    const rankOrder = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    const rankNums = ranks.map(r => rankOrder.indexOf(r));
    const rankCounts = {};
    rankNums.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const isFlush = suits.some(s => suits.filter(x => x === s).length >= 5);
    const sorted = [...rankNums].sort((a, b) => a - b);

    let isStraight = false;
    for (let i = 0; i <= sorted.length - 5; i++) {
        if (sorted[i + 4] - sorted[i] === 4 && new Set(sorted.slice(i, i + 5)).size === 5) {
            isStraight = true;
            break;
        }
    }

    if (isFlush && isStraight) return '🔥 Стрит-флеш';
    if (counts[0] === 4) return '💎 Каре';
    if (counts[0] === 3 && counts[1] === 2) return '🏠 Фулл-хаус';
    if (isFlush) return '🌊 Флеш';
    if (isStraight) return '📈 Стрит';
    if (counts[0] === 3) return '3️⃣ Тройка';
    if (counts[0] === 2 && counts[1] === 2) return '2️⃣ Две пары';
    if (counts[0] === 2) return '1️⃣ Пара';
    return '🃏 Старшая карта';
}

// ---- ОБНОВИТЬ БАНК ----
function updatePot(amount) {
    gameState.pot = amount;
    document.getElementById('potAmount').textContent = amount.toLocaleString();
}

// ---- СТАТУС БАР ----
function updateStatusBar(round, players) {
    document.getElementById('statusRound').textContent = round;
    document.getElementById('statusPlayers').textContent = players;
}

function phaseLabel(phase) {
    const labels = {
        waiting: 'Ожидание',
        preflop: 'Префлоп',
        flop: 'Флоп',
        turn: 'Тёрн',
        river: 'Ривер',
        showdown: 'Вскрытие',
    };
    return labels[phase] || phase;
}

// ---- ЛОГ ----
function addLog(text, highlight = false) {
    const log = document.getElementById('actionLog');
    const item = document.createElement('div');
    item.className = `action-log-item${highlight ? ' highlight' : ''}`;
    item.textContent = text;
    log.prepend(item);

    // Оставить только 4 последних
    while (log.children.length > 4) {
        log.removeChild(log.lastChild);
    }

    setTimeout(() => item.remove(), 4000);
}

// ---- СКРЫТЬ ОЖИДАНИЕ ----
function hideWaiting() {
    const overlay = document.getElementById('waitingOverlay');
    if (overlay) overlay.style.display = 'none';
}
/* ============================================
   GAME.JS — Часть 2: ходы, таймер, итоги
============================================ */

// ---- ИНИЦИАЛИЗАЦИЯ КНОПОК ----
function initButtons() {
    const btnFold = document.getElementById('btnFold');
    const btnCheck = document.getElementById('btnCheck');
    const btnCall = document.getElementById('btnCall');
    const btnRaise = document.getElementById('btnRaise');
    const btnAllIn = document.getElementById('btnAllIn');
    const slider = document.getElementById('raiseSlider');
    const btnBack = document.getElementById('btnBackLobby');

    btnFold.addEventListener('click', () => {
        if (!gameState.isMyTurn) return;
        sendAction('fold');
        Sounds?.fold();
        window.TG?.haptic('medium');
        disableActions();
        stopTimer();
    });

    btnCheck.addEventListener('click', () => {
        if (!gameState.isMyTurn) return;
        sendAction('check');
        Sounds?.chip();
        window.TG?.haptic('light');
        disableActions();
        stopTimer();
    });

    btnCall.addEventListener('click', () => {
        if (!gameState.isMyTurn) return;
        sendAction('call', { amount: gameState.currentBet - gameState.myBet });
        Sounds?.chip();
        window.TG?.haptic('medium');
        disableActions();
        stopTimer();
    });

    btnRaise.addEventListener('click', () => {
        if (!gameState.isMyTurn) return;
        const wrap = document.getElementById('raiseWrap');
        wrap.classList.toggle('visible');
        if (wrap.classList.contains('visible')) {
            Sounds?.click();
        }
    });

    // Подтверждение рейза -- долгое нажатие на кнопку Raise
    btnRaise.addEventListener('dblclick', () => {
        if (!gameState.isMyTurn) return;
        const amount = parseInt(document.getElementById('raiseAmount').textContent);
        sendAction('raise', { amount });
        Sounds?.chip();
        window.TG?.haptic('heavy');
        disableActions();
        stopTimer();
        document.getElementById('raiseWrap').classList.remove('visible');
    });

    // Слайдер рейза
    slider.addEventListener('input', () => {
        const min = gameState.minRaise || 0;
        const max = gameState.myChips;
        const val = Math.floor(min + (slider.value / 100) * (max - min));
        document.getElementById('raiseAmount').textContent = val;
        Sounds?.click();
    });

    btnAllIn.addEventListener('click', () => {
        if (!gameState.isMyTurn) return;
        sendAction('allin', { amount: gameState.myChips });
        Sounds?.allIn();
        window.TG?.haptic('heavy');
        disableActions();
        stopTimer();
        addLog('Ты пошёл All-In!', true);
    });

    btnBack.addEventListener('click', () => {
        window.location.href = 'lobby.html';
    });
}

// ---- ОТПРАВИТЬ ДЕЙСТВИЕ ----
function sendAction(type, data = {}) {
    gameState.isMyTurn = false;
    if (socket?.connected) {
        socket.emit('game:action', {
            type,
            token: GAME_TOKEN,
            gameId: gameState.gameId,
            ...data,
        });
    }

    // Обновить лог
    const labels = {
        fold: 'Ты сбросил',
        check: 'Ты чекнул',
        call: `Ты коллировал ${data.amount || ''}`,
        raise: `Ты рейзнул ${data.amount || ''}`,
        allin: 'Ты All-In!',
    };
    addLog(labels[type] || type, type === 'allin');
}

// ---- ХОД ДРУГОГО ИГРОКА ----
function onPlayerAction(data) {
    // data = { playerIndex, type, amount, chips }
    const player = gameState.players[data.playerIndex];
    if (!player) return;

    // Обновить фишки
    if (data.chips !== undefined) {
        player.chips = data.chips;
        const el = document.getElementById(`chips-${data.playerIndex}`);
        if (el) el.textContent = data.chips.toLocaleString();
    }

    // Обновить банк
    if (data.pot !== undefined) updatePot(data.pot);

    // Пометить сброшенного
    if (data.type === 'fold') {
        player.folded = true;
        const seat = document.getElementById(`seat-${data.playerIndex}`);
        if (seat) seat.classList.add('folded');
        const cards = document.getElementById(`cards-${data.playerIndex}`);
        if (cards) cards.innerHTML = '';
    }

    // Убрать активный стиль с предыдущего
    document.querySelectorAll('.player-seat').forEach(s => s.classList.remove('active'));

    // Лог
    const name = data.playerIndex === gameState.myIndex ? 'Ты' : player.name;
    const labels = {
        fold: `${name} сбросил`,
        check: `${name} чекнул`,
        call: `${name} коллировал ${data.amount || ''}`,
        raise: `${name} рейзнул ${data.amount || ''}`,
        allin: `${name} All-In!`,
    };
    addLog(labels[data.type] || `${name}: ${data.type}`, data.type === 'allin');
    Sounds?.action();
}

// ---- ТВОЙ ХОД ----
function onYourTurn(data) {
    // data = { currentBet, myBet, myChips, minRaise, canCheck, canCall, callAmount, timeLimit }
    gameState.isMyTurn = true;
    gameState.currentBet = data.currentBet || 0;
    gameState.myBet = data.myBet || 0;
    gameState.myChips = data.myChips || gameState.myChips;
    gameState.minRaise = data.minRaise || 0;

    enableActions(data);
    startTimer(data.timeLimit || 30);
    Sounds?.yourTurn();
    window.TG?.haptic('medium');

    // Подсветить свой сит
    const mySeat = document.getElementById(`seat-${gameState.myIndex}`);
    if (mySeat) mySeat.classList.add('active');

    // Обновить кнопку Call
    const btnCall = document.getElementById('btnCall');
    if (data.callAmount > 0) {
        btnCall.textContent = `Call ${data.callAmount}`;
    }
}

// ---- ВКЛЮЧИТЬ / ВЫКЛЮЧИТЬ КНОПКИ ----
function enableActions(data) {
    const btnFold = document.getElementById('btnFold');
    const btnCheck = document.getElementById('btnCheck');
    const btnCall = document.getElementById('btnCall');
    const btnRaise = document.getElementById('btnRaise');
    const btnAllIn = document.getElementById('btnAllIn');

    btnFold.disabled = false;
    btnCheck.disabled = !data.canCheck;
    btnCall.disabled = !data.canCall && data.callAmount <= 0;
    btnRaise.disabled = false;
    btnAllIn.disabled = false;

    if (!data.canCheck) {
        btnCheck.style.opacity = '0.3';
    } else {
        btnCheck.style.opacity = '1';
    }

    // Слайдер рейза
    const slider = document.getElementById('raiseSlider');
    const min = data.minRaise || 0;
    const max = gameState.myChips;
    const initial = Math.floor(min + (max - min) * 0.5);
    slider.value = 50;
    document.getElementById('raiseAmount').textContent = initial;
}

function disableActions() {
    ['btnFold', 'btnCheck', 'btnCall', 'btnRaise', 'btnAllIn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = true;
    });
    document.getElementById('raiseWrap').classList.remove('visible');
    gameState.isMyTurn = false;
}

// ---- ТАЙМЕР ----
function startTimer(seconds) {
    stopTimer();

    const myIndex = gameState.myIndex;
    const timerWrap = document.getElementById(`timer-wrap-${myIndex}`);
    const timerBar = document.getElementById(`timer-bar-${myIndex}`);

    if (!timerWrap || !timerBar) return;

    timerWrap.style.display = 'block';
    timerBar.style.width = '100%';
    timerBar.classList.remove('warning');

    let remaining = seconds;

    gameState.timerInterval = setInterval(() => {
        remaining--;
        const pct = (remaining / seconds) * 100;
        timerBar.style.width = `${pct}%`;

        if (remaining <= 10) {
            timerBar.classList.add('warning');
            Sounds?.tick();
        }

        if (remaining <= 0) {
            stopTimer();
            // Автофолд
            if (gameState.isMyTurn) {
                sendAction('fold');
                disableActions();
                addLog('Время вышло -- автофолд', false);
            }
        }
    }, 1000);
}

function stopTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }

    // Скрыть таймер
    const myIndex = gameState.myIndex;
    const timerWrap = document.getElementById(`timer-wrap-${myIndex}`);
    if (timerWrap) timerWrap.style.display = 'none';
}

// ---- КОНЕЦ РАУНДА ----
function onRoundEnd(data) {
    // data = { winnerId, winnerName, amount, handName, cards }
    stopTimer();
    disableActions();

    const isWinner = data.winnerId === window.TG?.getId();

    // Показать вскрытие карт
    if (data.revealCards) {
        data.revealCards.forEach(({ playerIndex, cards }) => {
            const container = document.getElementById(`cards-${playerIndex}`);
            if (!container) return;
            container.innerHTML = cards.map(c => {
                const isRed = c.suit === '♥' || c.suit === '♦';
                return `<div class="card ${isRed ? 'red' : 'black'}" style="width:18px;height:26px;font-size:8px">
                            ${c.rank}${c.suit}
                        </div>`;
            }).join('');
        });
    }

    // Показать результат
    const resultEl = document.getElementById('roundResult');
    const titleEl = document.getElementById('roundResultTitle');
    const handEl = document.getElementById('roundResultHand');
    const amountEl = document.getElementById('roundResultAmount');

    if (isWinner) {
        titleEl.textContent = 'Победа!';
        titleEl.style.color = 'var(--gold)';
        amountEl.textContent = `+${data.amount}`;
        Sounds?.win();
        window.TG?.haptic('heavy');
    } else {
        titleEl.textContent = `Победил ${data.winnerName}`;
        titleEl.style.color = 'var(--platinum-dim)';
        amountEl.textContent = `+${data.amount}`;
        Sounds?.lose();
    }

    handEl.textContent = data.handName || '';
    resultEl.style.display = 'flex';

    // Скрыть через 3 секунды
    setTimeout(() => {
        resultEl.style.display = 'none';

        // Убрать карты
        document.getElementById('communityCards').innerHTML = '';
        document.getElementById('handCards').innerHTML = `
            <div class="card back hand-card"></div>
            <div class="card back hand-card"></div>
        `;
        document.getElementById('handStrength').textContent = '';
        gameState.myCards = [];
        gameState.communityCards = [];
    }, 3000);

    addLog(isWinner ? `Ты выиграл ${data.amount}!` : `${data.winnerName} выиграл`, isWinner);
}

// ---- КОНЕЦ ТУРНИРА ----
function onTournamentEnd(data) {
    // data = { place, starsWon, players }
    stopTimer();
    disableActions();

    const placeEmoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];
    const emoji = placeEmoji[data.place - 1] || `${data.place}`;

    document.getElementById('tournamentPlace').textContent = emoji;
    document.getElementById('tournamentPrize').textContent = data.starsWon > 0 ? `+${data.starsWon} ⭐ Stars` : 'Без приза';

    const titles = {
        1: 'Ты победил!',
        2: 'Второе место!',
        3: 'Третье место!',
    };
    document.getElementById('tournamentTitle').textContent = titles[data.place] || `${data.place}-е место`;

    document.getElementById('tournamentEnd').style.display = 'flex';

    if (data.place === 1) {
        Sounds?.win();
        window.TG?.haptic('heavy');
    } else {
        Sounds?.lose();
    }
}

// ---- АКТИВНЫЙ ИГРОК (чужой ход) ----
function setActivePlayer(playerIndex) {
    document.querySelectorAll('.player-seat').forEach((seat, i) => {
        seat.classList.toggle('active', i === playerIndex);
    });

    // Таймер для чужого хода
    const timerWrap = document.getElementById(`timer-wrap-${playerIndex}`);
    const timerBar = document.getElementById(`timer-bar-${playerIndex}`);

    if (timerWrap && timerBar) {
        timerWrap.style.display = 'block';
        timerBar.style.width = '100%';

        setTimeout(() => {
            timerBar.style.transition = 'width 30s linear';
            timerBar.style.width = '0%';
        }, 50);

        setTimeout(() => {
            timerWrap.style.display = 'none';
            timerBar.style.transition = '';
        }, 30000);
    }
}
