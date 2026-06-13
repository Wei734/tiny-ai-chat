import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';

export function useAutoScroll(messages, currentChatId) {
  const containerRef = ref(null);
  const BOTTOM_THRESHOLD = 50;
  const showScrollButton = ref(false);
  const autoScrollEnabled = ref(true);
  const autoScrolling = ref(false);

  const handleScroll = () => {
    if (autoScrolling.value) return;
    const el = containerRef.value;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const distance = scrollHeight - scrollTop - clientHeight;
    const atBottom = distance <= BOTTOM_THRESHOLD;
    autoScrollEnabled.value = atBottom;
    showScrollButton.value = !atBottom;
  };

  const scrollToBottom = () => {
    const el = containerRef.value;
    if (!el) return;
    autoScrolling.value = true;
    el.scrollTop = el.scrollHeight;
    autoScrollEnabled.value = true;
    showScrollButton.value = false;
    requestAnimationFrame(() => {
      autoScrolling.value = false;
    });
  };

  // 消息变化自动滚动
  watch(
    () => [
      messages.value.length,
      messages.value[messages.value.length - 1]?.content,
    ],
    () => {
      const lastMsg = messages.value[messages.value.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        nextTick(() => scrollToBottom());
        return;
      }
      if (!autoScrollEnabled.value) return;
      nextTick(() => {
        const el = containerRef.value;
        if (el) {
          autoScrolling.value = true;
          el.scrollTop = el.scrollHeight;
          requestAnimationFrame(() => {
            autoScrolling.value = false;
          });
        }
      });
    },
    { deep: true }
  );

  // 切换对话回底
  watch(currentChatId, () => {
    nextTick(() => scrollToBottom());
  });

  // 绑定事件
  onMounted(() => {
    nextTick(() => {
      const el = containerRef.value;
      if (el) {
        el.addEventListener('scroll', handleScroll, { passive: true });
      }
    });
  });

  onUnmounted(() => {
    const el = containerRef.value;
    if (el) {
      el.removeEventListener('scroll', handleScroll);
    }
  });

  return {
    containerRef,
    showScrollButton,
    scrollToBottom,
  };
}