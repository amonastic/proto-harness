import { fail } from '../../core/src/util.js';

export function extractJson(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : cleaned;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (
    typeof item === 'string' ? item : item?.name || item?.title || item?.statement || ''
  )).map((item) => String(item).trim()).filter(Boolean);
}

function normalizeUnknown(item, index) {
  if (typeof item === 'string') {
    return {
      id: `U-MODEL-${index + 1}`,
      question: item,
      why_blocking: '模型标记为待确认',
      blocking: true,
      answered: false,
      answer: '',
      owner: '业务负责人'
    };
  }
  return {
    id: item.id || `U-MODEL-${index + 1}`,
    question: String(item.question || item.title || '').trim(),
    why_blocking: String(item.why_blocking || item.reason || '影响业务口径'),
    blocking: item.blocking !== false,
    answered: false,
    answer: '',
    owner: item.owner || '业务负责人'
  };
}

export function normalizeProductAnalysis(raw, modelId) {
  if (!raw || typeof raw !== 'object') {
    throw fail('RUNTIME_FAILED', '模型返回不是 JSON 对象', { raw: String(raw).slice(0, 4000) });
  }
  const objects = arrayOf(raw.objects).map((item, index) => (
    typeof item === 'string'
      ? { name: item, key_fields: [], relations: [], reason: '', evidence_refs: [] }
      : {
          name: String(item.name || item.title || `对象${index + 1}`),
          key_fields: stringList(item.key_fields || item.fields),
          relations: arrayOf(item.relations),
          reason: String(item.reason || ''),
          evidence_refs: stringList(item.evidence_refs)
        }
  ));
  const roles = arrayOf(raw.roles).map((item) => (
    typeof item === 'string'
      ? { name: item, endpoint: '', reason: '' }
      : { name: String(item.name || ''), endpoint: String(item.endpoint || ''), reason: String(item.reason || '') }
  ));
  const endpoints = arrayOf(raw.endpoints).map((item) => (
    typeof item === 'string'
      ? { name: item, role: '使用者', platform: 'Web' }
      : {
          name: String(item.name || '业务端'),
          role: String(item.role || '使用者'),
          platform: String(item.platform || 'Web')
        }
  ));
  const capabilities = arrayOf(raw.capabilities).map((item, index) => ({
    name: String(item.name || `能力${index + 1}`),
    goal: String(item.goal || ''),
    objects: stringList(item.objects || item.object_refs),
    rules: stringList(item.rules || item.rule_refs),
    preconditions: stringList(item.preconditions),
    exceptions: stringList(item.exceptions),
    endpoints: stringList(item.endpoints || item.endpoint_refs)
  }));
  const candidateRules = arrayOf(raw.candidate_rules || raw.rules).map((item, index) => (
    typeof item === 'string'
      ? { topic: `规则${index + 1}`, statement: item, scope: '', evidence_refs: [] }
      : {
          topic: String(item.topic || `规则${index + 1}`),
          statement: String(item.statement || item.content || ''),
          scope: String(item.scope || ''),
          evidence_refs: stringList(item.evidence_refs),
          confidence: 'candidate',
          source: 'model'
        }
  )).filter((item) => item.statement);
  const unknowns = arrayOf(raw.unknowns).map(normalizeUnknown).filter((item) => item.question);
  return {
    source: `model:${modelId || 'unknown'}`,
    summary: String(raw.summary || '模型完成产品知识候选提取。'),
    objects,
    roles,
    endpoints,
    capabilities,
    candidate_rules: candidateRules,
    unknowns,
    proposal_reason: '产品初始化需要确认候选规则与关键未知项',
    warnings: stringList(raw.warnings)
  };
}

