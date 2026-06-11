// server/utils/streamParser.js

/**
 * 解析 OpenAI 流式数据块
 * @param {string} chunk - 原始数据块
 * @param {object} state - 累加状态 { buffer, isToolCall, toolObj, assistantContent, startedNatural }
 * @param {function} onNatural - 当确认为自然语言时回调 (content)
 * @returns {object} 更新后的 state
 */
function parseOpenAIChunk(chunk, state, onNatural) {
  const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    if (line.includes('[DONE]')) return state;

    try {
      const json = JSON.parse(line.replace('data: ', ''));
      const content = json.choices[0].delta?.content;
      if (!content) continue;

      // 判断阶段
      if (!state.isToolCall && !state.startedNatural) {
        state.buffer += content;

        // 尝试解析工具调用 JSON
        if (state.buffer.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(state.buffer.trim());
            if (parsed.tool && parsed.args) {
              state.isToolCall = true;
              state.toolObj = parsed;
              continue;
            }
          } catch (e) {
            // JSON 还不完整，但如果是自然语言前缀，立刻输出
            if (state.buffer.length > 10 && !state.buffer.trim().startsWith('{')) {
              onNatural(state.buffer);
              state.assistantContent += state.buffer;
              state.buffer = '';
              state.startedNatural = true;
            }
          }
        } else if (!state.buffer.startsWith('{')) {
          // 明确不是 JSON，直接输出
          onNatural(state.buffer);
          state.assistantContent += state.buffer;
          state.buffer = '';
          state.startedNatural = true;
        }
      } else if (state.isToolCall) {
        // 已判定为工具调用，忽略后续文本
        continue;
      } else {
        // 自然语言模式，直接输出
        onNatural(content);
        state.assistantContent += content;
      }
    } catch (e) { /* 忽略该行的解析错误 */ }
  }

  return state;
}

module.exports = { parseOpenAIChunk };