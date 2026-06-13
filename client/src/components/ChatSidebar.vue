< --! src\components\ChatSidebar.vue -- >
<template>
  <el-aside :width="isCollapsed ? '60px' : '220px'" class="sidebar" :class="{ collapsed: isCollapsed }">
    <el-button 
      circle 
      size="small"
      :icon="isCollapsed ? Expand : Fold" 
      @click="$emit('toggle')" 
      class="sidebar-toggle-btn"
    />

    <div v-if="isCollapsed" class="collapsed-placeholder"></div>
    <div v-else class="sidebar-content">
      <div class="new-chat-btn">
        <el-button type="primary" :icon="Plus" @click="$emit('new-chat')" class="new-chat-main-btn" style="width: 100%">
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
            @click="$emit('load-chat', item)"
          >
            <el-icon><ChatDotRound /></el-icon>
            <div class="item-info">
              <span class="title-text">{{ item.title }}</span>
            </div>
            <el-icon class="delete-icon" @click.stop="$emit('delete-chat', item.id)"><Delete /></el-icon>
          </div>
        </el-scrollbar>
      </div>
    </div>
  </el-aside>
</template>

<script setup>
import { Plus, ChatDotRound, Delete, Fold, Expand } from '@element-plus/icons-vue';

defineProps({
  isCollapsed: Boolean,
  historyList: Array,
  currentChatId: [String, Number],
});

defineEmits(['toggle', 'new-chat', 'load-chat', 'delete-chat']);
</script>

<style scoped>
/* 把原来 sidebar 相关的所有样式移到这里 */
.sidebar {
  background-color: #1e1e1e;
  color: #fff;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #333;
  position: relative;
  transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.sidebar-toggle-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 20;
  background-color: #2c2c2c;
  border-color: #555;
  color: #ccc;
}
.sidebar-toggle-btn:hover {
  background-color: #3c3c3c;
  border-color: #888;
  color: #fff;
}
.collapsed-placeholder {
  flex: 1;
}
.new-chat-btn {
  padding: 60px 20px 20px 20px;
}
.new-chat-main-btn {
  background-color: #2c2c2c;
  border-color: #555;
  color: #eee;
  border-radius: 12px;
}
.new-chat-main-btn:hover {
  background-color: #3c3c3c;
  border-color: #888;
  color: #fff;
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
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 8px 20px;
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
  background-color: #2c2c2c;
}
.history-item > .el-icon:first-child {
  margin-right: 8px;
}
.title-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-info {
  display: flex;
  flex-direction: column;
  margin-left: 10px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.delete-icon {
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.2s, visibility 0.2s;
  font-size: 14px;
  flex-shrink: 0;
  margin-left: 8px;
  margin-right: 4px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.history-item:hover .delete-icon {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
}
.delete-icon:hover {
  color: #ff4d4f;
  transform: scale(1.2);
  cursor: pointer;
}
.sidebar.collapsed .history-list,
.sidebar.collapsed .new-chat-btn {
  display: none;
}
</style>