// server\utils\contextBuilder.js
const { cleanMessagesForAPI } = require('./helpers')
const { retrieveMemories, dynamicAllocation } = require('./memory');
const { countTokens } = require('./token');
const { detectTrigger } = require('../../server/triggerDetector')
const { MODEL_LIMITS } = require('../config/models');

async function prepareLLMContext(provider, model, messages, systemPrompt) {
  const MAX_WINDOW = 10000;//MODEL_LIMITS[model] || MODEL_LIMITS.default;
  const MEMORY_THRESHOLD = MAX_WINDOW * 0.5;
  const RESERVED_OUTPUT = 4000;

  const systemTokens = countTokens([{ role: 'system', content: systemPrompt }]);
  const historyTokens = countTokens(messages);
  const totalTokens = systemTokens + historyTokens;

  // 初始化最终变量
  let finalSystemPrompt = systemPrompt;
  let recentMessages;      // 要发送给 API 的历史消息（不含 system）
  let memoryBudget = 0;

  if (totalTokens <= MEMORY_THRESHOLD) {
    // ---- 短对话：全量保留 ----
    console.log(`[短对话]`);
    recentMessages = messages;
    memoryBudget = 100;
    // 短对话系统提示词不需要追加位置信息，保持原样
  } else {
    // ---- 长对话：动态裁剪 ----
    console.log(`[长对话]`);
    const totalBudget = MAX_WINDOW - systemTokens - RESERVED_OUTPUT - 200;
    const allocation = dynamicAllocation(messages, totalBudget);
    recentMessages = allocation.recentMessages;
    memoryBudget = allocation.memoryBudget;

    // 注入位置元信息
    const allUserMessages = messages.filter(m => m.role === 'user');
    const firstUserInRecent = recentMessages.find(m => m.role === 'user');
    if (firstUserInRecent && allUserMessages.length > 0) {
      const firstUserIndex = allUserMessages.indexOf(firstUserInRecent);
      if (firstUserIndex !== -1) {
        const startUserNumber = firstUserIndex + 1;
        if (startUserNumber > 1) {
          finalSystemPrompt += `\n\n【系统元信息】你当前可见的对话仅是用户真实历史的切片。可见的第一条用户消息是该用户的第 ${startUserNumber} 条消息，总计已有 ${allUserMessages.length} 条用户消息。更早的内容已被截断，不可见。`;
        }
      }
    }
  }

  // ---- 统一组装返回 ----
  const systemMsg = { role: 'system', content: finalSystemPrompt };

  if (provider.type === 'anthropic') {
    return {
      model,
      max_tokens: 4096,
      system: finalSystemPrompt,
      messages: cleanMessagesForAPI(recentMessages),   // recentMessages 不含 system
      memoryBudget,
      stream: true,
    };
  }

  // 非 Anthropic：将 system 消息拼入 messages 数组
  return {
    model,
    messages: cleanMessagesForAPI([systemMsg, ...recentMessages]),
    memoryBudget,
    stream: true,
  };
}

module.exports = { prepareLLMContext };