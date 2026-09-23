'use strict';

// H07（P3）：跨会话恢复测试。
// 3 类拦截场景（dirty 变化、权限过期、新消息覆盖）+ 1 类透传对照
// （三项一致时 recoverSession 结果与直接调用 H02 execute({ resumeCheckpointId }) 一致）。
// 测试不依赖真实工作区状态：executeGitStatus 注入合成快照；executeFn 注入对照函数。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const {
  recoverSession,
  compareDirtySnapshots,
  writeDirtySnapshot,
  readDirtySnapshot
} = require('../../../scripts/harness/lib/runner/session-recovery');
const { execute } = require('../../../scripts/harness/lib/runner/runner');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/synthetic/r00-08-resume.json'), 'utf8'));
const AUTHORIZED_TICKET = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/recovery/fixtures/permission-authorized.json'), 'utf8'));
const EXPIRED_TICKET = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/recovery/fixtures/permission-expired.json'), 'utf8'));

const TMP_DIR = '.harness-runtime/recovery-test';

// 造一个真实 H02 checkpoint：interruptAfter 中断 → checkpoint resumable
function makeInterruptedCheckpoint(seed) {
  return execute({ fixture: FIXTURE, seed, outDir: TMP_DIR, interruptAfter: 2, forceRunId: true });
}

test('H07-R1 dirty baseline comparison (line-by-line, user-2026-08-13: no hash)', () => {
  assert.equal(compareDirtySnapshots(' M a.js\n', ' M a.js\n').state, 'consistent');
  assert.equal(compareDirtySnapshots(' M a.js\n', ' M b.js\n').state, 'changed');
  assert.equal(compareDirtySnapshots(null, ' M b.js\n').state, 'indeterminate', 'missing baseline must be INDETERMINATE, not changed');
  assert.equal(compareDirtySnapshots(' M a.js\n', null).state, 'changed', 'current snapshot unavailable → changed');
  const bothMissing = compareDirtySnapshots(null, null);
  assert.equal(bothMissing.state, 'indeterminate', 'both missing → indeterminate (baseline missing dominates)');
});

test('H07-R2 dirty snapshot sidecar file round-trips (checkpoint-id naming, no new dir)', () => {
  const id = 'CHECKPOINT-P3-RT';
  writeDirtySnapshot(id, ' M a.js\n', TMP_DIR);
  const read = readDirtySnapshot(id, TMP_DIR);
  assert.equal(read, ' M a.js\n');
  const snapshotPath = path.join(HOST_ROOT, TMP_DIR, `${id}.dirty-snapshot.json`);
  assert.ok(fs.existsSync(snapshotPath), 'sidecar must live next to checkpoints');
  fs.rmSync(snapshotPath);
});

test('H07-R3 dirty changed blocks recovery with RECONTRACT (injected git status)', () => {
  const partial = makeInterruptedCheckpoint(101);
  // 旁路快照记录"落盘时"dirty = a.js；当前注入快照 = b.js → 变化
  writeDirtySnapshot(partial.checkpoint.checkpoint_id, ' M a.js\n', TMP_DIR);
  const result = recoverSession({
    checkpointId: partial.checkpoint.checkpoint_id,
    fixture: FIXTURE,
    outDir: TMP_DIR,
    executeGitStatus: () => ' M b.js\n',
    permissionRecord: AUTHORIZED_TICKET,
    latestUserMessage: null
  });
  assert.equal(result.verdict, 'RECONTRACT');
  assert.ok(result.reasons.some((reason) => reason.includes('dirty 状态已变化')), 'reason must point at dirty change');
});

test('H07-R4 expired permission blocks recovery with RECONTRACT', () => {
  const partial = makeInterruptedCheckpoint(102);
  writeDirtySnapshot(partial.checkpoint.checkpoint_id, ' M a.js\n', TMP_DIR);
  const result = recoverSession({
    checkpointId: partial.checkpoint.checkpoint_id,
    fixture: FIXTURE,
    outDir: TMP_DIR,
    executeGitStatus: () => ' M a.js\n',
    permissionRecord: EXPIRED_TICKET,
    latestUserMessage: null
  });
  assert.equal(result.verdict, 'RECONTRACT');
  assert.ok(result.reasons.some((reason) => reason.includes('权限票据失效')), 'reason must point at permission');
});

test('H07-R5 covering new user message blocks recovery with RECONTRACT (reuses checkTaskAuth)', () => {
  const partial = makeInterruptedCheckpoint(103);
  writeDirtySnapshot(partial.checkpoint.checkpoint_id, ' M a.js\n', TMP_DIR);
  const result = recoverSession({
    checkpointId: partial.checkpoint.checkpoint_id,
    fixture: FIXTURE,
    outDir: TMP_DIR,
    executeGitStatus: () => ' M a.js\n',
    permissionRecord: AUTHORIZED_TICKET,
    latestUserMessage: '先讨论一下这个方案。', // 非授权 → 覆盖
    plannedFiles: ['tests/harness/fixtures/synthetic/r00-08-resume.json']
  });
  assert.equal(result.verdict, 'RECONTRACT');
  assert.ok(result.reasons.some((reason) => reason.includes('覆盖性新消息')), 'reason must point at new message');
});

