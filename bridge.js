const normalizeText = value => typeof value === 'string' ? value.trim() : '';
const CURRENT_DATA_SCHEMA_VERSION = 2;

const worldBookDiagnostics = {
    globalBooks: [],
    localBooks: [],
    mountedBooks: {},
    lastInjection: null
};

const normalizeWorldBook = (book, type = 'local') => {
    if (!book || typeof book !== 'object') return book;

    const normalized = { ...book };
    normalized.id = String(book.id ?? book.uid ?? `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    normalized.title = normalizeText(book.title || book.name) || '未命名世界书';
    normalized.content = normalizeText(book.content || book.text || book.entry || book.description || book.prompt);
    normalized.position = ['front', 'middle', 'back'].includes(book.position) ? book.position : 'middle';
    normalized.group = normalizeText(book.group || book.category);

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

    if (!normalizeText(friend.setting) && compatibleSetting) normalized.setting = compatibleSetting;
    if (!normalized.roleName) normalized.roleName = normalizeText(friend.name || friend.alias) || '未命名角色';
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

const updateDiagnosticCache = (key, value) => {
    if (key === 'global_world_books' && Array.isArray(value)) worldBookDiagnostics.globalBooks = value;
    if (key === 'local_world_books' && Array.isArray(value)) worldBookDiagnostics.localBooks = value;
    if (key === 'chat_world_books' && value && typeof value === 'object') worldBookDiagnostics.mountedBooks = value;
};

const getBookNamesFromDisplay = element => {
    if (!element) return [];
    const text = normalizeText(element.textContent);
    if (!text || text === '未挂载') return [];
    return text.split(',').map(item => item.trim()).filter(Boolean);
};

const buildExpectedDiagnostic = displayElement => {
    const selectedNames = getBookNamesFromDisplay(displayElement);
    const validLocal = selectedNames.filter(name =>
        worldBookDiagnostics.localBooks.some(book => book.title === name && normalizeText(book.content))
    );
    const activeGlobal = worldBookDiagnostics.globalBooks.filter(book => book.active && normalizeText(book.content));

    return {
        selectedLocal: selectedNames.length,
        validLocal: validLocal.length,
        invalidLocal: Math.max(0, selectedNames.length - validLocal.length),
        activeGlobal: activeGlobal.length,
        expectedTotal: validLocal.length + activeGlobal.length
    };
};

const renderWorldBookDiagnostic = displayElement => {
    if (!displayElement || !displayElement.parentElement) return;

    const expected = buildExpectedDiagnostic(displayElement);
    let diagnostic = displayElement.parentElement.querySelector(':scope > .jx-worldbook-diagnostic');
    if (!diagnostic) {
        diagnostic = document.createElement('div');
        diagnostic.className = 'jx-worldbook-diagnostic';
        diagnostic.style.cssText = 'font-size:11px;line-height:1.5;margin-top:4px;opacity:.82;white-space:normal;';
        displayElement.insertAdjacentElement('afterend', diagnostic);
    }

    const actual = worldBookDiagnostics.lastInjection;
    const actualText = actual
        ? `上次请求实际注入 ${actual.total} 本（全局 ${actual.global} / 局部 ${actual.local}）`
        : `预计注入 ${expected.expectedTotal} 本`;

    const nextText = `局部已选 ${expected.selectedLocal} · 有效 ${expected.validLocal} · 失效 ${expected.invalidLocal} · 全局启用 ${expected.activeGlobal}\n${actualText}`;
    if (diagnostic.textContent !== nextText) diagnostic.textContent = nextText;
    diagnostic.style.color = expected.invalidLocal > 0 ? '#d97706' : '#16a34a';
    diagnostic.title = expected.invalidLocal > 0
        ? '存在已选择但找不到正文的局部世界书，请重新挂载或检查内容。'
        : '绿色表示当前选择均可读取；实际注入以最近一次聊天请求为准。';
};

let diagnosticRenderTimer = null;
const scheduleDiagnosticRender = () => {
    if (diagnosticRenderTimer) clearTimeout(diagnosticRenderTimer);
    diagnosticRenderTimer = setTimeout(() => {
        renderWorldBookDiagnostic(document.getElementById('quick-wb-display'));
        renderWorldBookDiagnostic(document.getElementById('page-wb-display'));
    }, 30);
};

const installWorldBookDiagnostics = () => {
    if (window.__jxWorldBookDiagnosticsInstalled) return;
    window.__jxWorldBookDiagnosticsInstalled = true;
    window.getWorldBookInjectionDiagnostics = () => ({ ...worldBookDiagnostics.lastInjection });

    const start = () => {
        scheduleDiagnosticRender();
        if (!document.body) return;
        const observer = new MutationObserver(mutations => {
            if (mutations.some(mutation => {
                const target = mutation.target?.nodeType === Node.TEXT_NODE ? mutation.target.parentElement : mutation.target;
                return target?.id === 'quick-wb-display' || target?.id === 'page-wb-display' ||
                    target?.querySelector?.('#quick-wb-display, #page-wb-display');
            })) scheduleDiagnosticRender();
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
};

const DATA_URL_PATTERN = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+/g;
const LARGE_BASE64_PATTERN = /[a-zA-Z0-9+/]{20000,}={0,2}/g;

const sanitizeChatContent = content => {
    if (typeof content === 'string') {
        return content
            .replace(DATA_URL_PATTERN, '[图片数据已省略]')
            .replace(LARGE_BASE64_PATTERN, '[大型二进制数据已省略]');
    }

    if (Array.isArray(content)) {
        return content.map(part => {
            if (!part || typeof part !== 'object') return part;
            if (part.type === 'text' && typeof part.text === 'string') {
                return { ...part, text: sanitizeChatContent(part.text) };
            }
            return part;
        });
    }

    return content;
};

const inspectActualWorldBookInjection = messages => {
    const systemContent = messages.find(message => message?.role === 'system' && typeof message.content === 'string')?.content || '';
    if (!systemContent) return;

    const global = worldBookDiagnostics.globalBooks.filter(book =>
        book.active && normalizeText(book.content) && systemContent.includes(normalizeText(book.content))
    ).length;
    const local = worldBookDiagnostics.localBooks.filter(book =>
        normalizeText(book.content) && systemContent.includes(normalizeText(book.content))
    ).length;

    worldBookDiagnostics.lastInjection = {
        global,
        local,
        total: global + local,
        checkedAt: Date.now()
    };
    scheduleDiagnosticRender();
};

const installChatRequestGuard = () => {
    if (window.__jxChatRequestGuardInstalled || typeof window.fetch !== 'function') return;
    window.__jxChatRequestGuardInstalled = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
        try {
            const url = typeof input === 'string' ? input : input?.url || '';
            const isChatCompletion = /\/chat\/completions(?:\?|$)/.test(url);
            if (isChatCompletion && typeof init.body === 'string') {
                const payload = JSON.parse(init.body);
                if (Array.isArray(payload.messages)) {
                    inspectActualWorldBookInjection(payload.messages);
                    let removedChars = 0;
                    payload.messages = payload.messages.map(message => {
                        if (!message || typeof message !== 'object') return message;
                        const before = typeof message.content === 'string' ? message.content.length : 0;
                        const content = sanitizeChatContent(message.content);
                        const after = typeof content === 'string' ? content.length : before;
                        removedChars += Math.max(0, before - after);
                        return { ...message, content };
                    });

                    if (removedChars > 0) {
                        console.warn(`[请求保护] 已从聊天上下文中移除约 ${removedChars} 个图片/Base64字符，避免 token 溢出。`);
                    }
                    init = { ...init, body: JSON.stringify(payload) };
                }
            }
        } catch (error) {
            console.warn('[请求保护] 清理或诊断聊天上下文失败，已使用原始请求继续发送:', error);
        }

        return originalFetch(input, init);
    };
};

installWorldBookDiagnostics();
installChatRequestGuard();

window.SimulatorAPI = {
    db: {
        dbName: 'iPhoneSimulatorDB',
        storeName: 'store',
        idb: null,
        _knownGlobalWorldBookIds: new Set(),
        init: function() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, 1);
                request.onupgradeneeded = event => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
                };
                request.onsuccess = async event => {
                    this.idb = event.target.result;
                    try {
                        await this.migrateDataIfNeeded();
                        await this.refreshWorldBookDiagnosticCache();
                    } catch (error) {
                        console.error('[数据迁移/诊断] 执行失败，已保留原数据并继续启动:', error);
                    }
                    resolve();
                };
                request.onerror = event => reject(event.target.error);
            });
        },
        _getRaw: function(key, defaultValue) {
            return new Promise(resolve => {
                if (!this.idb) return resolve(defaultValue);
                const transaction = this.idb.transaction([this.storeName], 'readonly');
                const request = transaction.objectStore(this.storeName).get(key);
                request.onsuccess = () => resolve(request.result !== undefined ? request.result : defaultValue);
                request.onerror = () => resolve(defaultValue);
            });
        },
        _putRaw: function(key, value) {
            return new Promise((resolve, reject) => {
                if (!this.idb) return resolve();
                const transaction = this.idb.transaction([this.storeName], 'readwrite');
                const request = transaction.objectStore(this.storeName).put(value, key);
                request.onsuccess = () => resolve();
                request.onerror = event => reject(event.target.error);
            });
        },
        refreshWorldBookDiagnosticCache: async function() {
            const globalBooks = this.normalizeValue('global_world_books', await this._getRaw('global_world_books', []));
            const localBooks = this.normalizeValue('local_world_books', await this._getRaw('local_world_books', []));
            const mountedBooks = this.normalizeValue('chat_world_books', await this._getRaw('chat_world_books', {}));
            updateDiagnosticCache('global_world_books', globalBooks);
            updateDiagnosticCache('local_world_books', localBooks);
            updateDiagnosticCache('chat_world_books', mountedBooks);
            scheduleDiagnosticRender();
        },
        migrateDataIfNeeded: async function() {
            const storedVersion = Number(await this._getRaw('data_schema_version', 0)) || 0;
            if (storedVersion >= CURRENT_DATA_SCHEMA_VERSION) return;

            console.info(`[数据迁移] 开始从版本 ${storedVersion} 迁移到 ${CURRENT_DATA_SCHEMA_VERSION}。`);
            const rawGlobalBooks = await this._getRaw('global_world_books', []);
            const rawLocalBooks = await this._getRaw('local_world_books', []);
            const rawFriends = await this._getRaw('friends', []);
            const rawMountedBooks = await this._getRaw('chat_world_books', {});

            const globalBooks = Array.isArray(rawGlobalBooks)
                ? rawGlobalBooks.map(book => normalizeWorldBook(book, 'global')).filter(book => book?.content)
                : [];
            const localBooks = Array.isArray(rawLocalBooks)
                ? rawLocalBooks.map(book => normalizeWorldBook(book, 'local')).filter(book => book?.content)
                : [];
            const friends = Array.isArray(rawFriends) ? rawFriends.map(normalizeFriend) : [];
            const mountedBooks = normalizeMountedWorldBooks(rawMountedBooks);

            await this._putRaw('global_world_books', globalBooks);
            await this._putRaw('local_world_books', localBooks);
            await this._putRaw('friends', friends);
            await this._putRaw('chat_world_books', mountedBooks);
            await this._putRaw('data_schema_version', CURRENT_DATA_SCHEMA_VERSION);
            globalBooks.forEach(book => this._knownGlobalWorldBookIds.add(String(book.id)));

            console.info(`[数据迁移] 已完成版本 ${CURRENT_DATA_SCHEMA_VERSION}：角色 ${friends.length} 个，全局世界书 ${globalBooks.length} 本，局部世界书 ${localBooks.length} 本。`);
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
            if (key === 'friends' && Array.isArray(value)) return value.map(normalizeFriend);
            if (key === 'chat_world_books') return normalizeMountedWorldBooks(value);
            return value;
        },
        get: function(key, defaultValue) {
            return new Promise(resolve => {
                if (!this.idb) return resolve(this.normalizeValue(key, defaultValue));
                const transaction = this.idb.transaction([this.storeName], 'readonly');
                const request = transaction.objectStore(this.storeName).get(key);
                request.onsuccess = () => {
                    const rawValue = request.result !== undefined ? request.result : defaultValue;
                    const normalized = this.normalizeValue(key, rawValue);
                    updateDiagnosticCache(key, normalized);
                    resolve(normalized);
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
                        if (!this._knownGlobalWorldBookIds.has(id)) normalized.active = true;
                        this._knownGlobalWorldBookIds.add(id);
                        return normalized;
                    }).filter(book => book?.content);
                } else {
                    valueToStore = this.normalizeValue(key, value);
                }

                const transaction = this.idb.transaction([this.storeName], 'readwrite');
                const request = transaction.objectStore(this.storeName).put(valueToStore, key);
                request.onsuccess = () => {
                    updateDiagnosticCache(key, valueToStore);
                    scheduleDiagnosticRender();
                    resolve();
                };
                request.onerror = event => {
                    console.error('IndexedDB set error:', event.target.error);
                    reject(event.target.error);
                };
            });
        },
        getAllWorldBook: async function() {
            const globalBooks = await this.get('global_world_books', []);
            const localBooks = await this.get('local_world_books', []);
            return { global: globalBooks, local: localBooks };
        }
    },
    ai: {
        chat: async function(prompt) {
            const url = localStorage.getItem('api_url');
            const key = localStorage.getItem('api_key');
            const model = localStorage.getItem('api_model');
            const temp = parseFloat(localStorage.getItem('api_temp') || '0.7');

            if (!url || !key) throw new Error('请先在设置中配置API');
            const messages = typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt;
            const res = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({ model, messages, temperature: temp })
            });

            if (!res.ok) {
                let errorMsg = `HTTP ${res.status} ${res.statusText}`;
                try {
                    const errData = await res.json();
                    if (errData.error) {
                        errorMsg += ` - ${errData.error.message || JSON.stringify(errData.error)}`;
                        if (errData.error.code) errorMsg += ` (Code: ${errData.error.code})`;
                    }
                } catch (_) {}
                throw new Error(errorMsg);
            }

            const data = await res.json();
            if (data.error) {
                let errorMsg = data.error.message || JSON.stringify(data.error);
                if (data.error.code) errorMsg += ` (Code: ${data.error.code})`;
                throw new Error(errorMsg);
            }
            if (!data.choices?.[0]?.message) {
                const reason = data.promptFilterResults
                    ? '触发了输入内容审查(Prompt Filter)'
                    : data.choices?.[0]?.finish_reason
                        ? `生成中断，原因: ${data.choices[0].finish_reason}`
                        : '未知原因';
                throw new Error(`API未返回有效内容，可能触发了内容审查(风控)。详细信息请查看控制台。(${reason})`);
            }

            let replyText = data.choices[0].message.content.trim();
            if (typeof window.cleanAiResponse === 'function') replyText = window.cleanAiResponse(replyText);
            else {
                replyText = replyText
                    .replace(/<(think|thought|reasoning)[^>]*>[\s\S]*?<\/\1>/gi, '')
                    .replace(/<(think|thought|reasoning)[^>]*>[\s\S]*$/gi, '')
                    .trim();
            }
            return replyText;
        }
    }
};

window.db = window.SimulatorAPI.db;
