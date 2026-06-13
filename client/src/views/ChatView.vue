<template>
  <div class="chat-container">
    <ChatSidebar
      :is-collapsed="isSidebarCollapsed"
      :history-list="historyList"
      :current-chat-id="currentChatId"
      @toggle="toggleSidebar"
      @new-chat="startNewChat"
      @load-chat="loadChat"
      @delete-chat="deleteChat"
    />

    <el-main class="main-content">
      <div class="chat-header">
        <ModelSelector v-model="selectedModel" :options="modelOptions" />
      </div>

      <div class="message-list" ref="containerRef">
        <div class="messages-wrapper">
          <MessageBubble 
            v-for="(msg, index) in messages" 
            :key="index" 
            :role="msg.role" 
            :content="msg.content" 
          />
          <div v-if="isThinking" class="message-item assistant">
            <div class="bubble-wrapper">
              <div class="bubble thinking">
                <span class="dot"></span><span class="dot"></span><span class="dot"></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-input-fixed">
        <ChatInput :disabled="isThinking" @submit="(text) => sendMessage(text, selectedModel)" />
      </div>
    </el-main>

    <button v-if="showScrollButton" class="scroll-to-bottom-btn" @click="scrollToBottom">
      ↓
    </button>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useChat } from '@/composables/useChat';
import { useAutoScroll } from '@/composables/useAutoScroll';
import ChatSidebar from '@/components/ChatSidebar.vue';
import MessageBubble from '@/components/MessageBubble.vue';
import ChatInput from '@/components/ChatInput.vue';
import ModelSelector from '@/components/ModelSelector.vue';

const {
  messages,
  isThinking,
  historyList,
  currentChatId,
  initHistory,
  sendMessage,
  startNewChat,
  loadChat,
  deleteChat,
  isSidebarCollapsed,
  toggleSidebar,
} = useChat();

const { containerRef, showScrollButton, scrollToBottom } = useAutoScroll(messages, currentChatId);

// ─────────── 模型列表 ───────────
const selectedModel = ref('没有模型');
const modelOptions = ref([]);

const fetchModels = async () => {
  try {
    const res = await fetch('http://localhost:3001/api/models');
    if (!res.ok) throw new Error('获取模型列表失败');
    modelOptions.value = await res.json();
  } catch (e) {
    console.error(e);
  }
};

onMounted(() => {
  initHistory();
  fetchModels();
});
</script>

<style scoped>
.chat-container {
  height: 100vh;
  display: flex;
}

.main-content {
  background-color: #f5f7fa;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100vh;
  padding: 0;
}

.chat-header {
  height: 50px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  padding-left: 20px;
  flex-shrink: 0;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
  box-sizing: border-box;
}

.messages-wrapper {
  width: 660px;
  margin: 0 auto;
}

.chat-input-fixed {
  flex-shrink: 0;
  width: 670px;
  margin: 0 auto;
  padding: 0 0 30px;
}

/* 思考动画（保持不变） */
.message-item { margin-bottom: 40px; display: flex; align-items: flex-start; }
.bubble { background-color: #fff; padding: 10px 20px; border-radius: 8px; }
.thinking { display: flex; align-items: center; padding: 4px 20px; background-color: transparent; box-shadow: none; border-radius: 0; width: fit-content; margin-left: 0; }
.dot { width: 6px; height: 6px; background-color: #999; border-radius: 50%; margin: 0 3px; animation: bounce 1.4s infinite ease-in-out both; }
.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* 滚动条 */
.message-list::-webkit-scrollbar { width: 4px; }
.message-list::-webkit-scrollbar-track { background: transparent; }
.message-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 2px; }
.message-list::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
.message-list { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.15) transparent; }

/* 回到底部按钮 */
.scroll-to-bottom-btn {
  position: fixed;
  bottom: 120px;
  right: 30px;
  z-index: 100;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: rgba(64,158,255,0.9);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  transition: opacity 0.2s, transform 0.2s;
}

.scroll-to-bottom-btn:hover {
  background-color: #409eff;
  transform: scale(1.1);
}
</style>