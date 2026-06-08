// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { encode } = require('gpt-tokenizer');

const { PROVIDER_CONFIG, MODEL_LIMITS, MODEL_LIST, getProvider } = 
require('./config/models');
const { readThreads, saveOrUpdateThread, getThreadById } = 
require('./utils/storage');
const { trimMessages, countTokens } = 
require('./utils/token');
const { splitIntoRounds, retrieveMemories, dynamicAllocation } =
require('./utils/memory');
const { detectTrigger } = 
require('../server/triggerDetector')
const { cleanMessagesForAPI } = 
require('./utils/helpers')
const { loadVectors } = 
require('./utils/vectorStore');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

loadVectors();

// GET /api/models — 返回可用模型列表
app.get('/api/models', (req, res) => {
  res.json(MODEL_LIST);
});

function buildRequestData(provider, model, messages, systemPrompt) {
  const MAX_WINDOW = 6000; //MODEL_LIMITS[pureModelName] || MODEL_LIMITS.default;
  const MEMORY_THRESHOLD = MAX_WINDOW * 0.5;    // 超过 50% 窗口才启用记忆
  const RESERVED_OUTPUT = 4000;                 // 留给模型输出的 token

  // 计算总 token（包含 system prompt）
  const systemTokens = countTokens([{ role: 'system', content: systemPrompt }]);
  const historyTokens = countTokens(messages);
  const totalTokens = systemTokens + historyTokens;

  // ---------- 分支 1：历史消息小于 50% 上下文窗口 短对话 → 原逻辑 ----------
  if (totalTokens <= MEMORY_THRESHOLD) {
    console.log('短对话分支');  // 修复4

    const withSystem = [{ role: 'system', content: systemPrompt }, ...messages];
    if (provider.type === 'anthropic') {
      // Claude: system 必须放在顶层，不能出现在 messages 中
      return {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: cleanMessagesForAPI(withSystem.filter(m => m.role !== 'system')),
        stream: true,
      };
    }
    // OpenAI 兼容（ChatGPT / Kimi / DeepSeek）
    return {
      model,
      messages: cleanMessagesForAPI(withSystem),   // system 作为第一条 message 直接保留
      stream: true,
    };
  }

  // ---------- 分支 2：长对话 → 启用记忆模式 ----------
  console.log('长对话分支');  // 修复4

  // 1. 找到最后一条用户消息
  const lastUserMsg = messages.filter(m => m.role === 'user').pop();
  const query = lastUserMsg ? lastUserMsg.content : '';

  // 2. 动态分配预算
  // 这些 token 会分配给两块：最近连续对话，以及检索出的早期记忆。
  const totalBudget = MAX_WINDOW - systemTokens - RESERVED_OUTPUT - 200; 
  const { recentMessages, memoryBudget } = dynamicAllocation(messages, totalBudget);

  // ========== 新增：触发判定 ==========
  // 准备旧消息池（不在 recentMessages 中的消息）
  const recentMsgSet = new Set(recentMessages);
  const allMessages = messages; // 这是完整的原始历史
  const oldMessages = allMessages.filter(m => !recentMsgSet.has(m));

  const triggerType = detectTrigger(query, oldMessages);
  console.log(`[触发判定] 提问片段: "${query.substring(0, 30)}..." → 类型: ${triggerType}`);
  // =================================

  // 3. 从早期历史中检索记忆（排除 recentMessages 对应的消息）
  let memories = [];
  if (triggerType === 'explicit' || triggerType === 'implicit_confirmed') {
    memories = cleanMessagesForAPI(retrieveMemories(query, oldMessages, memoryBudget));
  } else {
    console.log('[触发判定] 无触发，跳过检索');
  }

  // 4. 组装最终消息列表
  let finalSystemPrompt = systemPrompt;
  if (memories.length > 0) {
    // 把记忆格式化成易读的文本块
    const memoryText = memories.map((m, i) => {
      const timeLabel = m.timestamp ? new Date(m.timestamp).toLocaleString() : '未知时间';
      const speaker = m.role === 'user' ? '用户' : '助手';
      return `[${timeLabel}] ${speaker}：${m.content}`;
    }).join('\n');

    // 追加到 system prompt，并用明确的边界标记
    finalSystemPrompt += `\n\n【以下是从长期记忆中检索到的相关历史对话片段，不是当前对话，仅供参考】\n${memoryText}\n【记忆片段结束】`;
  }

  // 5. 构造唯一的 system 消息
  const systemMsg = { role: 'system', content: finalSystemPrompt };

  // 6. 组装最终消息列表：只有 system + recentMessages（全是 user/assistant）
  const finalMessages = [
    systemMsg,
    ...recentMessages
  ];

  if (provider.type === 'anthropic') {
    // Claude: system 必须放在顶层，不能出现在 messages 中
    return {
      model,
      max_tokens: 4096,
      system: finalSystemPrompt,
      messages: cleanMessagesForAPI(recentMessages),
      stream: true,
    };
  }

  // OpenAI 兼容（ChatGPT / Kimi / DeepSeek）
  return {
    model,
    messages: cleanMessagesForAPI(finalMessages),   // system 作为第一条 message 直接保留
    stream: true,
  };
}

// ✅ 聊天接口（整理清楚，只组装一次）
app.post('/api/chat', async (req, res) => {
  try {
    const { threadId, model, messages } = req.body;
    const provider = getProvider(model);

    // 取第一条用户消息（前端现在只发一条，安全起见用数组）
    const userMessage = messages?.[0]?.content;
    if (!userMessage) {
      return res.status(400).json({ error: '缺少用户消息' });
    }

    // ---------- 1. 获取或创建线程 ----------
    const threads = readThreads();
    let thread = getThreadById(threadId);
    if (!thread) {
      saveOrUpdateThread(threadId, []);
      thread = getThreadById(threadId);
    }

    // 2. 将当前用户消息临时加入历史（暂未写入文件）
    const userMsgObj = { role: 'user', content: userMessage };
    thread.messages.push(userMsgObj);
    thread.updatedAt = new Date().toISOString();

    // 3. 准备完整上下文（历史消息，不含 system，buildRequestData 会统一加）
    const fullContext = [...thread.messages]; // 当前历史 + 刚推入的用户消息

    // 构建调用大模型的请求信息
    const requestData = buildRequestData(provider, model, fullContext, '你是一个智能助手。');

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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

    // 6. 处理流式响应 + 收集助手回复
    let assistantContent = '';
    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (provider.type === 'openai' && line.startsWith('data: ')) {
          if (line.includes('[DONE]')) return;
          try {
            const json = JSON.parse(line.replace('data: ', ''));
            const content = json.choices[0].delta?.content;
            if (content) {
              assistantContent += content;   // ✅ 累加
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
                  assistantContent += text;   // ✅ 累加
                  res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
                }
              }
            } catch (e) {}
          }
        }
      }
    });

    response.data.on('end', () => {
      // 7. 助手回复完成，存入线程并写盘
      if (assistantContent) {
        thread.messages.push({ role: 'assistant', content: assistantContent });
      }
      thread.updatedAt = new Date().toISOString();
      saveOrUpdateThread(thread.id, thread.messages);

      res.write('data: [DONE]\n\n');
      res.end();
    });

    response.data.on('error', (err) => {
      if (assistantContent) {
        thread.messages.push({
          role: 'assistant',
          content: assistantContent + '\n\n[连接中断]'
        });
      }
      thread.updatedAt = new Date().toISOString();
      saveOrUpdateThread(thread.id, thread.messages);
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