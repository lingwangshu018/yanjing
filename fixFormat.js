const TEXT_TYPES = new Set(['text', 'quote_reply']);

const normalizeQuote = quote => {
    if (!quote || typeof quote !== 'object') return null;
    const content = quote.content ?? quote.text ?? '';
    if (!content) return null;
    return {
        senderName: quote.senderName || quote.sender || '',
        content: String(content)
    };
};

const normalizeStructuredMessage = raw => {
    if (!raw || typeof raw !== 'object') return null;

    const type = String(raw.type || 'text');
    const quote = normalizeQuote(raw.quote || raw.reference);
    const translation = raw.translation || '';
    const senderName = raw.senderName || '';

    const common = {
        type,
        quote,
        translation,
        senderName
    };

    if (TEXT_TYPES.has(type)) {
        const text = raw.text ?? raw.content ?? '';
        if (!text && !quote) return null;
        return { ...common, type: 'text', text: String(text) };
    }

    if (type === 'emoticon') {
        const text = raw.url ?? raw.text ?? raw.content ?? '';
        if (!text) return null;
        return {
            ...common,
            type: 'emoticon',
            text: String(text),
            meaning: raw.meaning || '表情'
        };
    }

    if (type === 'image') {
        const text = raw.url ?? raw.description ?? raw.text ?? raw.content ?? '';
        if (!text) return null;
        return { ...common, type: 'image', text: String(text) };
    }

    if (type === 'voice') {
        const text = raw.text ?? raw.content ?? '';
        if (!text) return null;
        return {
            ...common,
            type: 'voice',
            text: String(text),
            duration: Number.isFinite(Number(raw.duration)) ? Number(raw.duration) : undefined
        };
    }

    if (type === 'html') {
        const htmlContent = raw.htmlContent ?? raw.html ?? raw.content ?? raw.text ?? '';
        if (!htmlContent) return null;
        return {
            ...common,
            type: 'html',
            text: String(htmlContent),
            htmlContent: String(htmlContent),
            extra: { ...(raw.extra || {}), htmlContent: String(htmlContent) }
        };
    }

    const text = raw.text ?? raw.content ?? raw.description ?? raw.url ?? '';
    const preserved = {
        ...raw,
        ...common,
        text: text === undefined || text === null ? '' : String(text)
    };

    if (raw.extra && typeof raw.extra === 'object') {
        preserved.extra = { ...raw.extra };
    } else {
        const extra = {};
        ['amount', 'note', 'action', 'target', 'suffix', 'suffix_zh', 'callType', 'itemType', 'price', 'name', 'title', 'startTime', 'endTime', 'mode', 'assignee', 'result', 'score', 'comment', 'taskId', 'limit'].forEach(key => {
            if (raw[key] !== undefined) extra[key] = raw[key];
        });
        if (Object.keys(extra).length > 0) preserved.extra = extra;
    }

    return preserved;
};

const normalizeStatus = status => ({
    心情: status?.心情 || status?.mood || status?.emotion || '',
    状态: status?.状态 || status?.state || status?.status || '',
    心声: status?.心声 || status?.thoughts || status?.inner_thoughts || '',
    个签: status?.个签 || status?.signature || status?.bio || ''
});

const parseJsonPayload = text => {
    const cleaned = String(text || '')
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim()
        .replace(/｛/g, '{')
        .replace(/｝/g, '}')
        .replace(/【/g, '[')
        .replace(/】/g, ']');

    try {
        return JSON.parse(cleaned);
    } catch (_) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (_) {
            return null;
        }
    }
};

const toFinalMessage = (item, msg, idx, currentChatFriendId, chatPersonas, personas, myProfile) => {
    let finalQuote = null;
    if (item.quote) {
        let qSender = item.quote.senderName || '';
        if (qSender === '用户' || qSender === '我' || qSender.toLowerCase() === 'user') {
            const pId = chatPersonas[currentChatFriendId];
            const myPersona = personas.find(x => x.id === pId) || { name: myProfile.name };
            qSender = myPersona.name;
        }
        finalQuote = {
            senderName: qSender,
            text: item.quote.content,
            type: 'text'
        };
    }

    const isEmoticon = item.type === 'emoticon';
    const finalType = isEmoticon ? 'text' : item.type;
    const baseExtra = item.extra && typeof item.extra === 'object' ? { ...item.extra } : null;
    const extra = item.type === 'voice'
        ? { ...(baseExtra || {}), duration: item.duration }
        : baseExtra;

    return {
        ...item,
        text: item.text || '',
        translation: item.translation || '',
        isMine: msg.isMine,
        type: finalType,
        isEmoticon,
        extra,
        quote: finalQuote,
        time: (msg.time || Date.now()) + idx,
        senderName: item.senderName || msg.senderName,
        meaning: item.meaning || ''
    };
};

export function parseAndFixJsonMessage(msg, currentChatFriendId, chatPersonas, personas, myProfile) {
    try {
        const parsed = parseJsonPayload(msg?.text);
        let statusData = normalizeStatus(parsed?.status);
        let normalizedMessages = [];

        if (parsed && Array.isArray(parsed.messages)) {
            normalizedMessages = parsed.messages
                .map(normalizeStructuredMessage)
                .filter(Boolean);
        }

        if (normalizedMessages.length === 0 && typeof window.salvageChatMessages === 'function') {
            const salvaged = window.salvageChatMessages(msg?.text || '');
            if (Array.isArray(salvaged)) {
                normalizedMessages = salvaged
                    .map(normalizeStructuredMessage)
                    .filter(Boolean);
            }
        }

        if (normalizedMessages.length === 0) {
            return { success: false, error: '未能提取到任何有效消息' };
        }

        const newMsgs = normalizedMessages.map((item, idx) =>
            toFinalMessage(item, msg, idx, currentChatFriendId, chatPersonas, personas, myProfile)
        );

        return { success: true, newMsgs, statusData };
    } catch (e) {
        console.error('修正格式失败:', e);
        return { success: false, error: '修复失败: ' + e.message };
    }
}
