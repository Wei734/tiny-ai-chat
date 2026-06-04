// client/src/composables/useChat.js
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';

const isSidebarCollapsed = ref(false); // 新增：是否折叠
const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

export function useChat() {
  const messages = ref([]);
  const isThinking = ref(false);
  const messageListRef = ref(null);
  const historyList = ref([]);
  const currentChatId = ref(null);

  // 初始化：读取历史记录
  const initHistory = () => {
    const savedHistory = localStorage.getItem('ai_chat_history');
    if (savedHistory) {
      try {
        historyList.value = JSON.parse(savedHistory);
      } catch (e) {
        console.error('历史记录读取失败', e);
      }
    }
  };

  // 滚动到底部
  const scrollToBottom = () => {
    nextTick(() => {
      if (messageListRef.value) {
        messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
      }
    });
  };

  // 保存历史记录
  const saveHistory = () => {
    localStorage.setItem('ai_chat_history', JSON.stringify(historyList.value));
  };

  // 新建对话
  const startNewChat = () => {
    messages.value = [];
    currentChatId.value = null;
  };

  // 发送消息核心逻辑
  const sendMessage = async (text, model) => {

    // 1. 添加用户消息
    messages.value.push({ role: 'user', content: text });
    scrollToBottom();

    // 2. 准备 AI 消息占位
    isThinking.value = true;
    const aiMessageIndex = messages.value.length;
    messages.value.push({ role: 'assistant', content: '' });
    
    // 3. 如果是新对话，初始化历史记录
    let isNewChat = false;
    if (!currentChatId.value) {
      currentChatId.value = Date.now();
      isNewChat = true;
      const newChatItem = {
        id: currentChatId.value,
        title: text.length > 10 ? text.substring(0, 10) + '...' : text,
        messages: []
      };
      historyList.value.unshift(newChatItem);
    }

    try {
      // 4. 数据清洗：过滤空消息
      const cleanMessages = messages.value
        .filter(msg => msg && msg.content && msg.content.trim() !== '')
        .map(msg => ({ role: msg.role, content: msg.content }));

      if (cleanMessages.length === 0) {
        ElMessage.warning('没有有效的消息');
        isThinking.value = false;
        return;
      }

      // 5. 发起请求
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            messages: cleanMessages,
            model: model // <--- 把选中的模型发过去
        })
      });

      if (!response.ok) throw new Error('网络响应异常');

      // 6. 处理流式响应
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      isThinking.value = false; // 停止思考动画

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
              // 忽略解析错误
            }
          }
        }
      }
      
      // 7. 对话结束，保存
      const currentChat = historyList.value.find(c => c.id === currentChatId.value);
      if (currentChat) {
        currentChat.messages = JSON.parse(JSON.stringify(messages.value));
        saveHistory();
      }

    } catch (error) {
      console.error(error);
      ElMessage.error('请求失败');
      messages.value[aiMessageIndex].content = '连接服务器失败...';
      isThinking.value = false;
    }
  };

  // 加载历史
  const loadChat = (item) => {
    try {
      currentChatId.value = item.id;
      messages.value = JSON.parse(JSON.stringify(item.messages));
    } catch (e) {
      ElMessage.error('该记录损坏，已删除');
      deleteChat(item.id);
      startNewChat();
    }
  };

  // 删除历史
  const deleteChat = (id) => {
    historyList.value = historyList.value.filter(item => item.id !== id);
    saveHistory();
    if (currentChatId.value === id) {
      startNewChat();
    }
  };

  // 强制清空
  const forceClear = () => {
    localStorage.removeItem('ai_chat_history');
    historyList.value = [];
    startNewChat();
    ElMessage.success('缓存已清空');
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
