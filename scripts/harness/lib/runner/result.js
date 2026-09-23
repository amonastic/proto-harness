'use strict';

// H02：Result 构造与校验。逐字段满足 harness/engineering/schema/result.schema.json：
// schema_version 恰为 h01-result-v1；result_id ^RESULT-[A-Z0-9][A-Z0-9-]*$；
// trace_id ^TRACE-[A-Z0-9][A-Z0-9-]*$；status 枚举 SUCCEEDED/FAILED/BLOCKED/INCOMPLETE；
// completion_evidence_refs 必须指向本次运行实际产生的 Trace/运行产物，不得引用不存在对象。

const crypto = require('crypto');
const { validateResult } = require('../trace/schema-check');

function newResultId(seed) {
  const suffix = crypto.createHash('sha256').update(`result-id:${seed}`).digest('hex').slice(0, 12).toUpperCase();
  return `RESULT-${suffix}`;
}

// status 由调用方按真实执行结果决定；failure_code/blocking_reason 仅在对应状态时使用。
function buildResult({ resultId, traceId, status, summary, completionEvidenceRefs, createdBy, scope, sourceRefs, failureCode, blockingReason }) {
  if (!resultId || typeof resultId !== 'string') throw new Error('H02_RESULT result_id required');
  if (!traceId || typeof traceId !== 'string') throw new Error('H02_RESULT trace_id required');
  const allowed = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED', 'INCOMPLETE']);
  if (!allowed.has(status)) throw new Error(`H02_RESULT unknown status: ${status}`);
  if (!summary || typeof summary !== 'string') throw new Error('H02_RESULT summary required');
  if (!Array.isArray(completionEvidenceRefs) || completionEvidenceRefs.length === 0) {
    throw new Error('H02_RESULT completion_evidence_refs must be non-empty (real evidence required)');
  }
  const result = {
    schema_version: 'h01-result-v1',
    result_id: resultId,
    trace_id: traceId,
    status,
    summary,
    completion_evidence_refs: completionEvidenceRefs,
    created_by: createdBy,
    scope,
    source_refs: sourceRefs
  };
  if (failureCode !== undefined) result.failure_code = failureCode;
  if (blockingReason !== undefined) result.blocking_reason = blockingReason;
  return result;
}

// 写盘前结构自检：任何 schema 违例抛 H02_RESULT_SCHEMA。
function assertValidResult(result) {
  const { errors } = validateResult(result);
  if (errors.length > 0) {
    throw new Error(`H02_RESULT_SCHEMA ${errors.join('; ')}`);
  }
  return result;
}

module.exports = {
  newResultId,
  buildResult,
  assertValidResult
};
