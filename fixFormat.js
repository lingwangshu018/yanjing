export function parseAndFixJsonMessage(msg, currentChatFriendId, chatPersonas, personas, myProfile) {
    try {
        let trulyFinalMsgs = [];
        let statusData = { "心情": "", "状态": "", "心声": "", "个签": "" };
        
        let cleanText = msg.text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

        // 仅转换大括号和中括号，避免替换正文中的全角标点导致内容变英文标点
        let tempStr = cleanText.replace(/｛/g, '{').replace(/｝/g, '}').replace(/【/g, '[').replace(/】/g, ']');

        // 尝试标准 JSON 解析
        let parsedJson = null;
        try {
            parsedJson = JSON.parse(tempStr);
        } catch (e) {
            const jsonMatch = tempStr.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsedJson = JSON.parse(jsonMatch[0]);
                } catch (e2) {}
            }
        }

        if (parsedJson) {
            if (parsedJson.status) {
                statusData["心情"] = parsedJson.status["心情"] || parsedJson.status.mood || parsedJson.status.emotion || "";
                statusData["状态"] = parsedJson.status["状态"] || parsedJson.status.state || parsedJson.status.status || "";
                statusData["心声"] = parsedJson.status["心声"] || parsedJson.status.thoughts || parsedJson.status.inner_thoughts || "";
                statusData["个签"] = parsedJson.status["个签"] || parsedJson.status.signature || parsedJson.status.bio || "";
            }
            if (parsedJson.messages && Array.isArray(parsedJson.messages)) {
                parsedJson.messages.forEach(m => {
                    if (m.type === 'poke' || m.type === 'system' || m.type === 'call' || m.type === 'friend_request' || m.type === 'change_avatar') {
                        return; 
                    }
                    let quote = null;
                    if (m.quote) {
                        quote = {
                            senderName: m.quote.senderName || '',
                            content: m.quote.content || m.quote.text || ''
                        };
                    }
                    if (m.type === 'emoticon') {
                        trulyFinalMsgs.push({ type: 'emoticon', text: m.url || m.text || '', meaning: m.meaning || '表情', quote: quote, translation: m.translation || '', senderName: m.senderName });
                    } else if (m.type === 'image') {
                        trulyFinalMsgs.push({ type: 'image', text: m.url || m.text || '', quote: quote, translation: m.translation || '', senderName: m.senderName });
                    } else if (m.type === 'voice') {
                        trulyFinalMsgs.push({ type: 'voice', text: m.content || m.text || '', duration: m.duration, quote: quote, translation: m.translation || '', senderName: m.senderName });
                    } else if (m.type === 'hangup_call') {
                        trulyFinalMsgs.push({ type: 'hangup_call', text: m.text || '挂断通话', quote: quote, translation: m.translation || '', senderName: m.senderName });
                    } else if (m.type === 'text' || m.type === 'quote_reply') {
                        trulyFinalMsgs.push({ type: 'text', text: m.text || '', quote: quote, translation: m.translation || '', senderName: m.senderName });
                    } else if (m.text) {
                        trulyFinalMsgs.push({ type: 'text', text: m.text, quote: quote, translation: m.translation || '', senderName: m.senderName });
                    }
                });
            }
        }

        // 如果没有成功解析，则退回到正则提取
        if (trulyFinalMsgs.length === 0) {
            // 1. 提取 status
            const extractStatusField = (fieldNames) => {
            for (let name of fieldNames) {
                const regex = new RegExp(`["']?${name}["']?\\s*[:：]\\s*(?:(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1|([^,\\n\\}\\]\\|｜，]+))`, 'i');
                const match = tempStr.match(regex);
                if (match) return (match[2] !== undefined ? match[2] : match[3]).trim();
            }
            return "";
        };
        statusData["心情"] = extractStatusField(["心情", "mood", "emotion"]);
        statusData["状态"] = extractStatusField(["状态", "state", "status"]);
        statusData["心声"] = extractStatusField(["心声", "thoughts", "inner_thoughts", "innerThoughts"]);
        statusData["个签"] = extractStatusField(["个签", "个性签名", "signature", "bio"]);

        // 抹除 time_perception，处理可能有多行或内含引号的情况
        const keysToErase = ["心情", "状态", "心声", "个签", "mood", "state", "status", "thoughts", "inner_thoughts", "innerThoughts", "个性签名", "signature", "bio", "time_perception", "_character_check", "character_check"];
        keysToErase.forEach(k => {
            tempStr = tempStr.replace(new RegExp(`["']?${k}["']?\\s*[:：]\\s*(?:(["'])(?:(?!\\1)[^\\\\]|\\\\.)*\\1|[^,\\n\\}\\]\\|｜，]+)`, 'ig'), '');
        });
        tempStr = tempStr.replace(/["']?status["']?\s*[:：]\s*\{[\s\S]*?\}/ig, '');
        tempStr = tempStr.replace(/["']?messages["']?\s*[:：]\s*\[?/ig, '');

        let tokens = [];
        const addToken = (index, length, data) => {
            tokens.push({ index, length, data });
            // 掏空已提取的内容，用空格代替，以保持索引稳定
            tempStr = tempStr.substring(0, index) + ' '.repeat(length) + tempStr.substring(index + length);
        };

        // 2. 提取 quote 块
        const quoteBlockRegex = /["']?(?:quote|reference)["']?\s*[:：]\s*\{([^}]*)\}/ig;
        let quoteMatches;
        while ((quoteMatches = quoteBlockRegex.exec(tempStr)) !== null) {
            let qContent = "";
            let qSender = "";
            const cMatch = quoteMatches[1].match(/["']?(?:content|text)["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/i);
            if (cMatch) qContent = cMatch[2];
            const sMatch = quoteMatches[1].match(/["']?(?:senderName)["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/i);
            if (sMatch) qSender = sMatch[2];
            
            if (!qContent) {
                const strMatches = [...quoteMatches[1].matchAll(/(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/g)];
                if (strMatches.length > 0) qContent = strMatches[strMatches.length - 1][2];
            }
            
            if (qContent) {
                addToken(quoteMatches.index, quoteMatches[0].length, {
                    type: 'quote_reply',
                    text: '', // 正文内容等后续 textToken 补充，这里先占个位带上 quote
                    quote: { senderName: qSender, content: qContent }
                });
            }
        }

        // 3. 提取表情包
        const emoRegex = /["']?type["']?\s*[:：]\s*["']?emoticon["']?[\s\S]*?["']?url["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1(?:[\s\S]*?["']?meaning["']?\s*[:：]\s*(["'])((?:(?!\\3)[^\\\\]|\\\\.)*)\3)?/ig;
        let emoMatches;
        while ((emoMatches = emoRegex.exec(tempStr)) !== null) {
            // Try to find senderName nearby
            const nearbyStr = tempStr.substring(Math.max(0, emoMatches.index - 50), Math.min(tempStr.length, emoMatches.index + emoMatches[0].length + 50));
            const senderMatch = nearbyStr.match(/["']?senderName["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/i);

            addToken(emoMatches.index, emoMatches[0].length, {
                type: 'emoticon',
                url: emoMatches[2],
                meaning: emoMatches[4] || '表情',
                senderName: senderMatch ? senderMatch[2] : null
            });
        }

        // 3.5 提取图片
        const imgRegex = /["']?type["']?\s*[:：]\s*["']?image["']?[\s\S]*?["']?url["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/ig;
        let imgMatches;
        while ((imgMatches = imgRegex.exec(tempStr)) !== null) {
            const nearbyStr = tempStr.substring(Math.max(0, imgMatches.index - 50), Math.min(tempStr.length, imgMatches.index + imgMatches[0].length + 50));
            const senderMatch = nearbyStr.match(/["']?senderName["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/i);

            addToken(imgMatches.index, imgMatches[0].length, {
                type: 'image',
                url: imgMatches[2],
                senderName: senderMatch ? senderMatch[2] : null
            });
        }

        // 4. 提取链接 (通常是表情包)
        const urlRegex = /["']?url["']?\s*[:：]\s*(["'])((?:http|data:image)(?:(?!\\1)[^\\\\]|\\\\.)*)\1/ig;
        let urlMatches;
        while ((urlMatches = urlRegex.exec(tempStr)) !== null) {
            const url = urlMatches[2];
            if (url.match(/\.(jpeg|jpg|gif|png|webp)/i) || url.includes('postimg.cc') || url.includes('mmexport') || url.startsWith('data:image') || url.startsWith('http')) {
                addToken(urlMatches.index, urlMatches[0].length, {
                    type: 'emoticon',
                    url: url,
                    meaning: '表情'
                });
            }
        }

        // 4.5 提取挂断通话
        const hangupRegex = /["']?type["']?\s*[:：]\s*["']?hangup_call["']?/ig;
        let hangupMatches;
        while ((hangupMatches = hangupRegex.exec(tempStr)) !== null) {
            addToken(hangupMatches.index, hangupMatches[0].length, {
                type: 'hangup_call',
                text: '挂断通话'
            });
        }

        // 5. 提取文本内容
        const textRegex = /["']?(?:text|content)["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/ig;
        let textMatches;
        while ((textMatches = textRegex.exec(tempStr)) !== null) {
            let textVal = textMatches[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            if (textVal.trim() && !textVal.includes('quote') && !textVal.includes('emoticon')) {
                const nearbyStr = tempStr.substring(Math.max(0, textMatches.index - 50), Math.min(tempStr.length, textMatches.index + textMatches[0].length + 50));
                const senderMatch = nearbyStr.match(/["']?senderName["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/i);
                addToken(textMatches.index, textMatches[0].length, { type: 'text', text: textVal, senderName: senderMatch ? senderMatch[2] : null });
            }
        }

        // 5.1 提取翻译内容
        const transRegex = /["']?translation["']?\s*[:：]\s*(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/ig;
        let transMatches;
        while ((transMatches = transRegex.exec(tempStr)) !== null) {
            let transVal = transMatches[2].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            if (transVal.trim()) {
                addToken(transMatches.index, transMatches[0].length, { type: 'translation', text: transVal });
            }
        }

        // 6. 抹除无用的 JSON 控制词及其值
        tempStr = tempStr.replace(/["']?(type|senderName|meaning|quote|reference|text|content|url|translation|target|suffix|suffix_zh)["']?\s*[:：]\s*(["'])((?:(?!\\2)[^\\\\]|\\\\.)*)\2/ig, (match) => {
            return ' '.repeat(match.length);
        });
        
        // 抹除花括号和中括号，但不要直接替换逗号导致内容截断丢失
        tempStr = tempStr.replace(/[\{\}\[\]]/g, ' ');

        // 7. 将剩余引号里的字符串或者散落文本视作补充文本
        const leftoverStrings = [...tempStr.matchAll(/(["'])((?:(?!\\1)[^\\\\]|\\\\.)*)\1/g)];
        const exclusionList = [
            'text', 'content', 'url', 'meaning', 'type', 'senderName', 'messages', 'time_perception', 
            'quote_reply', 'emoticon', 'quote', 'reference', 'status', 'translation', 'character_check', 
            '_character_check', 'target', 'suffix', 'suffix_zh', 'poke', 'action', 'itemType', 'price', 
            'name', 'amount', 'note', 'limit', 'callType', 'description', 'transfer', 'transfer_receive', 
            'family_card', 'family_card_receive', 'gift_receive', 'pay_for_another', 'recall_msg', 
            'change_avatar', 'friend_request', 'schedule', 'title', 'startTime', 'endTime', 'mode', 
            'assignee', 'result', 'score', 'comment', 'whisper', 'taskId', 'image', 'system', 'call'
        ];
        
        for (let match of leftoverStrings) {
            let val = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
            if (val && !exclusionList.includes(val)) {
                // Avoid picking up partial JSON syntax
                if (!val.match(/^[a-zA-Z_]+$/) || val.length > 15) {
                    addToken(match.index, match[0].length, { type: 'text', text: val });
                }
            }
            // 抹去已提取的字符串
            tempStr = tempStr.substring(0, match.index) + ' '.repeat(match[0].length) + tempStr.substring(match.index + match[0].length);
        }
        
        // 清洗残留的不带引号的游离文本（去除可能的残留 json 标点）
        let leftoverText = tempStr.replace(/["']/g, ' ').replace(/[,:]/g, ' ').trim();
        // 彻底抹除残留的括号和无效控制符
        leftoverText = leftoverText.replace(/[\{\}\[\]\\]/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (leftoverText && leftoverText.length > 1 && leftoverText !== 'reference') {
            // 这里如果不为空，可能是大段没有引号包围的文字
            // 以空格分割太碎，可以直接整体作为一个 text token，前提是不全是乱码控制符
            if (leftoverText.replace(/[^a-zA-Z]/g, '').length < leftoverText.length / 2) {
                tokens.push({ index: 99999, length: leftoverText.length, data: { type: 'text', text: leftoverText } });
            }
        }

        tokens.sort((a, b) => a.index - b.index);

        // 组装最终的消息
        let pendingQuote = null;
        let pendingTranslation = null;
        
        for (let i = 0; i < tokens.length; i++) {
            let item = tokens[i].data;
            if (item.type === 'quote_reply') {
                pendingQuote = item.quote;
            } else if (item.type === 'translation') {
                if (trulyFinalMsgs.length > 0 && !trulyFinalMsgs[trulyFinalMsgs.length - 1].translation) {
                    trulyFinalMsgs[trulyFinalMsgs.length - 1].translation = item.text;
                } else {
                    pendingTranslation = item.text;
                }
            } else if (item.type === 'emoticon') {
                trulyFinalMsgs.push({ type: 'emoticon', text: item.url, meaning: item.meaning, quote: pendingQuote, translation: pendingTranslation || '', senderName: item.senderName });
                pendingQuote = null;
                pendingTranslation = null;
            } else if (item.type === 'image') {
                trulyFinalMsgs.push({ type: 'image', text: item.url, quote: pendingQuote, translation: pendingTranslation || '', senderName: item.senderName });
                pendingQuote = null;
                pendingTranslation = null;
            } else if (item.type === 'hangup_call') {
                trulyFinalMsgs.push({ type: 'hangup_call', text: item.text, quote: pendingQuote, translation: pendingTranslation || '', senderName: item.senderName });
                pendingQuote = null;
                pendingTranslation = null;
            } else if (item.type === 'text') {
                if (exclusionList.includes(item.text)) continue;
                trulyFinalMsgs.push({ type: 'text', text: item.text, quote: pendingQuote, translation: pendingTranslation || '', senderName: item.senderName });
                pendingQuote = null;
                pendingTranslation = null;
            }
        }
        
        if (pendingQuote) {
            if (trulyFinalMsgs.length > 0 && !trulyFinalMsgs[trulyFinalMsgs.length - 1].quote) {
                trulyFinalMsgs[trulyFinalMsgs.length - 1].quote = pendingQuote;
            } else {
                trulyFinalMsgs.push({ type: 'text', text: '[系统提示：包含一个引用]', quote: pendingQuote, translation: '' });
            }
        }
        }

        if (trulyFinalMsgs.length === 0) {
            return { success: false, error: '未能提取到任何有效消息' };
        }

        let isMine = msg.isMine;
        let senderName = msg.senderName;
        let timeBase = msg.time || Date.now();

        const newMsgs = trulyFinalMsgs.map((item, idx) => {
            let finalQuote = null;
            if (item.quote) {
                let qSender = item.quote.senderName || '';
                if (qSender === '用户' || qSender === '我' || qSender.toLowerCase() === 'user') {
                    const pId = chatPersonas[currentChatFriendId];
                    const myPersona = personas.find(x => x.id === pId) || { name: myProfile.name, setting: '普通用户' };
                    qSender = myPersona.name;
                }
                finalQuote = {
                    senderName: qSender,
                    text: item.quote.content,
                    type: 'text'
                };
            }

            let finalType = item.type;
            let isEmoticon = false;
            if (item.type === 'emoticon') {
                finalType = 'text';
                isEmoticon = true;
            }

            return {
                text: item.text || (item.type === 'emoticon' || item.type === 'image' ? item.url : ''),
                translation: item.translation || '',
                isMine: isMine,
                type: finalType,
                isEmoticon: isEmoticon,
                extra: item.type === 'voice' ? { duration: item.duration } : null,
                quote: finalQuote,
                time: timeBase + idx,
                senderName: item.senderName || senderName,
                meaning: item.meaning || ''
            };
        });

        return { success: true, newMsgs, statusData };
    } catch (e) {
        console.error('修正格式失败:', e);
        return { success: false, error: '修复失败: ' + e.message };
    }
}
