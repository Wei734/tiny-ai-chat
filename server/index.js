// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { encode } = require('gpt-tokenizer');

const { PROVIDER_CONFIG, MODEL_LIMITS, MODEL_LIST, getProvider } = 
require('./config/models');
const { readThreads, writeThreads } = 
require('./utils/storage');
const { trimMessages } = 
require('./utils/token');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// GET /api/models — 返回可用模型列表
app.get('/api/models', (req, res) => {
  res.json(MODEL_LIST);
});

function buildRequestData(provider, model, messages, systemPrompt) {
  const pureModelName = model.split('/').pop();

  // 为截断计算，统一构造包含 system 的临时数组
  const withSystem = [{ role: 'system', content: systemPrompt }, ...messages];
  const trimmed = trimMessages(withSystem, pureModelName);

  if (provider.type === 'anthropic') {
    // Claude: system 必须放在顶层，不能出现在 messages 中
    return {
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: trimmed.filter(m => m.role !== 'system'),
      stream: true,
    };
  }

  // OpenAI 兼容（ChatGPT / Kimi / DeepSeek）
  return {
    model,
    messages: trimmed,   // system 作为第一条 message 直接保留
    stream: true,
  };
}

// ✅ 聊天接口（整理清楚，只组装一次）
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model } = req.body;
    const provider = getProvider(model);
    const pureModelName = model.split('/').pop();

    console.log(`[请求] 模型: ${model}, 类型: ${provider.type}, 原始消息数: ${messages.length}`);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 构建调用大模型的请求信息
    const requestData = buildRequestData(provider, model, messages, '你是一个智能助手。');
    


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

require('./routes/threads')(app);

app.listen(PORT, () => {
  console.log(`后端服务运行在 http://localhost:${PORT}`);
});