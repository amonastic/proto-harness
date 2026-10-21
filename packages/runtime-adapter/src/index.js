import { createLocalAdapter } from './local.js';
import { createOpenAICompatibleAdapter } from './openai.js';

export { createLocalAdapter, createOpenAICompatibleAdapter };
export { localProductAnalysis, localRequirementAnalysis } from './local.js';
export { extractJson, normalizeProductAnalysis, normalizeRequirementAnalysis, normalizeInteractionSpec } from './parse.js';

export function createAdapter(config = {}) {
  const kind = config.kind || config.model?.kind || 'local-heuristic';
  if (kind === 'openai-compatible') {
    return createOpenAICompatibleAdapter({
      baseUrl: config.baseUrl || config.model?.baseUrl,
      apiKey: config.apiKey,
      model: config.model?.model || config.modelId,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      jsonMode: config.jsonMode !== false,
      fetchImpl: config.fetchImpl,
      label: config.label || 'OpenAI 兼容模型'
    });
  }
  return createLocalAdapter();
}
