import {
  createBaseline, createDecision, createProposal, hashProposal,
  createRuleRevision, validateRuleRevision
} from './models.js';
import { fail, makeId, nowIso } from './util.js';

export function buildChangesFromAnalysis(analysis) {
  const changes = [];
  const seen = new Set();
  for (const proposal of analysis.rule_proposals || []) {
    const dedupeKey = proposal.rule_id
      ? `revise:${proposal.rule_id}`
      : `create:${String(proposal.statement || '').replace(/\s+/g, '')}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (proposal.kind === 'rule.revise' && proposal.rule_id) {
      changes.push({
        kind: 'rule.revise',
        rule_id: proposal.rule_id,
        from_revision: proposal.from_revision ?? null,
        statement: proposal.statement,
        scope: proposal.scope || '',
        topic: proposal.topic || '',
        constraints: proposal.constraints || [],
        evidence_refs: proposal.evidence_refs || [],
        reason: proposal.reason || ''
      });
    } else {
      changes.push({
        kind: 'rule.create',
        rule_id: proposal.rule_id || null,
        statement: proposal.statement,
        scope: proposal.scope || '',
        topic: proposal.topic || '',
        constraints: proposal.constraints || [],
        evidence_refs: proposal.evidence_refs || [],
        reason: proposal.reason || ''
      });
    }
  }
  return changes.filter((item) => item.statement);
}

export function createRequirementProposal(store, requirement, analysis, { reason = '' } = {}) {
  const changes = buildChangesFromAnalysis(analysis);
  if (changes.length === 0) return null;
  const baseBaseline = store.getBaseline(requirement.baseline_id);
  const proposal = createProposal({
    productId: store.project.id,
    requirementId: requirement.id,
    baseRevision: requirement.revision,
    baseBaselineId: requirement.baseline_id,
    changes,
    reason: reason || analysis.proposal_reason || '根据需求分析形成规则变更建议',
    evidenceRefs: analysis.evidence_refs || [],
    impact: analysis.impact || null,
    conflicts: analysis.conflicts || [],
    analysisSource: analysis.source || 'local-heuristic'
  });
  proposal.base_baseline_status = baseBaseline?.status || null;
  proposal.proposal_hash = hashProposal(proposal);
  store.saveRequirementProposal(requirement.id, proposal);
  store.activity({
    type: 'proposal.created',
    summary: `需求 ${requirement.title} 产生 ${changes.length} 项规则变更建议`,
    ref: requirement.id
  });
  return proposal;
}

export function verifyProposalIntegrity(store, requirementId, proposal) {
  if (!proposal) throw fail('NOT_FOUND', '提案不存在');
  const expected = hashProposal(proposal);
  if (expected !== proposal.proposal_hash) {
    throw fail('STALE_PROPOSAL', '提案内容已变化，请重新展示并裁决');
  }
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  if (Number(proposal.base_revision) !== Number(requirement.revision)) {
    throw fail('STALE_PROPOSAL', `需求已从修订 ${proposal.base_revision} 变化到 ${requirement.revision}，原裁决不能继续套用`);
  }
  const baseline = store.getBaseline(requirement.baseline_id);
  if (proposal.base_baseline_id && baseline && proposal.base_baseline_id !== baseline.id) {
    throw fail('STALE_PROPOSAL', '需求基线已变化，请重新展示提案');
  }
  const baseBaseline = store.getBaseline(proposal.base_baseline_id || requirement.baseline_id);
  if (!baseBaseline) throw fail('STALE_PROPOSAL', '提案基准基线不存在');
  for (const change of proposal.changes || []) {
    if (change.kind === 'rule.revise' && change.rule_id) {
      const ref = (baseBaseline.rule_refs || []).find((item) => item.id === change.rule_id);
      if (!ref) {
        throw fail('STALE_PROPOSAL', `规则 ${change.rule_id} 不在提案基准基线中`);
      }
      if (change.from_revision != null && Number(ref.revision) !== Number(change.from_revision)) {
        throw fail('STALE_PROPOSAL', `提案基准中的规则 ${change.rule_id} 已从修订 ${change.from_revision} 变化到 ${ref.revision}`);
      }
    }
  }
  return requirement;
}

export function recordDecision(store, {
  requirementId, proposalHash, baseRevision, action, reason, condition = '', confirmedBy = 'user'
}) {
  if (!['adopt', 'keep', 'conditional'].includes(action)) {
    throw fail('INVALID_INPUT', '裁决动作必须是 adopt / keep / conditional');
  }
  if (!String(reason || '').trim()) {
    throw fail('INVALID_INPUT', '裁决必须填写理由');
  }
  if (action === 'conditional' && !String(condition || '').trim()) {
    throw fail('INVALID_INPUT', '条件采纳必须填写生效条件');
  }
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  const proposal = store.getRequirementProposal(requirementId);
  if (!proposal) throw fail('NOT_FOUND', '需求没有待裁决提案');
  if (proposalHash !== proposal.proposal_hash) {
    throw fail('STALE_PROPOSAL', '提交的提案哈希与当前提案不一致');
  }
  if (Number(baseRevision) !== Number(proposal.base_revision)) {
    throw fail('STALE_PROPOSAL', '提交的基准版本与提案不一致');
  }
  verifyProposalIntegrity(store, requirementId, proposal);

  const existing = store.listDecisions()
    .find((item) => item.proposal_hash === proposal.proposal_hash && item.requirement_id === requirementId);
  if (existing) return existing;

  const decision = createDecision({
    productId: store.project.id,
    requirementId,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    chosen: { action, condition: condition || '' },
    reason,
    confirmedBy,
    condition,
    conflictContext: {
      conflicts: proposal.conflicts || [],
      changes: proposal.changes
    }
  });
  store.saveDecision(decision);
  store.saveRequirementProposal(requirementId, {
    ...proposal,
    status: 'decided',
    decided_at: decision.confirmed_at,
    decision_id: decision.id
  });
  store.activity({
    type: 'decision.recorded',
    summary: `记录裁决：${{ adopt: '采纳变更', keep: '保留当前规则', conditional: '有条件采纳' }[action]}`,
    ref: decision.id
  });
  return decision;
}

function plannedBaselineId(requirement) {
  return makeId('BASELINE', `${requirement.title}-next`);
}

function applyChanges(store, { requirement, decision, proposal, plannedBaseline }) {
  const changedRules = [];
  for (const change of proposal.changes || []) {
    if (change.kind === 'rule.revise') {
      const baseBaseline = store.getBaseline(requirement.baseline_id);
      const baseRef = (baseBaseline?.rule_refs || []).find((ref) => ref.id === change.rule_id);
      const fromRevision = change.from_revision ?? baseRef?.revision;
      const base = store.getRule(change.rule_id, fromRevision);
      if (!base) throw fail('NOT_FOUND', `规则 ${change.rule_id} 在提案基准中不存在`);
      const index = store.getRuleIndex(change.rule_id);
      const nextRevision = Math.max(...(index?.revisions || [base.revision])) + 1;
      const scope = decision.chosen.action === 'conditional' && decision.condition
        ? [change.scope, `条件：${decision.condition}`].filter(Boolean).join('；')
        : change.scope;
      const revision = createRuleRevision({
        productId: store.project.id,
        ruleId: base.id,
        revision: nextRevision,
        statement: change.statement,
        scope,
        knowledgeStatus: 'confirmed',
        effectiveState: 'planned',
        baselineId: plannedBaseline.id,
        constraints: [
          ...(change.constraints || []),
          ...(decision.chosen.action === 'conditional' ? [`生效条件：${decision.condition}`] : [])
        ],
        evidenceRefs: (change.evidence_refs && change.evidence_refs.length > 0)
          ? change.evidence_refs
          : (base.evidence_refs || []),
        decisionRef: decision.id,
        supersedes: { id: base.id, revision: base.revision },
        topic: change.topic || base.topic,
        source: 'decision'
      });
      store.saveRuleRevision(revision);
      changedRules.push(revision);
    } else if (change.kind === 'rule.create') {
      const id = change.rule_id && !store.getRule(change.rule_id)
        ? change.rule_id
        : makeId('RULE', change.topic || change.statement);
      const revision = createRuleRevision({
        productId: store.project.id,
        ruleId: id,
        revision: 1,
        statement: change.statement,
        scope: decision.chosen.action === 'conditional' && decision.condition
          ? [change.scope, `条件：${decision.condition}`].filter(Boolean).join('；')
          : change.scope,
        knowledgeStatus: 'confirmed',
        effectiveState: 'planned',
        baselineId: plannedBaseline.id,
        constraints: [
          ...(change.constraints || []),
          ...(decision.chosen.action === 'conditional' ? [`生效条件：${decision.condition}`] : [])
        ],
        evidenceRefs: (change.evidence_refs && change.evidence_refs.length > 0)
          ? change.evidence_refs
          : (proposal.evidence_refs || []),
        decisionRef: decision.id,
        topic: change.topic || '',
        source: 'decision'
      });
      validateRuleRevision(revision);
      store.saveRuleRevision(revision);
      changedRules.push(revision);
    }
  }
  return changedRules;
}

function loadOriginalAnalysis(store, requirement) {
  try {
    return JSON.parse(store.readRequirementFile(requirement.id, 'analysis.json')).analysis || {};
  } catch {
    return {};
  }
}

function finalRulesForBaseline(store, baseline) {
  return (baseline?.rule_refs || [])
    .map((ref) => store.getRule(ref.id, ref.revision))
    .filter(Boolean);
}

function endpointNameFor(store, requirement) {
  const refs = requirement.endpoint_refs || [];
  return store.project.endpoints.find((item) => refs.includes(item.id))?.name
    || store.project.endpoints[0]?.name
    || '业务端';
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildResolvedAnalysis({ store, requirement, decision, proposal, baseline }) {
  const original = loadOriginalAnalysis(store, requirement);
  const action = decision.chosen?.action || 'adopt';
  const finalRules = finalRulesForBaseline(store, baseline);
  const answers = (requirement.unknowns || [])
    .filter((item) => item.answer)
    .map((item) => ({ id: item.id, question: item.question, answer: item.answer, blocking: Boolean(item.blocking) }));
  const rejectedChanges = action === 'keep'
    ? (proposal.changes || []).map((change) => ({
        kind: change.kind,
        rule_id: change.rule_id || null,
        statement: change.statement,
        reason: change.reason || ''
      }))
    : [];
  const resolved = {
    ...original,
    source: original.source || requirement.analysis_source || 'local-heuristic',
    decision: {
      id: decision.id,
      action,
      reason: decision.reason,
      condition: decision.condition || '',
      at: nowIso()
    },
    final_rules: finalRules.map((rule) => ({
      id: rule.id,
      revision: rule.revision,
      statement: rule.statement,
      constraints: rule.constraints || [],
      effective_state: rule.effective_state,
      knowledge_status: rule.knowledge_status
    })),
    confirmed_answers: answers,
    rule_proposals: [],
    conflicts: [],
    rejected_changes: rejectedChanges
  };

  if (action === 'keep') {
    const endpointName = endpointNameFor(store, requirement);
    resolved.effective_title = '按现行规则处理';
    resolved.effective_goal = '保留现行规则，不实施被否决的新口径。';
    resolved.summary = `业务裁决保留现行规则：${decision.reason}`;
    resolved.core_flows = [
      `在「${endpointName}」按现行规则发起操作`,
      '系统校验现行规则与业务状态',
      '按现行规则结果继续或阻断，并保留操作记录'
    ];
    resolved.scope = {
      in_scope: [`在「${endpointName}」按现行规则继续现有流程`],
      out_of_scope: uniqueStrings([
        ...(original.scope?.out_of_scope || []),
        ...rejectedChanges.map((change) => `不采纳：${change.statement}`)
      ])
    };
    resolved.impact = {
      actual: [],
      verify: original.impact?.verify || [],
      keep: uniqueStrings([
        ...finalRules.map((rule) => `继续执行现行规则：${rule.statement}`),
        ...(original.impact?.keep || [])
      ])
    };
    resolved.acceptance = uniqueStrings([
      ...finalRules.map((rule) => `现行规则继续生效：${rule.statement}`),
      '被否决口径不进入页面行为或交付产物',
      ...answers.map((item) => `已确认：${item.question} -> ${item.answer}`)
    ]);
  } else {
    resolved.effective_title = requirement.title;
    resolved.effective_goal = requirement.goal;
    resolved.summary = action === 'conditional'
      ? `业务裁决附加条件采用：${decision.condition}`
      : `业务裁决采纳新口径：${decision.reason}`;
    resolved.scope = {
      in_scope: uniqueStrings([
        ...(original.scope?.in_scope || requirement.scope?.in_scope || []),
        ...(decision.condition ? [`生效条件：${decision.condition}`] : [])
      ]),
      out_of_scope: original.scope?.out_of_scope || requirement.scope?.out_of_scope || []
    };
    resolved.impact = original.impact || requirement.impact;
    resolved.core_flows = original.core_flows || [];
    resolved.acceptance = uniqueStrings([
      ...(original.acceptance || requirement.acceptance || []),
      ...finalRules.map((rule) => `规则 ${rule.id} r${rule.revision}：${rule.statement}`),
      ...answers.map((item) => `已确认：${item.question} -> ${item.answer}`)
    ]);
  }
  return resolved;
}

export function applyDecision(store, decisionId) {
  const decision = store.getDecision(decisionId);
  if (!decision) throw fail('NOT_FOUND', '裁决不存在');
  if (decision.applied_at) return decision.result;
  const requirement = store.getRequirement(decision.requirement_id);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  const proposal = store.getRequirementProposal(requirement.id);
  if (!proposal || proposal.proposal_hash !== decision.proposal_hash) {
    throw fail('STALE_PROPOSAL', '当前提案与裁决绑定内容不一致');
  }
  verifyProposalIntegrity(store, requirement.id, proposal);

  if (decision.chosen.action === 'keep') {
    const baseBaseline = store.getBaseline(requirement.baseline_id);
    if (!baseBaseline) throw fail('NOT_FOUND', '需求基线不存在');
    const resolved = buildResolvedAnalysis({
      store, requirement, decision, proposal, baseline: baseBaseline
    });
    store.saveRequirementFile(requirement.id, 'analysis-resolved.json', resolved);
    const updatedRequirement = store.saveRequirement({
      ...requirement,
      status: 'analyzed',
      next_step: '生成需求与设计',
      scope: resolved.scope,
      acceptance: resolved.acceptance,
      impact: resolved.impact,
      rule_refs: (baseBaseline.rule_refs || []).map((ref) => ({ id: ref.id, revision: ref.revision })),
      effective_title: resolved.effective_title,
      effective_goal: resolved.effective_goal,
      decision_ref: decision.id,
      resolved_analysis_ref: 'analysis-resolved.json',
      revision: requirement.revision + 1,
      updated_at: nowIso(),
      checkpoints: [...(requirement.checkpoints || []), {
        at: nowIso(), from: requirement.status, to: 'analyzed', summary: '裁决保留当前规则，产物按现行规则生成'
      }]
    });
    const result = {
      action: 'keep',
      baseline_id: requirement.baseline_id,
      rule_refs: updatedRequirement.rule_refs,
      artifact_ids: [],
      resolved_analysis_ref: 'analysis-resolved.json',
      note: '保留当前规则；需求继续基于现行基线，被否决口径不进入产物'
    };
    const updatedDecision = store.saveDecision({
      ...decision,
      applied_at: nowIso(),
      result
    });
    store.saveRequirementProposal(requirement.id, {
      ...proposal,
      status: 'applied',
      applied_at: nowIso(),
      decision_id: decision.id
    });
    store.rebuildIndex();
    store.activity({ type: 'decision.applied', summary: '裁决应用：保留当前规则，生成口径锁定为现行规则', ref: decision.id });
    return updatedDecision.result;
  }

  const baseBaseline = store.getBaseline(requirement.baseline_id);
  if (!baseBaseline) throw fail('NOT_FOUND', '需求基线不存在');
  const planned = createBaseline({
    productId: store.project.id,
    name: `${requirement.title} · 下一版`,
    status: 'planned',
    ruleRefs: [],
    capabilityRefs: baseBaseline.capability_refs || [],
    formedBy: 'decision',
    evidenceRefs: baseBaseline.evidence_refs || [],
    notes: `由需求 ${requirement.id} 的裁决建立；未自动生效。`
  });
  planned.id = plannedBaselineId(requirement);
  planned.status = 'planned';
  planned.created_at = nowIso();
  store.saveBaseline(planned);

  const changedRules = applyChanges(store, { requirement, decision, proposal, plannedBaseline: planned });
  const changedIds = new Set(changedRules.map((rule) => rule.id));
  const mergedRefs = new Map();
  for (const ref of baseBaseline.rule_refs || []) mergedRefs.set(ref.id, { ...ref });
  for (const rule of changedRules) mergedRefs.set(rule.id, { id: rule.id, revision: rule.revision });
  const updatedBaseline = store.saveBaseline({
    ...planned,
    rule_refs: [...mergedRefs.values()],
    notes: `${planned.notes} 规则变更：${changedRules.map((rule) => `${rule.id} r${rule.revision}`).join('、')}`
  });

  const staleArtifacts = [];
  for (const artifact of store.listArtifacts(requirement.id)) {
    const affected = (artifact.rule_refs || []).some((ref) => changedIds.has(ref.id));
    if (affected && artifact.state !== 'stale') {
      store.saveArtifact({ ...artifact, state: 'stale' });
      staleArtifacts.push(artifact.id);
    }
  }

  const resolved = buildResolvedAnalysis({
    store, requirement, decision, proposal, baseline: updatedBaseline
  });
  store.saveRequirementFile(requirement.id, 'analysis-resolved.json', resolved);
  const updatedRequirement = store.saveRequirement({
    ...requirement,
    baseline_id: updatedBaseline.id,
    rule_refs: (updatedBaseline.rule_refs || []).map((ref) => ({ id: ref.id, revision: ref.revision })),
    status: 'analyzed',
    next_step: '生成需求与设计',
    scope: resolved.scope,
    acceptance: resolved.acceptance,
    impact: resolved.impact,
    effective_title: resolved.effective_title,
    effective_goal: resolved.effective_goal,
    decision_ref: decision.id,
    resolved_analysis_ref: 'analysis-resolved.json',
    revision: requirement.revision + 1,
    updated_at: nowIso(),
    checkpoints: [...(requirement.checkpoints || []), {
      at: nowIso(), from: requirement.status, to: 'analyzed',
      summary: `应用裁决：${changedRules.map((rule) => `${rule.id} r${rule.revision}`).join('、')}`
    }]
  });

  const result = {
    action: decision.chosen.action,
    baseline_id: updatedBaseline.id,
    rule_refs: changedRules.map((rule) => ({ id: rule.id, revision: rule.revision })),
    artifact_ids: staleArtifacts,
    resolved_analysis_ref: 'analysis-resolved.json',
    note: '新规则进入 planned 基线；现行基线未自动切换'
  };
  const updatedDecision = store.saveDecision({
    ...decision,
    applied_at: nowIso(),
    result
  });
  store.saveRequirementProposal(requirement.id, {
    ...proposal,
    status: 'applied',
    applied_at: nowIso()
  });
  store.activity({
    type: 'decision.applied',
    summary: `应用裁决，建立计划基线 ${updatedBaseline.name}`,
    ref: decision.id
  });
  store.rebuildIndex();
  return updatedDecision.result;
}

export function activateBaseline(store, baselineId, { confirmedBy = 'user', reason = '' } = {}) {
  const baseline = store.getBaseline(baselineId);
  if (!baseline) throw fail('NOT_FOUND', '基线不存在');
  if (!['planned', 'draft', 'current'].includes(baseline.status)) {
    throw fail('INVALID_INPUT', `基线状态 ${baseline.status} 不能激活`);
  }
  for (const ref of baseline.rule_refs || []) {
    const rule = store.getRule(ref.id, ref.revision);
    if (!rule) throw fail('MISSING_RESOURCE', `基线引用的规则缺失：${ref.id} r${ref.revision}`);
    if (rule.knowledge_status !== 'confirmed') {
      throw fail('INVALID_INPUT', `基线包含未确认规则：${ref.id} r${ref.revision}`);
    }
  }
  const previous = store.getCurrentBaseline();
  const activated = store.setCurrentBaseline(baselineId, { activatedBy: confirmedBy });
  const activeKeys = new Set((baseline.rule_refs || []).map((ref) => `${ref.id}@${ref.revision}`));
  for (const ref of baseline.rule_refs || []) {
    const rule = store.getRule(ref.id, ref.revision);
    if (rule && rule.effective_state !== 'current') {
      store.saveRuleRevision({ ...rule, effective_state: 'current' });
    }
  }
  if (previous && previous.id !== baselineId) {
    for (const ref of previous.rule_refs || []) {
      if (activeKeys.has(`${ref.id}@${ref.revision}`)) continue;
      const rule = store.getRule(ref.id, ref.revision);
      if (rule && rule.effective_state === 'current') {
        store.saveRuleRevision({ ...rule, effective_state: 'retired' });
      }
    }
  }
  if (reason) {
    store.saveBaseline({ ...activated, activation_reason: reason });
  }
  store.rebuildIndex();
  store.activity({
    type: 'baseline.activated',
    summary: `明确生效：${baseline.name}`,
    ref: baselineId
  });
  return store.getBaseline(baselineId);
}
