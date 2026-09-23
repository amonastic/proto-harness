'use strict';

// H03C：iteration-reference 验证器测试矩阵（I00-01..I00-08）+ 薄适配层单元验证。
// fixture 驱动（tests/harness/fixtures/validators/iteration-ref-i00.json）；
// 验证器为纯函数，判定全部来自薄适配层（canonical 逻辑），不读取文件系统。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/iteration-ref-i00.json'), 'utf8'));
const { checkIterationReference } = require('../../../scripts/harness/validators/iteration-reference');
const adapter = require('../../../scripts/harness/adapters/iteration-snapshots-adapter');

test('I00 matrix: all 8 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 8, 'I00 fixture must contain exactly 8 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkIterationReference({
      iteration: fixture.iteration,
      activeIteration: FIXTURE.activeIteration,
      iframes: fixture.iframes,
      knownDebt: fixture.knownDebt
    });
    assert.equal(outcome.verdict, fixture.expected.verdict, `${fixture.id} verdict: ${JSON.stringify(outcome.newIssues)}`);
    assert.equal(outcome.isHistorical, fixture.expected.isHistorical, `${fixture.id} isHistorical`);
    assert.equal(outcome.newIssues.length, fixture.expected.newCount, `${fixture.id} newIssues count: ${JSON.stringify(outcome.newIssues)}`);
    if (fixture.expected.debtCount !== undefined) {
      assert.equal(outcome.debtIssues.length, fixture.expected.debtCount, `${fixture.id} debtIssues count`);
    }
    if (fixture.expected.newIncludes) {
      const includes = Array.isArray(fixture.expected.newIncludes) ? fixture.expected.newIncludes : [fixture.expected.newIncludes];
      for (const fragment of includes) {
        assert.ok(outcome.newIssues.some((issue) => issue.detail.includes(fragment)), `${fixture.id} newIssues must include ${fragment}: ${JSON.stringify(outcome.newIssues)}`);
      }
    }
  }
});

test('I00-07 adapter: iterationRank ranks 下 after 上 and isHistorical follows canonical formula', () => {
  assert.equal(adapter.iterationRank('202608上'), 202608 * 2 + 0);
  assert.equal(adapter.iterationRank('202608下'), 202608 * 2 + 1);
  assert.equal(adapter.iterationRank('202608下') > adapter.iterationRank('202608上'), true);
  assert.equal(adapter.isHistorical('202608上', '202608下'), true);
  assert.equal(adapter.isHistorical('202608下', '202608上'), false);
  assert.equal(adapter.isHistorical('202608上', ''), false, 'no active → not historical');
});

test('I00 adapter functions match canonical semantics (live source / snapshot / mutable docs)', () => {
  assert.equal(adapter.isLiveSourceRef('../../admin-portal/maintain-admin/pages/x.html'), true);
  assert.equal(adapter.isLiveSourceRef('snapshots/202607上/x.html'), false);
  assert.equal(adapter.isSnapshotRef('snapshots/202607上/x.html'), true);
  assert.equal(adapter.isSnapshotRef('../../admin-portal/x.html'), false);
  assert.equal(adapter.parseSnapshotIteration('snapshots/202607上/x.html'), '202607上');
  assert.equal(adapter.parseSnapshotIteration('../../admin-portal/x.html'), null);
  const docs = adapter.findMutableDocs('<script src="../admin-portal/maintain-admin/js/docs.js"></script>');
  assert.ok(docs.length >= 1, 'mutable docs must be found');
});

test('I00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  const fixture = FIXTURE.cases[0];
  checkIterationReference({ iteration: fixture.iteration, activeIteration: FIXTURE.activeIteration, iframes: fixture.iframes, knownDebt: fixture.knownDebt });
  const after = fs.readdirSync(HOST_ROOT);
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});
