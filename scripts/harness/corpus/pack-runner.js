'use strict';

// H05（P2）：运行包执行适配层。
// AFK 执行者入口：npm run harness:pack:run -- --pack <pack_path>
// （注：npm run harness:run 为 H02 Runner CLI 入口（--fixture），不再承载 --pack；
//  重复键修复见 20260812：harness:run → run.js，pack 运行走 harness:pack:run）
//
// 契约（任务包 5.3/6.4）：
//   1. 从运行包读取 fixture 和 contract_ref
//   2. 从环境变量注入实际 API key（DEEPSEEK_API_KEY、JUDGE_MODEL_ID 等）
//   3. 调用 scripts/harness/lib/runner/runner.js 的 execute()（只调用现有接口，不复制 Runner 逻辑）
//   4. 运行包缺少必要字段 → 拒绝执行（退出码 2）+ 明确错误
//   5. 环境变量缺失（DEEPSEEK_API_KEY）→ 拒绝运行（退出码 2）+ 配置检查清单
//   6. judge 端未配置 → fallback（Claude Sonnet 4.6 + Anthropic 官方）+ warning
//
// 兼容模式：无 --pack 参数时转发给 scripts/harness/run.js（防御性保留；
//  harness:pack:run 恒带 --pack，正常路径不经过转发）。

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const REQUIRED_PACK_FIELDS = ['pack_id', 'task_id', 'fixture', 'execution_fixture', 'contract_ref', 'provider_config_template'];

function loadPack(packPath) {
  const resolved = path.resolve(HOST_ROOT, packPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H05_RUN pack escapes project root: ${packPath}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`H05_RUN pack parse failed: ${packPath}: ${error.message}`);
  }
  for (const field of REQUIRED_PACK_FIELDS) {
    if (parsed[field] === undefined || parsed[field] === null) {
      throw new Error(`H05_RUN pack missing required field: ${field}`);
    }
  }
  if (!parsed.fixture.payload || typeof parsed.fixture.payload !== 'object') {
    throw new Error('H05_RUN pack fixture.payload must be an object');
  }
  return parsed;
}

// 环境注入检查：DEEPSEEK_API_KEY 缺失 → 拒绝（退出码 2）；judge 未配置 → warning + fallback
function checkEnvironment(pack) {
  const issues = [];
  const warnings = [];
  const executionTemplate = pack.provider_config_template && pack.provider_config_template.execution;
  if (executionTemplate && executionTemplate.api_key === '${DEEPSEEK_API_KEY}' && !process.env.DEEPSEEK_API_KEY) {
    issues.push('DEEPSEEK_API_KEY 未配置：运行包执行需要真实 API key');
  }
  const judgeTemplate = pack.provider_config_template && pack.provider_config_template.judge;
  if (judgeTemplate && !process.env.JUDGE_MODEL_ID && !process.env.JUDGE_BASE_URL) {
    warnings.push('judge 端未配置，使用 fallback（Claude Sonnet 4.6 + Anthropic 官方）');
  }
  return { issues, warnings };
}

// 执行运行包：调用 runner.execute()（H02 现有接口）
function runPack(pack, { seed = 1, outDir = '.harness-runtime/runner' } = {}) {
  const env = checkEnvironment(pack);
  if (env.issues.length > 0) {
    const error = new Error(`H05_RUN_ENV ${env.issues.join('；')}\n配置检查清单：1) 设置 DEEPSEEK_API_KEY；2) 可选设置 DEEPSEEK_BASE_URL/DEEPSEEK_MODEL_ID；3) judge 可选 JUDGE_MODEL_ID/JUDGE_BASE_URL/JUDGE_AUTH_METHOD`);
    error.code = 'H05_RUN_ENV_MISSING';
    throw error;
  }
  const { execute } = require('../lib/runner/runner');
  const executionFixture = pack.execution_fixture;
  if (!executionFixture || typeof executionFixture !== 'object') {
    throw new Error('H05_RUN pack missing execution_fixture (H02 runner execution shape required)');
  }
  const outcome = execute({
    fixture: executionFixture,
    seed,
    outDir
  });
  return { env, outcome };
}

// CLI：npm run harness:pack:run -- --pack <path>；无 --pack 防御性转发 H02 run.js
function main(argv) {
  const packIndex = argv.indexOf('--pack');
  if (packIndex === -1) {
    // 兼容模式：转发 H02 run.js（--fixture 用法）
    const runJs = require('../run');
    return runJs.main(argv);
  }
  const packPath = argv[packIndex + 1];
  if (!packPath || packPath.startsWith('--')) throw new Error('H05_RUN --pack requires a path');
  const pack = loadPack(packPath);
  const result = runPack(pack);
  for (const warning of result.env.warnings) process.stderr.write(`H05_RUN warning: ${warning}\n`);
  process.stdout.write(`${JSON.stringify({
    pack_id: pack.pack_id,
    task_id: pack.task_id,
    run_id: result.outcome.runId,
    result_status: result.outcome.result.status,
    trace_file: result.outcome.traceFile
  }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  try {
    const code = main(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2; // 包字段缺失 / env 缺失 / 执行失败一律拒绝运行
  }
}

module.exports = { REQUIRED_PACK_FIELDS, loadPack, checkEnvironment, runPack, main };
