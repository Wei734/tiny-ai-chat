// \config\models.js
// --- 模型配置表 ---
const PROVIDER_CONFIG = {
  kimi: {
    url: 'https://api.moonshot.cn/v1/chat/completions',
    key: process.env.KIMI_API_KEY,
    type: 'openai'
  },
  ofox: {
    url: 'https://api.ofox.ai/v1/chat/completions',
    key: process.env.OFOX_API_KEY,
    type: 'openai'
  },
  claude: {
    url: 'https://api.ofox.ai/anthropic/v1/messages',
    key: process.env.OFOX_API_KEY,
    type: 'anthropic'
  },
  gemini: {
    url: 'https://api.ofox.ai/v1/chat/completions',
    key: process.env.OFOX_API_KEY,
    type: 'openai'
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    key: process.env.DEEPSEEK_API_KEY,
    type: 'openai'
  }
};

// --- 模型上下文限制 ---
const MODEL_LIMITS = {
  'gpt-4o': 128000,
  'kimi-k2.6': 256000,
  'claude-opus-4.6': 200000,
  'gpt-5.4': 128000,
  'gemini-3.1-pro-preview': 1000000,
  'deepseek-chat': 128000,
  'deepseek-reasoner': 128000,
  'default': 4000
};

// 模型列表配置（与 PROVIDER_CONFIG 和 MODEL_LIMITS 对应）
const MODEL_LIST = [
  { value: 'kimi-k2.6', label: 'Kimi: kimi-k2.6 (便宜好用)' },
  { value: 'deepseek-chat', label: 'DeepSeek: V3.2 (非思考模式)' },
  { value: 'deepseek-reasoner', label: 'DeepSeek: V3.2 (思考模式)' },
  { value: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' },
  { value: 'anthropic/claude-opus-4.6', label: 'Anthropic: Claude Opus 4.6' },
  { value: 'openai/gpt-5.4', label: 'OpenAI: GPT-5.4' },
  { value: 'google/gemini-3.1-pro-preview', label: 'Google: Gemini 3.1 Pro Preview' }
];

// 智能路由
function getProvider(modelName) {
  const lowerModel = modelName.toLowerCase();
  if (lowerModel.includes('moonshot') || lowerModel.includes('kimi')) return PROVIDER_CONFIG.kimi;
  if (lowerModel.includes('claude') || lowerModel.includes('opus')) return PROVIDER_CONFIG.claude;
  if (lowerModel.includes('gemini')) return PROVIDER_CONFIG.gemini;
  if (lowerModel.includes('deepseek')) return PROVIDER_CONFIG.deepseek;
  return PROVIDER_CONFIG.ofox;
};

module.exports = { PROVIDER_CONFIG, MODEL_LIMITS, MODEL_LIST, getProvider };