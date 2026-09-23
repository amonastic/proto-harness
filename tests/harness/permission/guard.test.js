'use strict';

// H06（P3）：权限守卫测试——越权拦截、票据过期、票据缺失、capability≠permission 分离、
// 风险口径与 runner.assertPermissionGranted 同构、产出对象满足 schema。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const { guardTool, isCapabilityReady, isPermissionAuthorized, RISK_RANK, CAPABILITY_RISK_RANK } = require('../../../scripts/harness/permission-guard');
const { assertPermissionGranted } = require('../../../scripts/harness/lib/runner/runner');
const { validateAgainstSchema, loadSchema } = require('../../../scripts/harness/lib/trace/schema-check');
const { createExecutionProvider } = require('../../../scripts/harness/providers/execution-provider');

const READY_CAPABILITY = {
  schema_version: 'h01-capability-v1',
  scope: 'harness-engineering',
  capability_id: 'CAP-TEST-01',
  owner_id: 'H06',
  action: 'execute-fixture',
  target: { kind: 'runner', scope: 'harness-engineering' },
  risk: 'read-only',
  status: 'ready',
  source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES']
};

const AUTHORIZED_TICKET = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/recovery/fixtures/permission-authorized.json'), 'utf8'));
const EXPIRED_TICKET = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/recovery/fixtures/permission-expired.json'), 'utf8'));

test('H06-P1 capability ready vs not-ready (missing field / bad risk / non-ready status)', () => {
  assert.equal(isCapabilityReady(READY_CAPABILITY).ready, true);
  assert.equal(isCapabilityReady({ ...READY_CAPABILITY, risk: undefined }).ready, false, 'missing risk → not-ready');
  assert.equal(isCapabilityReady({ ...READY_CAPABILITY, risk: 'unknown-risk' }).ready, false, 'bad risk → not-ready');
  assert.equal(isCapabilityReady({ ...READY_CAPABILITY, status: 'planned' }).ready, false, 'non-ready status → not-ready');
  assert.equal(isCapabilityReady(null).ready, false);
});

test('H06-P2 permission ticket validity: authorized / expired / missing / revoked', () => {
  assert.equal(isPermissionAuthorized(AUTHORIZED_TICKET, Date.now()).authorized, true);
  assert.equal(isPermissionAuthorized(EXPIRED_TICKET, Date.now()).authorized, false, 'expired ticket');
  assert.equal(isPermissionAuthorized(null).authorized, false, 'missing ticket');
  assert.equal(isPermissionAuthorized({ ...AUTHORIZED_TICKET, status: 'REVOKED' }).authorized, false, 'revoked');
  assert.equal(isPermissionAuthorized({ ...AUTHORIZED_TICKET, valid_until: 'not-a-date' }).authorized, false, 'illegal date treated as missing');
});

test('H06-P3 guard denies before tool call: capability exists but permission missing/unauthorized', () => {
  // capability ready 但无票据 → 拦截（capability 存在不代表 permission 已授权）
  const denied = guardTool({ tool: { action: 'execute-fixture', scope: 'harness-engineering' }, capabilityRecord: READY_CAPABILITY, permissionRecord: null });
  assert.equal(denied.verdict, 'deny');
  assert.equal(denied.stage, 'permission');
});

test('H06-P4 guard denies expired ticket and forbidden scope and unlisted action', () => {
  const expired = guardTool({ tool: { action: 'execute-fixture', scope: 'harness-engineering' }, capabilityRecord: READY_CAPABILITY, permissionRecord: EXPIRED_TICKET });
  assert.equal(expired.verdict, 'deny');
  assert.ok(expired.reason.includes('过期'));
  const scopeDenied = guardTool({ tool: { action: 'execute-fixture', scope: 'production' }, capabilityRecord: READY_CAPABILITY, permissionRecord: AUTHORIZED_TICKET });
  assert.equal(scopeDenied.verdict, 'deny');
  assert.equal(scopeDenied.stage, 'scope');
  const actionDenied = guardTool({ tool: { action: 'build-corpus', scope: 'harness-engineering' }, capabilityRecord: { ...READY_CAPABILITY, action: 'build-corpus' }, permissionRecord: AUTHORIZED_TICKET });
  assert.equal(actionDenied.verdict, 'deny');
  assert.ok(actionDenied.reason.includes('未授权'));
});

