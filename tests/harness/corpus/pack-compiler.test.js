'use strict';

// H05（P2）：运行包编译器与执行适配层测试。
// 验证：编译结构（pack_id/task_id/fixture/contract_ref/provider_config_template）、
// API key 占位符（不填充实际值）、不含仓库内路径/规则正文、
// 缺 task 报错、pack-runner 字段校验与 env 注入检查（exit 2 语义）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_CORPUS = 'tests/harness/fixtures/corpus/h04-sample-b00.json';
const { compilePack, findFixtureForTask, buildProviderConfigTemplate } = require('../../../scripts/harness/corpus/pack-compiler');
const { loadPack, checkEnvironment, REQUIRED_PACK_FIELDS } = require('../../../scripts/harness/corpus/pack-runner');

const TMP_PACKS = '.harness-runtime/packs-test';

test('H05-01 compilePack produces self-contained pack with placeholder keys and execution_fixture', () => {
  const result = compilePack({ taskId: 'TASK-H04-CORPUS', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS });
  const pack = result.pack;
  assert.match(pack.pack_id, /^PACK-TASK-H04-CORPUS-\d+$/);
  assert.equal(pack.task_id, 'TASK-H04-CORPUS');
  assert.equal(pack.schema_version, 'h05-pack-v1');
  assert.ok(pack.fixture.corpus_id, 'fixture must be embedded');
  assert.equal(pack.contract_ref.task_id, 'TASK-H04-CORPUS');
  assert.equal(pack.contract_ref.contract_version, 'h01-task-v1');
  // H02 Runner 执行形态必须存在（H04 验证器 payload 不是执行输入）
  assert.ok(pack.execution_fixture && Array.isArray(pack.execution_fixture.steps) && pack.execution_fixture.steps.length > 0, 'execution_fixture with steps required');
  assert.ok(pack.execution_fixture.ruleset_id && pack.execution_fixture.epoch_id && pack.execution_fixture.fixture_suite_ref, 'execution_fixture refs required');
  // API key 必须为占位符，不得包含实际值
  assert.equal(pack.provider_config_template.execution.api_key, '${DEEPSEEK_API_KEY}');
  assert.equal(pack.provider_config_template.judge.api_key, '${JUDGE_API_KEY}');
  const serialized = JSON.stringify(pack);
  assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(serialized), 'pack must not contain any real key material (long sk- token pattern)');
  // 不得包含仓库内绝对路径与规则正文
  assert.ok(!serialized.includes(HOST_ROOT), 'pack must not embed host root path');
  assert.ok(!serialized.includes('AGENTS.md'), 'pack must not embed rule file references');
  // 磁盘产物位于 .harness-runtime/（gitignore 排除）
  assert.ok(fs.existsSync(result.fileName));
  assert.ok(result.fileName.includes('.harness-runtime/'));
});

test('H05-02 missing task_id is rejected', () => {
  assert.throws(() => compilePack({ taskId: '', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS }), /H05_PACK taskId required/);
  assert.throws(() => compilePack({ taskId: 'TASK-NOT-IN-CORPUS', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS }), /H05_PACK no fixture for task_id/);
  // 路径注入防护：非法 task_id（含 .. 或不符合白名单）必须拒绝；大小写规则与 task.schema.json 一致
  assert.throws(() => compilePack({ taskId: '../../etc/pwn', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS }), /H05_PACK invalid task_id/);
  assert.throws(() => compilePack({ taskId: 'TASK-..', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS }), /H05_PACK invalid task_id/);
  assert.throws(() => compilePack({ taskId: 'task-lowercase', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS }), /H05_PACK invalid task_id/);
  assert.throws(() => compilePack({ taskId: 'TASK-abc', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS }), /H05_PACK invalid task_id/, 'lowercase after TASK- must be rejected (schema parity)');
});

test('H05-03 findFixtureForTask locates fixture by task_id', () => {
  const { readCorpus } = require('../../../scripts/harness/corpus/pack-compiler');
  const corpus = readCorpus(SAMPLE_CORPUS);
  const fixture = findFixtureForTask(corpus, 'TASK-H04-CORPUS');
  assert.equal(fixture.task_id, 'TASK-H04-CORPUS');
});

test('H05-04 provider config template reuses P1 runtime shapes', () => {
  const template = buildProviderConfigTemplate();
  assert.equal(template.execution.provider_id, 'P-DEEPSEEK-V4-FLASH');
  assert.equal(template.judge.provider_id, 'J-GENERIC-JUDGE');
  assert.ok(template.execution.base_url.length > 0, 'execution base_url must be resolved');
});

test('H05-05 pack-runner rejects packs missing required fields', () => {
  const incomplete = { pack_id: 'PACK-X' };
  const dir = path.join(HOST_ROOT, TMP_PACKS);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = path.join(dir, 'incomplete.json');
  fs.writeFileSync(fileName, JSON.stringify(incomplete));
  assert.throws(() => loadPack(path.relative(HOST_ROOT, fileName)), /H05_RUN pack missing required field/);
  fs.rmSync(fileName);
});

test('H05-05b pack-runner executes a compiled pack via runner.execute() (execution_fixture path)', async () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;
  const savedJudge = process.env.JUDGE_MODEL_ID;
  process.env.DEEPSEEK_API_KEY = 'test-key-for-pack-exec';
  delete process.env.JUDGE_MODEL_ID;
  try {
    const result = compilePack({ taskId: 'TASK-H04-CORPUS', corpusPath: SAMPLE_CORPUS, outDir: TMP_PACKS });
    const { runPack } = require('../../../scripts/harness/corpus/pack-runner');
    const executed = runPack(result.pack, { outDir: TMP_PACKS, seed: Date.now() % 1000000 });
    assert.equal(executed.outcome.result.status, 'SUCCEEDED', 'runner.execute() must succeed on execution_fixture');
    assert.ok(executed.outcome.trace.events.length >= 1, 'trace must have events');
    assert.ok(executed.env.warnings.length >= 1, 'judge fallback warning expected when JUDGE_MODEL_ID unset');
    assert.equal(executed.env.issues.length, 0, 'no env issues with DEEPSEEK_API_KEY set');
  } finally {
    if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey; else delete process.env.DEEPSEEK_API_KEY;
    if (savedJudge !== undefined) process.env.JUDGE_MODEL_ID = savedJudge; else delete process.env.JUDGE_MODEL_ID;
  }
});

test('H05-06 pack-runner env check: missing DEEPSEEK_API_KEY is an issue, judge fallback is a warning', () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  const savedJudge = process.env.JUDGE_MODEL_ID;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.JUDGE_MODEL_ID;
  try {
    const pack = {
      provider_config_template: {
        execution: { api_key: '${DEEPSEEK_API_KEY}' },
        judge: { model_id: 'fallback' }
      }
    };
    const env = checkEnvironment(pack);
    assert.ok(env.issues.length >= 1, 'missing DEEPSEEK_API_KEY must be an issue (exit 2 semantics)');
    assert.ok(env.warnings.length >= 1, 'unconfigured judge must produce a fallback warning');
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
    if (savedJudge !== undefined) process.env.JUDGE_MODEL_ID = savedJudge; else delete process.env.JUDGE_MODEL_ID;
  }
});

test('H05-07 REQUIRED_PACK_FIELDS matches pack structure', () => {
  assert.deepEqual(REQUIRED_PACK_FIELDS, ['pack_id', 'task_id', 'fixture', 'execution_fixture', 'contract_ref', 'provider_config_template']);
});
