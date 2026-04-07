/* ============================================
   PLANET POKER — TG.JS
   Инициализация Telegram WebApp
============================================ */

const tg = window.Telegram?.WebApp;

if (tg) {
    tg.expand();
    tg.setHeaderColor('#080808');
    tg.setBackgroundColor('#080808');
    tg.enableClosingConfirmation();
}

// Данные пользователя
const tgUser = tg?.initDataUnsafe?.user || null;

window.TG = {
    app: tg,
    user: tgUser,

    // Имя пользователя
    getName() {
        if (!tgUser) return 'Игрок';
        return tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : '');
    },

    // Короткое имя (для аватара)
    getInitials() {
        const name = this.getName();
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    },

    // Фото профиля (если есть)
    getPhoto() {
        return tgUser?.photo_url || null;
    },

    // ID пользователя
    getId() {
        return tgUser?.id || null;
    },

    // Показать кнопку "Назад"
    showBack(callback) {
        if (!tg) return;
        tg.BackButton.show();
        tg.BackButton.onClick(callback);
    },

    // Скрыть кнопку "Назад"
    hideBack() {
        if (!tg) return;
        tg.BackButton.hide();
    },

    // Вибрация
    haptic(type = 'light') {
        tg?.HapticFeedback?.impactOccurred(type);
    },

    // Показать нативный alert
    alert(msg, cb) {
        tg ? tg.showAlert(msg, cb) : (alert(msg), cb?.());
    },

    // Показать confirm
    confirm(msg, cb) {
        tg ? tg.showConfirm(msg, cb) : cb(confirm(msg));
    }
};
