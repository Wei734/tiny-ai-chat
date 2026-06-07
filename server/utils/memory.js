// \server\utils\memory.js
const { countTokens } = 
require('./token');


// 简单中英文停用词表（可自行扩充）
const STOP_WORDS = new Set([
  // 中文常见停用词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  '吗', '呢', '啊', '吧', '哦', '嗯',
  // 英文常见停用词
  'the', 'is', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'but', 'not', 'this', 'that', 'it', 'with', 'as', 'from', 'by',
  'be', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'you',
  'i', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
]);
/**
 * 将消息数组按“轮”分组
 * 一轮 = 一条 user 消息 + 后面直到下一条 user 之前的所有消息
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Array<Array<{role: string, content: string}>>}
 */
function splitIntoRounds(messages) {
  const rounds = [];
  let currentRound = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      // 遇到新的 user，保存上一轮（如果有内容）
      if (currentRound.length > 0) {
        rounds.push(currentRound);
      }
      // 开始新轮，当前 user 为第一句
      currentRound = [msg];
    } else {
      // assistant / system / tool 等：追加到当前轮
      currentRound.push(msg);
    }
  }

  // 收尾：最后一轮可能有残留
  if (currentRound.length > 0) {
    rounds.push(currentRound);
  }

  return rounds;
}

/**
 * 获取最近 n 轮的消息（打平）
 * @param {Array} messages - 原始消息数组
 * @param {number} n - 要取的轮数
 * @returns {Array} 最近 n 轮的消息列表（保持原始顺序）
 */
function takeRecentRounds(messages, n) {
  const rounds = splitIntoRounds(messages);
  const recentRounds = rounds.slice(-n);
  // 打平轮次为消息列表
  return recentRounds.flat();
}

/**
 * 从文本中提取关键词（混合中英文）
 * @param {string} text
 * @returns {string[]} 关键词数组
 */
function extractKeywords(text) {
  if (!text) return [];

  // 1. 提取中文关键词（用二元组 bigram 作为近似）
  const chineseChars = text.replace(/[^\u4e00-\u9fa5]/g, '');
  const chineseBigrams = [];
  for (let i = 0; i < chineseChars.length - 1; i++) {
    const bigram = chineseChars.substring(i, i + 2);
    if (!STOP_WORDS.has(bigram)) {
      chineseBigrams.push(bigram);
    }
  }

  // 2. 提取英文关键词（分词）
  const englishWords = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  // 3. 合并并去重
  const keywords = [...new Set([...chineseBigrams, ...englishWords])];
  return keywords;
}

/**
 * 计算 query 与 text 的关键词匹配得分
 * @param {string} query - 查询文本（如当前用户问题）
 * @param {string} text - 候选历史消息文本
 * @returns {number} 0~1 之间的得分
 */
function scoreByKeywords(query, text) {
  const queryKeywords = extractKeywords(query);
  const textKeywords = extractKeywords(text);

  if (queryKeywords.length === 0 || textKeywords.length === 0) return 0;

  // 计算交集大小
  const querySet = new Set(queryKeywords);
  const textSet = new Set(textKeywords);
  let intersection = 0;
  for (const w of querySet) {
    if (textSet.has(w)) intersection++;
  }

  // 使用 Jaccard 系数变体：交集大小 / (查询关键词数 + 文本关键词数 - 交集)
  // 避免分母过大
  const score = intersection / (querySet.size + textSet.size - intersection);
  return score;
}

/**
 * 动态分配最近轮数 + 记忆预算
 * @param {Array} messages - 全部历史消息
 * @param {number} totalBudget - 可用的总 token 预算
 * @returns {{ recentMessages: Array, memoryBudget: number }}
 */
function dynamicAllocation(messages, totalBudget) {
  const rounds = splitIntoRounds(messages);
  const MIN_RECENT_ROUNDS = 2;
  const MAX_RECENT_ROUNDS = 10;
  const RECENT_BUDGET_RATIO = 0.6;  // 最近部分最多占用 60%

  let recentRounds = [];
  let recentTokens = 0;

  // 1. 硬保底：最少最近 2 轮
  for (let i = rounds.length - 1; i >= 0 && recentRounds.length < MIN_RECENT_ROUNDS; i--) {
    const roundTokens = countTokens(rounds[i]);
    recentRounds.unshift(rounds[i]);
    recentTokens += roundTokens;
  }

  // 2. 弹性扩展：在 60% 预算内，最多再加到 10 轮
  const maxRecentBudget = totalBudget * RECENT_BUDGET_RATIO;
  for (let i = rounds.length - recentRounds.length - 1; i >= 0 && recentRounds.length < MAX_RECENT_ROUNDS; i--) {
    const roundTokens = countTokens(rounds[i]);
    if (recentTokens + roundTokens <= maxRecentBudget) {
      recentRounds.unshift(rounds[i]);
      recentTokens += roundTokens;
    } else {
      break;
    }
  }

  const recentMessages = recentRounds.flat();
  const memoryBudget = Math.max(0, totalBudget - recentTokens);
  return { recentMessages, memoryBudget };
}

/**
 * 从旧消息池中检索与查询相关的记忆
 * @param {string} query - 用户查询文本
 * @param {Array} oldMessages - 已经排除最近轮次的旧消息数组
 * @param {number} maxTokens - 分配给记忆的最大 token 预算
 * @returns {Array} 按时间升序排列的相关记忆消息
 */
function retrieveMemories(query, oldMessages, maxTokens) {
  if (!oldMessages || oldMessages.length === 0) return [];

  // 1. 打分
  const scored = oldMessages.map(msg => ({
    msg,
    score: scoreByKeywords(query, msg.content)
  }));

  // 2. 按得分降序排序
  scored.sort((a, b) => b.score - a.score);

  // 3. 按 token 预算截取（相关度太低也丢弃）
  const selected = [];
  let usedTokens = 0;
  for (const item of scored) {
    if (item.score < 0.05) break;
    const msgTokens = countTokens([item.msg]);
    if (usedTokens + msgTokens > maxTokens) break;
    selected.push(item.msg);
    usedTokens += msgTokens;
  }

  // 4. 按原始时间顺序排列（便于模型理解时间线）
  selected.sort((a, b) => oldMessages.indexOf(a) - oldMessages.indexOf(b));

  return selected;
}

module.exports = { splitIntoRounds, retrieveMemories, dynamicAllocation };