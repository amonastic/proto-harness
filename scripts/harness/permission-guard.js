'use strict';

// H06（P3）：权限守卫（纯函数）。
//
// 契约（任务包 5.1 + 主任务包第 17 章）：
//   1. capability（工具存在）与 permission（工具授权）分离判定
//   2. capability status 为 'ready' 才进入 permission 判定；缺失必要字段 → not-ready（6.1）
//   3. permission 票据：status === 'AUTHORIZED' 且未过 valid_until，工具 action ∈ actions
//      且 target.scope ∉ forbidden_scopes → 允许；否则拒绝（票据缺失/非法/过期一律按缺失处理，6.2）
//   4. 风险分级口径与 runner.js assertPermissionGranted 同构：
//      同一 riskRank 比较规则（low<medium<high<critical），capability 四枚举
//      （read-only/reversible-write/destructive-write/external-call）映射到同一 0-3 rank 轴
//   5. 纯函数：输入状态+票据，输出允许/拒绝，不读环境变量之外的隐式全局状态

// 与 scripts/harness/lib/runner/runner.js 的 assertPermissionGranted 保持同构：
//   riskRank = { low: 0, medium: 1, high: 2, critical: 3 }；申请风险不得超过被授予风险
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

// capability.schema.json 的 risk 四枚举 → 同构 rank 轴
const CAPABILITY_RISK_RANK = Object.freeze({
  'read-only': 0,
  'reversible-write': 1,
  'destructive-write': 2,
  'external-call': 3
});

// capability 就绪判定：status 恰为 'ready'（capability.schema.json 的 status 无枚举，
// P3 以 'ready' 作为 ready 等价状态，6.1 缺失必要字段 → not-ready）
function isCapabilityReady(capabilityRecord) {
  if (!capabilityRecord || typeof capabilityRecord !== 'object') return { ready: false, reason: 'capability 记录缺失' };
  const required = ['capability_id', 'action', 'target', 'risk', 'status'];
  for (const key of required) {
    if (capabilityRecord[key] === undefined || capabilityRecord[key] === null || capabilityRecord[key] === '') {
      return { ready: false, reason: `capability 缺少必要字段 ${key}` };
    }
  }
  if (!CAPABILITY_RISK_RANK.hasOwnProperty(capabilityRecord.risk)) {
    return { ready: false, reason: `capability risk 非法：${capabilityRecord.risk}` };
  }
  if (capabilityRecord.status !== 'ready') {
    return { ready: false, reason: `capability status 非 ready：${capabilityRecord.status}` };
  }
  return { ready: true, reason: 'capability ready' };
}

// permission 票据有效性判定（permission.schema.json 语义）
// now 默认取 Date.now()；票据非法/缺失/过期一律按缺失处理
function isPermissionAuthorized(permissionRecord, now = Date.now()) {
  if (!permissionRecord || typeof permissionRecord !== 'object') {
    return { authorized: false, reason: '权限票据缺失' };
  }
  const required = ['permission_id', 'status', 'valid_until', 'actions', 'forbidden_scopes'];
  for (const key of required) {
    if (permissionRecord[key] === undefined || permissionRecord[key] === null) {
      return { authorized: false, reason: `票据格式非法（缺 ${key}）` };
    }
  }
  if (permissionRecord.status !== 'AUTHORIZED') {
    return { authorized: false, reason: `票据状态非 AUTHORIZED：${permissionRecord.status}` };
  }
  if (typeof permissionRecord.valid_until === 'string' && permissionRecord.valid_until.length > 0) {
    const untilMs = Date.parse(permissionRecord.valid_until);
    if (Number.isNaN(untilMs)) {
      // 6.2：票据格式非法视为未授权（按缺失处理）
      return { authorized: false, reason: `票据格式非法（valid_until 不可解析：${permissionRecord.valid_until}）` };
    }
    if (now > untilMs) {
      return { authorized: false, reason: `票据已过期（valid_until=${permissionRecord.valid_until}）` };
    }
  }
  return { authorized: true, reason: '票据有效' };
}

// 守卫主函数：工具调用前判定
// 输入：
//   tool —— { action, scope }（本次要调用的工具动作与目标域）
//   capabilityRecord —— capability.schema.json 形态记录
//   permissionRecord —— permission.schema.json 形态票据
//   grantedRiskRank —— 票据被授予的风险上限（与 runner assertPermissionGranted 的 max_risk 同轴）
//   now —— 当前时间（测试注入）
// 输出：{ verdict: 'allow'|'deny', reason, stage: 'capability'|'permission'|'scope'|'risk' }
function guardTool({ tool, capabilityRecord, permissionRecord, grantedRiskRank = 'low', now = Date.now() }) {
  // 1. capability 判定
  const capability = isCapabilityReady(capabilityRecord);
  if (!capability.ready) {
    return { verdict: 'deny', reason: capability.reason, stage: 'capability' };
  }
  // 2. permission 判定
  const permission = isPermissionAuthorized(permissionRecord, now);
  if (!permission.authorized) {
    return { verdict: 'deny', reason: permission.reason, stage: 'permission' };
  }
  // 3. 动作授权：tool.action 必须在票据 actions 白名单内
  if (!Array.isArray(permissionRecord.actions) || !permissionRecord.actions.includes(tool.action)) {
    return { verdict: 'deny', reason: `工具动作未授权：${tool.action}`, stage: 'permission' };
  }
  // 4. 禁止域：target.scope 不得在 forbidden_scopes 内
  if (Array.isArray(permissionRecord.forbidden_scopes) && permissionRecord.forbidden_scopes.includes(tool.scope)) {
    return { verdict: 'deny', reason: `目标域在禁止清单内：${tool.scope}`, stage: 'scope' };
  }
  // 5. 风险比较（与 runner assertPermissionGranted 同构）：
  //    工具所需风险 rank（capability.risk 映射）不得超过被授予风险 rank
  const requiredRank = CAPABILITY_RISK_RANK[capabilityRecord.risk];
  const grantedRank = RISK_RANK[grantedRiskRank] !== undefined ? RISK_RANK[grantedRiskRank] : 0;
  if (requiredRank > grantedRank) {
    return {
      verdict: 'deny',
      reason: `工具风险 ${capabilityRecord.risk}（rank ${requiredRank}）超过被授予风险 ${grantedRiskRank}（rank ${grantedRank}）`,
      stage: 'risk'
    };
  }
  return { verdict: 'allow', reason: 'capability ready 且权限有效', stage: 'risk' };
}

module.exports = {
  RISK_RANK,
  CAPABILITY_RISK_RANK,
  isCapabilityReady,
  isPermissionAuthorized,
  guardTool
};
