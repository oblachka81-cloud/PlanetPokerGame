/* ============================================
   PLANET POKER — SOUNDS.JS
   Звуки через Web Audio API (без файлов)
============================================ */

window.Sounds = (() => {
    let ctx = null;

    function getCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        return ctx;
    }

    // Базовый генератор звука
    function play(freq, type, duration, gain = 0.3, delay = 0) {
        try {
            const ac = getCtx();
            const osc = ac.createOscillator();
            const vol = ac.createGain();

            osc.connect(vol);
            vol.connect(ac.destination);

            osc.type = type;
            osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
            vol.gain.setValueAtTime(0, ac.currentTime + delay);
            vol.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.01);
            vol.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);

            osc.start(ac.currentTime + delay);
            osc.stop(ac.currentTime + delay + duration);
        } catch (e) {}
    }

    return {
        // Карта выдана
        card() {
            play(520, 'sine', 0.08, 0.2);
            play(680, 'sine', 0.06, 0.15, 0.05);
        },

        // Фишки в банк (чип)
        chip() {
            play(900, 'triangle', 0.06, 0.25);
            play(700, 'triangle', 0.08, 0.2, 0.04);
        },

        // Чужой ход / действие
        action() {
            play(440, 'sine', 0.12, 0.15);
        },

        // Твой ход (уведомление)
        yourTurn() {
            play(660, 'sine', 0.15, 0.3);
            play(880, 'sine', 0.15, 0.3, 0.15);
        },

        // Победа в раунде
        win() {
            play(523, 'sine', 0.15, 0.3);
            play(659, 'sine', 0.15, 0.3, 0.12);
            play(784, 'sine', 0.2, 0.4, 0.24);
            play(1047, 'sine', 0.2, 0.4, 0.38);
        },

        // Проигрыш
        lose() {
            play(440, 'sawtooth', 0.15, 0.2);
            play(330, 'sawtooth', 0.15, 0.2, 0.15);
            play(220, 'sawtooth', 0.2, 0.3, 0.32);
        },

        // Fold
        fold() {
            play(350, 'sine', 0.1, 0.15);
            play(280, 'sine', 0.12, 0.15, 0.1);
        },

        // All-in
        allIn() {
            play(200, 'sawtooth', 0.05, 0.3);
            play(400, 'sawtooth', 0.08, 0.3, 0.05);
            play(600, 'sine', 0.1, 0.3, 0.1);
            play(800, 'sine', 0.15, 0.4, 0.16);
            play(1000, 'sine', 0.2, 0.5, 0.24);
        },

        // Кнопка / клик
        click() {
            play(600, 'sine', 0.05, 0.1);
        },

        // Игрок подключился
        join() {
            play(500, 'sine', 0.1, 0.2);
            play(700, 'sine', 0.1, 0.2, 0.1);
        },

        // Игра начинается
        gameStart() {
            [0, 0.15, 0.3, 0.45, 0.6].forEach((delay, i) => {
                play(400 + i * 120, 'sine', 0.2, 0.25, delay);
            });
        },

        // Таймер тикает (последние секунды)
        tick() {
            play(800, 'square', 0.04, 0.1);
        },
    };
})();
