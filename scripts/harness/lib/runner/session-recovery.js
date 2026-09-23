'use strict';

// H07（P3）：跨会话恢复核验层（包装 H02 checkpoint/resume，不重造）。
//
// 契约（任务包 5.2）：
//   1. readCheckpoint 复用 H02（schema 校验由其承担；错误透传不包装）
//   2. dirty 核验：checkpoint 落盘时旁路记录的 git status --short 快照 vs 当前快照（逐行比对，
//      用户 2026-08-13 裁决不加 hash：任务包 12 节待确认项 2）
//   3. permission 核验：permission.schema.json 实例 status !== AUTHORIZED 或超 valid_until → 过期
//   4. 新消息核验：checkpoint 之后的新用户消息 → checkTaskAuth 判定是否覆盖任务目标
//   5. 三项一致 → 调用 H02 execute({ resumeCheckpointId })（透传结果）
//   6. 任一不一致 → { verdict: 'RECONTRACT', reasons } 不调用 execute
//   7. execute 抛出的 input_digest 等 H02 错误 → 捕获归类为「规则/输入变化」呈现，不吞掉
//
// 7.2：git status 调用封装为可替换接口（executeGitStatus 依赖注入），单测不依赖真实工作区。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readCheckpoint } = require('./checkpoint');
const { isPermissionAuthorized } = require('../../permission-guard');
const { checkTaskAuth } = require('../../validators/task-auth');

const HOST_ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_OUT_DIR = '.harness-runtime/runner';

