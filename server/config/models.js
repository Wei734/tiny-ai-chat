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

// 模型 -> 供应商配置 key 的映射表
const MODEL_PROVIDER_MAP = {
  'kimi-k2.6': 'kimi',
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  'gpt-4o': 'ofox',
  'gpt-5.4': 'ofox',
  'claude-opus-4.6': 'claude',
  'gemini-3.1-pro-preview': 'gemini',   // 实际用的还是 ofox 的 openai 兼容接口，但 PRODIVER_CONFIG 里 gemini 已经指向了 ofox 的 url，所以保持一致
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
  { value: 'gpt-4o', label: 'OpenAI: GPT-4o' },
  { value: 'claude-opus-4.6', label: 'Anthropic: Claude Opus 4.6' },
  { value: 'gpt-5.4', label: 'OpenAI: GPT-5.4' },
  { value: 'gemini-3.1-pro-preview', label: 'Google: Gemini 3.1 Pro Preview' }
];

// 智能路由
function getProvider(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    console.error('[getProvider] 无效的 modelName:', modelName);
    return null;
  }

  const providerKey = MODEL_PROVIDER_MAP[modelName];

  if (!providerKey) {
    console.warn(`[getProvider] 未匹配到供应商，模型名: ${modelName}`);
    // 根据你的需求选择：
    // 1. 返回 null 让上层报错
    // 2. 返回一个默认供应商（比如 ofox）
    return null;   // 或 return PROVIDER_CONFIG.ofox;
  }

  return PROVIDER_CONFIG[providerKey];
}

module.exports = { PROVIDER_CONFIG, MODEL_LIMITS, MODEL_LIST, getProvider };