#!/usr/bin/env node
'use strict';

// P5/H09：harness:qualify CLI 入口。
// 用法：
//   npm run harness:qualify -- --provider deepseek --matrix <matrix.json> --out <out.json> [--dry-run] [--task-family <pattern>] [--retry <N>] [--verbose]
// 退出码：0 成功；2 拒绝（缺 key / 非法参数 / 未实现模型）；3 内部错误。
//
// 契约（P5 任务包 §5.2/§6/§7.2/§11）：
//   - 只接受 --provider deepseek（其他模型 P6+ 未实现，直接拒绝，不预留骨架）
//   - 真实模式缺 DEEPSEEK_API_KEY → 明确错误 + 退出码 2，不静默跳过
//   - --dry-run 使用本地合成 provider（不读 key），产物标 dry_run: true，仅链路验证

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = '.harness-runtime/qualification/deepseek.json';
const SUPPORTED_PROVIDERS = Object.freeze(['deepseek']);

function parseCli(argv) {
  const options = { provider: null, matrix: null, out: DEFAULT_OUT, dryRun: false, taskFamily: null, retry: 0, verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`H09_QUALIFY ${token} requires a value`);
      index += 1;
      return value;
    };
    switch (token) {
      case '--provider': options.provider = next(); break;
      case '--matrix': options.matrix = next(); break;
      case '--out': options.out = next(); break;
      case '--task-family': options.taskFamily = next(); break;
      case '--retry': {
        const value = Number.parseInt(next(), 10);
        if (!Number.isInteger(value) || value < 0) throw new Error('H09_QUALIFY --retry must be a non-negative integer');
        options.retry = value;
        break;
      }
      case '--dry-run': options.dryRun = true; break;
      case '--verbose': options.verbose = true; break;
      default: throw new Error(`H09_QUALIFY unknown argument: ${token}`);
    }
  }
  if (!options.provider) throw new Error('H09_QUALIFY --provider is required');
  if (!options.matrix) throw new Error('H09_QUALIFY --matrix is required');
  return options;
}

function resolveOutPath(outPath) {
  const resolved = path.resolve(HOST_ROOT, outPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`H09_QUALIFY --out escapes project root: ${outPath}`);
  }
  return resolved;
}

function writeOutAtomic(outPath, content) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`);
  fs.renameSync(tmp, outPath);
}

async function main(argv) {
  const options = parseCli(argv);
  if (!SUPPORTED_PROVIDERS.includes(options.provider)) {
    // P5 只实现 DeepSeek；LongCat / GLM / Codex 留 P6+（任务包 §11）
    throw Object.assign(new Error(`H09_QUALIFY provider "${options.provider}" 未实现：P5 只准入 DeepSeek（2026-08-19 用户裁决），LongCat / GLM / Codex 留 P6+`), { code: 'H09_PROVIDER_NOT_IMPLEMENTED' });
  }

  let provider;
  if (options.dryRun) {
    const { createDryRunProvider } = require('./lib/qualification/runner');
    provider = createDryRunProvider();
  } else {
    // 真实模式：复用 P1/H02A 已验证的 DeepSeek execution runtime；缺 key 明确拒绝（任务包 §6）
    if (!process.env.DEEPSEEK_API_KEY) {
      throw Object.assign(new Error(
        'H09_QUALIFY_ENV DEEPSEEK_API_KEY 未配置：准入运行需要真实 API key。\n配置检查清单：1) export DEEPSEEK_API_KEY=...；2) 可选 DEEPSEEK_BASE_URL / DEEPSEEK_MODEL_ID；3) 链路验证可用 --dry-run（本地合成 provider，不读 key）。'
      ), { code: 'H09_QUALIFY_ENV_MISSING' });
    }
    const { createExecutionRuntime } = require('./providers/execution-runtime');
    provider = createExecutionRuntime();
  }

  const { runQualification } = require('./lib/qualification/runner');
  const matrix = await runQualification({
    provider,
    matrixPath: options.matrix,
    taskFamilyPattern: options.taskFamily,
    retry: options.retry,
    verbose: options.verbose,
    dryRun: options.dryRun
  });

  const outPath = resolveOutPath(options.out);
  writeOutAtomic(outPath, matrix);

  process.stdout.write(`${JSON.stringify({
    provider: matrix.provider,
    dry_run: matrix.dry_run,
    matrix_id: matrix.matrix_id,
    families_evaluated: matrix.summary.families_evaluated,
    families_skipped: matrix.summary.families_skipped,
    total_runs: matrix.summary.total_runs,
    tier_counts: matrix.summary.tier_counts,
    out: options.out
  }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      const message = error && error.message ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = (error && error.code === 'H09_PROVIDER_NOT_IMPLEMENTED') || (error && error.code === 'H09_QUALIFY_ENV_MISSING') ? 2 : 3;
    }
  );
}

module.exports = { parseCli, resolveOutPath, writeOutAtomic, main };
