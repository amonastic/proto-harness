'use strict';

// P7/H10C：多模型并行调度测试。
// 覆盖：双模型并发独立日志、对比报告、聚合信号、部分失败容错、L3/L4 拒绝、矩阵缺失拒绝、dry-run 端到端。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const QUALIFICATION_DIR = path.join(HOST_ROOT, '.harness-runtime/qualification');

const {
  runParallelShadow,
  createDefaultProviderFactory,
  selectParallelFixtures,
  SUPPORTED_PROVIDERS,
  API_KEY_ENV
} = require('../../../scripts/harness/lib/shadow/parallel');
const { detectCrossModelConsensus } = require('../../../scripts/harness/lib/shadow/intervention');
const { main: shadowMain } = require('../../../scripts/harness/shadow');

const ORIGINAL_FILES = new Map(); // provider -> 原文件内容（用于恢复）

function writeMatrix(provider, families) {
  const file = path.join(QUALIFICATION_DIR, `${provider}.json`);
  if (!ORIGINAL_FILES.has(provider)) {
    ORIGINAL_FILES.set(provider, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  }
  fs.mkdirSync(QUALIFICATION_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 'h09-qualification-result-v1',
    provider,
    dry_run: true,
    generated_at: new Date().toISOString(),
    summary: {},
    warnings: [],
    skipped: [],
    families
  }, null, 2) + '\n');
}

function restoreMatrices() {
  for (const [provider, content] of ORIGINAL_FILES) {
    const file = path.join(QUALIFICATION_DIR, `${provider}.json`);
    if (content === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, content);
  }
  ORIGINAL_FILES.clear();
}

function cleanupShadowDirs(providers, family) {
  for (const provider of providers) {
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow', provider, family), { recursive: true, force: true });
  }
  fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/compare'), { recursive: true, force: true });
}

// 行为可编程 provider：输出固定 verdict
function createVerdictProvider(verdict) {
  return {
    provider_id: 'P-TEST-PARALLEL',
    async call() {
      return {
        schema_version: 'h02-provider-result-v1',
        provider_id: 'P-TEST-PARALLEL',
        role: 'execution',
        request_id: 't',
        outcome: { code: 'OK', summary: `deepseek-v4-flash echoed: {"verdict":"${verdict}","reason":"test"}` }
      };
    }
  };
}

const NOW = new Date('2026-08-19T12:00:00Z');

