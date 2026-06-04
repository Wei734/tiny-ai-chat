<!-- client/src/components/ChatInput.vue -->
<template>
  <div class="input-area">
    <textarea
      v-model="inputValue"
      :rows="3"
      placeholder="输入你想问的问题... (Shift+Enter换行)"
      @keydown.enter="handleKeydown"
      :disabled="disabled"
      class="chat-textarea"
    ></textarea>
    <div class="send-btn-wrapper">
      <el-button type="primary" :icon="Promotion" circle @click="handleSubmit" :loading="disabled"></el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Promotion } from '@element-plus/icons-vue';

const props = defineProps({
  disabled: Boolean
});

const emit = defineEmits(['submit']);

const inputValue = ref('');

const handleKeydown = (e) => {
  if (e.shiftKey) return;   // Shift+Enter 换行
  e.preventDefault();
  handleSubmit();
};

const handleSubmit = () => {
  const text = inputValue.value.trim();
  if (!text || props.disabled) return;
  
  emit('submit', text);
  inputValue.value = '';
};
</script>

<style scoped>
.input-area {
  margin: 0 auto;   /* 上下边距为0，左右自动平分，实现居中 */
  flex-direction: column;   /* 上下排列 */
  align-items: flex-end;    /* 按钮靠右对齐 */
  gap: 10px;                /* 输入框和按钮之间的间距 */
  background-color:#ffffff;
  display: flex;
  align-items: flex-end;
  border-radius: 8px;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.05); /* 轻微上浮阴影 */
}


/* 原生 textarea 样式，完全由你控制 */
.chat-textarea {
  width: 100%;
  padding: 10px 16px;
  border: none;                /* 没有边框 */
  outline: none;               /* 聚焦时也不显示轮廓 */
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  resize: none;                /* 禁止手动拖拽大小 */
  background-color: #ffffff;
  box-shadow: none;
  font-family: inherit;
  box-sizing: border-box;
}


.send-btn-wrapper {
  margin: 8px;
}

</style>