'use strict';

// H03D：delivery-manifest 验证器测试矩阵（M00-01..M00-07）。
// fixture 驱动（tests/harness/fixtures/validators/delivery-manifest-m00.json）；
// 验证器为纯函数，不读取 git log、不检查文件系统。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/fixtures/validators/delivery-manifest-m00.json'), 'utf8'));
const { checkDeliveryManifest, STATUS_ENUM, ONLINE_STATUS_ENUM } = require('../../../scripts/harness/validators/delivery-manifest');

test('M00 matrix: all 7 cases pass expected verdicts (fixture-driven, pure function)', () => {
  assert.equal(FIXTURE.cases.length, 7, 'M00 fixture must contain exactly 7 cases');
  for (const fixture of FIXTURE.cases) {
    const outcome = checkDeliveryManifest({ manifest: fixture.manifest, requiredFiles: fixture.requiredFiles });
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

test('M00 enums are exactly as contracted', () => {
  assert.deepEqual([...STATUS_ENUM], ['local', 'committed', 'pushed', 'online']);
  assert.deepEqual([...ONLINE_STATUS_ENUM], ['pending', 'done', 'not-required']);
});

test('M00 pure-function: no side effects on project root', () => {
  const before = fs.readdirSync(HOST_ROOT);
  const fixture = FIXTURE.cases[0];
  checkDeliveryManifest({ manifest: fixture.manifest, requiredFiles: fixture.requiredFiles });
  const after = fs.readdirSync(HOST_ROOT);
  assert.deepEqual(after, before, 'validator must not create or remove entries in project root');
});
