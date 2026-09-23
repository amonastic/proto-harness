'use strict';

// H03A：dirty-scope 验证器测试矩阵（D00-01..D00-08）。
// fixture 驱动（tests/harness/fixtures/validators/dirty-scope-d00.json）；
// 验证器为纯函数，只解析传入的 statusOutput 字符串，不执行真实 git 命令。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/dirty-scope-d00.json'), 'utf8'));
const { checkDirtyScope, matchesAnyGlob, parseStatusOutput } = require('../../../scripts/harness/validators/dirty-scope');

test('D00 matrix: all 8 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 8, 'D00 fixture must contain exactly 8 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkDirtyScope({ statusOutput: fixture.statusOutput, targetFiles: fixture.targetFiles, forbiddenGlobs: FIXTURE.forbiddenGlobs });
    assert.equal(outcome.verdict, fixture.expected.verdict, `${fixture.id} verdict: ${JSON.stringify(outcome.violations)}`);
    if (fixture.expected.target !== undefined) {
      assert.deepEqual(outcome.layers.target, fixture.expected.target, `${fixture.id} target layer`);
    }
    if (fixture.expected.existingDirty !== undefined) {
      assert.deepEqual(outcome.layers.existing_dirty, fixture.expected.existingDirty, `${fixture.id} existing_dirty layer`);
    }
    if (fixture.expected.highRisk !== undefined) {
      assert.deepEqual(outcome.layers.high_risk, fixture.expected.highRisk, `${fixture.id} high_risk layer`);
    }
    if (fixture.expected.untracked !== undefined) {
      assert.deepEqual(outcome.layers.untracked, fixture.expected.untracked, `${fixture.id} untracked layer`);
    }
    if (fixture.expected.readonly !== undefined) {
      assert.deepEqual(outcome.layers.readonly, fixture.expected.readonly, `${fixture.id} readonly layer`);
    }
  }
});

test('D00 glob matching: ** crosses segments, * stays within segment', () => {
  assert.equal(matchesAnyGlob('harness/01-强制闸门.md', ['harness/**']), true);
  assert.equal(matchesAnyGlob('迭代索引/snapshots/202606/foo.html', ['迭代索引/snapshots/**']), true);
  assert.equal(matchesAnyGlob('standards/rule-map.json', ['standards/**']), true);
  assert.equal(matchesAnyGlob('scripts/a.js', ['scripts/*.js']), true);
  assert.equal(matchesAnyGlob('scripts/sub/b.js', ['scripts/*.js']), false, '* must not cross segments');
  assert.equal(matchesAnyGlob('AGENTS.md', ['AGENTS.md']), true);
  assert.equal(matchesAnyGlob('doc/x.md', ['AGENTS.md']), false);
});

test('D00 parseStatusOutput: staged vs worktree vs untracked', () => {
  const entries = parseStatusOutput('M  scripts/a.js\n M scripts/b.js\n?? download/\n');
  assert.deepEqual(entries.map((entry) => entry.path), ['scripts/a.js', 'scripts/b.js', 'download/']);
  assert.deepEqual(entries.map((entry) => entry.untracked), [false, false, true]);
  assert.equal(entries[0].index, 'M');
  assert.equal(entries[1].worktree, 'M');
});

test('D00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  const outcome = checkDirtyScope({ statusOutput: ' M scripts/a.js\n', targetFiles: ['scripts/a.js'], forbiddenGlobs: ['AGENTS.md'] });
  const after = fs.readdirSync(HOST_ROOT);
  assert.equal(outcome.verdict, 'pass');
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});
