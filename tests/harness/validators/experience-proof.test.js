'use strict';

// H03D：experience-proof 验证器测试矩阵（E00-01..E00-08）。
// fixture 驱动（tests/harness/fixtures/validators/experience-proof-e00.json）；
// 验证器为纯函数，不访问真实浏览器、不检查截图文件存在性。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/experience-proof-e00.json'), 'utf8'));
const { checkExperienceProof, SYNTAX_ONLY_TYPES } = require('../../../scripts/harness/validators/experience-proof');

test('E00 matrix: all 8 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 8, 'E00 fixture must contain exactly 8 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkExperienceProof({ proof: fixture.proof });
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

test('E00 syntax-only types are exactly the two rejected types', () => {
  assert.deepEqual([...SYNTAX_ONLY_TYPES].sort(), ['search-only', 'syntax-only']);
  assert.equal(checkExperienceProof({ proof: { ...FIXTURE.cases[0].proof, checkType: 'dom' } }).verdict, 'pass');
});

test('E00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  checkExperienceProof({ proof: FIXTURE.cases[0].proof });
  const after = fs.readdirSync(HOST_ROOT);
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});
