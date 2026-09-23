'use strict';

// H02：Provider 统一 request/result 协议。
// ExecutionProvider 与 JudgeProvider 必须通过同一结构调用（字段命名与结构一致），
// Runner 代码中不得出现任何厂商 SDK 引用或厂商特定字段名。
// 本协议对象为本地合成实现（local-fixture adapter），不产生真实模型调用。

const { stableJson } = require('../trace/schema-check');

const PROVIDER_REQUEST_SCHEMA_VERSION = 'h02-provider-request-v1';
const PROVIDER_RESULT_SCHEMA_VERSION = 'h02-provider-result-v1';

// 统一 request：由 Runner 构造，两个 provider 角色共用同一结构。
function buildProviderRequest({ providerId, role, runId, taskId, fixture, step, seed }) {
  if (!providerId || typeof providerId !== 'string') throw new Error('H02_PROTOCOL provider_id required');
  if (role !== 'execution' && role !== 'judge') throw new Error(`H02_PROTOCOL unknown role: ${role}`);
  if (!runId || typeof runId !== 'string') throw new Error('H02_PROTOCOL run_id required');
  if (!taskId || typeof taskId !== 'string') throw new Error('H02_PROTOCOL task_id required');
  if (!fixture || typeof fixture !== 'object') throw new Error('H02_PROTOCOL fixture required');
  if (!step || typeof step !== 'object') throw new Error('H02_PROTOCOL step required');
  if (seed === undefined || !Number.isInteger(seed)) throw new Error('H02_PROTOCOL seed must be integer');
  return {
    schema_version: PROVIDER_REQUEST_SCHEMA_VERSION,
    provider_id: providerId,
    role,
    run_id: runId,
    task_id: taskId,
    fixture_ref: fixture.fixture_suite_ref || '',
    ruleset_id: fixture.ruleset_id || '',
    epoch_id: fixture.epoch_id || '',
    step,
    seed
  };
}

// 统一 result：adapter 与占位 judge 均返回该结构，且 outcome 字段集合完全一致（不得因角色差异分叉）。
// outcome.code 枚举：OK / TOOL_ERROR / TIMEOUT / SENSITIVE_REJECTED / BLOCKED / PLACEHOLDER。
// outcome 统一为四字段：code、summary、exit_code（无则 null）、tool_result（无则 null）。
function buildProviderResult({ providerId, role, requestId, outcome }) {
  if (!providerId || typeof providerId !== 'string') throw new Error('H02_PROTOCOL provider_id required');
  if (role !== 'execution' && role !== 'judge') throw new Error(`H02_PROTOCOL unknown role: ${role}`);
  if (!outcome || typeof outcome !== 'object') throw new Error('H02_PROTOCOL outcome required');
  const allowedCodes = new Set(['OK', 'TOOL_ERROR', 'TIMEOUT', 'SENSITIVE_REJECTED', 'BLOCKED', 'PLACEHOLDER']);
  if (!allowedCodes.has(outcome.code)) throw new Error(`H02_PROTOCOL unknown outcome.code: ${outcome.code}`);
  if (typeof outcome.summary !== 'string' || outcome.summary.length === 0) throw new Error('H02_PROTOCOL outcome.summary required');
  return {
    schema_version: PROVIDER_RESULT_SCHEMA_VERSION,
    provider_id: providerId,
    role,
    request_id: requestId,
    outcome: {
      code: outcome.code,
      summary: outcome.summary,
      // 结构统一：exit_code 恒为 number、tool_result 恒为对象（值语义由调用方/兜底保证）
      exit_code: typeof outcome.exit_code === 'number' ? outcome.exit_code : 0,
      tool_result: outcome.tool_result && typeof outcome.tool_result === 'object' ? outcome.tool_result : { tool: 'synthetic', summary: outcome.summary }
    }
  };
}

// R00-10：两个角色的 request/result 结构一致性校验（同一套代码）。
// 返回 { role, request_fields, result_fields, errors }。
function assertProviderMessageShape(role, request, result) {
  const requestFields = Object.keys(request).sort();
  const resultFields = Object.keys(result).sort();
  const errors = [];
  if (request.role !== role) errors.push(`request.role=${request.role} expected ${role}`);
  if (result.role !== role) errors.push(`result.role=${result.role} expected ${role}`);
  if (request.schema_version !== PROVIDER_REQUEST_SCHEMA_VERSION) errors.push('request schema_version mismatch');
  if (result.schema_version !== PROVIDER_RESULT_SCHEMA_VERSION) errors.push('result schema_version mismatch');
  if (request.provider_id !== result.provider_id) errors.push('request/result provider_id mismatch');
  if (request.step === undefined || request.step === null) errors.push('request.step missing');
  if (!result.outcome || typeof result.outcome.code !== 'string') errors.push('result.outcome.code missing');
  return { role, request_fields: requestFields, result_fields: resultFields, errors };
}

// 跨角色结构比较：除 role/provider_id 外的字段结构（键集合与类型形状）必须一致。
// 比较的是形状而非值：execution 与 judge 允许值不同（OK vs PLACEHOLDER），但字段结构不得分叉。
function sameShape(a, b) {
  const strip = (obj) => {
    const copy = JSON.parse(JSON.stringify(obj));
    delete copy.role;
    delete copy.provider_id;
    delete copy.request_id;
    delete copy.response_id;
    return copy;
  };
  const shapeOf = (value) => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[${value.map(shapeOf).join(',')}]`;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${key}:${shapeOf(value[key])}`).join(',')}}`;
    }
    return typeof value;
  };
  return shapeOf(strip(a)) === shapeOf(strip(b));
}

module.exports = {
  PROVIDER_REQUEST_SCHEMA_VERSION,
  PROVIDER_RESULT_SCHEMA_VERSION,
  buildProviderRequest,
  buildProviderResult,
  assertProviderMessageShape,
  sameShape
};
