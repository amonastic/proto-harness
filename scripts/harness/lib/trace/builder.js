'use strict';

// H02：Trace 构造与序列化。逐字段满足 harness/engineering/schema/trace.schema.json：
// schema_version 恰为 h01-trace-v1；trace_id ^TRACE-[A-Z0-9][A-Z0-9-]*$；
// ruleset_id/epoch_id/fixture_suite_ref/oracle_ref/adapter_ref 必须为真实引用值（由调用方传入，不得占位）；
// events minItems 1 且 uniqueItems（对象深度相等去重）；全层 additionalProperties:false。

const crypto = require('crypto');
const { stableJson, validateTrace } = require('./schema-check');

function newTraceId(seed) {
  const suffix = crypto.createHash('sha256').update(`trace-id:${seed}`).digest('hex').slice(0, 12).toUpperCase();
  return `TRACE-${suffix}`;
}

function newRunId(seed) {
  const suffix = crypto.createHash('sha256').update(`run-id:${seed}`).digest('hex').slice(0, 12).toUpperCase();
  return `RUN-${suffix}`;
}

// 构造 Trace。参数全部必须显式提供；events 至少 1 条。
function buildTrace({ traceId, runId, taskId, rulesetId, epochId, fixtureSuiteRef, oracleRef, adapterRef, events, terminalState, status, scope, sourceRefs }) {
  if (!traceId || typeof traceId !== 'string') throw new Error('H02_TRACE trace_id required');
  if (!runId || typeof runId !== 'string') throw new Error('H02_TRACE run_id required');
  if (!taskId || typeof taskId !== 'string') throw new Error('H02_TRACE task_id required');
  if (!rulesetId || typeof rulesetId !== 'string') throw new Error('H02_TRACE ruleset_id required');
  if (!epochId || typeof epochId !== 'string') throw new Error('H02_TRACE epoch_id required');
  if (!fixtureSuiteRef || typeof fixtureSuiteRef !== 'string') throw new Error('H02_TRACE fixture_suite_ref required');
  if (!oracleRef || typeof oracleRef !== 'string') throw new Error('H02_TRACE oracle_ref required');
  if (!adapterRef || typeof adapterRef !== 'string') throw new Error('H02_TRACE adapter_ref required');
  if (!Array.isArray(events) || events.length === 0) throw new Error('H02_TRACE events must be non-empty array');
  const trace = {
    schema_version: 'h01-trace-v1',
    trace_id: traceId,
    run_id: runId,
    task_id: taskId,
    ruleset_id: rulesetId,
    epoch_id: epochId,
    fixture_suite_ref: fixtureSuiteRef,
    oracle_ref: oracleRef,
    adapter_ref: adapterRef,
    events,
    terminal_state: terminalState,
    status,
    scope,
    source_refs: sourceRefs
  };
  return trace;
}

// 写盘前结构自检：任何 schema 违例抛 H02_TRACE_SCHEMA。
function assertValidTrace(trace) {
  const { errors } = validateTrace(trace);
  if (errors.length > 0) {
    throw new Error(`H02_TRACE_SCHEMA ${errors.join('; ')}`);
  }
  return trace;
}

function serializeTrace(trace) {
  return `${stableJson(trace)}\n`;
}

module.exports = {
  newTraceId,
  newRunId,
  buildTrace,
  assertValidTrace,
  serializeTrace
};
