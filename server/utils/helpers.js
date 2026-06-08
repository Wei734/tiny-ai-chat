// server/utils/helpers.js

/**
 * 生成全局唯一的消息 ID
 * 格式：msg_<时间戳>_<6位随机小写字母数字>
 * 示例：msg_1718000000001_a3fx9k
 * @returns {string}
 */
function generateMessageId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `msg_${timestamp}_${random}`;
}

/**
 * 清洗消息数组，只保留 API 需要的 role 和 content
 * @param {Array} messages 
 * @returns {Array} 纯净消息数组
 */
function cleanMessagesForAPI(messages) {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

module.exports = { generateMessageId, cleanMessagesForAPI };