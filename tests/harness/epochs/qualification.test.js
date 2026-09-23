'use strict';

// P5/H09：准入矩阵流程测试。
// 覆盖：matrix 读取/派生、fixture 选取、L0-L4 档位判定、P0 连续失败 N=2 立即停止、
//       dry-run 全链路、缺 key 拒绝、非 deepseek 拒绝、epoch schema v2 fixtures 合法性。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const MATRIX_PATH = 'tests/harness/epochs/qualification-matrix.json';
const CORPUS_PATH = 'tests/harness/fixtures/corpus/corpus.json';

const { loadQualificationMatrix, taskFamiliesFromCorpus } = require('../../../scripts/harness/lib/qualification/matrix');
const { decideTier } = require('../../../scripts/harness/lib/qualification/tiers');
const {
  selectFixtures,
  runFamily,
  runQualification,
  createDryRunProvider,
  P0_CONSECUTIVE_FAILURE_LIMIT
} = require('../../../scripts/harness/lib/qualification/runner');
const { main: qualifyMain, parseCli } = require('../../../scripts/harness/qualify');
const { loadSchemas, validateAgainstSchema } = require('../../../scripts/harness/validate-contract');

// 行为可编程 provider：按调用顺序返回预设结果（最后一个结果循环复用）
function createScriptedProvider(results) {
  let index = 0;
  return {
    provider_id: 'P-TEST-SCRIPTED',
    async call() {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      if (result instanceof Error) throw result;
      return result;
    }
  };
}

const PASS_RESULT = (verdict) => ({
  schema_version: 'h02-provider-result-v1',
  provider_id: 'P-TEST-SCRIPTED',
  role: 'execution',
  request_id: 'test',
  outcome: { code: 'OK', summary: `deepseek-v4-flash echoed: {"verdict":"${verdict}","reason":"test"}` }
});

const FAIL_RESULT = { schema_version: 'h02-provider-result-v1', provider_id: 'P-TEST-SCRIPTED', role: 'execution', request_id: 'test', outcome: { code: 'TOOL_ERROR', summary: 'H02A_EXECUTION_CALL_FAILED network timeout' } };

// ---- matrix 读取与派生 ----

test('H09-01 qualification matrix carries 6 families all expected L2', () => {
  const corpus = require(`../../../${CORPUS_PATH}`);
  const matrix = loadQualificationMatrix(MATRIX_PATH, corpus.fixtures);
  assert.equal(matrix.matrix_id, 'QMATRIX-H09-BASE-V1');
  assert.equal(matrix.task_families.length, 6);
  for (const family of matrix.task_families) assert.equal(family.expected_tier, 'L2');
});

test('H09-02 missing matrix file falls back to corpus-derived families (default L2)', () => {
  const corpus = require(`../../../${CORPUS_PATH}`);
  const matrix = loadQualificationMatrix('tests/harness/epochs/__missing__.json', corpus.fixtures);
  assert.equal(matrix.matrix_id, 'QMATRIX-DERIVED');
  assert.deepEqual(matrix.task_families.map((entry) => entry.family).sort(), ['cross-platform', 'entry-defect', 'feature-addition', 'malformed-index', 'permission-control', 'snapshot-pollution']);
  for (const family of matrix.task_families) assert.equal(family.expected_tier, 'L2');
  const derived = taskFamiliesFromCorpus(corpus.fixtures);
  assert.equal(derived.length, 6);
});

test('H09-03 fixture selection caps P0 at 5 / P1 at 3 / P2 at 3 per family', () => {
  const corpus = require(`../../../${CORPUS_PATH}`);
  assert.equal(selectFixtures(corpus.fixtures, 'entry-defect', 'P0').length, 5, 'entry-defect P0 capped at 5');
  assert.equal(selectFixtures(corpus.fixtures, 'malformed-index', 'P1').length, 3, 'malformed-index P1 capped at 3');
  assert.equal(selectFixtures(corpus.fixtures, 'snapshot-pollution', 'P0').length, 5, 'snapshot-pollution P0 capped at 5');
  assert.equal(selectFixtures(corpus.fixtures, 'entry-defect', 'P1').length, 0, 'entry-defect has no P1 fixtures');
  assert.equal(selectFixtures(corpus.fixtures, 'malformed-index', 'P0').length, 0, 'malformed-index has no P0 fixtures');
});

// ---- 档位判定（§5.3 + 2026-08-19 用户裁决）----

test('H09-04 tier L4 when P0/P1/P2 all pass', () => {
  const result = decideTier({ p0: [true, true, true], p1: [true, true], p2: [true, true, true] });
  assert.equal(result.tier, 'L4');
});