// 默认 git status 封装（可在测试中替换）
function defaultGitStatus() {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--short'], {
    cwd: HOST_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

// dirty 快照旁路文件路径（与 checkpoint 同目录，7.1）
function dirtySnapshotPath(checkpointId, outDir = DEFAULT_OUT_DIR) {
  return path.join(path.resolve(HOST_ROOT, outDir), `${checkpointId}.dirty-snapshot.json`);
}

function readDirtySnapshot(checkpointId, outDir = DEFAULT_OUT_DIR) {
  try {
    const parsed = JSON.parse(fs.readFileSync(dirtySnapshotPath(checkpointId, outDir), 'utf8'));
    return typeof parsed.status_lines === 'string' ? parsed.status_lines : null;
  } catch {
    return null;
  }
}

function writeDirtySnapshot(checkpointId, statusLines, outDir = DEFAULT_OUT_DIR) {
  fs.mkdirSync(path.dirname(dirtySnapshotPath(checkpointId, outDir)), { recursive: true });
  fs.writeFileSync(dirtySnapshotPath(checkpointId, outDir), `${JSON.stringify({ checkpoint_id: checkpointId, status_lines: statusLines }, null, 2)}\n`);
}

// 归一化 dirty 快照比对（逐行比对，忽略空行；null = 无法获取）
// 三态语义（对抗审查修正 20260813）：
//   'consistent'   —— 两侧一致
//   'changed'      —— 确实发生了变化
//   'indeterminate'—— 旁路快照缺失（baseline 为 null）时无法判定，必须与"确实变了"区分，
//                      由调用方给出补建 baseline 的路径，不得静默恢复
function compareDirtySnapshots(baseline, current) {
  if (baseline === null) {
    return { state: 'indeterminate', reason: 'dirty 基线缺失（旁路快照不存在），无法判定工作区是否变化；需先补建 baseline' };
  }
  if (current === null) {
    return { state: 'changed', reason: '当前 dirty 状态无法获取（git status 失败），按已变化处理' };
  }
  const baselineLines = baseline.split('\n').map((line) => line.trim()).filter(Boolean).sort();
  const currentLines = current.split('\n').map((line) => line.trim()).filter(Boolean).sort();
  if (baselineLines.join('\n') === currentLines.join('\n')) {
    return { state: 'consistent', reason: 'dirty 状态一致' };
  }
  return { state: 'changed', reason: 'dirty 状态已变化（相对 checkpoint 落盘时快照）' };
}

// 跨会话恢复主函数
// 输入：
//   checkpointId, outDir —— H02 checkpoint 位置
//   executeGitStatus —— git status 函数注入（默认真实调用；测试替换）
//   permissionRecord —— 该任务关联的 permission.schema.json 实例（测试注入）
//   latestUserMessage —— checkpoint 之后的新用户消息（无则 null）
//   plannedFiles —— 与 latestUserMessage 配套的计划文件（checkTaskAuth 输入）
//   executeFn —— execute 函数注入（默认 H02 runner.execute；测试可注入对照）
//   seed —— 透传给 execute
// 输出：{ verdict: 'RECOVERED'|'RECONTRACT', checkpoint?, reasons?, outcome? }
function recoverSession({
  checkpointId,
  fixture,
  outDir = DEFAULT_OUT_DIR,
  executeGitStatus = defaultGitStatus,
  permissionRecord = null,
  latestUserMessage = null,
  plannedFiles = [],
  executeFn = null,
  seed = 1
}) {
  // 1. 复用 H02 readCheckpoint（schema 校验由其承担；错误透传）
  const checkpoint = readCheckpoint(checkpointId, outDir);
  if (!checkpoint) {
    const error = new Error(`H02_CHECKPOINT not found: ${checkpointId}`);
    error.code = 'H02_CHECKPOINT_NOT_FOUND';
    throw error;
  }
  if (!fixture || typeof fixture !== 'object') {
    const error = new Error('H07_RECOVER fixture required (H02 execute resume 需要 fixture 做 input_digest 比对)');
    error.code = 'H07_RECOVER_FIXTURE_REQUIRED';
    throw error;
  }

  const reasons = [];

  // 2. dirty 核验（三态：一致/变化/无法判定——无法判定与确实变化必须区分）
  const baseline = readDirtySnapshot(checkpointId, outDir);
  const current = executeGitStatus();
  const dirty = compareDirtySnapshots(baseline, current);
  if (dirty.state === 'indeterminate') {
    return {
      verdict: 'INDETERMINATE',
      reasons: [dirty.reason],
      checkpoint,
      remediation: '以当前 git status 补建 baseline：npm run harness:recover -- --checkpoint <id> --fixture <path> --snapshot-baseline'
    };
  }
  if (dirty.state === 'changed') reasons.push(dirty.reason);

  // 3. permission 核验
  if (permissionRecord !== null) {
    const permission = isPermissionAuthorized(permissionRecord);
    if (!permission.authorized) reasons.push(`权限票据失效：${permission.reason}`);
  }

  // 4. 新消息核验（复用 checkTaskAuth）
  if (latestUserMessage !== null && typeof latestUserMessage === 'string' && latestUserMessage.length > 0) {
    const auth = checkTaskAuth({ message: latestUserMessage, plannedFiles });
    if (auth.verdict === 'fail') {
      reasons.push(`存在覆盖性新消息：${auth.reason}`);
    }
  }

  if (reasons.length > 0) {
    return { verdict: 'RECONTRACT', reasons, checkpoint };
  }

  // 5. 三项一致 → 调用 H02 execute({ resumeCheckpointId })（透传）
  try {
    const execute = executeFn || require('./runner').execute;
    const outcome = execute({
      fixture,
      seed,
      outDir,
      resumeCheckpointId: checkpointId
    });
    return { verdict: 'RECOVERED', reasons: [], checkpoint, outcome };
  } catch (error) {
    // 6. H02 错误归类呈现（如 input_digest mismatch → 规则/输入变化）
    if (error.message && error.message.includes('input_digest')) {
      return {
        verdict: 'RECONTRACT',
        reasons: [`规则/输入变化（H02 校验）：${error.message}`],
        checkpoint
      };
    }
    throw error;
  }
}

// 补建 dirty baseline（首次真实调用路径）：以当前 git status 写旁路快照。
// 供 recover.js 的 --snapshot-baseline 参数调用；纯补建不恢复。
function establishDirtyBaseline(checkpointId, outDir = DEFAULT_OUT_DIR, executeGitStatus = defaultGitStatus) {
  const statusLines = executeGitStatus();
  if (statusLines === null) {
    throw new Error('H07_RECOVER cannot establish dirty baseline: git status unavailable');
  }
  writeDirtySnapshot(checkpointId, statusLines, outDir);
  return { checkpoint_id: checkpointId, snapshot_file: dirtySnapshotPath(checkpointId, outDir), status_lines: statusLines };
}

module.exports = {
  DEFAULT_OUT_DIR,
  defaultGitStatus,
  dirtySnapshotPath,
  readDirtySnapshot,
  writeDirtySnapshot,
  compareDirtySnapshots,
  establishDirtyBaseline,
  recoverSession
};
