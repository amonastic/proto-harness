'use strict';

// P6/H10A：干预信号测试。
// 阈值（2026-08-19 用户裁决"1同意"）：连续失败 N=3；P0 任一失败 / P1 >50% / P2 >66%；
// API 错误率 >30%；格式异常即触发。

const test = require('node:test');
const assert = require('node:assert/strict');

const { THRESHOLDS, detectInterventionSignals, hasCritical } = require('../../../scripts/harness/lib/shadow/intervention');

test('H10A-IV-01 consecutive failure threshold N=3 (2 does not trigger, 3 triggers)', () => {
  assert.equal(THRESHOLDS.CONSECUTIVE_FAILURE_LIMIT, 3, 'N=3 fixed by user ruling');
  assert.deepEqual(detectInterventionSignals({ consecutiveFailures: 2 }), []);
  const signals = detectInterventionSignals({ consecutiveFailures: 3 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'consecutive_failure');
  assert.equal(signals[0].severity, 'warning');
  assert.match(signals[0].reason, /N=3/);
});

test('H10A-IV-02 tier downgrade critical when any P0 fails', () => {
  const signals = detectInterventionSignals({ failuresByPriority: { P0: [true, false], P1: [true], P2: [] } });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'tier_downgrade');
  assert.equal(signals[0].severity, 'critical');
  assert.match(signals[0].reason, /P0 存在失败/);
});

test('H10A-IV-03 tier downgrade critical when P1 failure rate >50%', () => {
  // 2 次运行 1 次失败 = 50%，不触发（>50%）
  assert.deepEqual(detectInterventionSignals({ failuresByPriority: { P0: [true], P1: [true, false], P2: [] } }), []);
  // 3 次运行 2 次失败 = 66.7% > 50%，触发
  const signals = detectInterventionSignals({ failuresByPriority: { P0: [true], P1: [true, false, false], P2: [] } });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'tier_downgrade');
  assert.equal(signals[0].severity, 'critical');
  assert.match(signals[0].reason, /P1 失败率 67%/);
});

test('H10A-IV-04 anomaly warning when API error rate >30%', () => {
  // 10 次运行 3 次 API 错误 = 30%，不触发（>30%）
  assert.deepEqual(detectInterventionSignals({ apiErrors: 3, totalRuns: 10 }), []);
  // 10 次运行 4 次 = 40% > 30%，触发
  const signals = detectInterventionSignals({ apiErrors: 4, totalRuns: 10 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'anomaly');
  assert.equal(signals[0].severity, 'warning');
  assert.match(signals[0].reason, /API 错误率 40%/);
});

test('H10A-IV-05 anomaly warning on format errors (verdict parse failure)', () => {
  const signals = detectInterventionSignals({ formatErrors: 1, totalRuns: 5 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'anomaly');
  assert.match(signals[0].reason, /格式异常/);
});

test('H10A-IV-06 hasCritical detects critical severity', () => {
  assert.equal(hasCritical([{ type: 'consecutive_failure', severity: 'warning' }]), false);
  assert.equal(hasCritical([{ type: 'tier_downgrade', severity: 'critical' }]), true);
});
