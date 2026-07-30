const normalizeText = value => typeof value === 'string' ? value.trim() : '';

const normalizeWorldBook = (book, type = 'local') => {
    if (!book || typeof book !== 'object') return book;

    const normalized = { ...book };
    normalized.id = String(book.id ?? book.uid ?? `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    normalized.title = normalizeText(book.title || book.name) || '未命名世界书';
    normalized.content = normalizeText(book.content || book.text || book.entry || book.description || book.prompt);
    normalized.position = ['front', 'middle', 'back'].includes(book.position) ? book.position : 'middle';
    normalized.group = normalizeText(book.group || book.category);

    // 局部世界书由聊天挂载关系控制，不需要 active 才能生效。
    // 全局世界书保留明确的开关值；旧数据缺少 active 时默认启用。
    if (type === 'global') normalized.active = typeof book.active === 'boolean' ? book.active : true;

    return normalized;
};

const normalizeFriend = friend => {
    if (!friend || typeof friend !== 'object' || friend.isGroup) return friend;

    const normalized = { ...friend };
    const compatibleSetting = normalizeText(
        friend.setting ||
        friend.persona ||
        friend.personality ||
        friend.characterSetting ||
        friend.character_prompt ||
        friend.systemPrompt ||
        friend.prompt ||
        friend.description
    );

    if (!normalizeText(friend.setting) && compatibleSetting) {
        normalized.setting = compatibleSetting;
    }

    if (!normalized.roleName) {
        normalized.roleName = normalizeText(friend.name || friend.alias) || '未命名角色';
    }

    return normalized;
};

const normalizeMountedWorldBooks = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value || {};

    const normalized = {};
    Object.entries(value).forEach(([friendId, mounted]) => {
        const list = Array.isArray(mounted) ? mounted : (mounted ? [mounted] : []);
        normalized[friendId] = [...new Set(list.map(item => {
            if (item && typeof item === 'object') return item.id ?? item.uid ?? item.value;
            return item;
        }).filter(item => item !== undefined && item !== null).map(String))];
    });
    return normalized;
};

window.SimulatorAPI = {
    db: {
        dbName: 'iPhoneSimulatorDB',
        storeName: 'store',
        idb: null,
        _knownGlobalWorldBookIds: new Set(),
        init: function() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        db.createObjectStore(this.storeName);
                    }
                };
                request.onsuccess = (event) => {
                    this.idb = event.target.result;
                    resolve();
                };
                request.onerror = (event) => reject(event.target.error);
            });
        },
        normalizeValue: function(key, value) {
            if (key === 'global_world_books' && Array.isArray(value)) {
                const normalized = value.map(book => normalizeWorldBook(book, 'global')).filter(book => book?.content);
                normalized.forEach(book => this._knownGlobalWorldBookIds.add(String(book.id)));
                return normalized;
            }
            if (key === 'local_world_books' && Array.isArray(value)) {
                return value.map(book => normalizeWorldBook(book, 'local')).filter(book => book?.content);
            }
            if (key === 'friends' && Array.isArray(value)) {
                return value.map(normalizeFriend);
            }
            if (key === 'chat_world_books') {
                return normalizeMountedWorldBooks(value);
            }
            return value;
        },
        get: function(key, defaultValue) {
            return new Promise((resolve) => {
                if (!this.idb) return resolve(this.normalizeValue(key, defaultValue));
                const transaction = this.idb.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(key);
                request.onsuccess = () => {
                    const rawValue = request.result !== undefined ? request.result : defaultValue;
                    resolve(this.normalizeValue(key, rawValue));
                };
                request.onerror = () => resolve(this.normalizeValue(key, defaultValue));
            });
        },
        set: function(key, value) {
            return new Promise((resolve, reject) => {
                if (!this.idb) return resolve();

                let valueToStore = value;
                if (key === 'global_world_books' && Array.isArray(value)) {
                    valueToStore = value.map(book => {
                        const normalized = normalizeWorldBook(book, 'global');
                        const id = String(normalized.id);
                        // main.js 新建世界书时会写入 active:false。仅对首次出现的新条目改为启用，
                        // 已存在条目的 false 仍视为用户主动关闭，不会被擅自打开。
                        if (!this._knownGlobalWorldBookIds.has(id)) normalized.active = true;
                        this._knownGlobalWorldBookIds.add(id);
                        return normalized;
                    }).filter(book => book?.content);
                } else {
                    valueToStore = this.normalizeValue(key, value);
                }

                const transaction = this.idb.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.put(valueToStore, key);
                request.onsuccess = () => resolve();
                request.onerror = (e) => {
                    console.error('IndexedDB set error:', e.target.error);
                    reject(e.target.error);
                };
            });
        },
        getAllWorldBook: async function() {
            const globalBooks = await this.get('global_world_books', []);
            const localBooks = await this.get('local_world_books', []);
            return {
                global: globalBooks,
                local: localBooks
            };
        }
    },
    ai: {
        chat: async function(prompt) {
            const url = localStorage.getItem('api_url');
            const key = localStorage.getItem('api_key');
            const model = localStorage.getItem('api_model');
            const temp = parseFloat(localStorage.getItem('api_temp') || '0.7');

            if (!url || !key) {
                throw new Error('请先在设置中配置API');
            }

            let messages = prompt;
            if (typeof prompt === 'string') {
                messages = [{ role: 'user', content: prompt }];
            }

            const res = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: temp
                })
            });

            if (!res.ok) {
                let errorMsg = `HTTP ${res.status} ${res.statusText}`;
                try {
                    const errData = await res.json();
                    if (errData.error) {
                        errorMsg += ` - ${errData.error.message || JSON.stringify(errData.error)}`;
                        if (errData.error.code) errorMsg += ` (Code: ${errData.error.code})`;
                    }
                } catch (e) {}
                throw new Error(errorMsg);
            }

            const data = await res.json();
            if (data.error) {
                let errorMsg = data.error.message || JSON.stringify(data.error);
                if (data.error.code) errorMsg += ` (Code: ${data.error.code})`;
                throw new Error(errorMsg);
            }

            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                let reason = '未知原因';
                if (data.promptFilterResults) reason = '触发了输入内容审查(Prompt Filter)';
                else if (data.choices && data.choices.length > 0 && data.choices[0].finish_reason) reason = `生成中断，原因: ${data.choices[0].finish_reason}`;
                throw new Error(`API未返回有效内容，可能触发了内容审查(风控)。详细信息请查看控制台。(${reason})`);
            }

            let replyText = data.choices[0].message.content.trim();

            if (typeof window.cleanAiResponse === 'function') {
                replyText = window.cleanAiResponse(replyText);
            } else {
                let cleaned = replyText.replace(/<(think|thought|reasoning)[^>]*>[\s\S]*?<\/\1>/gi, '');
                cleaned = cleaned.replace(/<(think|thought|reasoning)[^>]*>[\s\S]*$/gi, '');
                replyText = cleaned.trim();
            }

            return replyText;
        }
    }
};

// 暴露为全局对象，确保 index.html / main.js 继续正常运行
window.db = window.SimulatorAPI.db;
