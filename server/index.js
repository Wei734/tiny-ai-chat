// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { encode } = require('gpt-tokenizer');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- 模型配置表 ---
const PROVIDER_CONFIG = {
  kimi: {
    url: 'https://api.moonshot.cn/v1/chat/completions',
    key: process.env.KIMI_API_KEY,
    type: 'openai'
  },
  ofox: {
    url: 'https://api.ofox.ai/v1/chat/completions',
    key: process.env.OFOX_API_KEY,
    type: 'openai'
  },
  claude: {
    url: 'https://api.ofox.ai/anthropic/v1/messages',
    key: process.env.OFOX_API_KEY,
    type: 'anthropic'
  },
  gemini: {
    url: 'https://api.ofox.ai/v1/chat/completions',
    key: process.env.OFOX_API_KEY,
    type: 'openai'
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    key: process.env.DEEPSEEK_API_KEY,
    type: 'openai'
  }
};

// --- 模型上下文限制 ---
const MODEL_LIMITS = {
  'gpt-4o': 128000,
  'kimi-k2.6': 256000,
  'claude-opus-4.6': 200000,
  'gpt-5.4': 128000,
  'gemini-3.1-pro-preview': 1000000,
  'deepseek-chat': 128000,
  'deepseek-reasoner': 128000,
  'default': 4000
};

// 模型列表配置（与 PROVIDER_CONFIG 和 MODEL_LIMITS 对应）
const MODEL_LIST = [
  { value: 'kimi-k2.6', label: 'Kimi: kimi-k2.6 (便宜好用)' },
  { value: 'deepseek-chat', label: 'DeepSeek: V3.2 (非思考模式)' },
  { value: 'deepseek-reasoner', label: 'DeepSeek: V3.2 (思考模式)' },
  { value: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' },
  { value: 'anthropic/claude-opus-4.6', label: 'Anthropic: Claude Opus 4.6' },
  { value: 'openai/gpt-5.4', label: 'OpenAI: GPT-5.4' },
  { value: 'google/gemini-3.1-pro-preview', label: 'Google: Gemini 3.1 Pro Preview' }
];

// GET /api/models — 返回可用模型列表
app.get('/api/models', (req, res) => {
  res.json(MODEL_LIST);
});

// 智能路由
const getProvider = (modelName) => {
  const lowerModel = modelName.toLowerCase();
  if (lowerModel.includes('moonshot') || lowerModel.includes('kimi')) return PROVIDER_CONFIG.kimi;
  if (lowerModel.includes('claude') || lowerModel.includes('opus')) return PROVIDER_CONFIG.claude;
  if (lowerModel.includes('gemini')) return PROVIDER_CONFIG.gemini;
  if (lowerModel.includes('deepseek')) return PROVIDER_CONFIG.deepseek;
  return PROVIDER_CONFIG.ofox;
};

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
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


// ✅ 修复后的截断函数
const trimMessages = (messages, modelName, maxOutputTokens = 4096) => {
  const limit = MODEL_LIMITS[modelName] || MODEL_LIMITS['default'];
  const maxInputTokens = limit - maxOutputTokens;

  const countTokens = (str) => {
    if (!str) return 0;
    try {
      return encode(str).length;
    } catch (e) {
      // gpt-tokenizer 对某些特殊字符可能报错，用粗略估算兜底
      return Math.ceil(str.length * 1.5);
    }
  };

  // 分离 system 消息和对话消息
  const systemMsg = messages.find(m => m.role === 'system');
  const chatHistory = messages.filter(m => m.role !== 'system');

  let currentTokens = 0;

  // system prompt 的 token 先算进去
  if (systemMsg) {
    currentTokens += countTokens(systemMsg.content);
  }

  // ✅ 从最新消息往前取，一旦放不下就 break（不是 continue）
  const trimmed = [];
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const msg = chatHistory[i];
    const msgTokens = countTokens(msg.content);

    if (currentTokens + msgTokens > maxInputTokens) {
      console.log(`[截断] 在第 ${i} 条消息处截断，已用 ${currentTokens} tokens，这条需要 ${msgTokens}`);
      break;  // ✅ 直接停止，丢弃所有更早的消息
    }

    trimmed.unshift(msg);
    currentTokens += msgTokens;
  }

  // ✅ 确保至少保留最后一条用户消息（避免空请求）
  if (trimmed.length === 0 && chatHistory.length > 0) {
    const lastMsg = chatHistory[chatHistory.length - 1];
    // 如果单条消息就超限，截断消息内容
    const maxChars = Math.floor(maxInputTokens / 1.5);
    trimmed.push({
      ...lastMsg,
      content: lastMsg.content.substring(0, maxChars)
    });
    console.log(`[截断] 单条消息过长，截断到 ${maxChars} 字符`);
  }

  // 把 system 加回开头
  if (systemMsg) {
    trimmed.unshift(systemMsg);
  }

  console.log(`[Token统计] 模型: ${modelName}, 上限: ${limit}, 输入token: ${currentTokens}, 消息数: ${messages.length} → ${trimmed.length}`);
  return trimmed;
};

