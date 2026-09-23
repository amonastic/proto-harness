'use strict';

// H06（P3）：状态机转移测试——9 类事件正反例全覆盖。
// state.js 为纯函数；"新消息"事件复用 checkTaskAuth（真实实现，不 mock）。

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { transition, STATES, EVENTS, TRANSITION_TABLE, ALLOWED_ACTIONS, handleNewMessage } = require('../../../scripts/harness/state');

test('H06-S1 all 9 events are defined in the transition machinery', () => {
  assert.deepEqual([...EVENTS].sort(), [
    'adjust', 'continue', 'handover', 'new_message', 'permission_denied',
    'strong_correction', 'supplement', 'tool_failure', 'validation_failure'
  ].sort());
  assert.equal(EVENTS.length, 9, '9 events required');
});

test('H06-S2 no event means no transition: unknown event stays in current state', () => {
  const result = transition('EXECUTING', 'unknown_event');
  assert.equal(result.nextState, 'EXECUTING', 'must stay in current state');
  assert.ok(result.diagnosis.includes('未知事件'), 'diagnosis must explain');
});

test('H06-S3 EXECUTING event table covers all 9 events (positive cases)', () => {
  const table = TRANSITION_TABLE.EXECUTING;
  assert.equal(table.continue, 'EXECUTING');
  assert.equal(table.supplement, 'EXECUTING');
  assert.equal(table.adjust, 'EXECUTING');
  assert.equal(table.handover, 'EXECUTING');
  assert.equal(table.strong_correction, 'RECONTRACT');
  assert.equal(table.tool_failure, 'BLOCKED');
  assert.equal(table.permission_denied, 'AWAITING_PERMISSION');
  assert.equal(table.validation_failure, 'BLOCKED');
  // new_message 在表内（EXECUTING），具体行为由 handleNewMessage 决定
  assert.equal(table.new_message, 'EXECUTING');
});

test('H06-S4 negative cases: state rejects events it cannot accept', () => {
  // IDLE 不接受 tool_failure / permission_denied / validation_failure
  // （strong_correction 是无条件全局事件，见 H06-S7，不在此列表）
  for (const event of ['tool_failure', 'permission_denied', 'validation_failure']) {
    const result = transition('IDLE', event);
    assert.equal(result.nextState, 'IDLE', `IDLE must reject ${event}`);
    assert.ok(result.diagnosis.includes('不接受事件'), 'diagnosis must explain rejection');
  }
  // RECONTRACT 不接受 continue（需用户确认）
  const r = transition('RECONTRACT', 'continue');
  assert.equal(r.nextState, 'RECONTRACT');
});

test('H06-S5 new_message with valid L3 auth advances and keeps authorization', () => {
  const result = transition('EXECUTING', 'new_message', {
    message: '开始改 tests/harness/state.js。',
    plannedFiles: ['tests/harness/state.js']
  });
  assert.equal(result.nextState, 'EXECUTING');
  assert.equal(result.recompilePack, false);
  assert.ok(result.diagnosis.includes('有效 L3 授权'));
});

test('H06-S6 new_message with invalid/covering message invalidates old authorization (recompile)', () => {
  const result = transition('EXECUTING', 'new_message', {
    message: '先讨论一下这个方案。',
    plannedFiles: ['tests/harness/state.js']
  });
  assert.equal(result.nextState, 'RECONTRACT');
  assert.equal(result.recompilePack, true, 'old authorization must be invalidated');
  assert.ok(result.diagnosis.includes('旧 authorization 失效'));
});

test('H06-S7 strong_correction unconditionally enters RECONTRACT from any state', () => {
  for (const state of ['IDLE', 'EXECUTING', 'AWAITING_PERMISSION', 'BLOCKED']) {
    const result = transition(state, 'strong_correction');
    assert.equal(result.nextState, 'RECONTRACT', `${state} + strong_correction -> RECONTRACT`);
    assert.equal(result.recompilePack, true);
  }
});

test('H06-S8 pack contract_ref change forces RECONTRACT (user-2026-08-13 ruling)', () => {
  const result = transition('EXECUTING', 'continue', {
    packContractRef: 'TASK-X-v2',
    currentContractRef: 'TASK-X-v1'
  });
  assert.equal(result.nextState, 'RECONTRACT');
  assert.equal(result.recompilePack, true);
  assert.ok(result.diagnosis.includes('contract_ref 变化'));
});

test('H06-S8b contract_ref change detected in AWAITING_PERMISSION and BLOCKED (adversarial review fix)', () => {
  // 对抗审查修正：换包检测不得只限 EXECUTING——待恢复/待继续动作的状态同样必须拦截
  for (const state of ['AWAITING_PERMISSION', 'BLOCKED']) {
    const result = transition(state, 'continue', {
      packContractRef: 'TASK-X-v2',
      currentContractRef: 'TASK-X-v1'
    });
    assert.equal(result.nextState, 'RECONTRACT', `${state} 换包必须 RECONTRACT`);
    assert.equal(result.recompilePack, true, `${state} 换包必须触发重新编译`);
  }
  // 无待恢复动作的状态（IDLE/DONE/RECONTRACT）不受此检测影响（IDLE 无 contract 上下文）
  const idle = transition('IDLE', 'continue', { packContractRef: 'TASK-X-v2', currentContractRef: 'TASK-X-v1' });
  assert.equal(idle.nextState, 'EXECUTING', 'IDLE 无待恢复动作，继续执行');
});

test('H06-S9 permission_denied and tool_failure drive recovery states with allowed actions', () => {
  const denied = transition('EXECUTING', 'permission_denied');
  assert.equal(denied.nextState, 'AWAITING_PERMISSION');
  assert.deepEqual([...denied.allowedActions], ['request-permission']);
  const failed = transition('EXECUTING', 'tool_failure');
  assert.equal(failed.nextState, 'BLOCKED');
  assert.ok(failed.allowedActions.includes('report-diagnosis'));
});

test('H06-S10 allowed actions are per-state and known', () => {
  for (const state of STATES) {
    assert.ok(Array.isArray(ALLOWED_ACTIONS[state]), `actions for ${state}`);
  }
  assert.deepEqual([...ALLOWED_ACTIONS.RECONTRACT], ['request-confirmation']);
});

test('H06-S11 handleNewMessage reuses task-auth for object mismatch detection', () => {
  const handled = handleNewMessage('EXECUTING', '开始改 scripts/a.js。', ['scripts/b.js'], undefined, undefined);
  assert.equal(handled.nextState, 'RECONTRACT', 'object mismatch must invalidate');
  assert.equal(handled.recompilePack, true);
});
