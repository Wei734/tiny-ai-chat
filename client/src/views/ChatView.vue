<!-- client/src/views/ChatView.vue -->
<template>
  <div class="chat-container">
    <!-- 左侧侧边栏 -->
    <el-aside :width="isSidebarCollapsed ? '60px' : '220px'" class="sidebar" :class="{ collapsed: isSidebarCollapsed }">
      
      <!-- 统一折叠按钮：始终存在，绝对定位在右上角 -->
      <el-button 
        circle 
        size="small"
        :icon="isSidebarCollapsed ? Expand : Fold" 
        @click="toggleSidebar" 
        class="sidebar-toggle-btn"
      />

      <!-- 折叠后的内容：不再需要 collapsed-icon-wrapper -->
      <div v-if="isSidebarCollapsed" class="collapsed-placeholder">
        <!-- 如果想在折叠时完全空白，可以留空，但保留 placeholder 以便布局 -->
      </div>

      <!-- 展开时的完整内容 -->
      <div v-else class="sidebar-content">
        <div class="new-chat-btn">
          <!-- 注意：这里不再有折叠按钮 -->
          <el-button type="primary" :icon="Plus" @click="startNewChat" class="new-chat-main-btn" style="width: 100%">
            新建对话
          </el-button>
        </div>
        <div class="history-list">
          <div class="history-title">历史对话</div>
          <el-scrollbar>
            <div 
              v-for="item in historyList" 
              :key="item.id" 
              class="history-item"
              :class="{ active: currentChatId === item.id }"
              @click="loadChat(item)"
            >
              <el-icon><ChatDotRound /></el-icon>
              <div class="item-info"> <!-- 包裹标题和时间 -->
                <span class="title-text">{{ item.title }}</span>
                <!-- <span class="time-text">{{ formatTime(item.id) }}</span>  先隐藏时间 -->
              </div>
              <el-icon class="delete-icon" @click.stop="deleteChat(item.id)"><Delete /></el-icon>
            </div>
          </el-scrollbar>
        </div>
      </div>
    </el-aside>

    <!-- 右侧聊天区域 -->
    <el-main class="main-content" ref="mainScrollRef">
      <div class="chat-header">
        <div class="model-selector">
          <span style="margin-right: 10px;">当前模型:</span>
          <el-select
            v-model="selectedModel"
            placeholder="选择模型"
            style="width: 240px"
            :prefix-icon="selectedModelIcon"
          >
            <el-option
              v-for="item in modelOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            >
              <el-icon style="margin-right: 8px; vertical-align: middle">
                <component :is="getModelIcon(item.value)" />
              </el-icon>
              <span>{{ item.label }}</span>
            </el-option>
          </el-select>
        </div>
      </div>

      <div class="message-list" ref="messageListRef">
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
  </div>
</template>

<script setup>
import { onMounted, ref, watch, nextTick, computed } from 'vue';
import {
  Plus,
  ChatDotRound,
  Delete,
  Service,
  Fold, 
  Expand,
  // 新增图标导入
  ChatLineSquare,
  Connection,
  Cpu,
  Monitor,
  Star,
} from '@element-plus/icons-vue';
import MessageBubble from '@/components/MessageBubble.vue';
import ChatInput from '@/components/ChatInput.vue';
import { useChat } from '@/composables/useChat';

// 引入逻辑
const {
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
  toggleSidebar,
} = useChat();

// 时间格式化
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// 初始化
onMounted(() => {
  initHistory();
  fetchModels();
});

// 模型相关
const selectedModel = ref('没有模型');
const modelOptions = ref([]);

const modelIconMap = {
  'kimi': ChatLineSquare,
  'gpt': Cpu,
  'claude': Connection,
  'deepseek': Star,
};

const getModelIcon = (modelValue) => modelIconMap[modelValue] || Service;
const selectedModelIcon = computed(() => getModelIcon(selectedModel.value));

const fetchModels = async () => {
  try {
    const res = await fetch('http://localhost:3001/api/models');
    if (!res.ok) throw new Error('获取模型列表失败');
    const data = await res.json();
    modelOptions.value = data;
  } catch (e) {
    console.error(e);
  }
};

const mainScrollRef = ref(null);

