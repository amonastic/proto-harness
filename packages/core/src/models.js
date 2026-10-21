import {
  nowIso, makeId, assertString, fail, hashObject
} from './util.js';

export const SCHEMA = Object.freeze({
  project: 'pha-project-v1',
  evidence: 'pha-evidence-v1',
  object: 'pha-object-v1',
  capability: 'pha-capability-v1',
  rule: 'pha-rule-v1',
  baseline: 'pha-baseline-v1',
  decision: 'pha-decision-v1',
  requirement: 'pha-requirement-v1',
  artifact: 'pha-artifact-v1',
  delivery: 'pha-delivery-v1',
  interactionSpec: 'interaction-spec-v1'
});

export const RULE_KNOWLEDGE = Object.freeze(['candidate', 'confirmed', 'superseded']);
export const RULE_EFFECTIVE = Object.freeze(['planned', 'current', 'retired']);
export const BASELINE_STATUS = Object.freeze(['draft', 'current', 'planned', 'retired']);
export const REQUIREMENT_STATUS = Object.freeze([
  'draft', 'analyzing', 'awaiting_decision', 'analyzed', 'generating', 'generated', 'reviewed', 'delivered', 'blocked'
]);

export function createEndpoint({ name, role, platform = 'Web', ui_standard = '' }) {
  assertString(name, 'endpoint.name');
  return {
    id: makeId('EP', name),
    name: name.trim(),
    role: String(role || '使用者').trim(),
    platform: String(platform || 'Web').trim(),
    ui_standard: String(ui_standard || '').trim()
  };
}

export function createProject({
  name, goal, audience, constraints = [], endpoints = [], openQuestions = [], sourceRoots = []
}) {
  assertString(name, 'product.name');
  assertString(goal, 'product.goal');
  const createdAt = nowIso();
  const endpointList = endpoints.length > 0
    ? endpoints.map((endpoint) => (endpoint.id ? endpoint : createEndpoint(endpoint)))
    : [createEndpoint({ name: '管理后台', role: '产品运营', platform: 'Web' })];
  return {
    schema_version: SCHEMA.project,
    id: makeId('PRODUCT', name, 6),
    name: name.trim(),
    goal: goal.trim(),
    audience: String(audience || '').trim(),
    constraints: constraints.map((item) => String(item).trim()).filter(Boolean),
    endpoints: endpointList,
    current_baseline_id: null,
    open_questions: openQuestions,
    source_roots: sourceRoots,
    app_version: '0.1.3',
    created_at: createdAt,
    updated_at: createdAt,
    revision: 1
  };
}

export function createEvidence({
  id = null, productId, title, sourceType = 'note', sourceRef = '', portable = true,
  locator = '', contentHash = '', rawExcerpt = '', usage = 'fact', capturedAt = nowIso(),
  sourceAbs = ''
}) {
  return {
    schema_version: SCHEMA.evidence,
    id: id || makeId('EVID', title || sourceRef || 'source'),
    product_id: productId,
    title: String(title || sourceRef || '来源').slice(0, 160),
    source_type: sourceType,
    source_ref: sourceRef,
    source_abs: sourceAbs,
    portable: Boolean(portable),
    locator,
    content_hash: contentHash,
    captured_at: capturedAt,
    raw_state: 'captured',
    raw_excerpt: String(rawExcerpt || '').slice(0, 6000),
    usage
  };
}

