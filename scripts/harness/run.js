#!/usr/bin/env node
'use strict';

// H02：Runner CLI 入口。
// 用法：node scripts/harness/run.js --fixture <path> [--seed <n>] [--run-id <id>] [--out-dir <dir>] [--resume-from <checkpoint_id>]
// 输出：.harness-runtime/runner/<run_id>.{trace,result,checkpoint}.json（默认 out-dir）。
// 退出码：0 成功（含 FAILED/INCOMPLETE 结果，真实执行完成）；2 拒绝执行（权限/重复 run_id/非法输入）；3 内部错误。

const fs = require('fs');
const path = require('path');
const { execute, DEFAULT_OUT_DIR, artifactPath } = require('./lib/runner/runner');

const HOST_ROOT = path.resolve(__dirname, '..', '..');

function parseCli(argv) {
  const options = { fixture: null, seed: 1, runId: null, outDir: DEFAULT_OUT_DIR, resumeFrom: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`H02_CLI ${token} requires a value`);
      index += 1;
      return value;
    };
    switch (token) {
      case '--fixture': options.fixture = next(); break;
      case '--seed': options.seed = Number.parseInt(next(), 10); break;
      case '--run-id': {
        const value = next();
        if (!/^[A-Z0-9][A-Z0-9-]*$/.test(value)) throw new Error(`H02_CLI --run-id must match ^[A-Z0-9][A-Z0-9-]*$: ${value}`);
        options.runId = value;
        break;
      }
      case '--out-dir': options.outDir = next(); break;
      case '--resume-from': options.resumeFrom = next(); break;
      default: throw new Error(`H02_CLI unknown argument: ${token}`);
    }
  }
  if (!options.fixture) throw new Error('H02_CLI --fixture is required');
  if (!Number.isInteger(options.seed)) throw new Error('H02_CLI --seed must be integer');
  return options;
}

function loadFixture(relativePath) {
  if (path.isAbsolute(relativePath)) throw new Error(`H02_CLI --fixture must be project-relative: ${relativePath}`);
  const resolved = path.resolve(HOST_ROOT, relativePath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`H02_CLI --fixture escapes project root: ${relativePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`H02_CLI fixture parse failed: ${relativePath}: ${error.message}`);
  }
  return parsed;
}

function main(argv) {
  const options = parseCli(argv);
  const fixture = loadFixture(options.fixture);
  const outcome = execute({
    fixture,
    seed: options.seed,
    runId: options.runId,
    outDir: options.outDir,
    resumeCheckpointId: options.resumeFrom
  });
  process.stdout.write(`${JSON.stringify({
    run_id: outcome.runId,
    result_status: outcome.result.status,
    trace_file: outcome.traceFile,
    result_file: outcome.resultFile,
    checkpoint_file: outcome.checkpointFile,
    events: outcome.trace.events.length,
    resumed_from: outcome.resumedFrom
  }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  let code = 0;
  try {
    code = main(process.argv.slice(2));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    code = (error && error.code === 'H02_RUN_ID_EXISTS') || (error && error.code === 'H02_PERMISSION_DENIED') || (error && error.code === 'H02_INVALID_FIXTURE') ? 2 : 3;
  }
  process.exitCode = code;
}

module.exports = { main, parseCli, loadFixture };
