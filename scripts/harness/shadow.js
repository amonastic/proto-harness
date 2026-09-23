#!/usr/bin/env node
'use strict';

// P7/H10C：harness:shadow CLI 入口（P6 单模型 + P7 多模型并行）。
// 用法：
//   单模型（P6）：npm run harness:shadow -- --provider deepseek --family <family> [--tier L1|L2|L3|L4] [--count N] [--fixture <corpus_id>] [--all] [--dry-run] [--stop-on-critical] [--verbose]
//   并行（P7）：npm run harness:shadow -- --parallel --providers deepseek,longcat --family <family> [--tier L1|L2] [--count N] [--fixture <corpus_id>] [--dry-run] [--verbose]
// 退出码：0 成功（含并行部分失败时 1）；2 拒绝（L0 族 / 缺 key / 矩阵缺失 / L3/L4 并行 / 参数错误）；3 内部错误。
//
// 契约（任务包 §5.1/§5.3/§5.4/§6/§11）：
//   - 互斥：--parallel 必须配合 --providers；非并行必须 --provider
//   - 并行模式只允许 L0/L1/L2（L3/L4 写入冲突拒绝）；任一矩阵缺失拒绝；全部 L0 拒绝
//   - 部分模型失败 → 退出码 1 + failed_providers；全部失败 → 退出码 2
//   - L4 只本地 commit 不 push（2026-08-19 用户裁决）

const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..');
const SUPPORTED_PROVIDERS = Object.freeze(['deepseek']);

function parseCli(argv) {
  const options = { provider: null, providers: null, parallel: false, family: null, tier: null, count: 1, fixture: null, all: false, dryRun: false, stopOnCritical: false, verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`H10A_SHADOW ${token} requires a value`);
      index += 1;
      return value;
    };
    switch (token) {
      case '--provider': options.provider = next(); break;
      case '--providers': options.providers = next(); break;
      case '--parallel': options.parallel = true; break;
      case '--family': options.family = next(); break;
      case '--tier': {
        const tier = next();
        if (!['L1', 'L2', 'L3', 'L4'].includes(tier)) throw new Error(`H10A_SHADOW --tier must be one of L1|L2|L3|L4: ${tier}`);
        options.tier = tier;
        break;
      }
      case '--count': {
        const value = Number.parseInt(next(), 10);
        if (!Number.isInteger(value) || value < 1) throw new Error('H10A_SHADOW --count must be a positive integer');
        options.count = value;
        break;
      }
      case '--fixture': options.fixture = next(); break;
      case '--all': options.all = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--stop-on-critical': options.stopOnCritical = true; break;
      case '--verbose': options.verbose = true; break;
      default: throw new Error(`H10A_SHADOW unknown argument: ${token}`);
    }
  }
  if (!options.family) throw new Error('H10A_SHADOW --family is required');
  // 互斥规则（任务包 §5.3）
  if (options.parallel) {
    if (!options.providers) throw new Error('H10A_SHADOW --parallel 必须配合 --providers（逗号分隔模型列表）');
    if (options.provider) throw new Error('H10A_SHADOW --parallel 不能使用 --provider（单数），请使用 --providers');
  } else {
    if (!options.provider) throw new Error('H10A_SHADOW --provider is required');
    if (options.providers) throw new Error('H10A_SHADOW 非并行模式不能使用 --providers（复数），请使用 --provider');
  }
  if (options.all && options.fixture) throw new Error('H10A_SHADOW --all and --fixture are mutually exclusive');
  return options;
}

