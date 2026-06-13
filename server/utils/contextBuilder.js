// server\utils\contextBuilder.js
const { cleanMessagesForAPI } = require('./helpers')
const { dynamicAllocation } = require('./memory');
const { countTokens, estimateTextTokens } = require('./token');
const { MODEL_LIMITS } = require('../config/models');
const { getFactsForInjection } = require('./factsStore')

/**
 * 准备上下文数据（系统提示词、最近消息、记忆预算）。
 * 依据模型窗口大小和完整会话消息总量，得到“最近消息”。（长对话需要裁剪） 
 *
 * @param {Object} provider - 模型提供商配置对象
 * @param {string} model - 模型名称，用于窗口大小查询
 * @param {Array<{role: string, content: string}>} messages - 完整的对话消息数组（不含 system 角色）
 * @param {string} systemPrompt - 基础系统提示词，将在内部可能被扩展（如添加位置元信息）
 * @returns {Promise<Object>} 返回一个对象，包含以下字段：
 *   - messages: 最近消息（role，content，id），非 Anthropic 厂商会在最前面包含系统消息（role = system）
 *   - memoryBudget: 分配给记忆检索的 token 预算
 *   - system: 单独的系统提示词字符串(仅 Anthropic) 
 */
async function prepareLLMContext(provider, model, messages, systemPrompt, threadId) {
  const MAX_WINDOW = 10000;//MODEL_LIMITS[model] || MODEL_LIMITS.default;
  const MEMORY_THRESHOLD = MAX_WINDOW * 0.5;
  const MAX_NOTE_TOKENS = MAX_WINDOW * 0.1;
  const RESERVED_OUTPUT = 4000;

  // 初始化最终变量
  let finalSystemPrompt = systemPrompt;
  let recentMessages;      // 要发送给 API 的历史消息（不含 system）
  let memoryBudget = 0;

  // ---------- 新增：注入笔记本 ----------
  const facts = getFactsForInjection(threadId);

  if (facts.length > 0) {
    let noteSection = '\n\n【永久笔记本】\n';
    let used = estimateTextTokens(noteSection);
    const includedFacts = [];
    for (const fact of facts) {
      const line =  `- ${fact}`; 
      const lineTokens = estimateTextTokens(line);
      if (used + lineTokens > MAX_NOTE_TOKENS) break;
      includedFacts.push(line);
      used += lineTokens;
    }
    noteSection += includedFacts.join('\n');
    if (includedFacts.length < facts.length) {
      noteSection += '\n（笔记本已满，以上仅展示部分）';
    }
    finalSystemPrompt += noteSection;
  }
  const systemTokens = countTokens([{ role: 'system', content: finalSystemPrompt }]); // 笔记本和系统提示词
  const historyTokens = countTokens(messages); 
  const totalTokens = systemTokens + historyTokens; // 笔记本，系统提示词，全部对话消息

  if (totalTokens <= MEMORY_THRESHOLD) {
    // ---- 短对话：全量保留 ----
    recentMessages = messages;
    memoryBudget = 0;

    // 计算统计信息（调试用）
    const totalMsgCount = messages.length;
    const roundCount = messages.filter(m => m.role === 'user').length;

    console.log(`[短对话] 线程消息总数: ${totalMsgCount} 条（约 ${roundCount} 轮），全量保留，无截断。`);
  } else {
    // ---- 长对话：动态裁剪 ----
    const totalBudget = MAX_WINDOW - systemTokens - RESERVED_OUTPUT - 200;
    const allocation = dynamicAllocation(messages, totalBudget);
    recentMessages = allocation.recentMessages;
    memoryBudget = allocation.memoryBudget;

    // 计算统计信息（调试用）
    const totalMsgCount = messages.length;
    const roundCount = messages.filter(m => m.role === 'user').length;
    const recentMsgCount = recentMessages.length;
    const recentRoundCount = recentMessages.filter(m => m.role === 'user').length;

    console.log(
        `[长对话] 原始消息总数: ${totalMsgCount} 条（约 ${roundCount} 轮），` +
        `截断后保留: ${recentMsgCount} 条（约 ${recentRoundCount} 轮），` +
        `内存预算: ${memoryBudget} tokens`
    );

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
      system: finalSystemPrompt,
      messages: recentMessages,   // recentMessages 不含 system
      memoryBudget,
    };
  }

  // 非 Anthropic：将 system 消息拼入 messages 数组
  return {
    messages: [systemMsg, ...recentMessages],
    memoryBudget,
  };
}

module.exports = { prepareLLMContext };