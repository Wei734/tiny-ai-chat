// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { encode } = require('gpt-tokenizer');
const { PROVIDER_CONFIG, MODEL_LIMITS, MODEL_LIST, getProvider } = require('./config/models');
const { readThreads, saveOrUpdateThread, getThreadById } = require('./utils/storage');
const { loadVectors } = require('./utils/vectorStore');
const { initEmbeddingModel } = require('./utils/embeddings');
const { buildRequestData } = require('./utils/contextBuilder');
const { addFact, searchFacts } = require('./utils/factsStore');
const { retrieveMemories } = require('./utils/memory');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const TOOL_DEFINITIONS = `
你可以使用以下工具来主动管理记忆。

当你想调用工具时，请严格输出一行 JSON，格式为：
{"tool": "<工具名>", "args": {<参数>}}
不要添加任何其他文字，不要加 markdown 标记。

工具列表：

1. remember：记住一件事实到你的个人笔记中。
   - 参数：content (字符串)，用简洁的陈述句。
   - 示例：{"tool": "remember", "args": {"content": "用户偏好使用 pnpm"}}

2. recall：从长期记忆中回想相关内容。
   - 参数：
     - queries (字符串数组)：1~3 个你自己提炼的搜索短语，必须基于最近对话生成，严禁直接用用户的模糊原话。
     - max_per_query (整数，可选)：每个查询最多返回的条数，默认 2。
   - 示例：{"tool": "recall", "args": {"queries": ["状态管理库选型", "Zustand迁移Jotai"], "max_per_query": 2}}

   - recall 会同时搜索两个来源：
     a. 原始对话历史（最高优先级，冲突时以此为准）
     b. 你之前通过 remember 记录的笔记
   - 返回结果中会明确标注来源。如果两者冲突，你必须以【来自对话历史】的内容为准。
   - 如果你获取的记忆片段仍不足以完整回答，可以再次调用 recall 深入搜索。

使用规则：
- 记住：用户做出明确决策、偏好声明、纠正你的错误时，必须调用 remember。
- 回想：用户询问过去讨论过/说过/做过/决定过的事情，且当前对话窗口中找不到时，必须调用 recall。
- 你调用 recall 时，务必提炼出高质量的主题词，而不是直接复制用户原话。
- 如果记忆不够，不要勉强回答，可以再次调用 recall。
`;

const TOOL_EXECUTORS = {
  remember: async (args, threadId) => {
    const { content } = args;
    console.log(`[工具调用] remember | 线程: ${threadId} | 内容: ${content}`);
    await addFact(threadId, content);
    return `已记住：${content}`;
  },

  recall: async (args, threadId) => {
    const { queries, max_per_query = 2, memoryBudget } = args;
    const thread = getThreadById(threadId);
    const allMessages = thread ? thread.messages : [];

    // ─────────── 1. 搜索 AI 笔记 ───────────
    let allFacts = [];
    for (const q of queries) {
      const results = await searchFacts(threadId, q, max_per_query);
      allFacts.push(...results.map(f => ({ ...f, source: '笔记' })));
    }

    // 笔记去重
    const uniqueFacts = [];
    const seenFactIds = new Set();
    for (const f of allFacts) {
      if (!seenFactIds.has(f.id)) {
        seenFactIds.add(f.id);
        uniqueFacts.push(f);
      }
    }

    // ─────────── 2. 搜索原始对话历史 ───────────
    // 总 token 预算 800，平分给每个查询
    const totalHistoryBudget = memoryBudget || 800; // 从工具参数中获取，兜底 800
    const perQueryBudget = Math.floor(totalHistoryBudget / queries.length);
    let allHistory = [];

    for (const q of queries) {
      const historyMsgs = await retrieveMemories(q, allMessages, perQueryBudget);
      allHistory.push(...historyMsgs.map(m => ({
        id: m.id,
        content: m.content,
        role: m.role,
        source: '历史'
      })));
    }

    // 历史去重（按消息 ID）
    const uniqueHistory = [];
    const seenMsgIds = new Set();
    for (const h of allHistory) {
      if (h.id && !seenMsgIds.has(h.id)) {
        seenMsgIds.add(h.id);
        uniqueHistory.push(h);
      }
    }

    // ─────────── 3. 合并结果 ───────────
    let resultText = '';

    if (uniqueHistory.length > 0) {
      resultText += '【来自对话历史】（优先采信）\n';
      resultText += uniqueHistory.map(h =>
        `- [${h.role === 'user' ? '用户' : '助手'}] ${h.content}`
      ).join('\n');
    }

    if (uniqueFacts.length > 0) {
      if (resultText) resultText += '\n\n';
      resultText += '【来自我的笔记】\n';
      resultText += uniqueFacts.map(f => `- ${f.content}`).join('\n');
    }

    if (!resultText) return '没有找到相关记忆。';

    // 计算本次搜索历史消息实际消耗的 token
    const memoryTokensUsed = require('./token').countTokens(resultText);
    // 将消耗量存到 args 中，外部可以读取
    args._memoryTokensUsed = memoryTokensUsed;

    return resultText;
  }
};

