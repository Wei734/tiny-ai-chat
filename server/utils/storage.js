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

module.exports = { readThreads, writeThreads };