'use strict';

// H04（P2）：Oracle 验证测试——合成语料基线驱动。
// 使用 tests/harness/fixtures/corpus/h04-sample-b00.json（合成 fixture + expected），
// 验证 oracle 判定：oracle_match、degraded 降级、diff 输出、未知 scenario_type 拒绝。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const SAMPLE_CORPUS = 'tests/harness/fixtures/corpus/h04-sample-b00.json';
const { validateCorpus, runValidatorFor, diffSummary } = require('../../../scripts/harness/corpus/oracle');

test('H04-O1 sample corpus validates with all oracle_match true (or degraded flagged)', () => {
  const summary = validateCorpus(SAMPLE_CORPUS);
  assert.equal(summary.fixture_count, 5);
  assert.equal(summary.failures, 0, 'all sample fixtures must match oracle expectations');
  assert.equal(summary.oracle_match_count, 5);
  const degraded = summary.results.filter((item) => item.oracle_confidence === 'degraded');
  assert.equal(degraded.length, 1, 'dirty fixture must be degraded');
  assert.equal(degraded[0].corpus_id, 'C-S-DIRTY-01');
  assert.ok(degraded[0].note.includes('baseline_dirty_warning'), 'degraded note must mention dirty warning');
});

test('H04-O2 scenario types route to the right validators (pure function, no git)', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, SAMPLE_CORPUS), 'utf8'));
  for (const fixture of corpus.fixtures) {
    const actual = runValidatorFor(fixture);
    assert.ok(['pass', 'fail'].includes(actual.verdict), `${fixture.corpus_id} verdict must be pass/fail`);
  }
});

test('H04-O3 mismatch produces diff and is never silently accepted (real validateCorpus)', () => {
  const corpus = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, SAMPLE_CORPUS), 'utf8'));
  const fixture = JSON.parse(JSON.stringify(corpus.fixtures[0]));
  fixture.expected = { verdict: 'fail' }; // 反向预期 → 必然 mismatch
  const summary = validateCorpus(SAMPLE_CORPUS, [fixture]);
  assert.equal(summary.failures, 1);
  assert.equal(summary.results[0].oracle_match, false);
  assert.ok(summary.results[0].diff.includes('verdict'), 'diff must describe the verdict mismatch');
});

test('H04-O4 unknown scenario_type is rejected loudly', () => {
  assert.throws(() => runValidatorFor({ corpus_id: 'X', scenario_type: 'unknown-type', payload: {} }), /H04_ORACLE unknown scenario_type/);
});

test('H04-O5 diffSummary shows expected vs actual', () => {
  const diff = diffSummary({ verdict: 'fail', violations: ['缺菜单项'] }, { verdict: 'pass' });
  assert.ok(diff.includes('verdict: expected pass, got fail'), 'diff must show verdict mismatch');
});

// 辅助：不复用（已删除 validateCorpusFromFixtures 副本——H04-O3 直测真实 validateCorpus）
