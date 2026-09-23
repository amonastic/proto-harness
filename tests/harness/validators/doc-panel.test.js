'use strict';

// H03B：doc-panel 验证器测试矩阵（P00-01..P00-05）+ copy-boundary 测试矩阵（C00-01..C00-05）。
// 说明：H03B 白名单未含独立 copy-boundary.test.js，C00 矩阵按任务包文件范围合入本文件。
// fixture 驱动；验证器均为纯函数。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const P00_FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/doc-panel-b00.json'), 'utf8'));
const C00_FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/copy-boundary-b00.json'), 'utf8'));
const { checkDocPanel, DEPENDENCY_SCRIPT_PATTERN, DOCS_SCRIPT_PATTERN } = require('../../../scripts/harness/validators/doc-panel');

test('P00 patterns: dependency vs docs script identification (regression)', () => {
  assert.equal(DEPENDENCY_SCRIPT_PATTERN.test('assets/js/doc-panel.js'), true, 'doc-panel.js must be dependency');
  assert.equal(DEPENDENCY_SCRIPT_PATTERN.test('js/docs.js'), false, 'docs.js must not be dependency');
  assert.equal(DOCS_SCRIPT_PATTERN.test('js/docs.js'), true, 'js/docs.js must be docs script');
  assert.equal(DOCS_SCRIPT_PATTERN.test('js/doc.js'), true, 'js/doc.js must be docs script');
  assert.equal(DOCS_SCRIPT_PATTERN.test('assets/js/doc-panel.js'), false, 'doc-panel.js must not be docs script');
  assert.equal(DOCS_SCRIPT_PATTERN.test('js/docs/merchant-list-edit.js'), true, 'page-named docs file must be docs script');
  assert.equal(DOCS_SCRIPT_PATTERN.test('js/docs/tobacco-mini.js'), true, 'page-named docs file must be docs script');
});
const { checkCopyBoundary, BOUNDARY_TERMS } = require('../../../scripts/harness/validators/copy-boundary');

test('P00 matrix: all 6 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(P00_FIXTURE.cases.length, 6, 'P00 fixture must contain exactly 6 cases');
  for (const fixture of P00_FIXTURE.cases) {
    const outcome = checkDocPanel({ docsData: fixture.docsData, docId: fixture.docId });
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

test('C00 matrix: all 5 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(C00_FIXTURE.cases.length, 5, 'C00 fixture must contain exactly 5 cases');
  for (const fixture of C00_FIXTURE.cases) {
    const outcome = checkCopyBoundary({ pageBodyText: fixture.pageBodyText });
    assert.equal(outcome.verdict, fixture.expected.verdict, `${fixture.id} verdict`);
    assert.equal(outcome.hits.length, fixture.expected.hitCount, `${fixture.id} hit count`);
    if (fixture.expected.terms) {
      const foundTerms = outcome.hits.map((hit) => hit.term);
      for (const term of fixture.expected.terms) {
        assert.ok(foundTerms.includes(term), `${fixture.id} hits must include ${term}: ${JSON.stringify(foundTerms)}`);
      }
    }
  }
});

test('C00 hits carry precise position and context', () => {
  const text = '前缀内容开发说明后缀内容';
  const outcome = checkCopyBoundary({ pageBodyText: text });
  assert.equal(outcome.verdict, 'fail');
  assert.equal(outcome.hits.length, 1);
  assert.equal(outcome.hits[0].term, '开发说明');
  assert.equal(outcome.hits[0].position, text.indexOf('开发说明'));
  assert.ok(outcome.hits[0].context.includes('开发说明'), 'context must include the hit term');
  assert.ok(outcome.hits[0].context.length <= 4 + 2 * 30, 'context must be bounded by ±30 chars');
});

test('C00 boundary terms are hard-coded (12 terms, no runtime file reads)', () => {
  assert.equal(BOUNDARY_TERMS.length, 12, 'boundary term table must have exactly 12 terms');
  for (const term of ['开发说明', '测试提示', '模拟操作', '仅供测试', '调试用', '临时注释', '待删除', '待确认', 'TODO', 'FIXME', 'HACK', 'DEBUG']) {
    assert.ok(BOUNDARY_TERMS.includes(term), `term ${term} must be in the table`);
  }
});

test('P00/C00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  checkDocPanel({ docsData: P00_FIXTURE.cases[0].docsData, docId: 'doc-a' });
  checkCopyBoundary({ pageBodyText: '开发说明' });
  const after = fs.readdirSync(HOST_ROOT);
  assert.deepEqual(after, before, 'validators must not create or remove entries in project root');
});