// 自动滚动
watch(
  () => [
    messages.value.length,
    messages.value[messages.value.length - 1]?.content,
  ],
  () => {
    nextTick(() => {
      const el = mainScrollRef.value?.$el || mainScrollRef.value;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  },
  { deep: true }
);

</script>

<style scoped>
.chat-container {
  height: 100vh;
  display: flex;
}

.sidebar {
  background-color: #1e1e1e;
  color: #fff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
}

/* 统一的侧边栏折叠按钮（绝对定位，始终在右上角） */
.sidebar-toggle-btn {
  position: absolute;
  top: 20px;                /* 与展开时新建按钮上边缘差不多 */
  right: 20px;              /* 与展开时新建按钮右边缘对齐 */
  z-index: 20;              /* 高于其他内容 */
  
  /* 尺寸：使用 size="small" 的默认 circle 即可，不需要额外宽高 */
  /* 颜色风格保持暗色 */
  background-color: #2c2c2c;
  border-color: #555;
  color: #ccc;
}
.sidebar-toggle-btn:hover {
  background-color: #3c3c3c;
  border-color: #888;
  color: #fff;
}

/* 折叠状态下的占位容器（可选，保持侧边栏结构） */
.collapsed-placeholder {
  flex: 1;                  /* 占满剩余空间，让按钮固定定位不影响 */
}

/* 让新建对话按钮区域变成纵向 flex 容器 */
.new-chat-btn {
  padding: 60px 20px 20px 20px;
}

/* 新建对话主按钮 - 暗灰风格 */
.new-chat-main-btn {
  background-color: #2c2c2c;
  border-color: #555;
  color: #eee;
  border-radius: 12px;   /* 左右更圆角，见下一条 */
}
.new-chat-main-btn:hover {
  background-color: #3c3c3c;
  border-color: #888;
  color: #fff;
}
.new-chat-main-btn:active {
  background-color: #1f1f1f;
}

.history-list {
  flex: 1;
  overflow: hidden;
}

.history-title {
  padding: 10px 20px;
  font-size: 12px;
  color: #888;
}

.main-content {
  background-color: #f5f7fa;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  scrollbar-gutter: stable;
  height: 100vh;
  padding: 0;
}

.chat-header {
  height: 50px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  padding-left: 20px;
  font-weight: bold;
  color: #333;
  position: sticky;
  top: 0;
  background-color: #f5f7fa;
  z-index: 10;
}

.message-list {
  width: 100%;
  flex: 1 0 auto;
  padding: 20px 0;
  box-sizing: border-box;
}

.chat-input-fixed {
  position: sticky;
  bottom: 0;
  background-color: #f5f7fa;
  z-index: 2;
  width: 670px;
  margin: 0 auto;
  padding: 0 0 30px;
}

.messages-wrapper {
  width: 660px;
  margin: 0 auto;
}

/* 思考动画 */
.message-item {
  margin-bottom: 40px;
  display: flex;
  align-items: flex-start;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.ai-avatar {
  background-color: #409eff;
  color: #fff;
  margin-right: 12px;
}

.bubble {
  background-color: #fff;
  padding: 10px 20px;
  border-radius: 8px;
}

.thinking {
  display: flex;
  align-items: center;
  padding: 4px 20px;
  background-color: transparent;
  box-shadow: none;
  border-radius: 0;
  width: fit-content;
  margin-left: 0;
}

.dot {
  width: 6px;
  height: 6px;
  background-color: #999;
  border-radius: 50%;
  margin: 0 3px;
  animation: bounce 1.4s infinite ease-in-out both;
}

.dot:nth-child(1) { animation-delay: -0.32s; }
.dot:nth-child(2) { animation-delay: -0.16s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

.history-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 8px 20px;              /* 变细 */
  cursor: pointer;
  color: #ececec;
  border-radius: 0 10px 10px 0;
  margin-right: 10px;
  position: relative;
  overflow: hidden;
}

.history-item:hover {
  background-color: #2c2c2c;
}

.history-item.active {
  background-color: #2c2c2c;     /* 非蓝色 */
  /* 如果想稍微区分，可以加个左边框或更亮一点 */
}

/* 图标与标题之间的间距 */
.history-item > .el-icon:first-child {
  margin-right: 8px;
}

/* 标题文字 */
.title-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 侧边栏动画 */
.sidebar {
  transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  position: relative;
}

.sidebar.collapsed .history-list {
  display: none;
}
.sidebar.collapsed .new-chat-btn {
  display: none;
}

.item-info {
  display: flex;
  flex-direction: column;
  margin-left: 10px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.time-text {
  font-size: 11px;
  color: #888;
}

.delete-icon {
  /* 使用 visibility 和 opacity 代替 display 控制显隐，保留占位 */
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.2s, visibility 0.2s;
  font-size: 14px;
  flex-shrink: 0;
  margin-left: 8px;
  margin-right: 4px;        /* 与右边框的额外间距，可按需调整 */
  width: 16px;              /* 固定宽度，防止图标尺寸变化 */
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;     /* 隐藏时无法点击 */
}

.history-item:hover .delete-icon {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;     /* 显示时可点击 */
}

.delete-icon:hover {
  color: #ff4d4f;          /* 红色醒目提示 */
  transform: scale(1.2);   /* 轻微放大，增强选中感 */
  cursor: pointer;
}

/* 滚动条 */
.main-content::-webkit-scrollbar {
  width: 4px;
}
.main-content::-webkit-scrollbar-track {
  background: transparent;
}
.main-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}
.main-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.25);
}

.main-content {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
}
</style>