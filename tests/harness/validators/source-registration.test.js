'use strict';

// H03B：source-registration 验证器测试矩阵（B00-01..B00-08）。
// fixture 驱动（tests/harness/fixtures/validators/source-reg-b00.json）；
// 验证器为纯函数，只解析传入的 sourceDir 图谱对象。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/source-reg-b00.json'), 'utf8'));
const { checkSourceRegistration } = require('../../../scripts/harness/validators/source-registration');
const { createSourceDir, assertGraphShape } = require('../../../scripts/harness/graph/repository-graph');

test('B00 matrix: all 8 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 8, 'B00 fixture must contain exactly 8 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkSourceRegistration({ sourceDir: fixture.sourceDir, pageId: fixture.pageId });
    assert.equal(outcome.verdict, fixture.expected.verdict, `${fixture.id} verdict: ${JSON.stringify(outcome.violations)}`);
    if (fixture.expected.checks) {
      for (const [key, expectedValue] of Object.entries(fixture.expected.checks)) {
        assert.equal(outcome.checks[key], expectedValue, `${fixture.id} checks.${key}`);
      }
    }
    if (fixture.expected.violationsIncludes) {
      for (const fragment of fixture.expected.violationsIncludes) {
        assert.ok(outcome.violations.some((violation) => violation.includes(fragment)), `${fixture.id} violations must include ${fragment}: ${JSON.stringify(outcome.violations)}`);
      }
    }
  }
});

test('B00 graph helpers build a shape-valid sourceDir (Slice A)', () => {
  const sourceDir = createSourceDir({
    path: 'admin-portal/maintain-admin/index.html',
    menuItems: [{ pageId: 'page-a', label: '页面甲', monthTag: '202608上' }],
    iframeCarriers: [{ pageId: 'page-a', src: 'pages/page-a.html', monthComment: '202608上' }],
    pageNames: { 'page-a': '页面甲' },
    iterationRefs: []
  });
  const graph = { sourceDir, docsData: { entries: [], scriptLoadOrder: [] }, pageBodyText: '' };
  assertGraphShape(graph);
  const outcome = checkSourceRegistration({ sourceDir, pageId: 'page-a' });
  assert.equal(outcome.verdict, 'pass');
});

test('B00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  const fixture = FIXTURE.cases[0];
  checkSourceRegistration({ sourceDir: fixture.sourceDir, pageId: fixture.pageId });
  const after = fs.readdirSync(HOST_ROOT);
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});