export function normalizeRequirementAnalysis(raw, { modelId, existingRules = [] } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw fail('RUNTIME_FAILED', '模型返回不是 JSON 对象', { raw: String(raw).slice(0, 4000) });
  }
  const existingIds = new Set(existingRules.map((rule) => rule.id));
  const existingById = new Map(existingRules.map((rule) => [rule.id, rule]));
  const ruleProposals = arrayOf(raw.rule_proposals || raw.rules).map((item, index) => {
    const requestedId = item.rule_id || item.id || '';
    if (requestedId && !existingById.has(requestedId) && !existingIds.has(requestedId)) {
      return null;
    }
    const existing = existingById.get(requestedId);
    const kind = existing ? 'rule.revise' : 'rule.create';
    return {
      kind,
      rule_id: existing ? existing.id : null,
      from_revision: existing ? existing.revision : null,
      topic: String(item.topic || existing?.topic || `规则${index + 1}`),
      statement: String(item.statement || item.content || '').trim(),
      scope: String(item.scope || existing?.scope || ''),
      constraints: stringList(item.constraints),
      evidence_refs: stringList(item.evidence_refs),
      reason: String(item.reason || '模型建议的规则变更')
    };
  }).filter((item) => item && item.statement);

  const conflicts = arrayOf(raw.conflicts).map((item, index) => {
    const refs = arrayOf(item.existing_rule_refs || item.existing_rules).map((ref) => {
      const id = typeof ref === 'string' ? ref : ref.id;
      const rule = existingById.get(id);
      if (!rule) return null;
      return {
        id: rule.id, revision: rule.revision, statement: rule.statement,
        scope: rule.scope, evidence_refs: rule.evidence_refs || []
      };
    }).filter(Boolean);
    if (refs.length === 0) return null;
    return {
      id: item.id || `CONFLICT-MODEL-${index + 1}`,
      topic: String(item.topic || refs[0].id),
      heuristic: false,
      existing_rules: refs,
      proposed_statement: String(item.proposed_statement || item.proposal || ''),
      why: String(item.why || item.reason || '模型识别到业务口径差异'),
      options: arrayOf(item.options).length > 0
        ? arrayOf(item.options)
        : [
            { id: 'adopt', label: '采用新口径', description: '新规则进入计划基线' },
            { id: 'keep', label: '保留现行规则', description: '按现行基线继续' },
            { id: 'conditional', label: '附加条件后采用', description: '限定适用范围' }
          ]
    };
  }).filter(Boolean);

  const impactRaw = raw.impact || {};
  const impact = {
    actual: stringList(impactRaw.actual || impactRaw.actual_changes),
    verify: stringList(impactRaw.verify || impactRaw.needs_check),
    keep: stringList(impactRaw.keep || impactRaw.keep_behavior)
  };
  const scopeRaw = raw.scope || {};
  const unknowns = arrayOf(raw.unknowns).map(normalizeUnknown).filter((item) => item.question);

  return {
    source: `model:${modelId || 'unknown'}`,
    summary: String(raw.summary || '模型完成需求分析。'),
    objects: arrayOf(raw.objects).map((item) => (
      typeof item === 'string' ? { name: item } : { name: String(item.name || '') }
    )).filter((item) => item.name),
    roles: arrayOf(raw.roles).map((item) => (typeof item === 'string' ? { name: item } : item)),
    endpoints: arrayOf(raw.endpoints).map((item) => (
      typeof item === 'string' ? { name: item } : item
    )).filter(Boolean),
    core_flows: stringList(raw.core_flows || raw.flows),
    scope: {
      in_scope: stringList(scopeRaw.in_scope),
      out_of_scope: stringList(scopeRaw.out_of_scope)
    },
    impact,
    acceptance: stringList(raw.acceptance || raw.acceptance_criteria),
    unknowns,
    rule_proposals: ruleProposals,
    conflicts,
    evidence_refs: stringList(raw.evidence_refs),
    proposal_reason: String(raw.proposal_reason || '模型建议形成规则变更'),
    interaction_hints: raw.interaction_hints || {},
    warnings: stringList(raw.warnings)
  };
}

export function normalizeInteractionSpec(raw, requirementId, modelId) {
  if (!raw || !Array.isArray(raw.pages) || raw.pages.length === 0) {
    throw fail('RUNTIME_FAILED', '模型返回的交互规格缺少 pages', { raw: String(raw).slice(0, 4000) });
  }
  return {
    schema_version: 'interaction-spec-v1',
    requirement_id: requirementId,
    source: `model:${modelId || 'unknown'}`,
    pages: raw.pages.map((page, index) => ({
      id: page.id || `PAGE-${index + 1}`,
      name: String(page.name || `页面${index + 1}`),
      responsibility: String(page.responsibility || ''),
      entry_conditions: stringList(page.entry_conditions),
      roles: stringList(page.roles),
      components: stringList(page.components),
      states: arrayOf(page.states).map((state) => (
        typeof state === 'string' ? { name: state, behavior: '' } : state
      )),
      fields: arrayOf(page.fields).map((field) => (
        typeof field === 'string' ? { name: field } : field
      )),
      behaviors: stringList(page.behaviors),
      feedback: stringList(page.feedback),
      exceptions: stringList(page.exceptions),
      design_constraints: stringList(page.design_constraints),
      acceptance_refs: stringList(page.acceptance_refs)
    }))
  };
}
