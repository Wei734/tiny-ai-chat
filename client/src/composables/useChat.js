// client/src/composables/useChat.js
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';

const isSidebarCollapsed = ref(false);
const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

export function useChat() {
  const messages = ref([]);
  const isThinking = ref(false);
  const messageListRef = ref(null);
  const historyList = ref([]);          // 存储从后端拿到的摘要列表
  const currentChatId = ref(null);

  // ===== 1. 初始化：从后端拉取历史列表 =====
  const initHistory = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/threads');
      if (!res.ok) throw new Error('获取历史失败');
      const data = await res.json();
      historyList.value = data;   // data 是摘要数组 [{id, title, updatedAt, messageCount}]
    } catch (e) {
      console.error('初始化历史列表失败', e);
      historyList.value = [];
    }
  };

  // ===== 2. 加载某个对话的完整消息 =====
  const loadChat = async (item) => {
    try {
      const res = await fetch(`http://localhost:3001/api/threads/${item.id}`);
      if (!res.ok) throw new Error('对话可能已被删除');
      const thread = await res.json();
      currentChatId.value = thread.id;
      messages.value = thread.messages || [];
    } catch (e) {
      ElMessage.error('加载对话失败，该记录可能已损坏');
      // 如果加载失败，从历史列表中移除（UI 上）
      historyList.value = historyList.value.filter(h => h.id !== item.id);
      startNewChat();
    }
  };

  // ===== 3. 保存对话到后端（覆盖整个 messages 数组） =====
  const saveChatToBackend = async (chatId, msgs) => {
    try {
      await fetch(`http://localhost:3001/api/threads/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: msgs })
      });
    } catch (e) {
      console.error('保存对话失败', e);
      // 不阻塞用户，只打印错误
    }
  };

  // ===== 4. 删除对话（暂时只从前端移除，后端可扩展） =====
  const deleteChat = async (id) => {
    try {
      const res = await fetch(`http://localhost:3001/api/threads/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('删除失败');
    } catch (e) {
      console.error('后端删除失败:', e);
      ElMessage.error('删除失败，请稍后再试');
      return; // 如果后端删除失败，前端也保留列表，避免数据不一致
    }

    // 后端删除成功后，更新前端历史列表
    historyList.value = historyList.value.filter(item => item.id !== id);
    if (currentChatId.value === id) {
      startNewChat();
    }
    ElMessage.success('对话已删除');
  };

  // 新建对话
  const startNewChat = () => {
    messages.value = [];
    currentChatId.value = null;
  };

  // 强制清空（现在只是清空当前列表，后端数据还在，你可以扩展）
  const forceClear = () => {
    historyList.value = [];
    startNewChat();
    ElMessage.success('本地列表已清空');
    // 如需要，可以调用后端的批量删除接口
  };

  // 滚动到底部
  const scrollToBottom = () => {
    nextTick(() => {
      if (messageListRef.value) {
        messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
      }
    });
  };

  // ===== 5. 发送消息（核心逻辑，改动最大） =====
  const sendMessage = async (text, model) => {
    // 添加用户消息
    messages.value.push({ role: 'user', content: text });
    scrollToBottom();

    // 准备 AI 消息占位
    isThinking.value = true;
    const aiMessageIndex = messages.value.length;
    messages.value.push({ role: 'assistant', content: '' });

    // 如果是新对话，生成一个线程 ID（时间戳）
    if (!currentChatId.value) {
      currentChatId.value = Date.now();
    }

    try {
      // 数据清洗
      const cleanMessages = messages.value
        .filter(msg => msg && msg.content && msg.content.trim() !== '')
        .map(msg => ({ role: msg.role, content: msg.content }));

      if (cleanMessages.length === 0) {
        ElMessage.warning('没有有效的消息');
        isThinking.value = false;
        return;
      }

      // 发起聊天请求（和原来一样）
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: cleanMessages,
          model: model
        })
      });

      if (!response.ok) throw new Error('网络响应异常');

      // 处理流式响应
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      isThinking.value = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '');
            if (jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.content) {
                messages.value[aiMessageIndex].content += parsed.content;
                scrollToBottom();
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }

      // ✅ 关键：流式结束后，把完整的 messages 保存到后端
      await saveChatToBackend(currentChatId.value, messages.value);

      // ✅ 顺便刷新侧边栏历史列表（重新拉取，确保标题等更新）
      await initHistory();

    } catch (error) {
      console.error(error);
      ElMessage.error('请求失败');
      messages.value[aiMessageIndex].content = '连接服务器失败...';
      isThinking.value = false;
    }
  };

  return {
    messages,
    isThinking,
    messageListRef,
    historyList,
    currentChatId,
    initHistory,
    sendMessage,
    startNewChat,
    loadChat,
    deleteChat,
    forceClear,
    isSidebarCollapsed,
    toggleSidebar
  };
}