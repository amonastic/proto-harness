'use strict';

// H03A：task-auth 验证器测试矩阵（A00-01..A00-08）。
// fixture 驱动（tests/harness/fixtures/validators/task-auth-a00.json）；
// 验证器为纯函数，测试只传字符串/对象参数，无文件系统/git/网络依赖。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/task-auth-a00.json'), 'utf8'));
const { checkTaskAuth } = require('../../../scripts/harness/validators/task-auth');

test('A00 matrix: all 8 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 8, 'A00 fixture must contain exactly 8 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkTaskAuth({ message: fixture.message, plannedFiles: fixture.plannedFiles });
    assert.equal(outcome.level, fixture.expected.level, `${fixture.id} level (got ${outcome.level}): ${outcome.reason}`);
    assert.equal(outcome.verdict, fixture.expected.verdict, `${fixture.id} verdict: ${outcome.reason}`);
    assert.ok(outcome.reason.includes(fixture.expected.reasonIncludes), `${fixture.id} reason must include ${fixture.expected.reasonIncludes} (got ${outcome.reason})`);
  }
});

test('A00 pure-function: no filesystem/git/network side effects (inputs only)', () => {
  const before = fs.readdirSync(HOST_ROOT);
  const outcome = checkTaskAuth({ message: '开始改 `tests/harness/validators/task-auth.js`。', plannedFiles: ['tests/harness/validators/task-auth.js'] });
  const after = fs.readdirSync(HOST_ROOT);
  assert.equal(outcome.verdict, 'pass');
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});

test('A00 matched_term reflects the winning term', () => {
  const l3 = checkTaskAuth({ message: '直接做 `scripts/a.js`。', plannedFiles: ['scripts/a.js'] });
  assert.equal(l3.matched_term, '直接做');
  const l2 = checkTaskAuth({ message: '可以做，但先给出文件清单。', plannedFiles: ['scripts/a.js'] });
  assert.equal(l2.matched_term, '可以做');
  const none = checkTaskAuth({ message: '看看现有授权规则。', plannedFiles: ['scripts/a.js'] });
  assert.equal(none.matched_term, '看看');
});
