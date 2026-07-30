class KeepAliveSystem {
    constructor() {
        this.audioElement = null;
        this.isActive = false;
        this.pollingTimer = null; // 用于存储轮询定时器
        this.lastCheckTime = 0; // 节流控制时间戳
        
        // 监听页面可见性变化，尝试在切回前台时确保播放
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.isActive && this.audioElement) {
                this.audioElement.play().catch(e => console.warn('恢复播放失败:', e));
            }
        });

        // 全局交互解锁音频（核心：iOS必须在用户手势内触发play才能持续在后台播放）
        const unlockHandler = () => {
            if (this.isActive && this.audioElement && this.audioElement.paused) {
                this.audioElement.play().then(() => {
                    console.log('✅ [保活] 用户手势解锁音频播放成功，激活系统播放面板');
                    if ('mediaSession' in navigator) {
                        navigator.mediaSession.playbackState = 'playing';
                    }
                }).catch(e => {});
            }
        };
        document.addEventListener('click', unlockHandler, { passive: true });
        document.addEventListener('touchstart', unlockHandler, { passive: true });
        document.addEventListener('scroll', unlockHandler, { passive: true });
    }

    async init() {
        this.setupAudioHeartbeat();
        this.setupMediaSession();
    }

    setupAudioHeartbeat() {
        if (!this.audioElement) {
            this.audioElement = document.createElement('audio');
            // 注意：Web 环境中建议使用相对路径
            this.audioElement.src = 'assets/silent.mp3';
            this.audioElement.loop = true;
            this.audioElement.style.display = 'none';
            this.audioElement.setAttribute('playsinline', ''); // 兼容 iOS
            document.body.appendChild(this.audioElement);

            // iOS 后台保活核心：利用音频播放进度事件驱动检查，替代被降权挂起的 setInterval
            this.audioElement.addEventListener('timeupdate', () => {
                if (this.isActive) {
                    this.checkPollingTasks();
                    
                    // 关键修复：防止 iOS 在后台播放结束时无法自动 loop 的问题
                    // 提前 0.5 秒手动将播放进度倒回开始，实现无缝循环
                    if (this.audioElement.duration > 0 && (this.audioElement.duration - this.audioElement.currentTime) < 0.5) {
                        this.audioElement.currentTime = 0;
                        this.audioElement.play().catch(() => {});
                    }
                }
            });

            // 监听播放结束手动恢复（以防 loop 在某些浏览器或 iOS 后台失效）
            this.audioElement.addEventListener('ended', () => {
                if (this.isActive) {
                    this.audioElement.currentTime = 0;
                    this.audioElement.play().catch(e => console.error('音频循环播放失败:', e));
                }
            });

            // 防止系统或其他因素意外暂停保活音频
            this.audioElement.addEventListener('pause', () => {
                if (this.isActive) {
                    console.log('检测到音频被意外暂停，正在尝试恢复以维持保活...');
                    this.audioElement.play().catch(e => console.error('自动恢复音频失败:', e));
                }
            });
        }
    }

    setupMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: '系统正在后台运行',
                artist: '保持连接中',
                album: '景叙系统保活服务',
                // 使用 PWA 相同的封面，增加真实感和统一感
                artwork: [
                    { src: 'https://tc-new.z.wiki/autoupload/Lps16m1XQxemt1c-RRKmtdiO_OyvX7mIgxFBfDMDErs/20260319/uejv/247X247/IMG_8042.jpeg', sizes: '192x192', type: 'image/jpeg' },
                    { src: 'https://tc-new.z.wiki/autoupload/Lps16m1XQxemt1c-RRKmtdiO_OyvX7mIgxFBfDMDErs/20260319/uejv/247X247/IMG_8042.jpeg', sizes: '512x512', type: 'image/jpeg' }
                ]
            });

            // 必须注册这些核心的控制手柄，iOS的控制中心/锁屏播放器才会认为这是一个"真正的播放器"而显示出来
            navigator.mediaSession.setActionHandler('play', () => {
                if (this.isActive && this.audioElement) {
                    this.audioElement.play();
                    navigator.mediaSession.playbackState = 'playing';
                }
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                // 表面上拦截暂停，其实是为了保活，强制它继续播
                if (this.isActive && this.audioElement) {
                    console.log('拦截到暂停操作，强制恢复播放以保活');
                    this.audioElement.play();
                    navigator.mediaSession.playbackState = 'playing';
                }
            });
            // 随便给点空实现，欺骗系统点亮上一首/下一首按钮
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (this.audioElement) this.audioElement.currentTime = 0;
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (this.audioElement) this.audioElement.currentTime = 0;
            });
        }
    }

    async showLocalNotification(title, body, icon = null) {
        console.log(`[系统通知准备] 当前权限状态: ${Notification.permission}`);
        if (!('Notification' in window)) {
            console.error('当前浏览器不支持 Notification API');
            return;
        }
        
        if (Notification.permission === 'granted') {
            try {
                const options = { 
                    body: body,
                    requireInteraction: true // 强制通知停留在屏幕上直到用户点击
                };
                if (icon) options.icon = icon;

                // 移动端（特别是安卓 Chrome）要求必须通过 ServiceWorker 来触发通知
                // 否则直接 new Notification 会抛出 Illegal constructor 错误而无法弹窗
                if ('serviceWorker' in navigator) {
                    const registration = await navigator.serviceWorker.ready;
                    if (registration && registration.showNotification) {
                        console.log('[系统通知] 正在通过 ServiceWorker 发送弹窗...');
                        await registration.showNotification(title, options);
                        console.log('✅ [系统通知成功] ServiceWorker 反馈：通知已发送');
                        return;
                    }
                }

                // 桌面端或无 SW 环境的备用方案
                console.log('[系统通知] 正在直接调用 new Notification 发送弹窗...');
                const notification = new Notification(title, options);

                notification.onshow = () => {
                    console.log('✅ [系统通知成功] 浏览器反馈：通知已经成功展示在屏幕上了！');
                };

                notification.onerror = (err) => {
                    console.error('❌ [系统通知失败] 浏览器拦截了弹窗，错误信息:', err);
                };
            } catch (e) {
                console.error('❌ [系统通知报错] 代码执行异常:', e);
            }
        } else {
            console.warn('[系统通知拦截] 无法弹窗，因为权限状态是:', Notification.permission);
        }
    }

    showWebToast(msg) {
        // 如果全局有 showToast 则使用，否则自己创建一个简单的网页内弹窗
        if (typeof showToast === 'function') {
            showToast(msg);
        } else {
            const toast = document.createElement('div');
            toast.textContent = msg;
            toast.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.8); color:white; padding:12px 24px; border-radius:12px; z-index:99999; font-size:15px; pointer-events:none; transition:opacity 0.3s; box-shadow:0 4px 15px rgba(0,0,0,0.3);';
            document.body.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }

    async start() {
        this.isActive = true;

        // 提前请求一次通知权限，确保在用户交互上下文中
        if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            await Notification.requestPermission();
        }

        try {
            if (this.audioElement) {
                // 必须在用户交互事件上下文中触发
                await this.audioElement.play();
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.playbackState = 'playing';
                }
                console.log('保活音频已启动');
            }
        } catch (error) {
            console.warn('启动保活音频失败 (将在下次用户交互时尝试恢复):', error);
        }

        // 启动本地事件轮询
        this.startPolling();

        // 网页内 UI 提示（确保用户一定能看到）
        this.showWebToast('后台保活服务已启动');
    }

    async checkPollingTasks() {
        if (!this.isActive) return;

        const now = Date.now();
        // 节流控制，至少 2 秒检查一次，避免 timeupdate 触发过频造成性能浪费
        if (now - this.lastCheckTime < 2000) return;
        this.lastCheckTime = now;

        try {
            // 触发全局心跳事件，供其他模块（如主动发消息）在后台也能执行
            window.dispatchEvent(new CustomEvent('systemHeartbeat'));

            // 从 localStorage 读取预约的本地通知队列
            const events = JSON.parse(localStorage.getItem('local_notifications') || '[]');
            if (events.length === 0) return;

            const readyEvents = events.filter(e => e.triggerTime <= now);
            const pendingEvents = events.filter(e => e.triggerTime > now);

            if (readyEvents.length > 0) {
                // 把还没到期的任务写回 localStorage，已到期的从队列中剔除
                localStorage.setItem('local_notifications', JSON.stringify(pendingEvents));

                // 触发所有已经到期的弹窗
                for (const event of readyEvents) {
                    console.log(`🎉 [本地轮询触发] 预约任务到期：${event.title}`);
                    await this.showLocalNotification(event.title, event.body);
                }
            }
        } catch (e) {
            console.error('本地轮询检查出错:', e);
        }
    }

    startPolling() {
        if (this.pollingTimer) clearInterval(this.pollingTimer);
        console.log('启动纯前端本地事件轮询 (支持 iOS timeupdate 驱动双保险)');

        // 立即检查一次
        this.checkPollingTasks();

        // 备用：每隔 5 秒执行一次心跳 (作为 PC 端或其他没有休眠且不支持音频事件环境的补充保障)
        this.pollingTimer = setInterval(() => {
            this.checkPollingTasks();
        }, 5000);
    }

    /**
     * 【纯前端核心魔法】预约一个未来的本地通知
     * 只要你开启了保活，哪怕你切到了后台，只要时间一到就会弹系统通知！
     * @param {string} title 通知标题
     * @param {string} body 通知内容
     * @param {number} delayMs 延迟毫秒数 (比如 5000 就是 5 秒后)
     */
    scheduleLocalNotification(title, body, delayMs) {
        const triggerTime = Date.now() + delayMs;
        const events = JSON.parse(localStorage.getItem('local_notifications') || '[]');
        events.push({ title, body, triggerTime, id: Date.now() + Math.random() });
        localStorage.setItem('local_notifications', JSON.stringify(events));
        console.log(`[通知预约成功] 将在 ${delayMs / 1000} 秒后弹出: "${title}"`);
    }

    stop() {
        this.isActive = false;
        
        if (this.audioElement) {
            this.audioElement.pause();
            console.log('保活音频已停止');
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'none';
            }
        }
        
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
            console.log('定时轮询服务已停止');
        }
        
        // 网页内 UI 提示
        this.showWebToast('后台保活服务已关闭');
    }

}

window.keepAliveSystem = new KeepAliveSystem();
