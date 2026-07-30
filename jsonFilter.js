export const cleanJsonFormatting = (text) => {
    if (!text || typeof text !== 'string') return text;
    
    // 检查是否包含类似 JSON 的特征
    if (!text.match(/["']\s*:\s*["'\[\{]/) && !text.includes('{"') && !text.includes('"}')) {
        return text;
    }

    let cleaned = text;

    // 1. 优先提取常见正文字段的值
    // 匹配 "text": "内容" 或 "content": "内容" 或 "social": "内容" 等
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

    // 如果成功提取到了目标字段，直接拼接这些文本作为结果
    if (extractedTexts.length > 0) {
        return extractedTexts.join('\n\n').trim();
    }

    // 2. 如果没有提取到目标字段，尝试提取所有长字符串值（可能是正文）
    // 匹配 "任意键": "长内容"
    const anyStringRegex = /"[^"]+"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi;
    let allStringValues = [];
    while ((match = anyStringRegex.exec(cleaned)) !== null) {
        let val = match[1];
        // 过滤掉看起来像配置项、短标签、URL等的值
        if (val.length > 5 && !val.match(/^[a-zA-Z0-9_]+$/) && !val.startsWith('http')) {
            try {
                allStringValues.push(JSON.parse(`"${val}"`));
            } catch (e) {
                allStringValues.push(val.replace(/\\n/g, '\n').replace(/\\"/g, '"'));
            }
        }
    }

    if (allStringValues.length > 0) {
        // 过滤掉可能是状态栏的值（通常较短）
        const longValues = allStringValues.filter(v => v.length > 10 || v.includes('，') || v.includes('。'));
        if (longValues.length > 0) {
            return longValues.join('\n\n').trim();
        }
        return allStringValues.join('\n\n').trim();
    }

    // 3. 暴力清理 JSON 格式符号
    // 移除所有的键名 "key": 
    cleaned = cleaned.replace(/"[^"]+"\s*:\s*/g, '');

    // 清理大括号、中括号
    cleaned = cleaned.replace(/[\{\}\[\]]/g, '');
    
    // 清理行首行尾的引号、逗号
    cleaned = cleaned.split('\n').map(line => {
        let l = line.trim();
        l = l.replace(/^["',]+|["',]+$/g, '');
        return l;
    }).filter(line => line.length > 0).join('\n');

    return cleaned.trim() || text;
};

// 挂载到全局 window 对象，方便在 main.js 中调用
window.cleanJsonFormatting = cleanJsonFormatting;

/**
 * 专门用于抢救聊天消息数组的函数
 * 当 JSON.parse 失败时，尝试用正则提取出转账、图片、语音等特殊格式
 * @param {string} text 损坏的 JSON 字符串
 * @returns {Array|null} 抢救出的消息数组，如果失败则返回 null
 */
export function salvageChatMessages(text) {
    if (!text) return null;
    
    let parsedMessages = [];
    // 匹配所有的 type 声明，例如 "type": "transfer" 或 'type': 'text'
    let types = [...text.matchAll(/(?:"|')?type(?:"|')?\s*:\s*(?:"|')([^"']+)(?:"|')/g)];
    
    if (types.length > 0) {
        for (let i = 0; i < types.length; i++) {
            let type = types[i][1];
            let start = types[i].index;
            let end = i + 1 < types.length ? types[i+1].index : text.length;
            let chunk = text.substring(start, end);

            if (type === 'transfer') {
                let amountMatch = chunk.match(/(?:"|')?amount(?:"|')?\s*:\s*(\d+(?:\.\d+)?)/);
                let noteMatch = chunk.match(/(?:"|')?note(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                if (amountMatch) {
                    parsedMessages.push({
                        type: 'transfer',
                        amount: parseFloat(amountMatch[1]),
                        note: noteMatch ? noteMatch[1] : '转账'
                    });
                }
            } else if (type === 'image') {
                let urlMatch = chunk.match(/(?:"|')?url(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                if (urlMatch) {
                    parsedMessages.push({
                        type: 'image',
                        url: urlMatch[1]
                    });
                }
            } else if (type === 'voice') {
                let contentMatch = chunk.match(/(?:"|')?content(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                let durationMatch = chunk.match(/(?:"|')?duration(?:"|')?\s*:\s*(\d+)/);
                if (contentMatch) {
                    parsedMessages.push({
                        type: 'voice',
                        content: contentMatch[1],
                        duration: durationMatch ? parseInt(durationMatch[1]) : Math.ceil(contentMatch[1].length / 4)
                    });
                }
            } else if (type === 'text') {
                let contentMatch = chunk.match(/(?:"|')?content(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                if (contentMatch) {
                    parsedMessages.push({
                        type: 'text',
                        content: contentMatch[1]
                    });
                }
            } else if (type === 'quote_reply') {
                let textMatch = chunk.match(/(?:"|')?text(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                let quoteContentMatch = chunk.match(/(?:"|')?content(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                let quoteSenderMatch = chunk.match(/(?:"|')?senderName(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                
                if (textMatch) {
                    let msgObj = {
                        type: 'quote_reply',
                        text: textMatch[1]
                    };
                    if (quoteContentMatch) {
                        msgObj.quote = {
                            content: quoteContentMatch[1],
                            senderName: quoteSenderMatch ? quoteSenderMatch[1] : ''
                        };
                    }
                    parsedMessages.push(msgObj);
                }
            } else if (type === 'emoticon') {
                let urlMatch = chunk.match(/(?:"|')?url(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                let meaningMatch = chunk.match(/(?:"|')?meaning(?:"|')?\s*:\s*(?:"|')([^"']*)/);
                if (urlMatch) {
                    parsedMessages.push({
                        type: 'emoticon',
                        url: urlMatch[1],
                        meaning: meaningMatch ? meaningMatch[1] : '表情'
                    });
                }
            }
        }
    }

    // 如果提取了部分消息结构，或者没有任何结构但能清理出纯文本，都返回
    if (parsedMessages.length > 0) {
        return parsedMessages;
    }

    // 如果没有提取到任何结构化消息，降级为纯文本
    let cleanText = cleanJsonFormatting(text);
    if (cleanText) {
        return [{ type: 'text', content: cleanText, isSalvaged: true }];
    }

    return null;
}

window.salvageChatMessages = salvageChatMessages;