test('H10C-01 dual-model parallel run produces independent logs and compare report', async () => {
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  writeMatrix('longcat', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  try {
    // corpus entry-defect expected= fail；deepseek 输出 fail（正确），longcat 输出 pass（错误）→ 分歧
    const summary = await runParallelShadow({
      providerNames: ['deepseek', 'longcat'],
      family: 'entry-defect',
      count: 3,
      dryRun: false,
      now: NOW,
      providerFactory: (name) => (name === 'deepseek' ? createVerdictProvider('fail') : createVerdictProvider('pass'))
    });
    assert.equal(summary.exit_code, 0);
    assert.equal(summary.failed_providers.length, 0);
    assert.equal(summary.succeeded.length, 2);
    for (const item of summary.succeeded) {
      assert.equal(item.fixtures, 3, 'each model must observe the shared 3-fixture set');
      assert.ok(item.log_files.length === 3, 'independent logs per fixture');
      assert.ok(item.log_files.every((file) => fs.existsSync(path.join(HOST_ROOT, file))), 'logs written to disk');
    }
    // 对比报告
    assert.ok(fs.existsSync(path.join(HOST_ROOT, summary.compare_path)), 'compare report must exist');
    const report = summary.compare_report;
    assert.equal(report.schema_version, 'h10c-shadow-compare-v1');
    assert.equal(report.family, 'entry-defect');
    assert.deepEqual(report.providers, ['deepseek', 'longcat']);
    assert.equal(report.fixture_count, 3);
    assert.equal(report.verdict_agreement_rate, 0, 'all 3 fixtures disagree (fail vs pass)');
    assert.equal(report.disagreements.length, 3);
    assert.equal(report.tier_comparison.deepseek, 'L2');
    assert.equal(report.tier_comparison.longcat, 'L2');
    assert.equal(report.failure_distribution.deepseek.total_failures, 0);
    assert.equal(report.failure_distribution.longcat.semantic_failure, 3, 'longcat pass vs expected fail = semantic failure');
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-02 cross_model_consensus signal when ≥2 models trigger tier_downgrade', async () => {
  // 两个模型都输出 pass（vs expected fail）→ 都触发 tier_downgrade/critical → 聚合信号
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  writeMatrix('longcat', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  try {
    const summary = await runParallelShadow({
      providerNames: ['deepseek', 'longcat'],
      family: 'entry-defect',
      count: 2,
      dryRun: false,
      now: NOW,
      providerFactory: () => createVerdictProvider('pass')
    });
    const signals = summary.compare_report.cross_model_signals;
    assert.equal(signals.length, 1, 'cross-model consensus must fire');
    assert.equal(signals[0].type, 'cross_model_consensus');
    assert.equal(signals[0].severity, 'critical');
    assert.deepEqual(signals[0].models, ['deepseek', 'longcat']);
    assert.match(signals[0].reason, /entry-defect/);
    // 单模型触发不聚合
    const single = detectCrossModelConsensus({ deepseek: [{ type: 'tier_downgrade', severity: 'critical' }] }, 'entry-defect');
    assert.deepEqual(single, []);
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-03 partial failure: one model fails, other succeeds → exit 1 + failed_providers', async () => {
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  writeMatrix('longcat', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  try {
    const summary = await runParallelShadow({
      providerNames: ['deepseek', 'longcat'],
      family: 'entry-defect',
      count: 1,
      dryRun: false,
      now: NOW,
      providerFactory: (name) => {
        if (name === 'longcat') throw new Error('H10C_PROVIDER_RUNTIME_NOT_IMPLEMENTED longcat runtime unavailable');
        return createVerdictProvider('fail');
      }
    });
    assert.equal(summary.exit_code, 1, 'partial failure must exit 1');
    assert.equal(summary.succeeded.length, 1);
    assert.equal(summary.failed_providers.length, 1);
    assert.equal(summary.failed_providers[0].provider, 'longcat');
    assert.match(summary.failed_providers[0].reason, /未实现|unavailable/);
    assert.ok(summary.compare_report.failed_providers, 'report must carry failed_providers');
    assert.equal(summary.compare_report.providers.length, 1);
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-04 L3/L4 tier in parallel mode is rejected', async () => {
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L3' }]);
  writeMatrix('longcat', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  try {
    await assert.rejects(
      () => runParallelShadow({ providerNames: ['deepseek', 'longcat'], family: 'entry-defect', count: 1, dryRun: true, now: NOW }),
      (error) => /L3\/L4/.test(error.message) && /并行模式不支持/.test(error.message)
    );
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-05 missing qualification matrix is rejected with harness:qualify hint', async () => {
  restoreMatrices(); // 确保 longcat 矩阵被删除
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  try {
    await assert.rejects(
      () => runParallelShadow({ providerNames: ['deepseek', 'longcat'], family: 'entry-defect', count: 1, dryRun: true, now: NOW }),
      (error) => /longcat 准入矩阵未产出/.test(error.message) && /harness:qualify --provider longcat/.test(error.message)
    );
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-06 all-L0 family is rejected in parallel mode', async () => {
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L0' }]);
  writeMatrix('longcat', [{ family: 'entry-defect', decided_tier: 'L0' }]);
  try {
    await assert.rejects(
      () => runParallelShadow({ providerNames: ['deepseek', 'longcat'], family: 'entry-defect', count: 1, dryRun: true, now: NOW }),
      (error) => /所有模型均拒绝该任务族（L0）/.test(error.message)
    );
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-07 CLI dry-run parallel end-to-end exits 0 and writes compare report', async () => {
  writeMatrix('deepseek', [{ family: 'entry-defect', decided_tier: 'L2' }]);
  writeMatrix('longcat', [{ family: 'entry-defect', decided_tier: 'L1' }]);
  try {
    const code = await shadowMain(['--parallel', '--providers', 'deepseek,longcat', '--family', 'entry-defect', '--count', '2', '--dry-run']);
    assert.equal(code, 0);
  } finally {
    restoreMatrices();
    cleanupShadowDirs(['deepseek', 'longcat'], 'entry-defect');
  }
});

test('H10C-08 CLI mutual exclusion rules are enforced', async () => {
  await assert.rejects(() => shadowMain(['--provider', 'deepseek', '--providers', 'deepseek,longcat', '--family', 'x', '--dry-run']), /非并行模式不能使用 --providers/);
  await assert.rejects(() => shadowMain(['--parallel', '--family', 'x', '--dry-run']), /--parallel 必须配合 --providers/);
  await assert.rejects(() => shadowMain(['--parallel', '--providers', 'deepseek,longcat', '--provider', 'deepseek', '--family', 'x', '--dry-run']), /--parallel 不能使用 --provider/);
});

test('H10C-09 default provider factory: real mode rejects longcat runtime, dry-run accepts all', () => {
  assert.ok(SUPPORTED_PROVIDERS.includes('longcat'));
  assert.ok(API_KEY_ENV.longcat, 'LONGCAT_API_KEY');
  const dryFactory = createDefaultProviderFactory({ dryRun: true });
  assert.ok(dryFactory('deepseek'));
  assert.ok(dryFactory('longcat'), 'dry-run must accept all providers');
  const realFactory = createDefaultProviderFactory({ dryRun: false });
  assert.throws(() => realFactory('longcat'), /LONGCAT_API_KEY 未配置/);
  assert.throws(() => realFactory('glm'), /GLM_API_KEY 未配置/);
});
