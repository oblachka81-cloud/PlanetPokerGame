(function() {
    const tg = window.Telegram?.WebApp;
    
    if (tg) {
        tg.expand();
        tg.setHeaderColor('#080808');
        tg.setBackgroundColor('#080808');
        tg.enableClosingConfirmation();
    }
    
    const tgUser = tg?.initDataUnsafe?.user || null;

    // ВРЕМЕННАЯ ДИАГНОСТИКА
    setTimeout(() => {
        const info = JSON.stringify({
            hasTg: !!tg,
            hasUser: !!tgUser,
            name: tgUser?.first_name || 'нет',
            id: tgUser?.id || 'нет',
            initData: tg?.initData ? tg.initData.slice(0, 50) : 'пусто',
        }, null, 2);
        document.body.insertAdjacentHTML('afterbegin',
            `<pre style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#000;color:#0f0;font-size:11px;padding:8px;word-break:break-all">${info}</pre>`
        );
    }, 1000);
    
    window.TG = {
        app: tg,
        user: tgUser,
        
        getName() {
            if (!tgUser) return 'Игрок';
            return tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : '');
        },
        
        getInitials() {
            const name = this.getName();
            return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        },
        
        getPhoto() {
            return tgUser?.photo_url || null;
        },
        
        getId() {
            return tgUser?.id || null;
        },
        
        showBack(callback) {
            if (!tg) return;
            tg.BackButton.show();
            tg.BackButton.onClick(callback);
        },
        
        hideBack() {
            if (!tg) return;
            tg.BackButton.hide();
        },
        
        haptic(type = 'light') {
            tg?.HapticFeedback?.impactOccurred(type);
        },
        
        alert(msg, cb) {
            if (tg) {
                tg.showAlert(msg, cb);
            } else {
                alert(msg);
                if (cb) cb();
            }
        },
        
        confirm(msg, cb) {
            if (tg) {
                tg.showConfirm(msg, cb);
            } else {
                cb(confirm(msg));
            }
        }
    };
})();
