// server/utils/toolLoop.js
const axios = require('axios');
const { parseOpenAIChunk } = require('./streamParser');

const TOOL_EXECUTORS = {
  remember: async (args, threadId) => {
    const { content } = args;
    const { addFact } = require('./factsStore');
    await addFact(threadId, content);
    return `已记住：${content}`;
  },
  recall: async (args, threadId, memoryBudget) => {
    const { queries, max_per_query = 2 } = args;
    const { getThread } = require('./threadStore'); // 假设有轻量内存存储，但也可以直接用旧 storage
    const { searchFacts } = require('./factsStore');
    const { retrieveMemories } = require('./memory');

    const thread = getThread(threadId);
    const allMessages = thread ? thread.messages : [];

    let allFacts = [];
    for (const q of queries) {
      const results = await searchFacts(threadId, q, max_per_query);
      allFacts.push(...results.map(f => ({ ...f, source: '笔记' })));
    }

    const uniqueFacts = allFacts.filter((f, i, arr) => arr.findIndex(x => x.id === f.id) === i);

    const totalHistoryBudget = memoryBudget || 800;
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

    const uniqueHistory = allHistory.filter((h, i, arr) => arr.findIndex(x => x.id === h.id) === i);

    let resultText = '';
    if (uniqueHistory.length > 0) {
      resultText += '【来自对话历史】（优先采信）\n';
      resultText += uniqueHistory.map(h => `- [${h.role === 'user' ? '用户' : '助手'}] ${h.content}`).join('\n');
    }
    if (uniqueFacts.length > 0) {
      if (resultText) resultText += '\n\n';
      resultText += '【来自我的笔记】\n';
      resultText += uniqueFacts.map(f => `- ${f.content}`).join('\n');
    }

    return resultText || '没有找到相关记忆。';
  }
};

/**
 * 运行工具调用循环，直到获得最终自然语言回复或到达最大轮次
 * @param {object} provider
 * @param {string} model
 * @param {Array} messages - 当前对话消息（包括系统消息）
 * @param {string} systemPrompt
 * @param {number} memoryBudget
 * @param {string} threadId
 * @param {function} onToken - 每次自然语言 token 输出时的回调
 * @returns {string} 最终助手回复内容
 */
async function runToolLoop(provider, model, messages, systemPrompt, memoryBudget, threadId, onToken) {
  let chatMessages = [...messages];
  let remainingMemoryBudget = memoryBudget;
  const MAX_TOOL_ROUNDS = 3;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await axios({
      method: 'post',
      url: provider.url,
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      data: {
        model,
        messages: chatMessages,
        stream: true,
        ...(provider.type === 'anthropic' && { system: systemPrompt })
      },
      responseType: 'stream'
    });

    // 初始化流解析状态
    let state = {
      buffer: '',
      isToolCall: false,
      toolObj: null,
      assistantContent: '',
      startedNatural: false
    };

    await new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        state = parseOpenAIChunk(chunk, state, (text) => {
          onToken(text);
        });
      });
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    // 兜底推送
    if (!state.isToolCall && !state.startedNatural && state.buffer.trim()) {
      onToken(state.buffer);
      state.assistantContent += state.buffer;
    }

    // 处理工具调用
    if (state.isToolCall && state.toolObj) {
      let toolResult;
      if (state.toolObj.tool === 'recall') {
        if (remainingMemoryBudget <= 0) {
          toolResult = '记忆预算已耗尽，无法搜索更多记忆。';
        } else {
          toolResult = await TOOL_EXECUTORS.recall(state.toolObj.args, threadId, remainingMemoryBudget);
          // 简单估算消耗，此处略去精细 token 计数
          remainingMemoryBudget -= 200; // 简单递减
          if (remainingMemoryBudget < 0) remainingMemoryBudget = 0;
        }
      } else {
        toolResult = await TOOL_EXECUTORS.remember(state.toolObj.args, threadId);
      }
      chatMessages.push({ role: 'user', content: `[工具返回] ${toolResult}` });
    } else {
      return state.assistantContent; // 获得最终自然语言回复
    }
  }

  return '[未生成回复]';
}

module.exports = { runToolLoop };