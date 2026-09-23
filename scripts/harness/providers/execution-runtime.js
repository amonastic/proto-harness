'use strict';

// H02A（P1）：ExecutionProvider 泛型运行时 —— DeepSeek v4 flash（官方 API）。
//
// D-USER-SWITCH-PROVIDER（用户 2026-08-12 裁决）：执行端固定为 DeepSeek v4 flash（官方 API），
// 覆盖 H00A Section 5 中 LongCat 2.0 的 selected-pending-smoke。
// 来源清册 Section 5 是模型/judge 状态的唯一 canonical。
//
// 配置（环境变量）：
//   DEEPSEEK_API_KEY  —— 必填；缺失时 call() 抛 H02A_EXECUTION_API_KEY_MISSING（doctor 报错、smoke 失败）
//   DEEPSEEK_BASE_URL —— 可选，默认 https://api.deepseek.com（官方）
//   DEEPSEEK_MODEL_ID —— 可选，默认 deepseek-chat（DeepSeek 官方 API chat 端点；"v4 flash" 为产品称呼，
//                        以模型 ID 可配应对官方端点演进，doctor 输出实际生效值）
//
// 行为契约（任务包 5.2）：
//   1. 使用环境变量配置；2. 构造独立 context_id（exec-<runId>-<taskId>-<timestamp>）；
//   3. 返回符合 provider.schema.json 的 result 对象；4. timeout 30s、retry 1 次（9.1 自主决策）。
//
// 测试注入：createExecutionRuntime({ fetchImpl }) 允许契约测试注入 fake fetch，
// 生产路径使用 Node 18+ 全局 fetch。

const { buildProviderResult } = require('../lib/runner/protocol');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL_ID = 'deepseek-chat';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 1;

function readConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    modelId: process.env.DEEPSEEK_MODEL_ID || DEFAULT_MODEL_ID
  };
}

// 独立 context_id：exec-<runId>-<taskId>-<timestamp>（与 judge 端完全不同前缀，保证独立性）
function buildContextId(runId, taskId) {
  return `exec-${runId}-${taskId}-${Date.now()}`;
}

function createExecutionRuntime({ fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  return {
    provider_id: 'P-DEEPSEEK-V4-FLASH',
    role: 'execution',
    status: 'selected-pending-smoke', // 待 smoke 通过后升级 callable-confirmed（来源清册 canonical）
    request_schema: 'urn:h02:provider-request-v1',
    result_schema: 'urn:h02:provider-result-v1',
    source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES', 'urn:h01:provider.schema.json', 'D-USER-SWITCH-PROVIDER'],
    scope: 'harness-engineering',

    // Provider 描述对象：满足 provider.schema.json（status 反映运行时 selected-pending-smoke，与来源清册一致）
    describe() {
      return {
        schema_version: 'h01-provider-v1',
        provider_id: this.provider_id,
        role: 'local-fixture', // 保持 provider.schema.json 的 role 枚举约束（H02A 期间仍为本地角色描述）
        status: 'selected-pending-smoke', // 待 smoke 通过后升级 callable-confirmed（来源清册 canonical）
        request_schema: this.request_schema,
        result_schema: this.result_schema,
        source_refs: this.source_refs,
        scope: this.scope
      };
    },

    // 配置可见性（doctor 使用；不输出 api key 本身）
    config() {
      const config = readConfig();
      return {
        provider_id: this.provider_id,
        model_id: config.modelId,
        base_url: config.baseUrl,
        api_key_present: config.apiKey.length > 0
      };
    },

    buildContextId(runId, taskId) {
      return buildContextId(runId, taskId);
    },

    // 真实调用：POST {baseUrl}/chat/completions，最小 prompt；timeout 30s + retry 1 次。
    // 返回统一 provider result（buildProviderResult 结构）。
    // maxTokens：可选，P8.3 扩展——requirement-interview 等任务需要长输出；
    // 缺省 16 保持 P1/H02A 原有行为（verdict 判定场景），向后兼容。
    async call({ runId, taskId, prompt, maxTokens }) {
      const config = readConfig();
      if (config.apiKey.length === 0) {
        const error = new Error('DEEPSEEK_API_KEY 缺失：doctor 已报错，执行端无法发起真实调用');
        error.code = 'H02A_EXECUTION_API_KEY_MISSING';
        throw error;
      }
      const contextId = buildContextId(runId, taskId);
      const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const body = {
        model: config.modelId,
        messages: [{ role: 'user', content: prompt || 'Echo: test' }],
        max_tokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 16
      };

      let lastError = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await doFetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          clearTimeout(timer);
          if (!response.ok) {
            // 错误消息只保留 status code，不拼远端响应体原文（防端点回显 Authorization 头导致 key 进日志）
            throw new Error(`DeepSeek API HTTP ${response.status}`);
          }
          const payload = await response.json();
          const summary = payload && payload.choices && payload.choices[0] && payload.choices[0].message
            ? String(payload.choices[0].message.content || '').slice(0, 200)
            : 'DeepSeek v4 flash returned empty completion';
          return buildProviderResult({
            providerId: this.provider_id,
            role: 'execution',
            requestId: contextId,
            outcome: {
              code: 'OK',
              summary: `deepseek-v4-flash echoed: ${summary}`,
              exit_code: 0,
              tool_result: { tool: 'deepseek-v4-flash', summary }
            }
          });
        } catch (error) {
          clearTimeout(timer);
          lastError = error;
        }
      }
      throw new Error(`H02A_EXECUTION_CALL_FAILED ${lastError ? lastError.message : 'unknown'}`.slice(0, 500));
    }
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  REQUEST_TIMEOUT_MS,
  MAX_RETRIES,
  readConfig,
  buildContextId,
  createExecutionRuntime
};
