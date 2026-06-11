// server\utils\contextBuilder.js
const { cleanMessagesForAPI } = require('./helpers')
const { retrieveMemories, dynamicAllocation } = require('./memory');
const { countTokens } = require('./token');
const { detectTrigger } = require('../../server/triggerDetector')
const { MODEL_LIMITS } = require('../config/models');

async function buildRequestData(provider, model, messages, systemPrompt) {
  const MAX_WINDOW = MODEL_LIMITS[model] || MODEL_LIMITS.default;
  const MEMORY_THRESHOLD = MAX_WINDOW * 0.5;    // 超过 50% 窗口才启用记忆
  const RESERVED_OUTPUT = 4000;                 // 留给模型输出的 token

  // 计算总 token（包含 system prompt）
  const systemTokens = countTokens([{ role: 'system', content: systemPrompt }]);
  const historyTokens = countTokens(messages);
  const totalTokens = systemTokens + historyTokens;

  // ---------- 分支 1：历史消息小于 50% 上下文窗口 短对话 → 原逻辑 ----------
  if (totalTokens <= MEMORY_THRESHOLD) {
    console.log('短对话分支');  // 修复4

    const withSystem = [{ role: 'system', content: systemPrompt }, ...messages];
    if (provider.type === 'anthropic') {
      // Claude: system 必须放在顶层，不能出现在 messages 中
      return {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: cleanMessagesForAPI(withSystem.filter(m => m.role !== 'system')),
        memoryBudget: 0,
        stream: true,
      };
    }
    // OpenAI 兼容（ChatGPT / Kimi / DeepSeek）
    return {
      model,
      messages: cleanMessagesForAPI(withSystem),   // system 作为第一条 message 直接保留
      memoryBudget: 0,
      stream: true,
    };
  }

  // ---------- 分支 2：长对话 → 启用记忆模式 ----------
  console.log('长对话分支');  // 修复4

  // 1. 找到最后一条用户消息
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const query = lastUserMsg ? lastUserMsg.content : '';

  // 2. 动态分配预算
  // 这些 token 会分配给两块：最近连续对话，以及检索出的早期记忆。
  const totalBudget = MAX_WINDOW - systemTokens - RESERVED_OUTPUT - 200; 
  const { recentMessages, memoryBudget } = dynamicAllocation(messages, totalBudget);

  // ========== 新增：触发判定 ==========
  // 准备旧消息池（不在 recentMessages 中的消息）
  const recentMsgSet = new Set(recentMessages);
  const allMessages = messages; // 这是完整的原始历史
  const oldMessages = allMessages.filter(m => !recentMsgSet.has(m));

  const triggerType = detectTrigger(query, oldMessages);
  console.log(`[触发判定] 提问片段: "${query.substring(0, 30)}..." → 类型: ${triggerType}`);
  // =================================

  // 3. 从早期历史中检索记忆（排除 recentMessages 对应的消息）
  let memories = [];
  if (triggerType === 'explicit' || triggerType === 'implicit_confirmed') {
    memories = cleanMessagesForAPI(await retrieveMemories(query, oldMessages, memoryBudget));
  } else {
    console.log('[触发判定] 无触发，跳过检索');
  }

  // 4. 组装最终消息列表
  let finalSystemPrompt = systemPrompt;
  if (memories.length > 0) {
    // 把记忆格式化成易读的文本块
    const memoryText = memories.map((m, i) => {
      const timeLabel = m.timestamp ? new Date(m.timestamp).toLocaleString() : '未知时间';
      const speaker = m.role === 'user' ? '用户' : '助手';
      return `[${timeLabel}] ${speaker}：${m.content}`;
    }).join('\n');

    // 追加到 system prompt，并用明确的边界标记
    finalSystemPrompt += `\n\n【以下是从本会话早期历史中检索到的记忆片段，与当前最新对话之间存在未展示的中间消息，仅供参考】\n${memoryText}\n【记忆片段结束】`;
  }

  // ========== 新增：注入位置元信息 ==========
  // 计算全量历史中用户消息的总数
  const allUserMessages = messages.filter(m => m.role === 'user');
  const totalUserCount = allUserMessages.length;

  // 找到 recentMessages 中第一条用户消息，并确定它在全量用户消息中的序号（从1开始）
  const firstUserInRecent = recentMessages.find(m => m.role === 'user');
  if (firstUserInRecent && totalUserCount > 0) {
    const firstUserIndex = allUserMessages.indexOf(firstUserInRecent);
    if (firstUserIndex !== -1) {
      const startUserNumber = firstUserIndex + 1; // 用户习惯从 1 开始计数
      // 只有当确实发生了截断时才告知（即开始序号 > 1）
      if (startUserNumber > 1) {
        const positionHint = `\n\n【系统元信息】你当前可见的对话仅是用户真实历史的切片。可见的第一条用户消息是该用户的第 ${startUserNumber} 条消息，总计已有 ${totalUserCount} 条用户消息。更早的内容已被截断，不可见。`;
        finalSystemPrompt += positionHint;
      }
    }
  }
  // ===========================================


  // 5. 构造唯一的 system 消息
  const systemMsg = { role: 'system', content: finalSystemPrompt };

  // 6. 组装最终消息列表：只有 system + recentMessages（全是 user/assistant）
  const finalMessages = [
    systemMsg,
    ...recentMessages
  ];

  if (provider.type === 'anthropic') {
    // Claude: system 必须放在顶层，不能出现在 messages 中
    return {
      model,
      max_tokens: 4096,
      system: finalSystemPrompt,
      messages: cleanMessagesForAPI(recentMessages),
      memoryBudget,
      stream: true,
    };
  }

  // OpenAI 兼容（ChatGPT / Kimi / DeepSeek）
  return {
    model,
    messages: cleanMessagesForAPI(finalMessages),   // system 作为第一条 message 直接保留
    memoryBudget,
    stream: true,
  };
}

module.exports = { buildRequestData };