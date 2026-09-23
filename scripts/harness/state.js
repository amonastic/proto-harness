'use strict';

// H06（P3）：任务执行状态机（纯函数）。
//
// 契约（任务包 5.1 + 主任务包第 17 章）：
//   1. 查表得到确定的下一状态与允许动作，不存在无事件跳转
//   2. "新消息"事件调用 task-auth.js 的 checkTaskAuth 判定有效 L3 授权；
//      fail 或对象不一致 → 旧 authorization 立即失效（recompilePack=true）
//   3. "强纠偏"无条件转入 RECONTRACT（需要用户二次确认）
//   4. 换运行包（contract_ref 变化）→ 强制 RECONTRACT（用户 2026-08-13 裁决：任务包 12 节待确认项 1）
//   5. 未知事件 → 拒绝转移，停在当前状态（6.1）
//
// 状态集（9.1 自主命名）：IDLE / EXECUTING / AWAITING_PERMISSION / RECONTRACT / BLOCKED / DONE
// 事件集（9 类）：new_message / continue / supplement / adjust / strong_correction /
//                tool_failure / permission_denied / validation_failure / handover

const { checkTaskAuth } = require('./validators/task-auth');

const STATES = Object.freeze(['IDLE', 'EXECUTING', 'AWAITING_PERMISSION', 'RECONTRACT', 'BLOCKED', 'DONE']);
const EVENTS = Object.freeze([
  'new_message', 'continue', 'supplement', 'adjust', 'strong_correction',
  'tool_failure', 'permission_denied', 'validation_failure', 'handover'
]);

// 转移表：currentState -> { [event]: nextState }（无定义 = 拒绝转移，停在当前状态）
const TRANSITION_TABLE = Object.freeze({
  IDLE: Object.freeze({
    new_message: 'EXECUTING',
    continue: 'EXECUTING',
    supplement: 'EXECUTING',
    adjust: 'EXECUTING',
    handover: 'EXECUTING'
  }),
  EXECUTING: Object.freeze({
    new_message: 'EXECUTING', // 有效 L3 授权时保持执行；无效/覆盖时由事件处理器改为 RECONTRACT
    continue: 'EXECUTING',
    supplement: 'EXECUTING',
    adjust: 'EXECUTING',
    handover: 'EXECUTING',
    strong_correction: 'RECONTRACT',
    tool_failure: 'BLOCKED',
    permission_denied: 'AWAITING_PERMISSION',
    validation_failure: 'BLOCKED'
  }),
  AWAITING_PERMISSION: Object.freeze({
    continue: 'EXECUTING', // 权限补齐后继续
    new_message: 'RECONTRACT', // 新消息默认重协商（覆盖判定见事件处理器）
    strong_correction: 'RECONTRACT'
  }),
  RECONTRACT: Object.freeze({
    new_message: 'EXECUTING', // 有效 L3 授权才能退出 RECONTRACT
    strong_correction: 'RECONTRACT'
  }),
  BLOCKED: Object.freeze({
    supplement: 'EXECUTING', // 补充修复后继续
    adjust: 'EXECUTING',
    new_message: 'RECONTRACT',
    strong_correction: 'RECONTRACT',
    validation_failure: 'BLOCKED'
  }),
  DONE: Object.freeze({
    new_message: 'EXECUTING', // 新任务授权
    continue: 'IDLE'
  })
});

// 各状态下允许的动作集合（供 Runner 调用前核对）
const ALLOWED_ACTIONS = Object.freeze({
  IDLE: Object.freeze(['compile-pack']),
  EXECUTING: Object.freeze(['run-tool', 'write-trace', 'compile-pack']),
  AWAITING_PERMISSION: Object.freeze(['request-permission']),
  RECONTRACT: Object.freeze(['request-confirmation']),
  BLOCKED: Object.freeze(['report-diagnosis', 'request-confirmation']),
  DONE: Object.freeze(['report-summary'])
});

