'use strict';

// H02：Checkpoint 构造、写读与校验。逐字段满足 harness/engineering/schema/checkpoint.schema.json：
// schema_version 恰为 h01-checkpoint-v1；checkpoint_id ^CHECKPOINT-[A-Z0-9][A-Z0-9-]*$；
// trace_id ^TRACE-[A-Z0-9][A-Z0-9-]*$；input_digest 必须是输入内容的真实 hash（非常量）；
// resumable 必须真实反映该 checkpoint 是否可从 snapshot_ref 恢复；status 限 active/superseded。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { stableJson, validateCheckpoint } = require('../trace/schema-check');

const HOST_ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_RUNTIME_DIR = '.harness-runtime/runner';

function newCheckpointId(seed) {
  const suffix = crypto.createHash('sha256').update(`checkpoint-id:${seed}`).digest('hex').slice(0, 12).toUpperCase();
  return `CHECKPOINT-${suffix}`;
}

// input_digest：对输入内容（fixture/ruleset/epoch/seed 的规范化表示）的真实 hash。
function inputDigestOf(fixture, rulesetId, epochId, seed) {
  return crypto.createHash('sha256').update(stableJson({ fixture, rulesetId, epochId, seed })).digest('hex');
}

function buildCheckpoint({ checkpointId, traceId, lastEventSequence, state, snapshotRef, inputDigest, resumable, status, scope, sourceRefs }) {
  if (!checkpointId || typeof checkpointId !== 'string') throw new Error('H02_CHECKPOINT checkpoint_id required');
  if (!traceId || typeof traceId !== 'string') throw new Error('H02_CHECKPOINT trace_id required');
  if (!Number.isInteger(lastEventSequence) || lastEventSequence < 0) throw new Error('H02_CHECKPOINT last_event_sequence must be non-negative integer');
  if (!state || typeof state !== 'string') throw new Error('H02_CHECKPOINT state required');
  if (!snapshotRef || typeof snapshotRef !== 'string') throw new Error('H02_CHECKPOINT snapshot_ref required');
  if (!inputDigest || typeof inputDigest !== 'string' || !/^[0-9a-f]{64}$/.test(inputDigest)) {
    throw new Error('H02_CHECKPOINT input_digest must be a real sha256 hex digest');
  }
  if (typeof resumable !== 'boolean') throw new Error('H02_CHECKPOINT resumable must be boolean');
  if (status !== 'active' && status !== 'superseded') throw new Error(`H02_CHECKPOINT unknown status: ${status}`);
  return {
    schema_version: 'h01-checkpoint-v1',
    checkpoint_id: checkpointId,
    trace_id: traceId,
    last_event_sequence: lastEventSequence,
    state,
    snapshot_ref: snapshotRef,
    input_digest: inputDigest,
    resumable,
    status,
    scope,
    source_refs: sourceRefs
  };
}

function assertValidCheckpoint(checkpoint) {
  const { errors } = validateCheckpoint(checkpoint);
  if (errors.length > 0) {
    throw new Error(`H02_CHECKPOINT_SCHEMA ${errors.join('; ')}`);
  }
  return checkpoint;
}

// 写盘（原子写：先写临时文件再 rename，避免半截 checkpoint 被恢复读取）。
// 路径安全：outDir 必须位于项目根内（realpath symlink 防线，与 readCheckpoint 对称）。
function writeCheckpoint(checkpoint, outDir = DEFAULT_RUNTIME_DIR) {
  assertValidCheckpoint(checkpoint);
  const resolved = path.resolve(HOST_ROOT, outDir);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H02_CHECKPOINT outDir escapes project root: ${outDir}`);
  fs.mkdirSync(resolved, { recursive: true });
  const realRoot = fs.realpathSync(HOST_ROOT);
  const realDir = fs.realpathSync(resolved);
  const realRelative = path.relative(realRoot, realDir);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error(`H02_CHECKPOINT outDir resolves outside project root: ${outDir}`);
  const fileName = path.join(resolved, `${checkpoint.checkpoint_id}.json`);
  const tmpFile = `${fileName}.tmp`;
  fs.writeFileSync(tmpFile, `${stableJson(checkpoint)}\n`);
  fs.renameSync(tmpFile, fileName);
  return fileName;
}

// 读取并校验既有 checkpoint；文件缺失返回 null。
// 路径安全：outDir 必须位于项目根内；checkpointId 必须满足 schema 的 id pattern，防止路径注入。
function readCheckpoint(checkpointId, outDir = DEFAULT_RUNTIME_DIR) {
  if (!/^CHECKPOINT-[A-Z0-9][A-Z0-9-]*$/.test(checkpointId)) {
    throw new Error(`H02_CHECKPOINT invalid checkpoint_id: ${checkpointId}`);
  }
  const dir = path.resolve(HOST_ROOT, outDir);
  const relative = path.relative(HOST_ROOT, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H02_CHECKPOINT outDir escapes project root: ${outDir}`);
  // symlink 防线：realpath 后仍必须在项目根内（防项目内指向外部的软链目录）；目录缺失按文件缺失处理
  try {
    const realRoot = fs.realpathSync(HOST_ROOT);
    const realDir = fs.realpathSync(dir);
    const realRelative = path.relative(realRoot, realDir);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error(`H02_CHECKPOINT outDir resolves outside project root: ${outDir}`);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const fileName = path.join(dir, `${checkpointId}.json`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(fileName, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`H02_CHECKPOINT read ${fileName}: ${error.message}`);
  }
  assertValidCheckpoint(parsed);
  return parsed;
}

// resume 成功后把被恢复的 checkpoint 标记 superseded（旧恢复点失效）。
function supersedeCheckpoint(checkpointId, outDir = DEFAULT_RUNTIME_DIR) {
  const ckpt = readCheckpoint(checkpointId, outDir);
  if (!ckpt) return null;
  const superseded = { ...ckpt, status: 'superseded' };
  writeCheckpoint(superseded, outDir);
  return superseded;
}

module.exports = {
  DEFAULT_RUNTIME_DIR,
  newCheckpointId,
  inputDigestOf,
  buildCheckpoint,
  assertValidCheckpoint,
  writeCheckpoint,
  readCheckpoint,
  supersedeCheckpoint
};
