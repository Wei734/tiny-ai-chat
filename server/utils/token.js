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

module.exports = { trimMessages };