// ✅ 聊天接口（整理清楚，只组装一次）
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model = 'gpt-4o' } = req.body;
    const provider = getProvider(model);
    const pureModelName = model.split('/').pop();

    console.log(`[请求] 模型: ${model}, 类型: ${provider.type}, 原始消息数: ${messages.length}`);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let requestData = {};

    // ✅ 只组装一次，直接截断
    if (provider.type === 'openai') {
      const systemPrompt = { role: 'system', content: '你是一个智能助手。' };
      const fullMessages = [systemPrompt, ...messages];
      const trimmedMessages = trimMessages(fullMessages, pureModelName);

      requestData = {
        model: model,
        messages: trimmedMessages,
        stream: true
      };
    } else if (provider.type === 'anthropic') {
      const systemPrompt = '你是一个智能助手。';
      const cleanMessages = messages.filter(m => m.role !== 'system');

      // ✅ Claude 也做截断
      const tempForTrim = [
        { role: 'system', content: systemPrompt },
        ...cleanMessages
      ];
      const trimmedMessages = trimMessages(tempForTrim, pureModelName);

      // 截断后再分离 system
      const finalMessages = trimmedMessages.filter(m => m.role !== 'system');

      requestData = {
        model: model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: finalMessages,
        stream: true
      };
    }

    // 发起请求
    const response = await axios({
      method: 'post',
      url: provider.url,
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      data: requestData,
      responseType: 'stream'
    });

    // 处理流式响应
    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (provider.type === 'openai' && line.startsWith('data: ')) {
          if (line.includes('[DONE]')) return;
          try {
            const json = JSON.parse(line.replace('data: ', ''));
            const content = json.choices[0].delta?.content;
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {}
        } else if (provider.type === 'anthropic') {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.replace('data: ', ''));
              if (json.type === 'content_block_delta' && json.delta.type === 'text_delta') {
                const text = json.delta.text;
                if (text) {
                  res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
                }
              }
            } catch (e) {}
          }
        }
      }
    });

    response.data.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    response.data.on('error', (err) => {
      console.error('[流错误]', err.message);
      res.write(`data: ${JSON.stringify({ content: '\n\n[连接中断]' })}\n\n`);
      res.end();
    });

  } catch (error) {
    console.error('[API 错误]', error.message);
    if (error.response) {
      error.response.data.on('data', c => console.error('详情:', c.toString()));
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// ========== 线程管理 API ==========

// 1. 获取对话列表（只返回摘要，不包含具体消息）
app.get('/api/threads', (req, res) => {
  try {
    const threads = readThreads();
    // 摘要信息：id, title, updatedAt, messageCount 等
    const list = threads.map(t => ({
      id: t.id,
      title: t.title,
      messageCount: t.messages?.length || 0,
      updatedAt: t.updatedAt
    }));
    // 按更新时间倒序
    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取线程列表失败' });
  }
});

// 2. 获取某个对话的全部消息
app.get('/api/threads/:id', (req, res) => {
  try {
    const threads = readThreads();
    const thread = threads.find(t => t.id == req.params.id);
    if (!thread) {
      return res.status(404).json({ error: '对话不存在' });
    }
    res.json(thread);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取对话失败' });
  }
});

// 3. 保存 / 更新对话（变通为：整体覆盖消息）
app.post('/api/threads/:id/messages', (req, res) => {
  try {
    const { messages } = req.body;          // 前端把完整 messages 发过来
    const threadId = Number(req.params.id); // 前端的 id 是时间戳数字

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须为数组' });
    }

    const threads = readThreads();
    let thread = threads.find(t => t.id === threadId);

    // 自动提取标题：取第一个用户消息的前 20 个字符
    const firstUserMsg = messages.find(m => m.role === 'user');
    const title = firstUserMsg
      ? (firstUserMsg.content.length > 20
          ? firstUserMsg.content.substring(0, 20) + '...'
          : firstUserMsg.content)
      : '新对话';

    const now = new Date().toISOString();

    if (thread) {
      // 更新已有线程
      thread.title = title;
      thread.messages = messages;
      thread.updatedAt = now;
    } else {
      // 新线程直接创建
      thread = {
        id: threadId,
        title,
        messages,
        createdAt: now,
        updatedAt: now
      };
      threads.push(thread);
    }

    writeThreads(threads);
    res.json({ success: true, id: threadId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存消息失败' });
  }
});

// 4. 删除某个对话
app.delete('/api/threads/:id', (req, res) => {
  try {
    const threads = readThreads();
    const filtered = threads.filter(t => t.id != req.params.id);
    if (filtered.length === threads.length) {
      return res.status(404).json({ error: '对话不存在' });
    }
    writeThreads(filtered);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '删除失败' });
  }
});

app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
});