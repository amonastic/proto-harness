'use strict';

// P7/H10C：跨模型对比器测试。
// 覆盖：verdict 一致率与分歧计算、失败模式分布、档位对比、边界情况（无共同 fixture、null verdict、单模型）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { COMPARE_SCHEMA_VERSION, buildCompareReport } = require('../../../scripts/harness/lib/shadow/comparator');

test('H10C-CP-01 verdict agreement rate and disagreement list', () => {
  const report = buildCompareReport({
    providerResults: [
      {
        provider: 'deepseek',
        entries: [
          { corpus_id: 'C-1', verdict: 'pass', category: null },
          { corpus_id: 'C-2', verdict: 'fail', category: null },
          { corpus_id: 'C-3', verdict: 'pass', category: null },
          { corpus_id: 'C-4', verdict: 'fail', category: 'semantic_failure' }
        ],
        tier: 'L2'
      },
      {
        provider: 'longcat',
        entries: [
          { corpus_id: 'C-1', verdict: 'pass', category: null },
          { corpus_id: 'C-2', verdict: 'pass', category: 'semantic_failure' },
          { corpus_id: 'C-3', verdict: 'fail', category: 'semantic_failure' },
          { corpus_id: 'C-4', verdict: 'fail', category: 'semantic_failure' }
        ],
        tier: 'L1'
      }
    ]
  });
  assert.equal(report.schema_version, COMPARE_SCHEMA_VERSION);
  assert.equal(report.fixture_count, 4);
  assert.equal(report.verdict_agreement_rate, 0.5, 'C-1 and C-4 agree (2/4)');
  assert.deepEqual(report.disagreements.map((item) => item.corpus_id), ['C-2', 'C-3']);
  const c2 = report.disagreements.find((item) => item.corpus_id === 'C-2');
  assert.deepEqual(c2.verdicts, { deepseek: 'fail', longcat: 'pass' });
  assert.deepEqual(c2.categories, { deepseek: null, longcat: 'semantic_failure' });
});

test('H10C-CP-02 failure distribution per provider', () => {
  const report = buildCompareReport({
    providerResults: [
      {
        provider: 'deepseek',
        entries: [
          { corpus_id: 'C-1', verdict: null, category: 'api_failure' },
          { corpus_id: 'C-2', verdict: null, category: 'format_error' },
          { corpus_id: 'C-3', verdict: 'fail', category: 'semantic_failure' },
          { corpus_id: 'C-4', verdict: 'pass', category: null }
        ],
        tier: 'L2'
      },
      {
        provider: 'longcat',
        entries: [
          { corpus_id: 'C-1', verdict: null, category: 'api_failure' },
          { corpus_id: 'C-2', verdict: 'fail', category: 'semantic_failure' },
          { corpus_id: 'C-3', verdict: 'pass', category: null },
          { corpus_id: 'C-4', verdict: 'pass', category: null }
        ],
        tier: 'L2'
      }
    ]
  });
  assert.deepEqual(report.failure_distribution.deepseek, { api_failure: 1, format_error: 1, semantic_failure: 1, total_failures: 3 });
  assert.deepEqual(report.failure_distribution.longcat, { api_failure: 1, format_error: 0, semantic_failure: 1, total_failures: 2 });
  assert.deepEqual(report.tier_comparison, { deepseek: 'L2', longcat: 'L2' });
});

test('H10C-CP-03 boundary: no common fixtures / null verdicts / single provider', () => {
  // 无共同 fixture（不同 fixture 集合）
  const disjoint = buildCompareReport({
    providerResults: [
      { provider: 'deepseek', entries: [{ corpus_id: 'C-1', verdict: 'pass', category: null }], tier: 'L1' },
      { provider: 'longcat', entries: [{ corpus_id: 'C-2', verdict: 'fail', category: null }], tier: 'L1' }
    ]
  });
  assert.equal(disjoint.fixture_count, 0);
  assert.equal(disjoint.verdict_agreement_rate, 0);

  // null verdict（双方均 null → 一致）
  const nullVerdicts = buildCompareReport({
    providerResults: [
      { provider: 'deepseek', entries: [{ corpus_id: 'C-1', verdict: null, category: 'api_failure' }], tier: 'L1' },
      { provider: 'longcat', entries: [{ corpus_id: 'C-1', verdict: null, category: 'api_failure' }], tier: 'L1' }
    ]
  });
  assert.equal(nullVerdicts.verdict_agreement_rate, 1, 'both null counts as agreement');

  // 单模型（部分失败后的对比报告）
  const single = buildCompareReport({
    providerResults: [{ provider: 'deepseek', entries: [{ corpus_id: 'C-1', verdict: 'pass', category: null }], tier: 'L2' }],
    crossModelSignals: []
  });
  assert.equal(single.providers.length, 1);
  assert.equal(single.verdict_agreement_rate, 1);
  assert.deepEqual(single.disagreements, []);
  assert.deepEqual(single.cross_model_signals, []);
});

test('H10C-CP-04 cross-model consensus signal passthrough', () => {
  const signal = { type: 'cross_model_consensus', severity: 'critical', reason: '≥2 models (deepseek, longcat) trigger tier_downgrade on entry-defect', models: ['deepseek', 'longcat'] };
  const report = buildCompareReport({
    providerResults: [
      { provider: 'deepseek', entries: [{ corpus_id: 'C-1', verdict: 'fail', category: null }], tier: 'L2' },
      { provider: 'longcat', entries: [{ corpus_id: 'C-1', verdict: 'fail', category: null }], tier: 'L2' }
    ],
    crossModelSignals: [signal]
  });
  assert.deepEqual(report.cross_model_signals, [signal]);
});
