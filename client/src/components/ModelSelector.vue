<template>
  <div class="model-selector">
    <span style="margin-right: 10px;">当前模型:</span>
    <el-select
      :model-value="modelValue"
      placeholder="选择模型"
      style="width: 240px"
      :prefix-icon="selectedModelIcon"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <el-option
        v-for="item in options"
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
</template>

<script setup>
import { computed } from 'vue';
import { Service, ChatLineSquare, Connection, Cpu, Star } from '@element-plus/icons-vue';

const props = defineProps({
  modelValue: String,
  options: Array,  // 模型列表 [{ value, label }]
});

defineEmits(['update:modelValue']);

const modelIconMap = {
  kimi: ChatLineSquare,
  gpt: Cpu,
  claude: Connection,
  deepseek: Star,
};

const getModelIcon = (modelValue) => modelIconMap[modelValue] || Service;
const selectedModelIcon = computed(() => getModelIcon(props.modelValue));
</script>

<style scoped>
.model-selector {
  display: flex;
  align-items: center;
}
</style>