test('H09-05 tier L3 when P2 passes 2/3', () => {
  const result = decideTier({ p0: [true, true], p1: [true], p2: [true, true, false] });
  assert.equal(result.tier, 'L3');
});

test('H09-06 tier L2 boundary when P2 passes 1/3 (§9.2)', () => {
  const result = decideTier({ p0: [true, true], p1: [true], p2: [true, false, false] });
  assert.equal(result.tier, 'L2');
  assert.ok(result.notes.some((note) => note.includes('边界') || note.includes('1/3')), 'boundary note expected');
});

test('H09-07 tier L2 conservative when no P2 fixtures (user ruling 2026-08-19)', () => {
  const result = decideTier({ p0: [true, true], p1: [true], p2: [] });
  assert.equal(result.tier, 'L2');
  assert.ok(result.notes.some((note) => note.includes('2026-08-19')), 'user ruling note expected');
});

test('H09-08 tier L1 when P1 fails', () => {
  const result = decideTier({ p0: [true, true], p1: [true, false], p2: [] });
  assert.equal(result.tier, 'L1');
});

test('H09-09 tier L0 when P0 fails (explicit refusal)', () => {
  const result = decideTier({ p0: [true, false], p1: [true], p2: [] });
  assert.equal(result.tier, 'L0');
});

// ---- P0 连续失败 N=2（用户裁决）----

test('H09-10 P0 consecutive failure N=2 aborts family immediately with L0 and stops further runs', async () => {
  const fixtures = [
    { corpus_id: 'C-TEST-A', task_id: 'TASK-T', scenario_type: 'entry-defect', priority: 'P0', payload: {}, expected: { verdict: 'fail' } },
    { corpus_id: 'C-TEST-B', task_id: 'TASK-T', scenario_type: 'entry-defect', priority: 'P0', payload: {}, expected: { verdict: 'fail' } }
  ];
  assert.equal(P0_CONSECUTIVE_FAILURE_LIMIT, 2, 'N=2 fixed by user ruling');
  const provider = createScriptedProvider([FAIL_RESULT, FAIL_RESULT]);
  const result = await runFamily({ provider, fixtures, family: 'entry-defect', retry: 0, verbose: false });
  assert.equal(result.skipped, false);
  assert.ok(result.aborted, 'family must abort on P0 consecutive failure');
  assert.equal(result.aborted.corpus_id, 'C-TEST-A');
  assert.equal(result.aborted.failures, 2);
  assert.equal(result.runs.P0.status, 'aborted');
  assert.equal(result.total_runs, 2, 'must stop after 2 runs, not continue to fixture B or P1/P2');
});

// ---- 族无 fixture → 跳过 ----

test('H09-11 family with no fixtures is skipped with warning (not tiered)', async () => {
  const fixtures = [{ corpus_id: 'C-X', task_id: 'T', scenario_type: 'entry-defect', priority: 'P0', payload: {}, expected: { verdict: 'fail' } }];
  const result = await runFamily({ provider: createScriptedProvider([PASS_RESULT('pass')]), fixtures, family: 'no-such-family', retry: 0, verbose: false });
  assert.equal(result.skipped, true);
});

// ---- dry-run 全链路（CLI）----

test('H09-12 dry-run full pipeline produces matrix with dry_run flag and conservative tiers', async () => {
  const outFile = path.join(HOST_ROOT, '.harness-runtime/qualification/' + `h09-dry-run-${Date.now()}.json`);
  try {
    const code = await qualifyMain(['--provider', 'deepseek', '--matrix', MATRIX_PATH, '--out', outFile, '--dry-run']);
    assert.equal(code, 0);
    const matrix = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(matrix.dry_run, true);
    assert.equal(matrix.provider, 'deepseek', 'provider field = declared target model (dry_run flag distinguishes mode)');
    assert.equal(matrix.summary.families_evaluated, 6);
    assert.equal(matrix.summary.families_skipped, 0);
    const byFamily = Object.fromEntries(matrix.families.map((family) => [family.family, family.decided_tier]));
    // dry-run 恒 pass：entry-defect/snapshot-pollution（P0 全过、P1/P2 缺失）→ L2；malformed-index（P0 缺失）→ L1
    assert.equal(byFamily['entry-defect'], 'L2', 'P0 pass + no P1/P2 → conservative L2');
    assert.equal(byFamily['snapshot-pollution'], 'L2');
    assert.equal(byFamily['malformed-index'], 'L1', 'no P0 fixtures → conservative L1');
  } finally {
    fs.rmSync(outFile, { force: true });
  }
});