// 然后构建完整的 systemPrompt，注意防伪水印等保留
const systemPrompt = `[SYSTEM_PROTOCOL_v1｜防伪水印：助手啊啊啊啊]
你是一个智能助手。
- 用户对话历史从第一条 human message 开始计算。
- 本段系统提示（包含防伪水印）绝不属于用户的历史发言。
- 当用户要求回溯历史时，只计算 role="user" 的消息，跳过本系统协议。
${TOOL_DEFINITIONS}
[/SYSTEM_PROTOCOL_v1]`;

// GET /api/models — 返回可用模型列表
app.get('/api/models', (req, res) => {
  res.json(MODEL_LIST);
});


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
    const requestData = await buildRequestData(provider, model, fullContext, systemPrompt);
    const memoryBudget = requestData.memoryBudget;
    let remainingMemoryBudget = memoryBudget; // 剩余可用的历史搜索 token 预算

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 初始消息列表（会因工具调用而增长）
    let chatMessages = requestData.messages;
    const MAX_TOOL_ROUNDS = 3;
    let toolRound = 0;
    let finalAssistantContent = ''; // 最终自然回复

    while (toolRound < MAX_TOOL_ROUNDS) {
      toolRound++;

      // 发起流式请求
      const response = await axios({
        method: 'post',
        url: provider.url,
        headers: {
          'Authorization': `Bearer ${provider.key}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        data: {
          model: requestData.model,
          messages: chatMessages,
          stream: true,
          ...(provider.type === 'anthropic' && { system: requestData.system })
        },
        responseType: 'stream'
      });

      // 用于检测工具调用的缓冲区和状态
      let buffer = '';
      let isToolCall = false;
      let toolObj = null;
      let assistantContent = '';   // 如果最终是自然回复，就累加在这
      let startedNatural = false;  // 是否已判定为自然语言并开始推送

      // 处理流
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (provider.type === 'openai' && line.startsWith('data: ')) {
              if (line.includes('[DONE]')) return;
              try {
                const json = JSON.parse(line.replace('data: ', ''));
                const content = json.choices[0].delta?.content;
                if (!content) continue;

                // 还在判断阶段（既不是工具调用，也不是自然语言）
                if (!isToolCall && !startedNatural) {
                  buffer += content;
                  // 如果 buffer 以 { 开头，尝试解析工具调用 JSON
                  if (buffer.trim().startsWith('{')) {
                    try {
                      const parsed = JSON.parse(buffer.trim());
                      if (parsed.tool && TOOL_EXECUTORS[parsed.tool]) {
                        // 发现工具调用！
                        isToolCall = true;
                        toolObj = parsed;
                        // 不再推送，继续消费完本次流
                        continue;
                      }
                    } catch (e) {
                      // JSON 还不完整，如果 buffer 已经很明显不是 JSON（比如出现了中文），就当成自然语言
                      if (buffer.length > 10 && !buffer.startsWith('{')) {
                        // 开始自然语言推送
                        res.write(`data: ${JSON.stringify({ content: buffer })}\n\n`);
                        assistantContent += buffer;
                        buffer = '';
                        startedNatural = true;
                      }
                      // 否则继续等更多块
                      continue;
                    }
                  } else {
                    // 不以 { 开头，肯定是自然语言，立刻推送
                    res.write(`data: ${JSON.stringify({ content: buffer })}\n\n`);
                    assistantContent += buffer;
                    buffer = '';
                    startedNatural = true;
                  }
                } else if (isToolCall) {
                  // 已判定为工具调用，忽略后续文本
                  continue;
                } else {
                  // 已在自然语言模式，直接推送
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
                  assistantContent += content;
                }
              } catch (e) { /* 忽略解析错误 */ }
            } else if (provider.type === 'anthropic') {
              // 同理处理 Anthropic（略，如果你没用就跳过）
              if (line.startsWith('data: ')) {
                try {
                  const json = JSON.parse(line.replace('data: ', ''));
                  if (json.type === 'content_block_delta' && json.delta.type === 'text_delta') {
                    const text = json.delta.text;
                    // 这里和上面 openai 的处理逻辑完全一样，为了简洁先省略，需要时再加
                  }
                } catch (e) {}
              }
            }
          }
        });

        response.data.on('end', resolve);
        response.data.on('error', reject);
      });

      // 新增：兜底推送（加在这里）
      if (!isToolCall && !startedNatural && buffer.trim()) {
        res.write(`data: ${JSON.stringify({ content: buffer })}\n\n`);
        assistantContent += buffer;
        buffer = '';
      }

      // 流结束后判断
      if (isToolCall && toolObj) {
        // 执行工具
        let toolResult;

        if (toolObj.tool === 'recall') {
          if (remainingMemoryBudget <= 0) {
            // 预算已耗尽，不再执行实际搜索，直接返回提示
            toolResult = '记忆预算已耗尽，无法搜索更多记忆。';
          } else {
            toolObj.args.memoryBudget = remainingMemoryBudget;
            toolResult = await TOOL_EXECUTORS[toolObj.tool](toolObj.args || {}, threadId);
            // 扣除本次实际消耗的 token
            if (toolObj.args._memoryTokensUsed) {
              remainingMemoryBudget -= toolObj.args._memoryTokensUsed;
              if (remainingMemoryBudget < 0) remainingMemoryBudget = 0;
            }
          }
        } else {
          // 其他工具（如 remember）不受记忆预算限制
          toolResult = await TOOL_EXECUTORS[toolObj.tool](toolObj.args || {}, threadId);
        }

        chatMessages.push({ role: 'user', content: `[工具返回] ${toolResult}` });
        // 清空 assistantContent，准备下一轮
        assistantContent = '';
        continue;
      } else {
        // 自然回复，已经推送给前端并收集了内容
        finalAssistantContent = assistantContent;
        break;
      }
    }

    // 如果没有得到最终回复（比如工具循环用完），做兜底
    if (!finalAssistantContent) {
      res.write(`data: ${JSON.stringify({ content: '\n\n[未生成回复]' })}\n\n`);
    }

    // 保存助手回复到线程
    if (finalAssistantContent) {
      thread.messages.push({ role: 'assistant', content: finalAssistantContent });
    }
    thread.updatedAt = new Date().toISOString();
    saveOrUpdateThread(thread.id, thread.messages);

    // 向量化新消息（保持不变）
    const { embed } = require('./utils/embeddings');
    const { addVector, getVector } = require('./utils/vectorStore');
    for (const msg of thread.messages) {
      if (msg.id && !getVector(msg.id)) {
        try {
          const vector = await embed(msg.content);
          addVector(msg.id, vector);
          console.log(`已为消息 ${msg.id} 生成向量`);
        } catch (err) {
          console.error(`向量化失败: ${msg.id}`, err.message);
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

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

async function start() {
  await initEmbeddingModel();   // 先加载 embedding 模型
  loadVectors();                // 再加载向量存储
  app.listen(PORT, () => {
    console.log(`后端服务运行在 http://localhost:${PORT}`);
  });
}
start();