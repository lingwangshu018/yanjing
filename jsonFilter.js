export const cleanJsonFormatting = (text) => {
    if (!text || typeof text !== 'string') return text;
    
    // 检查是否包含类似 JSON 的特征
    if (!text.match(/["']\s*:\s*["'\[\{]/) && !text.includes('{"') && !text.includes('"}')) {
        return text;
    }

    let cleaned = text;

    // 1. 优先提取常见正文字段的值
    const targetKeys = ['text', 'content', 'social', 'new_semantic', 'new_episodic', 'group_event', 'message', 'reply'];
    const keysPattern = targetKeys.join('|');
    const textRegex = new RegExp(`"(?:${keysPattern})"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'gi');
    
    let extractedTexts = [];
    let match;
    while ((match = textRegex.exec(cleaned)) !== null) {
        try {
            extractedTexts.push(JSON.parse(`"${match[1]}"`));
        } catch (e) {
            extractedTexts.push(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        }
    }

    if (extractedTexts.length > 0) {
        return extractedTexts.join('\n\n').trim();
    }

    // 2. 如果没有提取到目标字段，尝试提取所有长字符串值（可能是正文）
    const anyStringRegex = /"[^"]+"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi;
    let allStringValues = [];
    while ((match = anyStringRegex.exec(cleaned)) !== null) {
        let val = match[1];
        if (val.length > 5 && !val.match(/^[a-zA-Z0-9_]+$/) && !val.startsWith('http')) {
            try {
                allStringValues.push(JSON.parse(`"${val}"`));
            } catch (e) {
                allStringValues.push(val.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
            }
        }
    }

    if (allStringValues.length > 0) {
        const longValues = allStringValues.filter(v => v.length > 10 || v.includes('，') || v.includes('。'));
        if (longValues.length > 0) {
            return longValues.join('\n\n').trim();
        }
        return allStringValues.join('\n\n').trim();
    }

    // 3. 最后降级清理 JSON 格式符号
    cleaned = cleaned.replace(/"[^"]+"\s*:\s*/g, '');
    cleaned = cleaned.replace(/[\{\}\[\]]/g, '');
    cleaned = cleaned.split('\n').map(line => {
        let l = line.trim();
        l = l.replace(/^["',]+|["',]+$/g, '');
        return l;
    }).filter(line => line.length > 0).join('\n');

    return cleaned.trim() || text;
};

window.cleanJsonFormatting = cleanJsonFormatting;

const readStringField = (chunk, names) => {
    const pattern = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const match = chunk.match(new RegExp(`(?:"|')?(?:${pattern})(?:"|')?\\s*:\\s*(?:"|')([^"']*)(?:"|')`, 'i'));
    return match ? match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
};

const readNumberField = (chunk, names) => {
    const pattern = names.join('|');
    const match = chunk.match(new RegExp(`(?:"|')?(?:${pattern})(?:"|')?\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'));
    return match ? Number(match[1]) : null;
};

const readBooleanField = (chunk, names) => {
    const pattern = names.join('|');
    const match = chunk.match(new RegExp(`(?:"|')?(?:${pattern})(?:"|')?\\s*:\\s*(true|false)`, 'i'));
    return match ? match[1].toLowerCase() === 'true' : null;
};

/**
 * 当 JSON.parse 失败时，尽可能保留原始消息类型与字段。
 * 不再把转账、礼物、日程、HTML 卡片等特殊消息静默吞掉。
 */
export function salvageChatMessages(text) {
    if (!text || typeof text !== 'string') return null;
    
    const parsedMessages = [];
    const types = [...text.matchAll(/(?:"|')?type(?:"|')?\s*:\s*(?:"|')([^"']+)(?:"|')/g)];
    
    for (let i = 0; i < types.length; i++) {
        const type = types[i][1];
        const start = types[i].index;
        const end = i + 1 < types.length ? types[i + 1].index : text.length;
        const chunk = text.substring(start, end);
        const senderName = readStringField(chunk, ['senderName']);
        const translation = readStringField(chunk, ['translation']);
        const common = {};
        if (senderName) common.senderName = senderName;
        if (translation) common.translation = translation;

        if (type === 'text') {
            const value = readStringField(chunk, ['text', 'content']);
            if (value) parsedMessages.push({ type: 'text', text: value, content: value, ...common });
            continue;
        }

        if (type === 'quote_reply') {
            const value = readStringField(chunk, ['text', 'content']);
            const quoteContent = readStringField(chunk, ['quoteContent', 'content']);
            const quoteSender = readStringField(chunk, ['quoteSenderName', 'senderName']);
            if (value) {
                const message = { type: 'quote_reply', text: value, content: value, ...common };
                if (quoteContent) message.quote = { content: quoteContent, senderName: quoteSender || '' };
                parsedMessages.push(message);
            }
            continue;
        }

        if (type === 'image') {
            const value = readStringField(chunk, ['url', 'description', 'text', 'content']);
            if (value) parsedMessages.push({ type: 'image', url: value, description: value, text: value, ...common });
            continue;
        }

        if (type === 'voice') {
            const value = readStringField(chunk, ['text', 'content']);
            const duration = readNumberField(chunk, ['duration']);
            if (value) parsedMessages.push({
                type: 'voice',
                text: value,
                content: value,
                duration: duration ?? Math.max(1, Math.ceil(value.length / 4)),
                ...common
            });
            continue;
        }

        if (type === 'emoticon') {
            const url = readStringField(chunk, ['url', 'text']);
            const meaning = readStringField(chunk, ['meaning']) || '表情';
            if (url) parsedMessages.push({ type: 'emoticon', url, text: url, meaning, ...common });
            continue;
        }

        if (type === 'html') {
            const htmlContent = readStringField(chunk, ['htmlContent', 'html', 'content']);
            if (htmlContent) parsedMessages.push({ type: 'html', htmlContent, text: htmlContent, ...common });
            continue;
        }

        if (type === 'transfer' || type === 'group_transfer') {
            const amount = readNumberField(chunk, ['amount', 'price']);
            const note = readStringField(chunk, ['note', 'text']) || '转账';
            if (amount !== null) parsedMessages.push({ type, amount, note, ...common });
            continue;
        }

        if (['market_buy', 'market_pay', 'market_share'].includes(type)) {
            const name = readStringField(chunk, ['name', 'title']) || '未命名商品';
            const price = readNumberField(chunk, ['price', 'amount']);
            const itemType = readStringField(chunk, ['itemType']) || 'gift';
            parsedMessages.push({ type, name, price: price ?? 0, itemType, ...common });
            continue;
        }

        if (['gift_receive', 'pay_for_another', 'transfer_receive', 'family_card_receive'].includes(type)) {
            const action = readStringField(chunk, ['action']) || 'receive';
            const name = readStringField(chunk, ['name']);
            parsedMessages.push({ type, action, ...(name ? { name } : {}), ...common });
            continue;
        }

        if (type === 'schedule') {
            const title = readStringField(chunk, ['title', 'name']) || '未命名日程';
            const startTime = readStringField(chunk, ['startTime', 'start']);
            const endTime = readStringField(chunk, ['endTime', 'end']);
            const mode = readStringField(chunk, ['mode']);
            const assignee = readStringField(chunk, ['assignee']);
            parsedMessages.push({ type, title, startTime, endTime, mode, assignee, ...common });
            continue;
        }

        if (['poke', 'call', 'friend_request', 'change_avatar', 'recall_msg', 'hangup_call', 'romance_accept', 'romance_reject', 'block'].includes(type)) {
            const target = readStringField(chunk, ['target']);
            const suffix = readStringField(chunk, ['suffix']);
            const callType = readStringField(chunk, ['callType']);
            const value = readStringField(chunk, ['text', 'content', 'url']);
            parsedMessages.push({
                type,
                ...(target ? { target } : {}),
                ...(suffix ? { suffix } : {}),
                ...(callType ? { callType } : {}),
                ...(value ? { text: value } : {}),
                ...common
            });
            continue;
        }

        // 未知类型也尽量保留，避免未来新增协议再次被旧解析器吞掉。
        const value = readStringField(chunk, ['text', 'content', 'description', 'url']);
        const action = readStringField(chunk, ['action']);
        const enabled = readBooleanField(chunk, ['enabled']);
        parsedMessages.push({
            type,
            ...(value ? { text: value, content: value } : {}),
            ...(action ? { action } : {}),
            ...(enabled !== null ? { enabled } : {}),
            ...common
        });
    }

    if (parsedMessages.length > 0) return parsedMessages;

    const cleanText = cleanJsonFormatting(text);
    if (cleanText) {
        return [{ type: 'text', text: cleanText, content: cleanText, isSalvaged: true }];
    }

    return null;
}

window.salvageChatMessages = salvageChatMessages;

const BACKUP_FORMAT = 'jx-backup';
const BACKUP_VERSION = 1;
const BLOCKED_BACKUP_KEYS = new Set(['api_key']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const cloneBackupValue = value => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
};

const getBackupDb = () => {
    const db = window.SimulatorAPI?.db || window.db;
    if (!db?.idb || !db.storeName) {
        throw new Error('数据库尚未初始化，请等待页面加载完成后重试');
    }
    return db;
};

const normalizeBackupEnvelope = input => {
    let parsed = input;
    if (typeof input === 'string') {
        try {
            parsed = JSON.parse(input);
        } catch (_) {
            throw new Error('备份文件不是有效 JSON');
        }
    }

    if (!isPlainObject(parsed)) throw new Error('备份根节点必须是对象');

    if (parsed.format === BACKUP_FORMAT) {
        if (!Number.isInteger(parsed.version) || parsed.version < 1) {
            throw new Error('备份版本号无效');
        }
        if (!isPlainObject(parsed.data)) throw new Error('备份缺少有效 data 对象');
        return parsed;
    }

    // 兼容旧版：允许直接使用键值对象作为备份数据。
    return {
        format: BACKUP_FORMAT,
        version: 0,
        createdAt: null,
        data: parsed,
        legacy: true
    };
};

export const validateJxBackup = input => {
    const envelope = normalizeBackupEnvelope(input);
    const entries = Object.entries(envelope.data);
    if (entries.length === 0) throw new Error('备份中没有可导入的数据');
    if (entries.length > 5000) throw new Error('备份键数量异常，已拒绝导入');

    const errors = [];
    const warnings = [];
    const safeEntries = [];
    let estimatedBytes = 0;

    for (const [rawKey, value] of entries) {
        const key = String(rawKey || '').trim();
        if (!key) {
            errors.push('发现空键名');
            continue;
        }
        if (key.length > 200) {
            errors.push(`键名过长：${key.slice(0, 40)}…`);
            continue;
        }
        if (BLOCKED_BACKUP_KEYS.has(key)) {
            warnings.push(`已跳过敏感字段：${key}`);
            continue;
        }

        let cloned;
        try {
            cloned = cloneBackupValue(value);
            estimatedBytes += JSON.stringify(cloned)?.length || 0;
        } catch (_) {
            errors.push(`字段无法序列化：${key}`);
            continue;
        }

        safeEntries.push([key, cloned]);
    }

    if (estimatedBytes > 100 * 1024 * 1024) {
        errors.push('备份体积超过 100 MB，已拒绝导入');
    } else if (estimatedBytes > 25 * 1024 * 1024) {
        warnings.push('备份体积较大，导入可能需要一些时间');
    }

    if (safeEntries.length === 0) errors.push('没有可安全导入的字段');

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        entries: safeEntries,
        format: envelope.format,
        version: envelope.version,
        legacy: Boolean(envelope.legacy),
        estimatedBytes
    };
};

export const exportJxBackup = async () => {
    const db = getBackupDb();
    const data = await new Promise((resolve, reject) => {
        const transaction = db.idb.transaction([db.storeName], 'readonly');
        const store = transaction.objectStore(db.storeName);
        const keyRequest = store.getAllKeys();
        const valueRequest = store.getAll();
        transaction.oncomplete = () => {
            const result = {};
            keyRequest.result.forEach((key, index) => {
                const normalizedKey = String(key);
                if (!BLOCKED_BACKUP_KEYS.has(normalizedKey)) {
                    result[normalizedKey] = valueRequest.result[index];
                }
            });
            resolve(result);
        };
        transaction.onerror = () => reject(transaction.error || new Error('读取备份数据失败'));
        transaction.onabort = () => reject(transaction.error || new Error('备份事务已中止'));
    });

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        schemaVersion: Number(data.data_schema_version || 0),
        data
    };
};

export const importJxBackup = async (input, options = {}) => {
    const validation = validateJxBackup(input);
    if (!validation.valid) throw new Error(`备份校验失败：${validation.errors.join('；')}`);
    if (options.dryRun) return { ...validation, imported: 0, dryRun: true };

    const db = getBackupDb();
    const snapshot = options.createSnapshot === false ? null : await exportJxBackup();

    try {
        await new Promise((resolve, reject) => {
            const transaction = db.idb.transaction([db.storeName], 'readwrite');
            const store = transaction.objectStore(db.storeName);

            if (options.replace === true) store.clear();
            validation.entries.forEach(([key, value]) => store.put(value, key));

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('导入事务失败'));
            transaction.onabort = () => reject(transaction.error || new Error('导入事务已回滚'));
        });
    } catch (error) {
        // IndexedDB 事务本身具备原子性；这里返回快照，方便界面提供下载或人工恢复。
        error.backupSnapshot = snapshot;
        throw error;
    }

    if (typeof db.refreshWorldBookDiagnosticCache === 'function') {
        await db.refreshWorldBookDiagnosticCache().catch(() => {});
    }

    return {
        imported: validation.entries.length,
        warnings: validation.warnings,
        legacy: validation.legacy,
        snapshot
    };
};

window.JXBackupGuard = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    validate: validateJxBackup,
    export: exportJxBackup,
    import: importJxBackup
};