test('H09-13 dry-run provider works without DEEPSEEK_API_KEY', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const outFile = path.join(HOST_ROOT, '.harness-runtime/qualification/' + `h09-dry-${Date.now()}.json`);
    try {
      const code = await qualifyMain(['--provider', 'deepseek', '--matrix', MATRIX_PATH, '--out', outFile, '--dry-run']);
      assert.equal(code, 0);
    } finally {
      fs.rmSync(outFile, { force: true });
    }
  } finally {
    if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous;
  }
});

// ---- 缺 key / 未实现模型拒绝 ----

test('H09-14 real mode without DEEPSEEK_API_KEY is rejected explicitly', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await assert.rejects(
      () => qualifyMain(['--provider', 'deepseek', '--matrix', MATRIX_PATH, '--out', '.harness-runtime/qualification/deepseek.json']),
      (error) => error.code === 'H09_QUALIFY_ENV_MISSING' && /DEEPSEEK_API_KEY/.test(error.message)
    );
  } finally {
    if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous;
  }
});

test('H09-15 non-deepseek provider is rejected (P6+ not implemented)', async () => {
  await assert.rejects(
    () => qualifyMain(['--provider', 'longcat', '--matrix', MATRIX_PATH, '--out', '.harness-runtime/qualification/longcat.json', '--dry-run']),
    (error) => error.code === 'H09_PROVIDER_NOT_IMPLEMENTED' && /LongCat|P6\+/.test(error.message)
  );
});

test('H09-16 --task-family filter restricts evaluated families', async () => {
  const outFile = path.join(HOST_ROOT, '.harness-runtime/qualification/' + `h09-filter-${Date.now()}.json`);
  try {
    const code = await qualifyMain(['--provider', 'deepseek', '--matrix', MATRIX_PATH, '--out', outFile, '--dry-run', '--task-family', 'entry-defect']);
    assert.equal(code, 0);
    const matrix = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(matrix.summary.families_evaluated, 1);
    assert.equal(matrix.families[0].family, 'entry-defect');
  } finally {
    fs.rmSync(outFile, { force: true });
  }
});

// ---- epoch schema v2 fixtures 字段 ----

test('H09-17 deepseek-ep01.json conforms to epoch schema v2 including fixtures', () => {
  const epoch = require('../../../tests/harness/epochs/deepseek-ep01.json');
  const schemas = loadSchemas(HOST_ROOT);
  const epochSchema = schemas.find((entry) => entry.$id === 'urn:h01:epoch.schema.json');
  assert.ok(epochSchema, 'epoch schema must exist');
  const errors = [];
  validateAgainstSchema(epoch, epochSchema.schema, 'epoch', errors);
  assert.deepEqual(errors, [], 'epoch v2 fixture must validate');
  assert.equal(epoch.schema_version, 'h01-epoch-v2');
  assert.ok(Array.isArray(epoch.fixtures) && epoch.fixtures.length === 31, 'epoch must reference all 31 corpus fixtures');
  const sample = epoch.fixtures[0];
  assert.ok(sample.corpus_id && sample.priority && sample.required_runs > 0, 'fixture ref fields required');
  const corpus = require(`../../../${CORPUS_PATH}`);
  const corpusIds = new Set(corpus.fixtures.map((fixture) => fixture.corpus_id));
  for (const ref of epoch.fixtures) {
    assert.ok(corpusIds.has(ref.corpus_id), `epoch fixture ref must exist in corpus: ${ref.corpus_id}`);
  }
});

// ---- runQualification 集成：P0 失败族全链路 ----

test('H09-18 runQualification marks family L0 when P0 fails and records failure detail', async () => {
  const corpus = require(`../../../${CORPUS_PATH}`);
  const failing = corpus.fixtures.filter((fixture) => fixture.scenario_type === 'entry-defect' && fixture.priority === 'P0').slice(0, 1);
  const matrix = await runQualification({
    provider: createScriptedProvider([FAIL_RESULT, FAIL_RESULT]),
    corpusPath: CORPUS_PATH,
    matrixPath: MATRIX_PATH,
    taskFamilyPattern: 'entry-defect',
    dryRun: false
  });
  assert.equal(matrix.summary.families_evaluated, 1);
  const family = matrix.families[0];
  assert.equal(family.decided_tier, 'L0');
  assert.ok(family.aborted, 'abort record must exist');
  assert.ok(family.tier_notes[0].includes(`N=${P0_CONSECUTIVE_FAILURE_LIMIT}`), 'tier note must cite N=2 threshold');
});
