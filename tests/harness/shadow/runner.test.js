'use strict';

// P6/H10A：影子观察流程测试。
// 覆盖：L0 拒绝、矩阵缺失、L1 只日志、L2 日志+diff、fixture 指定、dirty 仓库 L3/L4 跳过写入、stop-on-critical。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const MATRIX_PATH = '.harness-runtime/qualification/deepseek.json';

const {
  loadQualificationResult,
  decidedTierOf,
  selectFixturesForShadow,
  gitStatusIsDirty,
  diffTargetPaths,
  runShadowObservation,
  createShadowDryRunProvider
} = require('../../../scripts/harness/lib/shadow/runner');
const { main: shadowMain } = require('../../../scripts/harness/shadow');

// 测试用临时矩阵产物（写入 .harness-runtime 下，gitignored）
function writeTestMatrix(families) {
  const dir = path.dirname(path.join(HOST_ROOT, MATRIX_PATH));
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    schema_version: 'h09-qualification-result-v1',
    provider: 'deepseek',
    dry_run: true,
    generated_at: new Date().toISOString(),
    summary: { families_evaluated: families.length, tier_counts: {} },
    warnings: [],
    skipped: [],
    families
  };
  const original = fs.existsSync(path.join(HOST_ROOT, MATRIX_PATH)) ? fs.readFileSync(path.join(HOST_ROOT, MATRIX_PATH), 'utf8') : null;
  fs.writeFileSync(path.join(HOST_ROOT, MATRIX_PATH), JSON.stringify(payload, null, 2) + '\n');
  return original;
}

function restoreMatrix(original) {
  if (original === null) fs.rmSync(path.join(HOST_ROOT, MATRIX_PATH), { force: true });
  else fs.writeFileSync(path.join(HOST_ROOT, MATRIX_PATH), original);
}

// dirty 前提必须由用例自行建立，否则 clean checkout 下失去的是被测前提而非功能。
// 探针文件必须落在 .gitignore 之外，否则不产生 dirty 状态。
const DIRTY_PROBE_PATH = path.join(HOST_ROOT, 'harness-dirty-probe.tmp');

function makeRepoDirty() {
  fs.writeFileSync(DIRTY_PROBE_PATH, 'proto-harness shadow dirty probe\n');
}

function removeDirtyProbe() {
  fs.rmSync(DIRTY_PROBE_PATH, { force: true });
}

// 脚本化 provider（按序返回，末位循环）
function createScriptedProvider(results) {
  let index = 0;
  return {
    provider_id: 'P-TEST-SHADOW',
    async call() {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      if (result instanceof Error) throw result;
      return result;
    }
  };
}

const OK_SUMMARY = (verdict) => ({
  schema_version: 'h02-provider-result-v1',
  provider_id: 'P-TEST-SHADOW',
  role: 'execution',
  request_id: 't',
  outcome: { code: 'OK', summary: `deepseek-v4-flash echoed: {"verdict":"${verdict}","reason":"test"}` }
});

test('H10A-01 qualification result matrix is loadable and tier lookup works', () => {
  const original = writeTestMatrix([
    { family: 'entry-defect', decided_tier: 'L2' },
    { family: 'malformed-index', decided_tier: 'L1' }
  ]);
  try {
    const matrix = loadQualificationResult(MATRIX_PATH);
    assert.equal(decidedTierOf(matrix, 'entry-defect'), 'L2');
    assert.equal(decidedTierOf(matrix, 'snapshot-pollution'), null);
  } finally {
    restoreMatrix(original);
  }
});

test('H10A-02 missing qualification matrix raises explicit error', () => {
  assert.throws(
    () => loadQualificationResult('.harness-runtime/qualification/__missing__.json'),
    /准入矩阵未产出，请先运行 harness:qualify/
  );
});

test('H10A-03 L0 family is refused with explicit error', async () => {
  const original = writeTestMatrix([{ family: 'entry-defect', decided_tier: 'L0' }]);
  try {
    await assert.rejects(
      () => runShadowObservation({ provider: createScriptedProvider([OK_SUMMARY('fail')]), family: 'entry-defect', now: new Date('2026-08-19T00:00:00Z') }),
      (error) => error.message.includes('L0') && error.message.includes('不执行影子观察')
    );
  } finally {
    restoreMatrix(original);
  }
});

test('H10A-04 L1 observation writes log only (no diff / no branch / no commit)', async () => {
  const original = writeTestMatrix([{ family: 'malformed-index', decided_tier: 'L1' }]);
  const now = new Date('2026-08-19T00:00:00Z');
  try {
    const result = await runShadowObservation({
      provider: createScriptedProvider([OK_SUMMARY('fail')]),
      family: 'malformed-index',
      now
    });
    assert.equal(result.tier, 'L1');
    assert.equal(result.fixture_count, 1);
    assert.ok(result.log_files.length === 1, 'log file must be written');
    assert.ok(fs.existsSync(result.log_files[0]), 'log file must exist on disk');
    const log = JSON.parse(fs.readFileSync(result.log_files[0], 'utf8'));
    assert.equal(log.schema_version, 'h10a-shadow-log-v1');
    assert.equal(log.family, 'malformed-index');
    assert.ok(log.prompt.includes('scenario_type'), 'prompt must be recorded');
    assert.equal(log.output.diff_path, null, 'L1 must not produce diff');
    assert.equal(log.output.branch, null);
    assert.equal(log.output.commit, null);
  } finally {
    restoreMatrix(original);
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/deepseek/malformed-index'), { recursive: true, force: true });
  }
});

