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
const { prepareLLMContext } = require('./utils/contextBuilder');
const { addFact, searchFacts } = require('./utils/factsStore');
const { retrieveMemories } = require('./utils/memory');
const { systemPrompt } = require('./config/prompts');
const { countTokens, truncateByTokensFromEnd } = require('./utils/token');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

    console.log(`[recall] 搜索原始对话历史，预算: ${memoryBudget}，查询: [${queries.join(', ')}]`);

    // ─────────── 1. 搜索原始对话历史 ───────────
    let allHistory = [];

    for (const q of queries) {
      const historyMsgs = await retrieveMemories(q, allMessages, memoryBudget);
      allHistory.push(...historyMsgs.map(m => ({
        id: m.id,
        content: m.content,
        role: m.role,
        source: '历史'
      })));
    }

    // ─────────── 2. 按消息id去重 ───────────
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
      resultText += '【来自对话历史】（按时间从早到晚排列，最新的在末尾，请优先参考较新的内容）\n';
      resultText += uniqueHistory.map(h =>
        `- [${h.role === 'user' ? '用户' : '助手'}] ${h.content}`
      ).join('\n');
    }
    
    // 预算截断（如果超限）
    const usedTokens = countTokens(resultText);
    let finalText = resultText;
    if (usedTokens > memoryBudget) {
      const declaration = '\n\n【工具提示】记忆预算已用尽，以上结果为截断内容。';
      const decTokens = countTokens(declaration);
      const available = memoryBudget - decTokens;
      finalText = (available > 0 ? truncateByTokensFromEnd(resultText, available) : '') + declaration;
    }

    args._memoryTokensUsed = countTokens(finalText);  // 将消耗量存到 args 中，外部可以读取
    return finalText || '没有找到相关记忆。';
  }
};

// GET /api/models — 返回可用模型列表
app.get('/api/models', (req, res) => {
  res.json(MODEL_LIST);
});


