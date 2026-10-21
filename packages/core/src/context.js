import { uniqueBy } from './util.js';

function queryTerms(query) {
  const text = String(query || '').toLowerCase().trim();
  if (!text) return [];
  const tokens = text.split(/[\s，。、；;,:：/|()[\]{}"'“”‘’!?！？\-]+/).filter((item) => item.length > 1);
  const shingles = [];
  for (const token of tokens) {
    if (/[\u4e00-\u9fa5]/.test(token)) {
      for (let i = 0; i < token.length - 1; i += 1) shingles.push(token.slice(i, i + 2));
    }
  }
  return [...new Set([...tokens, ...shingles])];
}

function scoreRule(rule, terms) {
  if (terms.length === 0) return 0;
  const haystack = `${rule.topic || ''}\n${rule.statement || ''}\n${rule.scope || ''}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length > 2 ? 2 : 1;
  }
  return score;
}

export function resolveContext(store, {
  baselineId = null, requirementId = null, query = '', budgetChars = 14000
} = {}) {
  const requirement = requirementId ? store.getRequirement(requirementId) : null;
  const targetBaselineId = baselineId || requirement?.baseline_id || store.project.current_baseline_id;
  const baseline = targetBaselineId ? store.getBaseline(targetBaselineId) : null;
  if (!baseline) {
    return {
      baseline: null,
      rules: [],
      capabilities: [],
      evidence: [],
      history: [],
      unknowns: requirement?.unknowns || [],
      warnings: ['未找到可用基线'],
      truncated: false
    };
  }

  const terms = queryTerms(query || requirement?.title || '');
  const currentBaseline = store.getCurrentBaseline();
  const rules = [];
  for (const ref of baseline.rule_refs || []) {
    const rule = store.getRule(ref.id, ref.revision);
    if (!rule) continue;
    rules.push({
      ...rule,
      applicable: rule.knowledge_status !== 'superseded',
      relevance: scoreRule(rule, terms)
    });
  }
  rules.sort((a, b) => b.relevance - a.relevance || String(a.id).localeCompare(String(b.id)));

  const capabilities = [];
  for (const ref of baseline.capability_refs || []) {
    const cap = store.listCapabilities().find((item) => item.id === ref.id);
    if (cap) capabilities.push(cap);
  }

  const history = [];
  if (currentBaseline && currentBaseline.id !== baseline.id) {
    for (const ref of currentBaseline.rule_refs || []) {
      const currentRule = store.getRule(ref.id, ref.revision);
      const selected = rules.find((item) => item.id === ref.id);
      if (currentRule && selected && currentRule.revision !== selected.revision) {
        history.push({
          ...currentRule,
          reason: `现行基线仍引用修订 ${currentRule.revision}；本任务选择的是修订 ${selected.revision}`
        });
      }
    }
  }
  const superseded = store.listRules({ latestOnly: false })
    .filter((rule) => rule.knowledge_status === 'superseded')
    .slice(0, 20);
  for (const rule of superseded) {
    if (!history.some((item) => item.id === rule.id && item.revision === rule.revision)) {
      history.push({ ...rule, reason: '历史规则，已标记替代' });
    }
  }

  const evidenceIds = uniqueBy(
    [...rules.flatMap((rule) => rule.evidence_refs || []),
      ...capabilities.flatMap((cap) => cap.evidence_refs || [])],
    (id) => id
  );
  const evidence = [];
  for (const id of evidenceIds) {
    const item = store.getEvidence(id);
    if (item) evidence.push(item);
  }

  const unknowns = (requirement?.unknowns || []).map((item) => ({ ...item }));
  const warnings = [];
  let used = 0;
  const keptRules = [];
  for (const rule of rules) {
    const cost = JSON.stringify(rule).length;
    if (used + cost > budgetChars && keptRules.length > 0) {
      warnings.push(`上下文达到预算，已省略 ${rules.length - keptRules.length} 条低相关规则`);
      break;
    }
    keptRules.push(rule);
    used += cost;
  }
  const truncated = keptRules.length < rules.length;

  return {
    baseline: {
      id: baseline.id,
      name: baseline.name,
      status: baseline.status,
      rule_count: baseline.rule_refs.length
    },
    rules: keptRules,
    capabilities,
    evidence,
    history,
    unknowns,
    warnings,
    truncated,
    query_terms: terms
  };
}

export function contextToPrompt(context) {
  const lines = [];
  lines.push(`基线：${context.baseline?.name || '无'}（${context.baseline?.status || '无'}）`);
  if (context.rules.length > 0) {
    lines.push('适用规则：');
    for (const rule of context.rules) {
      lines.push(`- [${rule.id} r${rule.revision}｜${rule.knowledge_status}/${rule.effective_state}] ${rule.statement}${rule.scope ? `（范围：${rule.scope}）` : ''}`);
    }
  } else {
    lines.push('适用规则：无');
  }
  if (context.capabilities.length > 0) {
    lines.push('能力：');
    for (const cap of context.capabilities.slice(0, 12)) {
      lines.push(`- ${cap.name}：${cap.goal || ''}`);
    }
  }
  if (context.evidence.length > 0) {
    lines.push('证据：');
    for (const item of context.evidence.slice(0, 12)) {
      lines.push(`- ${item.title}（${item.source_ref || '项目内记录'}）：${String(item.raw_excerpt || '').slice(0, 300)}`);
    }
  }
  if (context.history.length > 0) {
    lines.push('历史/现行对照：');
    for (const item of context.history.slice(0, 8)) {
      lines.push(`- [${item.id} r${item.revision}] ${item.statement}（${item.reason || ''}）`);
    }
  }
  if (context.unknowns.length > 0) {
    lines.push('未知项：');
    for (const item of context.unknowns) {
      lines.push(`- ${item.question}${item.blocking ? '（阻塞）' : ''}`);
    }
  }
  return lines.join('\n');
}
