'use strict';

// H07（P3）：跨会话恢复 CLI 入口。
// 用法：
//   npm run harness:recover -- --checkpoint <checkpoint_id> --fixture <path> [--permission <path>] [--message <text>]
//   npm run harness:recover -- --checkpoint <checkpoint_id> --fixture <path> --snapshot-baseline（补建 dirty baseline）
// 只做参数解析与格式化输出；恢复逻辑本身在 lib/runner/session-recovery.js（包装 H02）。

const fs = require('fs');
const path = require('path');
const { recoverSession, establishDirtyBaseline } = require('./lib/runner/session-recovery');

const HOST_ROOT = path.resolve(__dirname, '../../..');

function parseCli(argv) {
  const options = { checkpoint: null, fixture: null, permission: null, message: null, seed: 1, outDir: '.harness-runtime/runner', snapshotBaseline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`H07_RECOVER ${token} requires a value`);
      index += 1;
      return value;
    };
    if (token === '--checkpoint') options.checkpoint = next();
    else if (token === '--fixture') options.fixture = next();
    else if (token === '--permission') options.permission = next();
    else if (token === '--message') options.message = next();
    else if (token === '--seed') options.seed = Number.parseInt(next(), 10);
    else if (token === '--out-dir') options.outDir = next();
    else if (token === '--snapshot-baseline') options.snapshotBaseline = true;
    else throw new Error(`H07_RECOVER unknown argument: ${token}`);
  }
  if (!options.checkpoint) throw new Error('H07_RECOVER --checkpoint is required');
  if (!options.fixture) throw new Error('H07_RECOVER --fixture is required (H02 resume 需要 fixture 做 input_digest 比对)');
  return options;
}

function loadJson(relPath) {
  const resolved = path.resolve(HOST_ROOT, relPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H07_RECOVER path escapes project root: ${relPath}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    const fixture = loadJson(options.fixture);
    if (options.snapshotBaseline) {
      const established = establishDirtyBaseline(options.checkpoint, options.outDir);
      process.stdout.write(`${JSON.stringify({ verdict: 'BASELINE_ESTABLISHED', ...established }, null, 2)}\n`);
      process.exitCode = 0;
      return;
    }
    const permissionRecord = options.permission ? loadJson(options.permission) : null;
    const result = recoverSession({
      checkpointId: options.checkpoint,
      fixture,
      outDir: options.outDir,
      permissionRecord,
      latestUserMessage: options.message,
      plannedFiles: [options.fixture],
      seed: options.seed
    });
    process.stdout.write(`${JSON.stringify({
      verdict: result.verdict,
      reasons: result.reasons,
      remediation: result.remediation || null,
      checkpoint_id: result.checkpoint ? result.checkpoint.checkpoint_id : null,
      run_id: result.outcome ? result.outcome.runId : null,
      result_status: result.outcome ? result.outcome.result.status : null
    }, null, 2)}\n`);
    process.exitCode = result.verdict === 'RECONTRACT' ? 1 : (result.verdict === 'INDETERMINATE' ? 1 : 0);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { parseCli };
