'use strict';

// P7/H10C：多模型影子观察并行调度。
// 契约（任务包 §5.1/§5.4/§6/§9）：
//   - 每个 provider 独立消费各自准入矩阵（.harness-runtime/qualification/<provider>.json）
//   - 任一矩阵缺失 → 拒绝（退出码 2）；全部 L0 → 拒绝；任一档位 L3/L4 → 拒绝（写入冲突风险）
//   - Promise.allSettled 并行：一个模型失败不影响其他；部分失败 → 退出码 1 + failed_providers
//   - 全部失败 → 退出码 2
//   - 对比报告：.harness-runtime/shadow/compare/<family>-<timestamp>.json（schema h10c-shadow-compare-v1）
//   - 聚合信号：≥2 模型触发 tier_downgrade/critical → cross_model_consensus（P7 自主决策：阈值=2）
//   - 并行 fixture 集合确定化（默认族内全部，保证跨模型对比对齐）

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const COMPARE_DIR = '.harness-runtime/shadow/compare';
const DEFAULT_CORPUS = 'tests/harness/fixtures/corpus/corpus.json';
const QUALIFICATION_TEMPLATE = '.harness-runtime/qualification/<provider>.json';
const COMPARE_SCHEMA_VERSION = 'h10c-shadow-compare-v1';

const { runShadowObservation, createShadowDryRunProvider, loadQualificationResult } = require('./runner');
const { buildCompareReport } = require('./comparator');
const { detectCrossModelConsensus } = require('./intervention');

const SUPPORTED_PROVIDERS = Object.freeze(['deepseek', 'longcat', 'glm', 'codex']);
const API_KEY_ENV = Object.freeze({ deepseek: 'DEEPSEEK_API_KEY', longcat: 'LONGCAT_API_KEY', glm: 'GLM_API_KEY', codex: 'CODEX_API_KEY' });

function qualificationPath(provider) {
  return QUALIFICATION_TEMPLATE.replace('<provider>', provider);
}