test('H06-P5 guard allows when capability ready + ticket authorized + action allowed + scope clear + risk within grant', () => {
  const allowed = guardTool({
    tool: { action: 'execute-fixture', scope: 'harness-engineering' },
    capabilityRecord: READY_CAPABILITY,
    permissionRecord: AUTHORIZED_TICKET,
    grantedRiskRank: 'low'
  });
  assert.equal(allowed.verdict, 'allow');
});

test('H06-P6 risk rank is isomorphic with runner assertPermissionGranted', () => {
  // 口径同构断言：同一比较规则（申请不得超过被授予）
  assert.deepEqual(RISK_RANK, { low: 0, medium: 1, high: 2, critical: 3 });
  // capability 四枚举映射到同一 rank 轴
  assert.equal(CAPABILITY_RISK_RANK['read-only'], 0);
  assert.equal(CAPABILITY_RISK_RANK['reversible-write'], 1);
  assert.equal(CAPABILITY_RISK_RANK['destructive-write'], 2);
  assert.equal(CAPABILITY_RISK_RANK['external-call'], 3);
  // runner.assertPermissionGranted 行为对照：允许低风险（capability run-synthetic-tool / risk low）
  const provider = createExecutionProvider();
  assertPermissionGranted({ permission: { capability: 'run-synthetic-tool', risk: 'low' } }, provider);
  assert.throws(() => assertPermissionGranted({ permission: { capability: 'run-synthetic-tool', risk: 'high' } }, provider), /H02_PERMISSION risk not granted/);
  // guard 风险比较与 runner 同构：外部调用（rank 3）需要 critical 授权
  const risky = guardTool({
    tool: { action: 'call-provider', scope: 'harness-engineering' },
    capabilityRecord: { ...READY_CAPABILITY, action: 'call-provider', risk: 'external-call' },
    permissionRecord: { ...AUTHORIZED_TICKET, actions: ['execute-fixture', 'call-provider'] },
    grantedRiskRank: 'low'
  });
  assert.equal(risky.verdict, 'deny');
  assert.equal(risky.stage, 'risk');
});

test('H06-P7 guard inputs satisfy permission/capability schemas', () => {
  const permissionSchema = loadSchema('permission.schema.json');
  const capabilitySchema = loadSchema('capability.schema.json');
  assert.deepEqual(validateAgainstSchema(AUTHORIZED_TICKET, permissionSchema), [], 'authorized fixture satisfies permission.schema.json');
  assert.deepEqual(validateAgainstSchema(EXPIRED_TICKET, permissionSchema), [], 'expired fixture satisfies permission.schema.json');
  assert.deepEqual(validateAgainstSchema(READY_CAPABILITY, capabilitySchema), [], 'capability fixture satisfies capability.schema.json');
});

test('H06-P8 capability doctor manifest entries satisfy capability.schema.json', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/capabilities/test-manifest.json'), 'utf8'));
  const capabilitySchema = loadSchema('capability.schema.json');
  const { doctorReport } = require('../../../scripts/harness/capability-doctor');
  const report = doctorReport(manifest);
  assert.equal(report.report.length, manifest.entries.length);
  for (const item of report.report) {
    if (item.schema_valid === false) {
      // CAP-INCOMPLETE-01 是故意缺 risk 的反例（not-ready 且 schema 报错）
      assert.equal(item.capability_id, 'CAP-INCOMPLETE-01', `only the deliberate incomplete entry may fail schema (${item.capability_id})`);
      assert.equal(item.ready, false, 'incomplete entry must be not-ready');
      continue;
    }
    // schema valid：status 'ready' 的必须 ready；'planned' 是合法非 ready 状态（CAP-SNAPSHOT-WRITE-01）
    if (item.status === 'ready') {
      assert.equal(item.ready, true, `${item.capability_id} status ready must be ready`);
    } else {
      assert.equal(item.ready, false, `${item.capability_id} status ${item.status} must be not-ready`);
    }
  }
  const incomplete = report.report.find((item) => item.capability_id === 'CAP-INCOMPLETE-01');
  assert.equal(incomplete.ready, false, 'CAP-INCOMPLETE-01 must be not-ready');
  assert.ok(incomplete.ready_reason.includes('risk'), 'reason must mention missing risk');
});
