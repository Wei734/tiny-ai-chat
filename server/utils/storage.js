// server/utils/storage.js
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');        // 注意路径，回到 server 层
const THREADS_FILE = path.join(DATA_DIR, 'threads.json');

// 确保 data 目录和文件存在
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(THREADS_FILE)) {
    fs.writeFileSync(THREADS_FILE, '[]', 'utf-8');
  }
}

// 读取所有线程
function readThreads() {
  ensureDataFile();
  const raw = fs.readFileSync(THREADS_FILE, 'utf-8');
  return JSON.parse(raw);
}

// 写入所有线程（覆盖写入，简单直接）
function writeThreads(threads) {
  ensureDataFile();
  fs.writeFileSync(THREADS_FILE, JSON.stringify(threads, null, 2), 'utf-8');
}

/**
 * 保存或更新线程的消息（覆盖模式）
 * @param {number} threadId - 线程 ID
 * @param {Array} messages - 完整消息数组 [{ role, content }]
 */
function saveOrUpdateThread(threadId, messages) {
  if (!Array.isArray(messages)) {
    throw new Error('messages 必须为数组');
  }

  const threads = readThreads();
  let thread = threads.find(t => t.id === threadId);

  // 自动提取标题
  const firstUserMsg = messages.find(m => m.role === 'user');
  const title = firstUserMsg
    ? (firstUserMsg.content.length > 20
        ? firstUserMsg.content.substring(0, 20) + '...'
        : firstUserMsg.content)
    : '新对话';

  const now = new Date().toISOString();

  if (thread) {
    thread.title = title;
    thread.messages = messages;
    thread.updatedAt = now;
  } else {
    thread = {
      id: threadId,
      title,
      messages,
      createdAt: now,
      updatedAt: now,
    };
    threads.push(thread);
  }

  writeThreads(threads);
  return thread; // 返回线程对象，方便后续使用
}

/**
 * 根据 ID 获取线程
 * @param {number|string} threadId
 * @returns {object|null} 线程对象或 null
 */
function getThreadById(threadId) {
  const threads = readThreads();
  const thread = threads.find(t => t.id == threadId);
  if (!thread) return null;
  return threads.find(t => t.id == threadId);   // 直接返回引用
}

module.exports = { readThreads, writeThreads, saveOrUpdateThread, getThreadById };