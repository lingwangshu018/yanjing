window.SimulatorAPI = {
    db: {
        dbName: 'iPhoneSimulatorDB',
        storeName: 'store',
        idb: null,
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
        get: function(key, defaultValue) {
            return new Promise((resolve) => {
                if (!this.idb) return resolve(defaultValue);
                const transaction = this.idb.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(key);
                request.onsuccess = () => {
                    resolve(request.result !== undefined ? request.result : defaultValue);
                };
                request.onerror = () => resolve(defaultValue);
            });
        },
        set: function(key, value) {
            return new Promise((resolve, reject) => {
                if (!this.idb) return resolve();
                const transaction = this.idb.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.put(value, key);
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
                throw new Error("请先在设置中配置API");
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
                    messages: messages,
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
                let reason = "未知原因";
                if (data.promptFilterResults) reason = "触发了输入内容审查(Prompt Filter)";
                else if (data.choices && data.choices.length > 0 && data.choices[0].finish_reason) reason = `生成中断，原因: ${data.choices[0].finish_reason}`;
                throw new Error(`API未返回有效内容，可能触发了内容审查(风控)。详细信息请查看控制台。(${reason})`);
            }

            let replyText = data.choices[0].message.content.trim();
            
            // Clean AI response
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

// 暴露为全局对象，确保 index.html 继续正常运行
window.db = window.SimulatorAPI.db;
