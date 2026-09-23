'use strict';

// H02：Trace 事件工厂。所有事件对象必须满足 trace.schema.json 的 events 项约束：
// sequence/state_from/state_to/event_type/result_code 必填；event_type 限 5 枚举；
// tool_result（可选）限 tool/summary 两字段；不允许额外字段。

const EVENT_TYPES = Object.freeze(['tool', 'verification', 'state-transition', 'model', 'error']);

function makeEvent(sequence, stateFrom, stateTo, eventType, resultCode, toolResult) {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`H02_EVENT sequence must be positive integer: ${sequence}`);
  if (typeof stateFrom !== 'string' || stateFrom.length === 0) throw new Error('H02_EVENT state_from must be non-empty string');
  if (typeof stateTo !== 'string' || stateTo.length === 0) throw new Error('H02_EVENT state_to must be non-empty string');
  if (!EVENT_TYPES.includes(eventType)) throw new Error(`H02_EVENT unknown event_type: ${eventType}`);
  if (typeof resultCode !== 'string' || resultCode.length === 0) throw new Error('H02_EVENT result_code must be non-empty string');
  const event = { sequence, state_from: stateFrom, state_to: stateTo, event_type: eventType, result_code: resultCode };
  if (toolResult !== undefined) {
    if (!toolResult || typeof toolResult !== 'object' || Array.isArray(toolResult)) throw new Error('H02_EVENT tool_result must be an object');
    if (typeof toolResult.tool !== 'string' || toolResult.tool.length === 0) throw new Error('H02_EVENT tool_result.tool must be non-empty string');
    if (typeof toolResult.summary !== 'string' || toolResult.summary.length === 0) throw new Error('H02_EVENT tool_result.summary must be non-empty string');
    const allowed = new Set(['tool', 'summary']);
    for (const key of Object.keys(toolResult)) {
      if (!allowed.has(key)) throw new Error(`H02_EVENT tool_result unknown field: ${key}`);
    }
    event.tool_result = toolResult;
  }
  return event;
}

// 工具调用事件：state_to 由调用方按 outcome 决定（如 COMPLETED/FAILED）。
function makeToolEvent(sequence, stateFrom, stateTo, tool, resultCode, summary) {
  return makeEvent(sequence, stateFrom, stateTo, 'tool', resultCode, { tool, summary });
}

// 状态迁移事件（无 tool_result）。
function makeStateTransitionEvent(sequence, stateFrom, stateTo, resultCode) {
  return makeEvent(sequence, stateFrom, stateTo, 'state-transition', resultCode);
}

// 错误事件（敏感拒绝、非法输入等）。
function makeErrorEvent(sequence, stateFrom, stateTo, tool, resultCode, summary) {
  return makeEvent(sequence, stateFrom, stateTo, 'error', resultCode, { tool, summary });
}

module.exports = {
  EVENT_TYPES,
  makeEvent,
  makeToolEvent,
  makeStateTransitionEvent,
  makeErrorEvent
};
