'use strict';

// H02：Local Fixture Adapter（纯合成，H02 唯一允许的 ExecutionProvider/JudgeProvider 实现）。
// 输入输出为纯函数式合成数据处理；不发起网络请求、不读取凭据、不依赖 API key 环境变量。
// 行为完全由传入的合成 fixture 数据（step.behavior / step.exit_code / step.args）决定，
// 禁止硬编码业务特定分支（真实业务词汇一律不得出现在 adapter 中）。
//
// 覆盖场景（对应任务包第 7 节）：
//   success  —— 正常工具调用成功（outcome OK，带 tool_result）
//   error    —— 工具调用返回非零码（outcome TOOL_ERROR，exit_code 真实记录）
//   timeout  —— 工具调用超时（adapter 内模拟，outcome TIMEOUT）
//   sensitive—— 输入触发敏感字段拒绝（outcome SENSITIVE_REJECTED）

const { buildProviderResult } = require('../lib/runner/protocol');

const ADAPTER_ID = 'P-LOCAL-FIXTURE-H02-V1';
const ADAPTER_REF = 'ADAPTER-LOCAL-FIXTURE-H02-V1';
const CAPABILITIES = Object.freeze(['run-synthetic-tool', 'judge-synthetic-tool']);
const MAX_RISK = 'low';

function createLocalFixtureAdapter() {
  return {
    provider_id: ADAPTER_ID,
    adapter_ref: ADAPTER_REF,
    role: 'local-fixture',
    status: 'callable-confirmed',
    request_schema: 'urn:h02:provider-request-v1',
    result_schema: 'urn:h02:provider-result-v1',
    capabilities: CAPABILITIES,
    max_risk: MAX_RISK,
    source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES', 'urn:h01:provider.schema.json'],

    // Provider 描述对象：逐字段满足 provider.schema.json（additionalProperties:false）。
    describe() {
      return {
        schema_version: 'h01-provider-v1',
        provider_id: this.provider_id,
        role: 'local-fixture',
        status: 'callable-confirmed',
        request_schema: this.request_schema,
        result_schema: this.result_schema,
        source_refs: this.source_refs,
        scope: 'harness-engineering'
      };
    },

    // 纯函数：request.step 决定输出。任何异常都转换为带分类的 outcome，不抛出。
    call(request) {
      const step = request.step || {};
      const behavior = step.behavior || 'success';
      const tool = typeof step.tool === 'string' && step.tool.length > 0 ? step.tool : 'synth-tool';
      switch (behavior) {
        case 'success':
          return buildProviderResult({
            providerId: request.provider_id,
            role: request.role,
            requestId: request.request_id || 'local-fixture',
            outcome: {
              code: 'OK',
              summary: `tool=${tool} exit_code=0`,
              exit_code: 0,
              tool_result: { tool, summary: `tool=${tool} exit_code=0` }
            }
          });
        case 'error': {
          const exitCode = Number.isInteger(step.exit_code) ? step.exit_code : 1;
          return buildProviderResult({
            providerId: request.provider_id,
            role: request.role,
            requestId: request.request_id || 'local-fixture',
            outcome: {
              code: 'TOOL_ERROR',
              summary: `tool=${tool} exit_code=${exitCode}`,
              exit_code: exitCode,
              tool_result: { tool, summary: `tool=${tool} exit_code=${exitCode}` }
            }
          });
        }
        case 'timeout':
          return buildProviderResult({
            providerId: request.provider_id,
            role: request.role,
            requestId: request.request_id || 'local-fixture',
            outcome: {
              code: 'TIMEOUT',
              summary: `tool=${tool} exceeded adapter time limit`
            }
          });
        case 'sensitive':
          return buildProviderResult({
            providerId: request.provider_id,
            role: request.role,
            requestId: request.request_id || 'local-fixture',
            outcome: {
              code: 'SENSITIVE_REJECTED',
              summary: 'adapter refused to emit sensitive field content'
            }
          });
        default:
          return buildProviderResult({
            providerId: request.provider_id,
            role: request.role,
            requestId: request.request_id || 'local-fixture',
            outcome: {
              code: 'BLOCKED',
              summary: `tool=${tool} unknown behavior=${behavior}`
            }
          });
      }
    }
  };
}

// 占位 judge：H02 阶段 JudgeProvider 仅返回合成占位结果，不承担语义判断。
function createPlaceholderJudge() {
  return {
    provider_id: 'J-LOCAL-FIXTURE-H02-V1',
    adapter_ref: 'ADAPTER-LOCAL-FIXTURE-H02-V1',
    role: 'local-fixture',
    status: 'callable-confirmed',
    request_schema: 'urn:h02:provider-request-v1',
    result_schema: 'urn:h02:provider-result-v1',
    capabilities: Object.freeze(['judge-synthetic-tool']),
    max_risk: 'low',
    source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES', 'urn:h01:provider.schema.json'],
    describe() {
      return {
        schema_version: 'h01-provider-v1',
        provider_id: this.provider_id,
        role: 'local-fixture',
        status: 'callable-confirmed',
        request_schema: this.request_schema,
        result_schema: this.result_schema,
        source_refs: this.source_refs,
        scope: 'harness-engineering'
      };
    },
    call(request) {
      return buildProviderResult({
        providerId: request.provider_id,
        role: request.role,
        requestId: request.request_id || 'local-fixture-judge',
        outcome: {
          code: 'PLACEHOLDER',
          summary: 'synthetic judge placeholder (no semantic verdict in H02)'
        }
      });
    }
  };
}

module.exports = {
  ADAPTER_ID,
  ADAPTER_REF,
  createLocalFixtureAdapter,
  createPlaceholderJudge
};
