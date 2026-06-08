// server/utils/vectorStore.js
const fs = require('fs');
const path = require('path');
const { ensureDataDir } = require('./storage'); 

const DATA_DIR = path.join(__dirname, '..', 'data');
const VECTORS_FILE = path.join(DATA_DIR, 'vectors.json');

// 内存中的向量映射：messageId -> Float32Array
const vectorMap = new Map();

/**
 * 从 vectors.json 加载所有向量到内存
 * 如果文件不存在，返回空 Map（首次运行）
 */
function loadVectors() {
  ensureDataDir();
  if (!fs.existsSync(VECTORS_FILE)) {
    // 文件不存在，创建一个空对象
    fs.writeFileSync(VECTORS_FILE, '{}', 'utf-8');
    return;
  }

  const raw = fs.readFileSync(VECTORS_FILE, 'utf-8');
  const data = JSON.parse(raw); // { messageId: number[] }

  // 清空当前内存，然后重新填充
  vectorMap.clear();
  for (const [id, vecArray] of Object.entries(data)) {
    // 普通数组 -> Float32Array
    vectorMap.set(id, new Float32Array(vecArray));
  }
  console.log(`向量存储已加载，共 ${vectorMap.size} 条向量`);
}

/**
 * 将内存中的向量映射持久化到 vectors.json
 */
function saveVectors() {
  ensureDataDir();
  const data = {};
  for (const [id, vec] of vectorMap.entries()) {
    // Float32Array -> 普通数组
    data[id] = Array.from(vec);
  }
  fs.writeFileSync(VECTORS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 添加或更新一条消息的向量
 * @param {string} messageId - 消息 ID
 * @param {Float32Array} vector - 向量数组
 */
function addVector(messageId, vector) {
  if (!(vector instanceof Float32Array)) {
    throw new Error('vector 必须是 Float32Array 类型');
  }
  vectorMap.set(messageId, vector);
  saveVectors(); // 立即持久化
}

/**
 * 获取单条消息的向量
 * @param {string} messageId
 * @returns {Float32Array|undefined}
 */
function getVector(messageId) {
  return vectorMap.get(messageId);
}

/**
 * 获取所有向量，用于批量相似度计算
 * @returns {Object} { ids: string[], vectors: Float32Array[] }
 */
function getAllVectors() {
  const ids = [];
  const vectors = [];
  for (const [id, vec] of vectorMap.entries()) {
    ids.push(id);
    vectors.push(vec);
  }
  return { ids, vectors };
}

/**
 * 删除一条消息的向量（消息被删除时调用）
 * @param {string} messageId
 */
function deleteVector(messageId) {
  const deleted = vectorMap.delete(messageId);
  if (deleted) {
    saveVectors(); // 立即持久化
  }
}

module.exports = {
  loadVectors,
  saveVectors,
  addVector,
  getVector,
  getAllVectors,
  deleteVector,
};