test('H10A-05 L2 observation writes log + diff file (git unified format)', async () => {
  const original = writeTestMatrix([{ family: 'entry-defect', decided_tier: 'L2' }]);
  const now = new Date('2026-08-19T00:00:00Z');
  try {
    const result = await runShadowObservation({
      provider: createShadowDryRunProvider(),
      family: 'entry-defect',
      fixtureRef: 'C-店-门店后台-index.html-02',
      now
    });
    assert.equal(result.tier, 'L2');
    const entry = result.output[0];
    assert.ok(entry.diff_path, 'L2 must produce diff file');
    const diff = fs.readFileSync(path.join(HOST_ROOT, entry.diff_path), 'utf8');
    assert.match(diff, /^---\s/m, 'diff must use unified format');
    assert.match(diff, /^\+\+\+\s/m);
    assert.ok(entry.branch === null && entry.commit === null, 'L2 must not branch/commit');
  } finally {
    restoreMatrix(original);
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/deepseek/entry-defect'), { recursive: true, force: true });
  }
});

test('H10A-06 --fixture selection restricts to requested corpus_id', () => {
  const fixtures = [
    { corpus_id: 'C-A', scenario_type: 'entry-defect', priority: 'P0' },
    { corpus_id: 'C-B', scenario_type: 'entry-defect', priority: 'P0' }
  ];
  const selected = selectFixturesForShadow(fixtures, 'entry-defect', { fixtureRef: 'C-B' });
  assert.deepEqual(selected.map((f) => f.corpus_id), ['C-B']);
  assert.throws(() => selectFixturesForShadow(fixtures, 'entry-defect', { fixtureRef: 'C-NOPE' }), /不属于任务族/);
  const all = selectFixturesForShadow(fixtures, 'entry-defect', { all: true });
  assert.equal(all.length, 2);
});

test('H10A-07 dirty repo skips L3/L4 write with warning (log + diff only)', async () => {
  // 自行制造 dirty 前提，验证 L3/L4 走"跳过写入"分支
  const original = writeTestMatrix([
    { family: 'entry-defect', decided_tier: 'L3' },
    { family: 'snapshot-pollution', decided_tier: 'L4' }
  ]);
  const now = new Date('2026-08-19T00:00:00Z');
  try {
    makeRepoDirty();
    assert.equal(gitStatusIsDirty(), true, 'dirty probe must make the workspace dirty');
    const l3 = await runShadowObservation({
      provider: createShadowDryRunProvider(),
      family: 'entry-defect',
      fixtureRef: 'C-店-门店后台-index.html-02',
      now
    });
    assert.equal(l3.dirty_write_skipped, true, 'L3 write must be skipped when dirty');
    assert.ok(l3.warnings.some((w) => w.includes('工作区存在未提交改动')), 'warning must be emitted');
    const l4 = await runShadowObservation({
      provider: createShadowDryRunProvider(),
      family: 'snapshot-pollution',
      fixtureRef: 'C-IT-INDEX-19',
      now
    });
    assert.equal(l4.dirty_write_skipped, true, 'L4 write must be skipped when dirty');
  } finally {
    removeDirtyProbe();
    restoreMatrix(original);
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/deepseek/entry-defect'), { recursive: true, force: true });
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/deepseek/snapshot-pollution'), { recursive: true, force: true });
  }
});

test('H10A-08 stop-on-critical stops after critical signal', async () => {
  const original = writeTestMatrix([{ family: 'entry-defect', decided_tier: 'L2' }]);
  const now = new Date('2026-08-19T00:00:00Z');
  try {
    // corpus entry-defect 的 expected.verdict 为 fail；provider 输出 pass → 语义失败 → tier_downgrade critical
    const provider = createScriptedProvider([OK_SUMMARY('pass')]);
    const result = await runShadowObservation({
      provider,
      family: 'entry-defect',
      all: true,
      stopOnCritical: true,
      now
    });
    assert.equal(result.stopped_by_critical, true);
    assert.ok(result.signals.some((s) => s.type === 'tier_downgrade' && s.severity === 'critical'), 'critical downgrade signal expected');
  } finally {
    restoreMatrix(original);
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/deepseek/entry-defect'), { recursive: true, force: true });
  }
});

test('H10A-09 CLI dry-run L1 exits 0 and writes log (end-to-end)', async () => {
  const original = writeTestMatrix([{ family: 'malformed-index', decided_tier: 'L1' }]);
  try {
    const code = await shadowMain(['--provider', 'deepseek', '--family', 'malformed-index', '--tier', 'L1', '--count', '1', '--dry-run']);
    assert.equal(code, 0);
  } finally {
    restoreMatrix(original);
    fs.rmSync(path.join(HOST_ROOT, '.harness-runtime/shadow/deepseek/malformed-index'), { recursive: true, force: true });
  }
});

test('H10A-10 diffTargetPaths extracts unified diff target paths', () => {
  const diff = '--- a/admin-portal/index.html\n+++ b/admin-portal/index.html\n@@ -1 +1 @@\n-old\n+new\n--- a/x.md\n+++ b/x.md\n';
  assert.deepEqual(diffTargetPaths(diff), ['admin-portal/index.html', 'x.md']);
  assert.deepEqual(diffTargetPaths('no diff'), []);
});
