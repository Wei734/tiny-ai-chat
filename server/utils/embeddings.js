// server/utils/embeddings.js
// 必须在 require 之前设置，强制离线
process.env.ALLOW_REMOTE_MODELS = 'false';
process.env.REMOTE_MODELS = 'false';
process.env.HF_HUB_OFFLINE = '1';

const { pipeline } = require('@xenova/transformers');

let embedPipeline = null;

async function initEmbeddingModel() {
  console.log('正在加载本地 Embedding 模型（纯离线，无网络）...');
  embedPipeline = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2',
    {
      local_files_only: true,     // 关键：禁止任何远程请求
    }
  );
  console.log('Embedding 模型加载完成');
}

async function embed(text) {
  if (!embedPipeline) {
    throw new Error('Embedding 模型尚未初始化');
  }
  const output = await embedPipeline(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

module.exports = { initEmbeddingModel, embed };