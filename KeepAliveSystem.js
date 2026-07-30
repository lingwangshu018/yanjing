class KeepAliveSystem {
    constructor() {
        this.audioElement = null;
        this.isActive = false;
        this.pollingTimer = null;
        this.lastCheckTime = 0;
        this.userPaused = false;
        this.foregroundInterval = 30000;
        this.backgroundMinInterval = 15000;

        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.handleUserUnlock = this.handleUserUnlock.bind(this);

        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        document.addEventListener('pointerdown', this.handleUserUnlock, { passive: true });
        document.addEventListener('touchstart', this.handleUserUnlock, { passive: true });
    }

    async init() {
        this.setupAudioHeartbeat();
        this.setupMediaSession();
    }

    handleVisibilityChange() {
        if (!this.isActive) return;

        if (document.visibilityState === 'visible') {
            this.startPolling();
            this.checkPollingTasks(true);
        } else {
            this.stopPolling();
            if (!this.userPaused) this.tryPlayAudio('切换到后台');
        }
    }

    handleUserUnlock() {
        if (!this.isActive || this.userPaused || !this.audioElement?.paused) return;
        this.tryPlayAudio('用户交互');
    }

    async tryPlayAudio(reason = '') {
        if (!this.isActive || this.userPaused || !this.audioElement) return false;
        try {
            await this.audioElement.play();
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
            return true;
        } catch (error) {
            console.debug(`[保活] ${reason}播放未获浏览器许可，将等待下次用户交互。`, error);
            return false;
        }
    }

    setupAudioHeartbeat() {
        if (this.audioElement) return;

        const audio = document.createElement('audio');
        audio.src = 'assets/silent.mp3';
        audio.loop = true;
        audio.preload = 'auto';
        audio.style.display = 'none';
        audio.setAttribute('playsinline', '');
        document.body.appendChild(audio);
        this.audioElement = audio;

        // 仅在后台使用音频进度作为低频兜底，前台交给普通定时器。
        audio.addEventListener('timeupdate', () => {
            if (this.isActive && document.visibilityState === 'hidden') {
                this.checkPollingTasks();
            }
        });

        audio.addEventListener('ended', () => {
            if (this.isActive && !this.userPaused && document.visibilityState === 'hidden') {
                audio.currentTime = 0;
                this.tryPlayAudio('音频结束');
            }
        });

        // 不再监听 pause 后强制恢复；用户暂停和系统暂停都应被尊重。
    }

    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: '景叙后台服务',
                artist: '保持提醒连接',
                album: '景叙',
                artwork: [
                    { src: 'https://tc-new.z.wiki/autoupload/Lps16m1XQxemt1c-RRKmtdiO_OyvX7mIgxFBfDMDErs/20260319/uejv/247X247/IMG_8042.jpeg', sizes: '192x192', type: 'image/jpeg' },
                    { src: 'https://tc-new.z.wiki/autoupload/Lps16m1XQxemt1c-RRKmtdiO_OyvX7mIgxFBfDMDErs/20260319/uejv/247X247/IMG_8042.jpeg', sizes: '512x512', type: 'image/jpeg' }
                ]
            });

            navigator.mediaSession.setActionHandler('play', () => {
                this.userPaused = false;
                this.tryPlayAudio('媒体控制播放');
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.userPaused = true;
                this.audioElement?.pause();
                navigator.mediaSession.playbackState = 'paused';
            });
            navigator.mediaSession.setActionHandler('previoustrack', null);
            navigator.mediaSession.setActionHandler('nexttrack', null);
        } catch (error) {
            console.debug('[保活] Media Session 配置不可用:', error);
        }
    }

    async showLocalNotification(title, body, icon = null) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        const options = { body, requireInteraction: false };
        if (icon) options.icon = icon;

        try {
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.ready;
                if (registration?.showNotification) {
                    await registration.showNotification(title, options);
                    return;
                }
            }
            new Notification(title, options);
        } catch (error) {
            console.error('[系统通知] 发送失败:', error);
        }
    }

    showWebToast(msg) {
        if (typeof showToast === 'function') {
            showToast(msg);
            return;
        }

        const toast = document.createElement('div');
        toast.textContent = msg;
        toast.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.8);color:#fff;padding:12px 24px;border-radius:12px;z-index:99999;font-size:15px;pointer-events:none;transition:opacity .3s;box-shadow:0 4px 15px rgba(0,0,0,.3)';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2200);
    }

    async start() {
        if (this.isActive) return;
        this.isActive = true;
        this.userPaused = false;

        if ('Notification' in window && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch (_) {}
        }

        await this.tryPlayAudio('启动');
        this.startPolling();
        this.checkPollingTasks(true);
        this.showWebToast('后台提醒服务已启动');
    }

    async checkPollingTasks(force = false) {
        if (!this.isActive) return;

        const now = Date.now();
        const minInterval = document.visibilityState === 'hidden'
            ? this.backgroundMinInterval
            : this.foregroundInterval;
        if (!force && now - this.lastCheckTime < minInterval) return;
        this.lastCheckTime = now;

        try {
            window.dispatchEvent(new CustomEvent('systemHeartbeat'));
            const events = JSON.parse(localStorage.getItem('local_notifications') || '[]');
            if (!Array.isArray(events) || events.length === 0) return;

            const readyEvents = events.filter(event => Number(event.triggerTime) <= now);
            const pendingEvents = events.filter(event => Number(event.triggerTime) > now);
            if (readyEvents.length === 0) return;

            localStorage.setItem('local_notifications', JSON.stringify(pendingEvents));
            for (const event of readyEvents) {
                await this.showLocalNotification(event.title, event.body, event.icon || null);
            }
        } catch (error) {
            console.error('[本地提醒] 轮询检查失败:', error);
        }
    }

    startPolling() {
        this.stopPolling();
        if (!this.isActive || document.visibilityState === 'hidden') return;

        this.pollingTimer = setInterval(() => {
            this.checkPollingTasks();
        }, this.foregroundInterval);
    }

    stopPolling() {
        if (!this.pollingTimer) return;
        clearInterval(this.pollingTimer);
        this.pollingTimer = null;
    }

    scheduleLocalNotification(title, body, delayMs) {
        const safeDelay = Math.max(0, Number(delayMs) || 0);
        let events;
        try {
            events = JSON.parse(localStorage.getItem('local_notifications') || '[]');
            if (!Array.isArray(events)) events = [];
        } catch (_) {
            events = [];
        }

        events.push({
            title: String(title || '景叙提醒'),
            body: String(body || ''),
            triggerTime: Date.now() + safeDelay,
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        });
        localStorage.setItem('local_notifications', JSON.stringify(events));
        this.checkPollingTasks(true);
    }

    stop() {
        if (!this.isActive) return;
        this.isActive = false;
        this.userPaused = false;
        this.stopPolling();

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        }
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
        this.showWebToast('后台提醒服务已关闭');
    }
}

window.keepAliveSystem = new KeepAliveSystem();
