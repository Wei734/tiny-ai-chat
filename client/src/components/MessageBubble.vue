<!-- client/src\components\MessageBubble.vue -->
<template>
  <div class="message-item" :class="role">
    <!-- 外层容器：纵向排列气泡和按钮 -->
    <div class="bubble-wrapper">
      <!-- 气泡内容 -->
      <div class="bubble">
        <div class="markdown-body" v-html="renderedContent"></div>
      </div>
      <!-- 复制按钮（始终在气泡正下方） -->
      <div class="bubble-actions">
        <el-tooltip content="复制" placement="bottom" :show-arrow="false" effect="light">
          <el-button text :icon="DocumentCopy" @click="handleCopy"></el-button>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ElMessage, ElTooltip } from 'element-plus';  // 引入 ElTooltip
import { DocumentCopy } from '@element-plus/icons-vue';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (e) {
          console.error('高亮失败:', e);
        }
      }
      return hljs.highlightAuto(code).value;
    }
  })
);

marked.setOptions({ breaks: true, gfm: true });

const props = defineProps({
  content: String,
  role: String
});

const renderedContent = computed(() => {
  if (!props.content) return '';
  try {
    return marked.parse(props.content);
  } catch (error) {
    console.error('Markdown 渲染失败:', error);
    return props.content;
  }
});

const handleCopy = () => {
  navigator.clipboard.writeText(props.content).then(() => {
    ElMessage.success('已复制');
  }).catch(() => {
    ElMessage.error('复制失败');
  });
};
</script>

<style scoped>
.message-item {
  display: flex;
  margin-bottom: 20px;
  align-items: flex-start;
}

.message-item.user {
  justify-content: flex-end;
}

/* 外层包裹：纵向排列，宽度与气泡一致 */
.bubble-wrapper {
  display: flex;
  flex-direction: column;
  width: 670px;
  max-width: 100%;
}

/* 用户的气泡整体向左留空 */
.message-item.user .bubble-wrapper {
  margin-left: 80px;
}

/* 气泡基础样式 */
.bubble {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

/* 用户气泡：绿色背景 */
.message-item.user .bubble {
  background-color: #ffffff;   /* 改为白色，和输入框背景统一 */
  color: #000;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); /* 保留微阴影，与AI无背景区分 */
}

/* AI 气泡：无背景、无阴影、无圆角，简洁 */
.message-item.assistant .bubble {
  background-color: transparent;
  box-shadow: none;
  padding: 0;
  border-radius: 0;
}

/* 复制按钮区域 */
.bubble-actions {
  display: flex;
  opacity: 0.5;
  transition: opacity 0.2s, color 0.2s;
  margin-top: 4px;
  color: #666;
}

/* AI 按钮靠左 */
.message-item.assistant .bubble-actions {
  justify-content: flex-start;
}

/* 用户按钮靠右 */
.message-item.user .bubble-actions {
  justify-content: flex-end;
}

/* 仅当悬停在按钮区域时加深 */
.bubble-actions:hover {
  opacity: 1;
  color: #333;
}

/* 让复制按钮的图标变大 */
:deep(.bubble-actions .el-button) {
  font-size: 18px;
  padding: 4px;
}

/* ---- Markdown 样式（保持不变）---- */
:deep(.markdown-body pre) {
  background-color: #0d1117;
  padding: 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

:deep(.markdown-body pre code) {
  font-family: 'Fira Code', Consolas, Monaco, 'Andale Mono', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: none;
  padding: 0;
}

:deep(.markdown-body code) {
  font-family: Consolas, Monaco, 'Andale Mono', monospace;
  background-color: rgba(175, 184, 193, 0.2);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}

:deep(.markdown-body p) {
  margin-bottom: 0.5em;
}

:deep(.hljs) {
  background: transparent !important;
  padding: 0 !important;
}
</style>