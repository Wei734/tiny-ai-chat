// server/utils/factsStore.js
const fs = require('fs');
const path = require('path');
const { embed } = require('./embeddings');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * 获取某个线程的事实文件路径
 * @param {number|string} threadId
 * @returns {string}
 */
function getFactsFilePath(threadId) {
  return path.join(DATA_DIR, `${threadId}_facts.json`);
}

/**
 * 读取一个线程的所有事实记忆
 * @param {number|string} threadId
 * @returns {Array<{id: string, content: string, vector: number[], createdAt: string}>}
 */
function readFacts(threadId) {
  const filePath = getFactsFilePath(threadId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 写入一个线程的事实记忆
 * @param {number|string} threadId
 * @param {Array} facts
 */
function writeFacts(threadId, facts) {
  const filePath = getFactsFilePath(threadId);
  fs.writeFileSync(filePath, JSON.stringify(facts, null, 2), 'utf-8');
}

/**
 * 添加一条新的事实记忆（自动生成向量）
 * @param {number|string} threadId
 * @param {string} content
 * @returns {Promise<object>} 新创建的事实对象
 */
async function addFact(threadId, content) {
  const facts = readFacts(threadId);
  const vector = await embed(content);
  const newFact = {
    id: `fact_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    content,
    vector: Array.from(vector), // 普通数组便于 JSON 序列化
    createdAt: new Date().toISOString()
  };
  facts.push(newFact);
  writeFacts(threadId, facts);
  return newFact;
}

/**
 * 在事实库中语义搜索
 * @param {number|string} threadId
 * @param {string} query
 * @param {number} topK 返回条数，默认 3
 * @returns {Promise<Array<{id: string, content: string, score: number, createdAt: string}>>}
 */
async function searchFacts(threadId, query, topK = 3) {
  const facts = readFacts(threadId);
  if (facts.length === 0) return [];

  const queryVec = await embed(query);
  const scored = facts.map(fact => {
    const vec = new Float32Array(fact.vector);
    const score = cosineSimilarity(queryVec, vec);
    return { ...fact, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ id, content, score, createdAt }) => ({
    id, content, score, createdAt
  }));
}

/**
 * 余弦相似度计算
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

module.exports = { addFact, searchFacts };