<!-- client/src/views/ChatView.vue -->
<template>
  <div class="chat-container">
    <!-- 左侧侧边栏 -->
    <!-- :class 动态绑定折叠样式 -->
    <el-aside :width="isSidebarCollapsed ? '60px' : '260px'" class="sidebar" :class="{ collapsed: isSidebarCollapsed }">
      
      <!-- 折叠后的按钮 (只显示图标) -->
      <div v-if="isSidebarCollapsed" class="collapsed-icon-wrapper" @click="toggleSidebar">
        <el-icon :size="24"><Expand /></el-icon>
      </div>

      <!-- 展开时的完整内容 -->
      <div v-else class="sidebar-content">
        <div class="new-chat-btn">
          <el-button type="primary" :icon="Plus" @click="startNewChat" style="width: 100%">
            新建对话
          </el-button>
          <!-- 折叠按钮 (右上角) -->
          <el-button 
              circle 
              :icon="Fold" 
              @click="toggleSidebar" 
              class="collapse-trigger"
              style="margin-left: 10px;">
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
                <span class="time-text">{{ formatTime(item.id) }}</span>
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
          <el-select v-model="selectedModel" placeholder="选择模型" style="width: 240px">
            <el-option
              v-for="item in modelOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </div>
      </div>

      <div class="message-list" ref="messageListRef">
        <div class="messages-wrapper">
          <!-- 使用拆分后的组件 -->
          <MessageBubble 
            v-for="(msg, index) in messages" 
            :key="index" 
            :role="msg.role" 
            :content="msg.content" 
          />

          <!-- 思考动画 -->
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
import { onMounted, ref, watch, nextTick } from 'vue';
import { Plus, ChatDotRound, Delete, Service } from '@element-plus/icons-vue';
import MessageBubble from '@/components/MessageBubble.vue';
import ChatInput from '@/components/ChatInput.vue';
import { useChat } from '@/composables/useChat';
// ... 引入增加 Fold, Expand 图标
import { Fold, Expand } from '@element-plus/icons-vue';

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

// 新增：时间格式化函数
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
  fetchModels();   // 👈 新增：初始化时拉取模型列表
});

// 定义模型列表
const selectedModel = ref('没有模型');
const modelOptions = ref([]);   // 初始空数组

// 获取模型列表
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

// 自动滚动到底部（监听消息变化）
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
/* 布局样式保留 */
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

.new-chat-btn {
  padding: 20px;
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

.history-item {
  padding: 12px 20px;
  cursor: pointer;
  display: flex;
  align-items: center;          /* 改为水平排列，原来你改成了 column，这里建议保持 center */
  color: #ececec;
  border-radius: 0 10px 10px 0;
  margin-right: 10px;
  position: relative;
  overflow: hidden;             /* 👈 关键：防止内容直接溢出 */
  flex-direction: column;
  align-items: flex-start;
}

.history-item:hover {
  background-color: #2c2c2c;
}

.history-item.active {
  background-color: #409eff;
}

.title-text {
  margin-left: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delete-icon {
  display: none;
  font-size: 14px;
}

.history-item:hover .delete-icon {
  display: block;
}

.main-content {
  background-color: #f5f7fa;
  display: flex;
  flex-direction: column;
  overflow-y: auto;            /* 滚动交给 main-content */
  scrollbar-gutter: stable;   /* 预留滚动条空间，防止以后偏位（可以先不加，稳定后再加） */
  height: 100vh;              /* 确保占满高度 */
  padding: 0;           /* 👈 干掉默认的 20px padding */
}

.chat-header {
  height: 50px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  padding-left: 20px;
  font-weight: bold;
  color: #333;
}

/* 移除 .message-list 的滚动属性，仅作包裹 */
.message-list {
  width: 100%;
  flex: 1 0 auto;             /* 占据剩余空间，但高度由内容撑开 */
  padding: 20px 0;
  box-sizing: border-box;
  /* 不再设置 overflow-y: auto */
}

/* 固定输入框在底部 */
.chat-input-fixed {
  position: sticky;
  bottom: 0;
  background-color: #f5f7fa;  /* 遮挡底层消息 */
  z-index: 2;
  width: 670px;               /* 与 wrapper 统一宽度，保证对齐（后续细调） */
  margin: 0 auto;
  padding: 0 0 30px;
}

.messages-wrapper {
  width: 660px;
  margin: 0 auto;
}

/* 思考动画样式 */
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

/* 思考动画专属样式——简洁无气泡 */
.thinking {
  display: flex;
  align-items: center;
  padding: 4px 20px;            /* 上下稍微留白，左右对齐 */
  background-color: transparent; /* 去除白底 */
  box-shadow: none;             /* 去除阴影 */
  border-radius: 0;             /* 去除圆角 */
  width: fit-content;
  margin-left: 0; /* 先默认，如果偏左就调整，例如 48px */
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

/* 侧边栏动画 */
.sidebar {
  transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); /* 丝滑动画 */
  position: relative;
}

.collapsed-icon-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 50px;
  cursor: pointer;
  color: #888;
}
.collapsed-icon-wrapper:hover {
  color: #fff;
}

/* 折叠时的历史列表样式调整 */
.sidebar.collapsed .history-list {
  display: none; /* 折叠时彻底隐藏历史列表，或者你可以做成悬浮显示 */
}
.sidebar.collapsed .new-chat-btn {
  display: none;
}

/* 图标 + 标题信息 + 删除按钮 都在同一行 */
.item-info {
  display: flex;
  flex-direction: column;      /* 标题和时间上下排列 */
  margin-left: 10px;
  flex: 1;                     /* 占据剩余宽度 */
  min-width: 0;                /* 👈 非常重要：允许 flex 子元素收缩 */
  overflow: hidden;            /* 👈 隐藏溢出内容 */
}

.time-text {
  font-size: 11px;
  color: #888;
}

/* 删除按钮 */
.delete-icon {
  display: none;
  font-size: 14px;
  flex-shrink: 0;              /* 防止被压缩 */
  margin-left: 8px;            /* 与标题保持间距 */
}

.collapse-trigger {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 10;
}

/* Webkit 滚动条 */
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

/* Firefox */
.main-content {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.15) transparent;
}
</style>
