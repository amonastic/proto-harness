'use strict';

// H03C：snapshot-integrity 验证器测试矩阵（S00-01..S00-06）。
// fixture 驱动（tests/harness/fixtures/validators/snapshot-integrity-s00.json）；
// 验证器为纯函数，可变 docs 检测来自薄适配层（canonical sourceDocsPattern）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/snapshot-integrity-s00.json'), 'utf8'));
const { checkSnapshotIntegrity } = require('../../../scripts/harness/validators/snapshot-integrity');

test('S00 matrix: all 6 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 6, 'S00 fixture must contain exactly 6 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkSnapshotIntegrity({ snapshotGraph: fixture.snapshotGraph, knownDebt: fixture.knownDebt });
    assert.equal(outcome.verdict, fixture.expected.verdict, `${fixture.id} verdict: ${JSON.stringify(outcome.newIssues)}`);
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

test('S00 adapter: findMutableDocs works on synthetic snapshot HTML (fixtures/snapshots)', () => {
  const { findMutableDocs } = require('../../../scripts/harness/adapters/iteration-snapshots-adapter');
  const clean = fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/snapshots/202607上-clean.html'), 'utf8');
  const mutable = fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/snapshots/202607上-mutable-docs.html'), 'utf8');
  assert.deepEqual(findMutableDocs(clean), [], 'clean snapshot must have no mutable docs refs');
  assert.ok(findMutableDocs(mutable).length >= 1, 'mutable-docs snapshot must hit sourceDocsPattern');
});

test('S00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  const fixture = FIXTURE.cases[0];
  checkSnapshotIntegrity({ snapshotGraph: fixture.snapshotGraph, knownDebt: fixture.knownDebt });
  const after = fs.readdirSync(HOST_ROOT);
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});