export function createObject({ productId, name, keyFields = [], relations = [], evidenceRefs = [], notes = '' }) {
  assertString(name, 'object.name');
  return {
    schema_version: SCHEMA.object,
    id: makeId('OBJ', name),
    product_id: productId,
    name: name.trim(),
    key_fields: keyFields.map(String),
    relations: relations.map((relation) => (
      typeof relation === 'string' ? { target: relation, kind: 'related' } : relation
    )),
    evidence_refs: evidenceRefs,
    notes,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

export function createCapability({
  productId, name, goal = '', objectRefs = [], ruleRefs = [], preconditions = [],
  exceptions = [], dependencyRefs = [], endpointRefs = [], evidenceRefs = [], acceptance = []
}) {
  assertString(name, 'capability.name');
  return {
    schema_version: SCHEMA.capability,
    id: makeId('CAP', name),
    product_id: productId,
    name: name.trim(),
    goal,
    object_refs: objectRefs,
    rule_refs: ruleRefs,
    preconditions,
    exceptions,
    dependency_refs: dependencyRefs,
    endpoint_refs: endpointRefs,
    evidence_refs: evidenceRefs,
    acceptance,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

export function createRuleRevision({
  productId, ruleId, revision = 1, statement, scope = '', knowledgeStatus = 'candidate',
  effectiveState = 'planned', baselineId = null, constraints = [], evidenceRefs = [],
  decisionRef = null, supersedes = null, topic = '', source = 'user'
}) {
  assertString(statement, 'rule.statement');
  return {
    schema_version: SCHEMA.rule,
    id: ruleId || makeId('RULE', topic || statement),
    product_id: productId,
    revision: Number(revision),
    topic: String(topic || '').trim(),
    statement: statement.trim(),
    scope: String(scope || '').trim(),
    knowledge_status: knowledgeStatus,
    effective_state: effectiveState,
    baseline_id: baselineId,
    constraints: constraints.map(String),
    evidence_refs: evidenceRefs,
    decision_ref: decisionRef,
    supersedes: supersedes ? { id: supersedes.id, revision: supersedes.revision } : null,
    source,
    created_at: nowIso()
  };
}

export function validateRuleRevision(rule) {
  const errors = [];
  if (!rule || rule.schema_version !== SCHEMA.rule) errors.push('schema_version 无效');
  if (!rule?.id) errors.push('缺少规则 ID');
  if (!Number.isInteger(rule?.revision) || rule.revision < 1) errors.push('revision 必须是正整数');
  if (!rule?.statement) errors.push('缺少规则正文');
  if (!RULE_KNOWLEDGE.includes(rule?.knowledge_status)) errors.push('knowledge_status 无效');
  if (!RULE_EFFECTIVE.includes(rule?.effective_state)) errors.push('effective_state 无效');
  if (errors.length) throw fail('INVALID_INPUT', `规则校验失败：${errors.join('；')}`, { errors });
  return rule;
}

export function createBaseline({
  productId, name, status = 'draft', ruleRefs = [], capabilityRefs = [], formedBy = 'user',
  activatedAt = null, evidenceRefs = [], notes = ''
}) {
  assertString(name, 'baseline.name');
  return {
    schema_version: SCHEMA.baseline,
    id: makeId('BASELINE', name),
    product_id: productId,
    name: name.trim(),
    status,
    rule_refs: ruleRefs.map((ref) => ({ id: ref.id, revision: Number(ref.revision) })),
    capability_refs: capabilityRefs.map((ref) => ({ id: ref.id, revision: Number(ref.revision || 1) })),
    formed_by: formedBy,
    activated_at: activatedAt,
    evidence_refs: evidenceRefs,
    notes,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

export function createDecision({
  productId, requirementId = null, proposalHash, baseRevision, chosen, reason,
  confirmedBy = 'user', condition = '', conflictContext = null
}) {
  assertString(proposalHash, 'decision.proposal_hash');
  assertString(reason, 'decision.reason');
  const createdAt = nowIso();
  return {
    schema_version: SCHEMA.decision,
    id: makeId('DECISION', requirementId || proposalHash.slice(0, 8)),
    product_id: productId,
    requirement_id: requirementId,
    proposal_hash: proposalHash,
    base_revision: Number(baseRevision),
    chosen,
    condition,
    reason: reason.trim(),
    confirmed_by: confirmedBy,
    confirmed_at: createdAt,
    applied_at: null,
    result: null,
    conflict_context: conflictContext
  };
}

export function proposalHashInput(proposal) {
  const {
    proposal_hash: ignoredHash,
    status: ignoredStatus,
    decided_at: ignoredDecidedAt,
    decision_id: ignoredDecisionId,
    applied_at: ignoredAppliedAt,
    ...rest
  } = proposal;
  return rest;
}

export function hashProposal(proposal) {
  return hashObject(proposalHashInput(proposal));
}

export function createProposal({
  productId, requirementId, baseRevision, baseBaselineId, changes, reason,
  evidenceRefs = [], impact = null, conflicts = [], analysisSource = 'local-heuristic'
}) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw fail('INVALID_INPUT', '提案必须包含至少一项变更');
  }
  assertString(reason, 'proposal.reason');
  const proposal = {
    schema_version: 'pha-proposal-v1',
    id: makeId('PROPOSAL', requirementId),
    product_id: productId,
    requirement_id: requirementId,
    base_revision: Number(baseRevision),
    base_baseline_id: baseBaselineId,
    changes,
    reason: reason.trim(),
    evidence_refs: evidenceRefs,
    impact,
    conflicts,
    analysis_source: analysisSource,
    status: 'pending',
    created_at: nowIso()
  };
  proposal.proposal_hash = hashProposal(proposal);
  return proposal;
}

export function createRequirement({
  productId, title, goal, rawInput = '', baselineId, endpoints = [], scope = null
}) {
  assertString(title, 'requirement.title');
  assertString(goal, 'requirement.goal');
  const createdAt = nowIso();
  return {
    schema_version: SCHEMA.requirement,
    id: makeId('REQ', title, 6),
    product_id: productId,
    title: title.trim(),
    goal: goal.trim(),
    raw_input: String(rawInput || '').trim(),
    baseline_id: baselineId,
    endpoint_refs: endpoints,
    status: 'draft',
    scope: scope || { in_scope: [], out_of_scope: [] },
    impact: { actual: [], verify: [], keep: [] },
    unknowns: [],
    acceptance: [],
    rule_refs: [],
    artifact_refs: [],
    interaction_spec_ref: null,
    delivery_refs: [],
    analysis_source: null,
    next_step: '开始分析需求',
    revision: 1,
    checkpoints: [{
      at: createdAt, from: null, to: 'draft', summary: '创建需求'
    }],
    created_at: createdAt,
    updated_at: createdAt
  };
}

export function createArtifact({
  requirementId, type, path: artifactPath, version = '1', ruleRefs = [],
  state = 'draft', provider = 'core', providerRevision = '', title = ''
}) {
  return {
    schema_version: SCHEMA.artifact,
    id: makeId('ARTIFACT', `${requirementId}-${type}`),
    requirement_id: requirementId,
    type,
    title: title || type,
    path: artifactPath,
    version: String(version),
    rule_refs: ruleRefs,
    state,
    provider,
    provider_revision: providerRevision,
    created_at: nowIso()
  };
}

export function createDelivery({
  productId, requirementId, requirementRevision, baselineId, ruleRefs = [],
  artifactRefs = [], manifest = [], sourceCommit = null, title = '',
  displaySnapshot = null
}) {
  const createdAt = nowIso();
  return {
    schema_version: SCHEMA.delivery,
    id: makeId('RELEASE', title || requirementId),
    product_id: productId,
    requirement_id: requirementId,
    requirement_revision: Number(requirementRevision),
    baseline_id: baselineId,
    rule_refs: ruleRefs,
    artifact_refs: artifactRefs,
    manifest,
    source_commit: sourceCommit,
    display_snapshot: displaySnapshot,
    status: 'draft',
    created_at: createdAt,
    updated_at: createdAt
  };
}

export function requirementStatusLabel(status) {
  return ({
    draft: '草稿',
    analyzing: '分析中',
    awaiting_decision: '待裁决',
    analyzed: '已分析',
    generating: '生成中',
    generated: '待评审',
    reviewed: '已评审',
    delivered: '已交付',
    blocked: '已阻塞'
  })[status] || status;
}

export function ruleStatusLabel(rule) {
  const knowledge = ({ candidate: '候选', confirmed: '已确认', superseded: '已替代' })[rule.knowledge_status] || rule.knowledge_status;
  const effective = ({ planned: '计划生效', current: '当前生效', retired: '已停用' })[rule.effective_state] || rule.effective_state;
  return `${knowledge} · ${effective}`;
}