// 新消息事件处理器：复用 H03A checkTaskAuth，判定该消息是否构成有效 L3 授权
// 返回 { nextState, recompilePack, diagnosis }
function handleNewMessage(currentState, message, plannedFiles, packContractRef, currentContractRef) {
  const auth = checkTaskAuth({ message, plannedFiles });
  const contractChanged = typeof packContractRef === 'string'
    && typeof currentContractRef === 'string'
    && packContractRef !== currentContractRef;
  if (auth.verdict === 'fail') {
    // 授权无效 → 旧 authorization 立即失效，需重新编译运行包
    return {
      nextState: 'RECONTRACT',
      recompilePack: true,
      diagnosis: `新消息未构成有效 L3 授权（${auth.reason}），旧 authorization 失效`
    };
  }
  if (contractChanged) {
    // 用户 2026-08-13 裁决（任务包 12 节待确认项 1）：换运行包强制 RECONTRACT
    return {
      nextState: 'RECONTRACT',
      recompilePack: true,
      diagnosis: '运行包 contract_ref 变化，强制重新确认'
    };
  }
  return {
    nextState: TRANSITION_TABLE[currentState].new_message,
    recompilePack: false,
    diagnosis: `新消息构成有效 L3 授权（${auth.matched_term}）`
  };
}

// 状态转移主函数（纯函数）
// 输入：
//   currentState —— 当前状态
//   event —— 事件（EVENTS 之一）
//   context —— { message?, plannedFiles?, packContractRef?, currentContractRef? }
// 输出：{ nextState, allowedActions, recompilePack, diagnosis }
function transition(currentState, event, context = {}) {
  if (!STATES.includes(currentState)) {
    return { nextState: currentState, allowedActions: [], recompilePack: false, diagnosis: `未知状态：${currentState}` };
  }
  if (!EVENTS.includes(event)) {
    // 6.1：事件不在定义表中 → 拒绝转移，停在当前状态
    return { nextState: currentState, allowedActions: ALLOWED_ACTIONS[currentState], recompilePack: false, diagnosis: `未知事件：${event}，拒绝转移` };
  }

  // 换包强制 RECONTRACT（用户 2026-08-13 裁决，任务包 12 节待确认项 1）：
  // 检测覆盖所有存在"待恢复/待继续动作"的状态（对抗审查修正：不限 EXECUTING）
  const contractChanged = context.packContractRef !== undefined
    && context.currentContractRef !== undefined
    && context.packContractRef !== context.currentContractRef;
  if (contractChanged && ['EXECUTING', 'AWAITING_PERMISSION', 'BLOCKED'].includes(currentState)) {
    return {
      nextState: 'RECONTRACT',
      allowedActions: ALLOWED_ACTIONS.RECONTRACT,
      recompilePack: true,
      diagnosis: '运行包 contract_ref 变化，强制重新确认'
    };
  }

  if (event === 'new_message') {
    const handled = handleNewMessage(
      currentState,
      context.message || '',
      context.plannedFiles || [],
      context.packContractRef,
      context.currentContractRef
    );
    return {
      ...handled,
      allowedActions: ALLOWED_ACTIONS[handled.nextState]
    };
  }

  if (event === 'strong_correction') {
    // 5.1.3：强纠偏无条件转入 RECONTRACT
    return {
      nextState: 'RECONTRACT',
      allowedActions: ALLOWED_ACTIONS.RECONTRACT,
      recompilePack: true,
      diagnosis: '强纠偏：无条件转入二次确认'
    };
  }

  const table = TRANSITION_TABLE[currentState];
  const next = table[event];
  if (!next) {
    return {
      nextState: currentState,
      allowedActions: ALLOWED_ACTIONS[currentState],
      recompilePack: false,
      diagnosis: `状态 ${currentState} 不接受事件 ${event}，停在当前状态`
    };
  }
  return {
    nextState: next,
    allowedActions: ALLOWED_ACTIONS[next],
    recompilePack: false,
    diagnosis: `${currentState} --${event}--> ${next}`
  };
}

module.exports = {
  STATES,
  EVENTS,
  TRANSITION_TABLE,
  ALLOWED_ACTIONS,
  handleNewMessage,
  transition
};