async function main(argv) {
  const options = parseCli(argv);

  // 并行模式（P7/H10C）
  if (options.parallel) {
    const providerNames = options.providers.split(',').map((name) => name.trim()).filter(Boolean);
    if (providerNames.length < 2) throw new Error('H10A_SHADOW --parallel 需要至少两个模型（--providers deepseek,longcat）');
    const { runParallelShadow } = require('./lib/shadow/parallel');
    const summary = await runParallelShadow({
      providerNames,
      family: options.family,
      tierOverride: options.tier,
      fixtureRef: options.fixture,
      count: options.all ? null : options.count,
      dryRun: options.dryRun,
      stopOnCritical: options.stopOnCritical,
      verbose: options.verbose
    });
    for (const failed of summary.failed_providers) {
      process.stderr.write(`[harness-shadow] WARNING 模型 ${failed.provider} 失败: ${failed.reason}\n`);
    }
    for (const signal of summary.compare_report.cross_model_signals || []) {
      process.stderr.write(`[harness-shadow] CRITICAL ${signal.type}: ${signal.reason}\n`);
    }
    process.stdout.write(`${JSON.stringify({
      mode: 'parallel',
      providers: summary.providers,
      family: summary.family,
      dry_run: summary.dry_run,
      tier_by_provider: summary.tier_by_provider,
      succeeded: summary.succeeded.map((item) => ({ provider: item.provider, tier: item.tier, fixtures: item.fixtures })),
      failed_providers: summary.failed_providers,
      compare_path: summary.compare_path,
      verdict_agreement_rate: summary.compare_report.verdict_agreement_rate,
      disagreements: summary.compare_report.disagreements.length,
      cross_model_signals: summary.compare_report.cross_model_signals || []
    }, null, 2)}\n`);
    return summary.exit_code; // 0 全成功；1 部分失败
  }

  // 单模型模式（P6，兼容）
  const { SUPPORTED_PROVIDERS } = require('./lib/shadow/parallel');
  if (!SUPPORTED_PROVIDERS.includes(options.provider)) {
    throw Object.assign(new Error(`H10A_SHADOW provider "${options.provider}" 未实现：当前支持 ${SUPPORTED_PROVIDERS.join(', ')}`), { code: 'H10A_PROVIDER_NOT_IMPLEMENTED' });
  }

  let provider;
  if (options.dryRun) {
    const { createShadowDryRunProvider } = require('./lib/shadow/runner');
    provider = createShadowDryRunProvider();
  } else {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw Object.assign(new Error(
        'H10A_SHADOW_ENV DEEPSEEK_API_KEY 未配置：影子观察需要真实 API key。\n配置检查清单：1) export DEEPSEEK_API_KEY=...；2) 链路验证可用 --dry-run（本地合成 provider，不读 key）。'
      ), { code: 'H10A_SHADOW_ENV_MISSING' });
    }
    const { createExecutionRuntime } = require('./providers/execution-runtime');
    provider = createExecutionRuntime();
  }

  const { runShadowObservation } = require('./lib/shadow/runner');
  const summary = await runShadowObservation({
    provider,
    providerName: options.provider,
    family: options.family,
    tier: options.tier,
    fixtureRef: options.fixture,
    count: options.count,
    all: options.all,
    dryRun: options.dryRun,
    stopOnCritical: options.stopOnCritical,
    verbose: options.verbose
  });

  for (const warning of summary.warnings) process.stderr.write(`[harness-shadow] WARNING ${warning}\n`);
  process.stdout.write(`${JSON.stringify({
    run_id: summary.run_id,
    provider: summary.provider,
    family: summary.family,
    tier: summary.tier,
    dry_run: summary.dry_run,
    fixture_count: summary.fixture_count,
    log_files: summary.log_files,
    signals: summary.signals,
    merged_weeks: summary.merged_weeks,
    dirty_write_skipped: summary.dirty_write_skipped,
    stopped_by_critical: summary.stopped_by_critical
  }, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      const message = error && error.message ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      const code = error && error.code ? error.code : '';
      // H10A/H10C 拒绝类（L0 族 / 缺 key / 矩阵缺失 / L3L4 并行 / 全部失败 / 参数错误）→ 2；其余 → 3
      // 注意：H10C 拒绝类错误以 H10C_ 消息前缀抛出（无 code 属性），一并匹配
      process.exitCode = /^H10[AC]_/.test(code || message) ? 2 : 3;
    }
  );
}

module.exports = { parseCli, main };
