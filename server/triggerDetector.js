// 显式回溯信号词列表
const explicitSignals = [
  '上次', '之前', '记得吗', '说过', '聊过',
  '告诉我之前', '我们讨论过', '回忆一下', '你还记得',
  '以前', '上回', '那次', '我说过', '我问过',
  '你之前说', '再讲一遍', '重复一下', '复述'
];

// 常见中文停用词（可根据需要扩充）
const stopWords = new Set([
  '的', '了', '吗', '啊', '呢', '吧', '是', '在',
  '我', '你', '他', '她', '它', '我们', '你们', '他们',
  '这', '那', '什么', '怎么', '为什么', '哪',
  '和', '与', '但', '或者', '因为', '所以', '如果',
  '不', '没', '很', '也', '就', '都', '要', '会',
  '一个', '这个', '那个', '可以', '还是', '只是',
  '有', '说', '想', '知道', '觉得'
]);

/**
 * 简单分词：按空格和常见标点切分
 */
function tokenize(text) {
  // 按非中文字符、空格、标点分割，保留中文词和英文单词
  return text.split(/[\s,，。！？、；：“”"']+/).filter(Boolean);
}

/**
 * 提取关键词：分词 + 去停用词 + 去重
 */
function extractKeywords(text) {
  const tokens = tokenize(text);
  return [...new Set(tokens.filter(token => !stopWords.has(token) && token.length > 1))];
}

/**
 * 检测触发类型
 * @param {string} userMessage 当前用户提问文本
 * @param {Array} oldMessages 旧消息数组，每条消息包含 role 和 content
 * @returns {string} 触发类型：'explicit' | 'implicit_confirmed' | 'none'
 */
function detectTrigger(userMessage, oldMessages = []) {
  const lowerMsg = userMessage.toLowerCase();

  // 1. 检查显式回溯信号
  if (explicitSignals.some(signal => lowerMsg.includes(signal))) {
    return 'explicit';
  }

  // 2. 提取关键词并尝试内容匹配（隐式触发）
  const keywords = extractKeywords(userMessage);
  if (keywords.length === 0) {
    return 'none';
  }

  // 3. 在旧消息池中搜索关键词
  const hit = oldMessages.some(msg =>
    keywords.some(kw => msg.content && msg.content.includes(kw))
  );

  return hit ? 'implicit_confirmed' : 'none';
}

module.exports = { detectTrigger };