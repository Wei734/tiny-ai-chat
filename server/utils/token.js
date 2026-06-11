// utils\token.js
const { encode } = require('gpt-tokenizer');
const { MODEL_LIMITS } = require('../config/models');

function estimateTokens(text) {
  // 粗略估算：中文大约1个字 ≈ 1 token，英文大约 1 token ≈ 4 字符
  // 更通用：取字符数 / 2，这个假设简单有效，误差在可接受范围
  return Math.ceil(text.length / 2);
}

function estimateMessageTokens(msg) {
  // 每条消息有固定的角色标识开销（约4 tokens），再加上内容的token数
  const roleOverhead = 4;
  return roleOverhead + estimateTokens(msg.content || '');
}

/**
 * 粗略估算消息数组的 token 数
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
function countTokens(messages) {
  if (!messages || messages.length === 0) return 0;

  let totalChars = 0;
  for (const msg of messages) {
    if (msg.content && typeof msg.content === 'string') {
      totalChars += msg.content.length;
    }
    // 每条消息还有格式开销（role 等），大约 4 个 token
    totalChars += 4 * 3.5;  // 换算为字符数
  }

  // 中英文混合粗略比例：1 token ≈ 3.5 个字符
  return Math.ceil(totalChars / 3.5);
}

/**
 * 估算纯文本的 token 数（与 countTokens 口径一致：1 token ≈ 3.5 字符）
 * @param {string} text
 * @returns {number}
 */
function estimateTextTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 3.5);
}


/**
 * 根据模型上下文限制或指定预算，保留最近若干轮完整对话
 * @param {Array} messages - 完整消息数组（含 system）
 * @param {string} model - 模型标识，如 'gpt-4o' 或 'openai/gpt-4o'，用于查表
 * @param {number} [maxTokens] - 可选，手动指定历史 token 预算上限；不传则自动计算
 * @returns {Array} 截断后的消息数组
 */
function trimMessages(messages, model, maxTokens) {
  if (!messages || messages.length === 0) return [];

  // 1. 确定预算
  let budget;
  if (maxTokens !== undefined && maxTokens !== null) {
    budget = maxTokens;                // 显式传入，直接使用
  } else {
    const pureModel = model.split('/').pop();   // 去掉可能的 provider 前缀
    const contextLimit = MODEL_LIMITS[pureModel] || MODEL_LIMITS['default'];
    // 留 20% 给模型输出（可根据需要调整比例）
    budget = Math.floor(contextLimit * 0.8);
  }

  // 2. 分离 system 与对话
  const systemMsgs = messages.filter(m => m.role === 'system');
  const convMsgs = messages.filter(m => m.role !== 'system');

  // 3. 将对话按轮次分组（一轮 = user + assistant）
  const rounds = [];
  for (let i = 0; i < convMsgs.length; i++) {
    const msg = convMsgs[i];
    if (msg.role === 'user') {
      const round = { user: msg, assistant: null };
      if (i + 1 < convMsgs.length && convMsgs[i + 1].role === 'assistant') {
        round.assistant = convMsgs[i + 1];
        i++; // 跳过 assistant
      }
      rounds.push(round);
    } else {
      // 孤立的 assistant（异常情况），也单独成轮
      rounds.push({ user: null, assistant: msg });
    }
  }

  // 4. 计算 system 消息固定开销
  let systemTokens = 0;
  systemMsgs.forEach(m => { systemTokens += estimateMessageTokens(m); });
  const conversationBudget = budget - systemTokens;

  // 5. 从最新轮开始累加，保留完整轮次
  let includedRounds = [];
  let usedTokens = 0;

  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i];
    let roundTokens = 0;
    if (round.user) roundTokens += estimateMessageTokens(round.user);
    if (round.assistant) roundTokens += estimateMessageTokens(round.assistant);

    if (usedTokens + roundTokens <= conversationBudget) {
      includedRounds.unshift(round); // 保持时间顺序
      usedTokens += roundTokens;
    } else {
      break;
    }
  }

  // 6. 拼接结果
  const result = [...systemMsgs];
  for (const round of includedRounds) {
    if (round.user) result.push(round.user);
    if (round.assistant) result.push(round.assistant);
  }
  console.log(`[截断] 模型: ${model}, 预算: ${budget}, 原始消息数: ${messages.length}, 保留消息数: ${result.length}`);
  return result;
}

/**
 * 按 token 数近似截断文本（基于字符比例）
 * @param {string} text
 * @param {number} maxTokens - 最大 token 数
 * @returns {string} 截断后的文本
 */
function truncateByTokens(text, maxTokens) {
  if (maxTokens <= 0) return '';
  const maxChars = Math.floor(maxTokens * 3.5);   // 与估算系数一致
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

// 导出新增函数
module.exports = { trimMessages, countTokens, estimateTextTokens, truncateByTokens };