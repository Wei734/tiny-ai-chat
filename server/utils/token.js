// utils\token.js

const { encode } = require('gpt-tokenizer');
const { MODEL_LIMITS } = require('../config/models');

// ✅ 修复后的截断函数
function trimMessages(messages, modelName, maxOutputTokens = 4096) {
  const limit = MODEL_LIMITS[modelName] || MODEL_LIMITS['default'];
  const maxInputTokens = limit - maxOutputTokens;

  const countTokens = (str) => {
    if (!str) return 0;
    try {
      return encode(str).length;
    } catch (e) {
      // gpt-tokenizer 对某些特殊字符可能报错，用粗略估算兜底
      return Math.ceil(str.length * 1.5);
    }
  };

  // 分离 system 消息和对话消息
  const systemMsg = messages.find(m => m.role === 'system');
  const chatHistory = messages.filter(m => m.role !== 'system');

  let currentTokens = 0;

  // system prompt 的 token 先算进去
  if (systemMsg) {
    currentTokens += countTokens(systemMsg.content);
  }

  // ✅ 从最新消息往前取，一旦放不下就 break（不是 continue）
  const trimmed = [];
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    const msgTokens = countTokens(msg.content);

    if (currentTokens + msgTokens > maxInputTokens) {
      console.log(`[截断] 在第 ${i} 条消息处截断，已用 ${currentTokens} tokens，这条需要 ${msgTokens}`);
      break;  // ✅ 直接停止，丢弃所有更早的消息
    }

    trimmed.unshift(msg);
    currentTokens += msgTokens;
  }

  // ✅ 确保至少保留最后一条用户消息（避免空请求）
  if (trimmed.length === 0 && chatHistory.length > 0) {
    const lastMsg = chatHistory[chatHistory.length - 1];
    // 如果单条消息就超限，截断消息内容
    const maxChars = Math.floor(maxInputTokens / 1.5);
    trimmed.push({
      ...lastMsg,
      content: lastMsg.content.substring(0, maxChars)
    });
    console.log(`[截断] 单条消息过长，截断到 ${maxChars} 字符`);
  }

  // 把 system 加回开头
  if (systemMsg) {
    trimmed.unshift(systemMsg);
  }

  console.log(`[Token统计] 模型: ${modelName}, 上限: ${limit}, 输入token: ${currentTokens}, 消息数: ${messages.length} → ${trimmed.length}`);
  return trimmed;
};

function countTokens(str) {
  if (!str) return 0;
    try {
      return encode(str).length;
    } catch (e) {
      // gpt-tokenizer 对某些特殊字符可能报错，用粗略估算兜底
      return Math.ceil(str.length * 1.5);
    }
};

module.exports = { trimMessages };