// ✅ 聊天接口（整理清楚，只组装一次）
app.post('/api/chat', async (req, res) => {
  try {
    // ---------- 0. 基本参数 ----------
    const { threadId, model, messages } = req.body;
    const provider = getProvider(model);
    const userMessage = messages?.[0]?.content;
    if (!userMessage) {
      return res.status(400).json({ error: '缺少用户消息' });
    }

    // ---------- 1. 线程准备 ----------
    const threads = readThreads();
    let thread = getThreadById(threadId);
    if (!thread) {
      saveOrUpdateThread(threadId, []);
      thread = getThreadById(threadId);
    }

    // 将本次用户消息加入历史（暂时只存在内存，结束后统一持久化）
    const userMsgObj = { role: 'user', content: userMessage };
    thread.messages.push(userMsgObj);
    thread.updatedAt = new Date().toISOString();

    const fullContext = [...thread.messages];   // 完整历史（user与assitant）

    // ---------- 2. 构建初始请求数据 ----------
    const { messages: baseMessages, memoryBudget, system } =
      await prepareLLMContext(provider, model, fullContext, systemPrompt, threadId);

    let remainingMemoryBudget = memoryBudget;   // 留给记忆注入的 token 额度
    let chatMessages = baseMessages;           // 当前要发给 API 的最近轮次

    // ---------- 3. 设置 SSE ----------
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // ---------- 4. 工具调用循环（最多三轮） ----------
    const MAX_TOOL_ROUNDS = 3;
    let toolRound = 0;
    let finalAssistantContent = '';   // 最终自然回复（保存用）

    while (toolRound < MAX_TOOL_ROUNDS) {
      toolRound++;

      // ---------- 4.1 发起流式请求 ----------
      const response = await axios({
        method: 'post',
        url: provider.url,
        headers: {
          'Authorization': `Bearer ${provider.key}`,
          'Content-Type': 'application/json',
          ...(provider.type === 'anthropic' && { 'anthropic-version': '2023-06-01' })
        },
        data: {
          model: model,
          messages: chatMessages,
          stream: true,
          ...(provider.type === 'anthropic' && { system })
        },
        responseType: 'stream'
      });

      // ---------- 4.2 流内容处理 ----------
      let buffer = '';               // 收集增量文本，用于工具调用检测
      let isToolCall = false;        // 本轮是否检测到工具调用
      let toolObj = null;            // 解析出的工具调用对象
      let assistantContent = '';     // 本轮助手自然回复
      let startedNatural = false;    // 是否已开始推送自然语言

      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            // ---------- OpenAI 格式解析 ----------
            if (provider.type === 'openai' && line.startsWith('data: ')) {
              if (line.includes('[DONE]')) return;
              try {
                const json = JSON.parse(line.replace('data: ', ''));
                const delta = json.choices[0].delta?.content;
                if (!delta) continue;

                // 还在判断阶段
                if (!isToolCall && !startedNatural) {
                  buffer += delta;
                  // 如果 buffer 以 { 开头，尝试解析工具调用
                  if (buffer.trim().startsWith('{')) {
                    try {
                      const parsed = JSON.parse(buffer.trim());
                      if (parsed.tool && TOOL_EXECUTORS[parsed.tool]) {
                        console.log(`[工具] 检测到工具调用: ${parsed.tool}`);
                        isToolCall = true;
                        toolObj = parsed;
                        continue;
                      }
                    } catch (_) {
                      // JSON 还不完整，如果明显不是 JSON，切为自然语言
                      if (buffer.length > 10 && !buffer.startsWith('{')) {
                        console.log('[流] 自然语言模式（buffer 非 JSON）');
                        res.write(`data: ${JSON.stringify({ content: buffer })}\n\n`);
                        assistantContent += buffer;
                        buffer = '';
                        startedNatural = true;
                      }
                      continue;
                    }
                  } else {
                    // 不以 { 开头，直接判定为自然语言
                    console.log('[流] 自然语言模式');
                    res.write(`data: ${JSON.stringify({ content: buffer })}\n\n`);
                    assistantContent += buffer;
                    buffer = '';
                    startedNatural = true;
                  }
                }
                // 已进入自然语言模式
                else if (startedNatural) {
                  res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
                  assistantContent += delta;
                }
                // 工具调用模式下忽略后续文本
                // else if (isToolCall) { /* 忽略 */ }
              } catch (e) { /* 忽略解析错误 */ }
            } 
            // ---------- Anthropic 格式解析（示例） ----------
            else if (provider.type === 'anthropic') {
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

      // ---------- 4.3 流结束后的善后与工具执行 ----------
      // 如果全程未判定状态，检查 buffer 是否含工具调用
      if (!isToolCall && !startedNatural && buffer) {
        // 尝试从 buffer 中提取工具调用 JSON（可能混有前置自然语言）
        const toolIdx = buffer.indexOf('{"tool"');
        if (toolIdx !== -1) {
          const beforeJson = buffer.substring(0, toolIdx);
          if (beforeJson) {
            res.write(`data: ${JSON.stringify({ content: beforeJson })}\n\n`);
            assistantContent += beforeJson;
          }
          const jsonPart = buffer.substring(toolIdx);
          try {
            const parsed = JSON.parse(jsonPart);
            if (parsed.tool && TOOL_EXECUTORS[parsed.tool]) {
              console.log(`[工具] 从残余 buffer 提取到工具调用: ${parsed.tool}`);
              isToolCall = true;
              toolObj = parsed;
            }
          } catch (_) { /* 可能 JSON 仍不完整，当作自然语言推送 */ }
        }

        // 仍未判定 → 当成自然语言
        if (!isToolCall && !startedNatural) {
          res.write(`data: ${JSON.stringify({ content: buffer })}\n\n`);
          assistantContent += buffer;
          startedNatural = true;
        }
      }

      // ---------- 4.4 根据结果分支处理 ----------
      if (isToolCall && toolObj) {
        // ---- 工具调用分支 ----
        console.log(`[工具] 执行工具: ${toolObj.tool}，参数:`, toolObj.args);

        if (toolObj.tool === 'recall') {
          toolObj.args.memoryBudget = remainingMemoryBudget;
        }        
        const toolResult = await TOOL_EXECUTORS[toolObj.tool](toolObj.args, threadId);

        // 将本轮助手的工具调用请求加入历史（但不保存到最终对话，因为我们不保存工具调用）
        const assistantToolMsg = {
          role: 'assistant',
          content: JSON.stringify({ tool: toolObj.tool, args: toolObj.args })
        };
        const toolResultMsg = {
          role: 'user',
          content: '【本信息不是用户真实回复，而是工具返回结果】->' + toolResult,
        };

        // 扣减预算
        const usedTokens = toolObj.args._memoryTokensUsed + countTokens([assistantToolMsg]);
        remainingMemoryBudget = Math.max(0, remainingMemoryBudget - usedTokens);

        // 更新 chatMessages，下一次循环发送给模型
        chatMessages = [
          ...chatMessages,
          assistantToolMsg,
          toolResultMsg
        ];

        console.log('[工具] 准备下一轮请求，当前 chatMessages 条数:', chatMessages.length);
        // 继续循环（若未达到最大轮数）
        continue;
      } else {
        // ---- 自然语言分支 ----
        finalAssistantContent = assistantContent;
        break;   // 结束工具循环
      }
    }

    // ---------- 5. 兜底：若超过最大轮数仍未得到自然回复 ----------
    if (!finalAssistantContent) {
      const fallback = '\n\n[未生成有效回复，请重试]';
      res.write(`data: ${JSON.stringify({ content: fallback })}\n\n`);
      finalAssistantContent = fallback;
    }

    // ---------- 6. 持久化（只保存自然对话） ----------
    if (finalAssistantContent) {
      thread.messages.push({ role: 'assistant', content: finalAssistantContent });
    }
    thread.updatedAt = new Date().toISOString();
    saveOrUpdateThread(thread.id, thread.messages);

    // ---------- 7. 向量化新消息 ----------
    const { embed } = require('./utils/embeddings');
    const { addVector, getVector } = require('./utils/vectorStore');
    for (const msg of thread.messages) {
      if (msg.id && !getVector(msg.id)) {
        try {
          const vector = await embed(msg.content);
          addVector(msg.id, vector);
          //console.log(`已为消息 ${msg.id} 生成向量`);
        } catch (err) {
          console.error(`向量化失败: ${msg.id}`, err.message);
        }
      }
    }

    // ---------- 8. 结束 SSE ----------
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