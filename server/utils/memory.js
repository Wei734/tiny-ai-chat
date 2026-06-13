// \server\utils\memory.js
const { countTokens } = require('./token');
const { embed } = require('./embeddings');      // <-- 必须有
const { getVector } = require('./vectorStore'); // <-- 必须有

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
  const MAX_RECENT_ROUNDS = 50;        // 安全上限大幅提高，实际由 token 预算控制
  const RECENT_BUDGET_RATIO = 0.6;     // 最近部分最多占用 60%

  let recentRounds = [];
  let recentTokens = 0;

  // 1. 硬保底：最少最近 2 轮
  for (let i = rounds.length - 1; i >= 0 && recentRounds.length < MIN_RECENT_ROUNDS; i--) {
    const roundTokens = countTokens(rounds[i]);
    recentRounds.unshift(rounds[i]);
    recentTokens += roundTokens;
  }

  // 2. 弹性扩展：在 60% 预算内，尽可能多地向前添加轮次
  const maxRecentBudget = totalBudget * RECENT_BUDGET_RATIO;
  for (let i = rounds.length - recentRounds.length - 1; i >= 0 && recentRounds.length < MAX_RECENT_ROUNDS; i--) {
    const roundTokens = countTokens(rounds[i]);
    if (recentTokens + roundTokens <= maxRecentBudget) {
      recentRounds.unshift(rounds[i]);
      recentTokens += roundTokens;
    } else {
      // 预算不够装下下一整轮，停止扩展
      break;
    }
  }

  const recentMessages = recentRounds.flat();
  const memoryBudget = Math.max(0, totalBudget - recentTokens);
  return { recentMessages, memoryBudget };
}

// ---------- 新增：余弦相似度 ----------
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * 从旧消息池中检索与查询相关的记忆（向量语义版）
 * @param {string} query - 用户查询文本
 * @param {Array} oldMessages - 已排除最近轮次的旧消息数组
 * @param {number} maxTokens - 分配给记忆的最大 token 预算
 * @returns {Promise<Array>} 按时间升序排列的相关记忆消息
 */
async function retrieveMemories(query, oldMessages, maxTokens) {
  if (!oldMessages || oldMessages.length === 0) return [];

  // 1. 生成查询向量
  const queryVector = await embed(query);

  // 2. 为每条消息打分，过滤不相关
  const scored = [];
  for (const msg of oldMessages) {
    if (!msg.id) continue;
    const vec = getVector(msg.id);
    if (!vec) continue;
    const score = cosineSimilarity(queryVector, vec);
    if (score < 0.4) continue;
    scored.push({ msg, score });
  }

  // 3. 按时间降序排列（最新的在前）
  // 假设 oldMessages 本身按时间升序，索引越大越新
  scored.sort((a, b) => oldMessages.indexOf(b.msg) - oldMessages.indexOf(a.msg));

  // 4. 按 token 预算截取（从最新开始向前拿）
  const selected = [];
  let usedTokens = 0;
  for (const item of scored) {
    const msgTokens = countTokens([item.msg]);
    if (usedTokens + msgTokens > maxTokens) break;
    selected.push(item.msg);
    usedTokens += msgTokens;
  }

  // 5. 恢复为时间升序，便于模型按时间线阅读
  selected.sort((a, b) => oldMessages.indexOf(a) - oldMessages.indexOf(b));

  return selected;
}

module.exports = { splitIntoRounds, retrieveMemories, dynamicAllocation };