test('H07-R6 all three consistent → passes through to H02 execute, result identical to direct resume', () => {
  // 唯一 seed + 清理残留：防止重复运行同 checkpoint 撞上 H02 superseded 拒绝
  const seed = Date.now() % 1000000;
  const partial = makeInterruptedCheckpoint(seed);
  writeDirtySnapshot(partial.checkpoint.checkpoint_id, ' M a.js\n', TMP_DIR);
  const recovered = recoverSession({
    checkpointId: partial.checkpoint.checkpoint_id,
    fixture: FIXTURE,
    outDir: TMP_DIR,
    executeGitStatus: () => ' M a.js\n',
    permissionRecord: AUTHORIZED_TICKET,
    latestUserMessage: null,
    seed,
    executeFn: execute
  });
  assert.equal(recovered.verdict, 'RECOVERED');
  assert.equal(recovered.outcome.result.status, 'SUCCEEDED');
  assert.equal(recovered.outcome.resumedFrom, partial.checkpoint.checkpoint_id);
  assert.equal(recovered.outcome.trace.events.length, 4);
  // 对照：另一 seed 的一次性完整运行（events 应与 recovered 完全一致——透传语义）
  const baselineSeed = (seed + 1) % 1000000;
  const baseline = execute({ fixture: FIXTURE, seed: baselineSeed, outDir: TMP_DIR });
  assert.deepEqual(recovered.outcome.trace.events, baseline.trace.events, 'recovered events must equal uninterrupted H02 run (pass-through semantics)');
});

test('H07-R7 missing checkpoint error passes through H02 error (not wrapped)', () => {
  assert.throws(
    () => recoverSession({ checkpointId: 'CHECKPOINT-NOT-EXIST', fixture: FIXTURE, outDir: TMP_DIR }),
    /H02_CHECKPOINT not found/
  );
});

test('H07-R8 fixture required for input_digest comparison', () => {
  const partial = makeInterruptedCheckpoint(Date.now() % 1000000);
  assert.throws(
    () => recoverSession({ checkpointId: partial.checkpoint.checkpoint_id, fixture: null, outDir: TMP_DIR }),
    (error) => error.code === 'H07_RECOVER_FIXTURE_REQUIRED'
  );
});

test('H07-R9 integration: real execute checkpoint without manual writeDirtySnapshot → INDETERMINATE → establish baseline → RECOVERED', () => {
  // 真实执行路径：H02 execute 落盘 checkpoint（不手工调用 writeDirtySnapshot）
  const seed = Date.now() % 1000000;
  const partial = makeInterruptedCheckpoint(seed);
  const checkpointId = partial.checkpoint.checkpoint_id;
  const injectedGitStatus = () => ' M tests/harness/fixtures/synthetic/r00-08-resume.json\n';

  // 第一步：旁路快照不存在 → INDETERMINATE（明确"无法判定"，不是 RECONTRACT）
  const first = recoverSession({
    checkpointId,
    fixture: FIXTURE,
    outDir: TMP_DIR,
    executeGitStatus: injectedGitStatus,
    permissionRecord: AUTHORIZED_TICKET,
    latestUserMessage: null,
    seed
  });
  assert.equal(first.verdict, 'INDETERMINATE');
  assert.ok(first.reasons[0].includes('基线缺失'), 'reason must say baseline missing');
  assert.ok(first.remediation.includes('--snapshot-baseline'), 'remediation must point at baseline establishment');
  assert.ok(!fs.existsSync(path.join(HOST_ROOT, TMP_DIR, `${checkpointId}.dirty-snapshot.json`)), 'no snapshot may exist before establishment');

  // 第二步：补建 baseline（establishDirtyBaseline，走 recover CLI 的 --snapshot-baseline 同款路径）
  const { establishDirtyBaseline } = require('../../../scripts/harness/lib/runner/session-recovery');
  const established = establishDirtyBaseline(checkpointId, TMP_DIR, injectedGitStatus);
  assert.ok(fs.existsSync(established.snapshot_file), 'baseline snapshot must be written by establishment path');

  // 第三步：再次恢复 → 三项一致 → RECOVERED（真实 execute resume 透传）
  const recovered = recoverSession({
    checkpointId,
    fixture: FIXTURE,
    outDir: TMP_DIR,
    executeGitStatus: injectedGitStatus,
    permissionRecord: AUTHORIZED_TICKET,
    latestUserMessage: null,
    seed
  });
  assert.equal(recovered.verdict, 'RECOVERED');
  assert.equal(recovered.outcome.result.status, 'SUCCEEDED');
  assert.equal(recovered.outcome.trace.events.length, 4);
});
