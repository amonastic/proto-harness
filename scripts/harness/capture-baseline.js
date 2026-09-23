#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateFrozenPackage } = require('./validate-h00a');
const {
  CANONICAL_MANIFEST_PATH, CANONICAL_OUTPUT_PATH, EVIDENCE_PATHS,
  buildPayload, canonicalJson, finalizeBaseline, sha256Buffer
} = require('./h00b-contract');

function projectRoot(cwd = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

function exactProjectPath(root, supplied, expected, flag) {
  const resolved = path.resolve(root, supplied);
  if (resolved !== path.join(root, expected)) throw new Error(`${flag} must be ${expected}`);
  return resolved;
}

function assertNoSymlinkParents(root, target) {
  let current = root;
  for (const segment of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`output parent must not be a symlink: ${path.relative(root, current)}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function assertSafeOutput(root, output) {
  assertNoSymlinkParents(root, output);
  const tracked = execFileSync('git', ['ls-files', '--', CANONICAL_OUTPUT_PATH], { cwd: root, encoding: 'utf8' }).trim();
  if (tracked) throw new Error(`runtime output is tracked by Git: ${CANONICAL_OUTPUT_PATH}`);
  let stat;
  try { stat = fs.lstatSync(output); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`output must be a regular file: ${CANONICAL_OUTPUT_PATH}`);
  if (stat.nlink !== 1) throw new Error(`output must not be a hardlink: ${CANONICAL_OUTPUT_PATH}`);
}

function workspaceSnapshot(root) {
  const tracked = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=no'], { cwd: root });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root });
  const evidence = EVIDENCE_PATHS.map((relativePath) => `${relativePath}\0${sha256Buffer(fs.readFileSync(path.join(root, relativePath)))}`).join('\n');
  return { tracked: tracked.toString('hex'), untracked: untracked.toString('hex'), evidence };
}

function h00aOptions(root, manifest) {
  return {
    projectRoot: root,
    manifest,
    incidents: path.join(root, 'tests/harness/incidents/seed.jsonl'),
    families: path.join(root, 'tests/harness/incidents/failure-family-candidates.jsonl'),
    debt: path.join(root, 'tests/harness/baselines/validation-debt.json'),
    confirmation: path.join(root, 'tests/harness/baselines/h00a-confirmation.json'),
    migration: path.join(root, 'tests/harness/baselines/h00a-schema-migration-r1.json'),
    ledger: path.join(root, 'doc/平台治理/harness-engineering/来源清册.md')
  };
}

function parseOptions(argv) {
  const values = new Map();
  const allowed = new Set(['--manifest', '--out']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) throw new Error(`unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`${flag} must be provided exactly once`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  for (const flag of allowed) if (!values.has(flag)) throw new Error(`${flag} is required`);
  return { manifest: values.get('--manifest'), out: values.get('--out') };
}

function captureBaseline(options) {
  const root = options.projectRoot || projectRoot(options.cwd);
  const manifestPath = exactProjectPath(root, options.manifest, CANONICAL_MANIFEST_PATH, '--manifest');
  const output = exactProjectPath(root, options.out, CANONICAL_OUTPUT_PATH, '--out');
  assertSafeOutput(root, output);
  const before = workspaceSnapshot(root);
  const h00a = validateFrozenPackage(h00aOptions(root, manifestPath));
  if (h00a.errors.length) throw new Error(`H00A frozen validation failed:\n${h00a.errors.join('\n')}`);
  if (h00a.confirmation.status !== 'approved' || h00a.confirmation.h00b_unlocked !== true) throw new Error('H00A confirmation must be approved with h00b_unlocked=true');
  const baseline = finalizeBaseline(buildPayload(root, h00a.manifest, h00a.confirmation));
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  assertSafeOutput(root, output);
  const temporary = path.join(path.dirname(output), `.h00b.${process.pid}.${Date.now()}.tmp`);
  let committed = false;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, canonicalJson(baseline), 'utf8'); } finally { fs.closeSync(fd); }
    if (options.beforeRename) options.beforeRename({ temporary, output });
    if (JSON.stringify(workspaceSnapshot(root)) !== JSON.stringify(before)) throw new Error('workspace or H00A evidence changed during capture');
    assertSafeOutput(root, output);
    fs.renameSync(temporary, output);
    committed = true;
  } finally {
    if (!committed && fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return baseline;
}

function main(argv = process.argv.slice(2)) {
  try {
    const baseline = captureBaseline(parseOptions(argv));
    console.log(JSON.stringify({
      status: 'captured-h00b-baseline', baselineId: baseline.baseline_id,
      payloadSha256: baseline.payload_sha256, frozenCaptureId: baseline.frozen_capture.frozen_capture_id,
      captureSubjectCommit: baseline.frozen_capture.capture_subject_commit
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { assertNoSymlinkParents, assertSafeOutput, captureBaseline, h00aOptions, parseOptions, workspaceSnapshot };
