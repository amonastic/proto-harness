'use strict';

// P7/H10C：跨模型对比器。
// 对比报告 schema 固定为 h10c-shadow-compare-v1（任务包 §5.2，不得更改）。
// 计算：verdict 一致率、分歧 fixture 列表、失败模式分布、档位对比、跨模型聚合信号。

const COMPARE_SCHEMA_VERSION = 'h10c-shadow-compare-v1';

// 输入 providerResults: [{ provider, entries: [{ corpus_id, verdict, category }], tier }]
// 输出对比报告对象（不含 timestamp/family，由调用方补）。
function buildCompareReport({ providerResults, crossModelSignals = [] }) {
  const providers = providerResults.map((item) => item.provider);
  const tierComparison = {};
  for (const item of providerResults) tierComparison[item.provider] = item.tier;

  // 共同 fixture 集合（所有模型都观察到的 corpus_id）
  const byCorpus = new Map(); // corpus_id -> { provider: {verdict, category} }
  for (const item of providerResults) {
    for (const entry of item.entries) {
      if (!byCorpus.has(entry.corpus_id)) byCorpus.set(entry.corpus_id, {});
      byCorpus.get(entry.corpus_id)[item.provider] = { verdict: entry.verdict, category: entry.category };
    }
  }
  const common = [...byCorpus.entries()].filter(([, byProvider]) => Object.keys(byProvider).length === providers.length);

  // verdict 一致率：verdict 完全一致（含双方 null）算一致
  let agreementCount = 0;
  const disagreements = [];
  for (const [corpusId, byProvider] of common) {
    const verdicts = {};
    const categories = {};
    for (const provider of providers) {
      verdicts[provider] = byProvider[provider].verdict;
      categories[provider] = byProvider[provider].category;
    }
    const first = verdicts[providers[0]];
    const consistent = providers.every((provider) => verdicts[provider] === first);
    if (consistent) agreementCount += 1;
    else disagreements.push({ corpus_id: corpusId, verdicts, categories });
  }
  const verdictAgreementRate = common.length > 0 ? Number((agreementCount / common.length).toFixed(4)) : 0;

  // 失败模式分布
  const failureDistribution = {};
  for (const item of providerResults) {
    const counts = { api_failure: 0, format_error: 0, semantic_failure: 0 };
    let totalFailures = 0;
    for (const entry of item.entries) {
      if (entry.category === 'api_failure' || entry.category === 'format_error' || entry.category === 'semantic_failure') {
        counts[entry.category] += 1;
        totalFailures += 1;
      }
    }
    failureDistribution[item.provider] = { ...counts, total_failures: totalFailures };
  }

  return {
    schema_version: COMPARE_SCHEMA_VERSION,
    providers,
    fixture_count: common.length,
    verdict_agreement_rate: verdictAgreementRate,
    disagreements,
    failure_distribution: failureDistribution,
    tier_comparison: tierComparison,
    cross_model_signals: crossModelSignals
  };
}

module.exports = { COMPARE_SCHEMA_VERSION, buildCompareReport };
