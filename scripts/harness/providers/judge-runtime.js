'use strict';

// H02A（P1）：JudgeProvider 泛型运行时（model_id + base_url + auth_method 运行时注入）。
//
// D-USER-SWITCH-PROVIDER（用户 2026-08-12 裁决）：judge 端泛型可配，
// 覆盖 H00A Section 5 中 Codex Judge 的 selected-pending-smoke。
// 来源清册 Section 5 是模型/judge 状态的唯一 canonical（judge 泛型配置状态：planned）。
//
// 配置（环境变量）：
//   JUDGE_MODEL_ID    —— 可选，fallback 'claude-sonnet-4.6'（用户 2026-08-12 确认）
//   JUDGE_BASE_URL    —— 可选，fallback 'https://api.anthropic.com'
//   JUDGE_AUTH_METHOD —— 可选，fallback 'api-key'（'api-key'|'bearer'|'oauth2'）
// 未配置时 doctor 给出 warning（fail-open，任务包 6.1）。
//
// 行为契约（任务包 5.2）：
//   1. 读取环境变量；2. 未配置使用 fallback；3. 构造独立 context_id（judge-<runId>-<taskId>-<timestamp>）；
//   4. 执行端与 judge 端 context_id 完全不同，保证独立性。

const { buildProviderResult } = require('../lib/runner/protocol');

const FALLBACK_MODEL_ID = 'claude-sonnet-4.6';
const FALLBACK_BASE_URL = 'https://api.anthropic.com';
const FALLBACK_AUTH_METHOD = 'api-key';
const AUTH_METHODS = Object.freeze(['api-key', 'bearer', 'oauth2']);

function readJudgeConfig() {
  const configured = process.env.JUDGE_MODEL_ID || process.env.JUDGE_BASE_URL || process.env.JUDGE_AUTH_METHOD;
  return {
    modelId: process.env.JUDGE_MODEL_ID || FALLBACK_MODEL_ID,
    baseUrl: process.env.JUDGE_BASE_URL || FALLBACK_BASE_URL,
    authMethod: process.env.JUDGE_AUTH_METHOD || FALLBACK_AUTH_METHOD,
    usingFallback: !configured
  };
}

// 独立 context_id：judge-<runId>-<taskId>-<timestamp>（与执行端 exec- 前缀完全不同）
function buildContextId(runId, taskId) {
  return `judge-${runId}-${taskId}-${Date.now()}`;
}

function createJudgeRuntime({ fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  return {
    provider_id: 'J-GENERIC-JUDGE',
    role: 'judge',
    status: 'planned', // H02A 期间泛型 judge 接口为 planned，真实语义判断留待 P2+
    request_schema: 'urn:h02:provider-request-v1',
    result_schema: 'urn:h02:provider-result-v1',
    source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES', 'urn:h01:provider.schema.json', 'D-USER-SWITCH-PROVIDER'],
    scope: 'harness-engineering',

    describe() {
      return {
        schema_version: 'h01-provider-v1',
        provider_id: this.provider_id,
        role: 'local-fixture',
        // 运行时状态 planned 不在 provider.schema.json 枚举中，describe() 使用最近合法状态
        // （selected-pending-smoke）；来源清册候选状态 planned 以 config() 与清册 Section 5 为准
        status: 'selected-pending-smoke',
        request_schema: this.request_schema,
        result_schema: this.result_schema,
        source_refs: this.source_refs,
        scope: this.scope
      };
    },

    // 配置可见性（doctor 使用；不输出任何密钥）
    config() {
      const config = readJudgeConfig();
      return {
        provider_id: this.provider_id,
        model_id: config.modelId,
        base_url: config.baseUrl,
        auth_method: config.authMethod,
        using_fallback: config.usingFallback
      };
    },

    buildContextId(runId, taskId) {
      return buildContextId(runId, taskId);
    },

    // 真实调用：POST {baseUrl}/v1/messages（Anthropic 兼容形态，泛型 base_url 可指向任意兼容端点）。
    // 返回统一 provider result 结构。
    async call({ runId, taskId, prompt }) {
      const config = readJudgeConfig();
      const contextId = buildContextId(runId, taskId);
      const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/messages`;
      // 只使用 judge 自有密钥（JUDGE_API_KEY），不得以 DEEPSEEK_API_KEY 兜底（防跨端点密钥泄露）
      const apiKey = process.env.JUDGE_API_KEY || '';
      const body = {
        model: config.modelId,
        max_tokens: 16,
        messages: [{ role: 'user', content: prompt || 'Echo: test' }]
      };
      const headers = { 'Content-Type': 'application/json' };
      if (config.authMethod === 'oauth2') {
        // oauth2：假设已有 bearer token 注入
        headers.Authorization = `Bearer ${process.env.JUDGE_OAUTH_TOKEN || ''}`;
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
        headers['x-api-key'] = apiKey;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!response.ok) {
          // 错误消息只保留 status code，不拼远端响应体原文（防端点回显 Authorization 头导致 key 进日志）
          throw new Error(`Judge API HTTP ${response.status}`);
        }
        const payload = await response.json();
        const summary = payload && payload.content && payload.content[0] && payload.content[0].text
          ? String(payload.content[0].text).slice(0, 200)
          : 'judge returned empty completion';
        return buildProviderResult({
          providerId: this.provider_id,
          role: 'judge',
          requestId: contextId,
          outcome: {
            code: 'OK',
            summary: `judge echoed: ${summary}`,
            exit_code: 0,
            tool_result: { tool: 'generic-judge', summary }
          }
        });
      } catch (error) {
        clearTimeout(timer);
        throw new Error(`H02A_JUDGE_CALL_FAILED ${error.message}`.slice(0, 500));
      }
    }
  };
}

module.exports = {
  FALLBACK_MODEL_ID,
  FALLBACK_BASE_URL,
  FALLBACK_AUTH_METHOD,
  AUTH_METHODS,
  readJudgeConfig,
  buildContextId,
  createJudgeRuntime
};