// 读取 corpus（项目内路径防逃逸；与 runner.js loadCorpus 同语义，不依赖其导出）
function loadCorpus(corpusPath = DEFAULT_CORPUS) {
  const resolved = path.resolve(HOST_ROOT, corpusPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`H10C_SHADOW corpus escapes project root: ${corpusPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`H10C_SHADOW corpus parse failed: ${corpusPath}: ${error.message}`);
  }
  return Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
}

// 默认 provider 工厂：
//   dry-run → 合成 provider（全部模型）
//   真实 → deepseek 复用 P1 execution runtime；其他模型 runtime 未实现（P6+ 批次）→ 抛错（该 provider 记 failed）
//   对应 API key 缺失 → 抛错（该 provider 记 failed，部分失败容错）
function createDefaultProviderFactory({ dryRun }) {
  return (name) => {
    if (dryRun) return createShadowDryRunProvider();
    if (name === 'deepseek') {
      if (!process.env.DEEPSEEK_API_KEY) throw new Error(`H10C_PROVIDER_ENV ${name} 的 ${API_KEY_ENV[name]} 未配置`);
      const { createExecutionRuntime } = require('../../providers/execution-runtime');
      return createExecutionRuntime();
    }
    if (!process.env[API_KEY_ENV[name]]) {
      throw new Error(`H10C_PROVIDER_ENV ${name} 的 ${API_KEY_ENV[name]} 未配置`);
    }
    throw new Error(`H10C_PROVIDER_RUNTIME_NOT_IMPLEMENTED ${name} 执行运行时未实现（P6+ 批次），真实并行调度暂只支持 DeepSeek`);
  };
}

// 并行 fixture 集合（确定性）：--fixture 指定 1 个；--count N 取前 N；默认族内全部
function selectParallelFixtures(fixtures, family, { fixtureRef = null, count = null } = {}) {
  const familyFixtures = fixtures.filter((fixture) => fixture.scenario_type === family);
  if (familyFixtures.length === 0) throw new Error(`H10C_SHADOW 任务族 ${family} 在 corpus 中无 fixture`);
  if (fixtureRef) {
    const match = familyFixtures.find((fixture) => fixture.corpus_id === fixtureRef);
    if (!match) throw new Error(`H10C_SHADOW fixture ${fixtureRef} 不属于任务族 ${family}`);
    return [match];
  }
  if (Number.isInteger(count) && count > 0) return familyFixtures.slice(0, count);
  return familyFixtures;
}

// 主入口。providerFactory(name) → runtime 或抛错。
// 返回 { exit_code, providers, family, tier_by_provider, compare_path, compare_report, succeeded, failed_providers, logs }
async function runParallelShadow({
  providerNames,
  family,
  tierOverride = null,
  fixtureRef = null,
  count = null,
  dryRun = false,
  stopOnCritical = false,
  verbose = false,
  now = new Date(),
  providerFactory = null
}) {
  if (!Array.isArray(providerNames) || providerNames.length < 2) {
    throw new Error('H10C_SHADOW 并行模式需要至少两个模型（--providers deepseek,longcat）');
  }
  for (const name of providerNames) {
    if (!SUPPORTED_PROVIDERS.includes(name)) {
      throw new Error(`H10C_SHADOW 未知模型 ${name}（支持: ${SUPPORTED_PROVIDERS.join(', ')}）`);
    }
  }

  // 1. 准入矩阵检查（任一缺失 → 拒绝，退出码 2）
  const tiers = {};
  for (const name of providerNames) {
    let matrix;
    try {
      matrix = loadQualificationResult(qualificationPath(name));
    } catch (error) {
      throw new Error(`H10C_MATRIX Provider ${name} 准入矩阵未产出，请先运行 harness:qualify --provider ${name}（${error.message}）`);
    }
    const entry = matrix.families.find((item) => item.family === family);
    if (!entry) {
      throw new Error(`H10C_MATRIX Provider ${name} 准入矩阵未评估任务族 ${family}，请先运行 harness:qualify --provider ${name}`);
    }
    tiers[name] = entry.decided_tier;
  }

  // 2. 档位检查：任一 L3/L4 → 拒绝（§6.2）；全部 L0 → 拒绝（§5.1）
  const effectiveTiers = {};
  for (const name of providerNames) {
    const tier = tierOverride || tiers[name];
    if (tier === 'L3' || tier === 'L4') {
      throw new Error('H10C_TIER 并行模式不支持 L3/L4 档位（写入冲突风险），请使用 L1/L2 档位或单模型模式');
    }
    effectiveTiers[name] = tier;
  }
  if (providerNames.every((name) => effectiveTiers[name] === 'L0')) {
    throw new Error('H10C_L0 所有模型均拒绝该任务族（L0），不执行并行观察');
  }

  // 3. fixture 集合（确定化，跨模型对齐）
  const fixtures = loadCorpus(DEFAULT_CORPUS);
  const selected = selectParallelFixtures(fixtures, family, { fixtureRef, count });

  // 4. 并行执行（Promise.allSettled：单模型失败不影响其他）
  const factory = providerFactory || createDefaultProviderFactory({ dryRun });
  const settled = await Promise.allSettled(providerNames.map(async (name) => {
    const runtime = factory(name); // 可能抛（key 缺失 / runtime 未实现）
    const tier = effectiveTiers[name];
    if (tier === 'L0') {
      return { provider: name, entries: [], tier, signals: [], skipped: true, reason: 'L0 拒绝观察' };
    }
    const entries = [];
    const logFiles = [];
    const signals = [];
    for (const fixture of selected) {
      const result = await runShadowObservation({
        provider: runtime,
        providerName: name,
        family,
        tier,
        matrixPath: qualificationPath(name),
        fixtureRef: fixture.corpus_id,
        dryRun,
        stopOnCritical,
        verbose,
        now
      });
      for (const log of result.log_files) logFiles.push(log);
      for (const signal of result.signals || []) signals.push(signal);
      // 读取本次观察日志（runShadowObservation 每次只跑 1 个 fixture → 1 条日志）取 verdict/category
      let verdict = null;
      let category = null;
      if (result.log_files.length > 0) {
        try {
          const logEntry = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, result.log_files[0]), 'utf8'));
          verdict = logEntry.response ? logEntry.response.verdict : null;
          category = logEntry.response ? logEntry.response.category : null;
        } catch {
          // 日志缺失时保留 null（进入分歧统计）
        }
      }
      entries.push({ corpus_id: fixture.corpus_id, verdict, category });
    }
    return { provider: name, entries, tier, signals, logFiles };
  }));

  // 5. 结果聚合（allSettled 保持输入顺序，按索引关联 provider 名）
  const succeeded = [];
  const failedProviders = [];
  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index];
    if (outcome.status === 'fulfilled') {
      succeeded.push(outcome.value);
    } else {
      failedProviders.push({ provider: providerNames[index], reason: String((outcome.reason && outcome.reason.message) || outcome.reason) });
    }
  }

  if (succeeded.length === 0) {
    throw new Error(`H10C_ALL_FAILED 所有模型执行失败，无法产出对比报告（${failedProviders.map((item) => `${item.provider}: ${item.reason}`).join('；')}）`);
  }

  // 6. 对比报告 + 聚合信号
  const providerResults = succeeded.map((item) => ({ provider: item.provider, entries: item.entries, tier: item.tier }));
  const modelSignals = {};
  for (const item of succeeded) modelSignals[item.provider] = item.signals || [];
  const crossModelSignals = detectCrossModelConsensus(modelSignals, family);
  const report = buildCompareReport({ providerResults, crossModelSignals });
  report.family = family;
  report.timestamp = now.toISOString();
  if (failedProviders.length > 0) report.failed_providers = failedProviders;

  const compareDir = path.join(HOST_ROOT, COMPARE_DIR);
  fs.mkdirSync(compareDir, { recursive: true });
  const compareFile = path.join(compareDir, `${family}-${now.getTime()}.json`);
  const tmp = `${compareFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(tmp, compareFile);

  return {
    exit_code: failedProviders.length > 0 ? 1 : 0,
    providers: providerNames,
    family,
    tier_by_provider: effectiveTiers,
    compare_path: path.relative(HOST_ROOT, compareFile),
    compare_report: report,
    succeeded: succeeded.map((item) => ({ provider: item.provider, tier: item.tier, fixtures: item.entries.length, log_files: item.logFiles || [] })),
    failed_providers: failedProviders,
    dry_run: dryRun === true
  };
}

module.exports = {
  COMPARE_DIR,
  COMPARE_SCHEMA_VERSION,
  SUPPORTED_PROVIDERS,
  API_KEY_ENV,
  qualificationPath,
  createDefaultProviderFactory,
  selectParallelFixtures,
  runParallelShadow
};
