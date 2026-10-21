import fs from 'node:fs';
import path from 'node:path';
import {
  atomicWriteJson, ensureDir, fail, hashObject, makeId, nowIso, slugify
} from './util.js';
import {
  createArtifact, createCapability, createEvidence, createObject,
  createRequirement as createRequirementEntity, createRuleRevision, hashProposal
} from './models.js';
import { ProjectStore } from './store.js';
import { resolveContext, contextToPrompt } from './context.js';
import { createRequirementProposal } from './proposals.js';
import {
  buildCssSpec, buildInteractionSpec, buildMapping, buildRequirementMarkdown,
  completeInteractionSpec, defaultTokens, renderPrototypeHtml, suggestedArtifactPaths, artifactRevision
} from './artifacts.js';

function checkpoint(requirement, to, summary) {
  return {
    ...requirement,
    status: to,
    revision: requirement.revision + 1,
    updated_at: nowIso(),
    checkpoints: [...(requirement.checkpoints || []), {
      at: nowIso(), from: requirement.status, to, summary
    }]
  };
}

function saveModelError(store, { stage, error, requirementId }) {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const file = store.resolve(`.runtime/model-errors/${stamp}.json`);
  ensureDir(path.dirname(file));
  atomicWriteJson(file, {
    at: nowIso(),
    stage,
    requirement_id: requirementId || null,
    code: error.code || 'RUNTIME_FAILED',
    message: error.message,
    details: error.details || null
  });
  return file;
}

export function createProductFromAnalysis({
  targetRoot, name, goal, audience = '', constraints = [], endpoints = [],
  references = [], analysis, selectedStatements = null, unknownAnswers = {},
  baselineName = '初始基线'
}) {
  const blocking = (analysis.unknowns || []).filter((item) => item.blocking && !String(unknownAnswers[item.question] || '').trim());
  if (blocking.length > 0) {
    throw fail('BLOCKING_UNKNOWN', `还有 ${blocking.length} 个阻塞未知项未回答`, {
      questions: blocking.map((item) => item.question)
    });
  }
  const briefText = [
    `产品：${name}`,
    `目标：${goal}`,
    `服务对象：${audience}`,
    `约束：${constraints.join('；')}`
  ].join('\n');
  const briefEvidence = createEvidence({
    productId: null,
    title: '产品初始说明',
    sourceType: 'note',
    sourceRef: '产品创建向导',
    portable: true,
    locator: '创建时输入',
    contentHash: hashObject({ name, goal, audience, constraints }).slice(0, 32),
    rawExcerpt: briefText,
    usage: 'fact'
  });
  const evidence = [briefEvidence];
  for (const item of references) {
    if (!String(item.text || '').trim()) continue;
    evidence.push(createEvidence({
      productId: null,
      title: item.title || item.source_ref || '参考资料',
      sourceType: 'reference',
      sourceRef: item.source_ref || '向导附加材料',
      sourceAbs: item.source_abs || '',
      portable: !item.source_abs,
      locator: item.locator || '文件',
      contentHash: hashObject(item.text).slice(0, 32),
      rawExcerpt: String(item.text).slice(0, 1800),
      usage: 'reference'
    }));
  }
  const objects = (analysis.objects || []).map((item) => createObject({
    productId: null,
    name: typeof item === 'string' ? item : item.name,
    keyFields: item.key_fields || [],
    relations: item.relations || [],
    evidenceRefs: [briefEvidence.id],
    notes: typeof item === 'object' ? item.reason || '' : ''
  })).filter((item) => item.name);
  const capabilities = (analysis.capabilities || []).map((item) => createCapability({
    productId: null,
    name: item.name,
    goal: item.goal || '',
    objectRefs: (item.objects || []).map((name) => objects.find((obj) => obj.name === name)?.id).filter(Boolean),
    ruleRefs: [],
    preconditions: item.preconditions || [],
    exceptions: item.exceptions || [],
    endpointRefs: [],
    evidenceRefs: [briefEvidence.id]
  }));
  const candidates = analysis.candidate_rules || [];
  const selected = selectedStatements == null ? candidates : candidates.filter((item) => selectedStatements.includes(item.statement));
  const rules = selected.map((item) => createRuleRevision({
    productId: null,
    ruleId: makeId('RULE', item.topic || item.statement),
    revision: 1,
    statement: item.statement,
    scope: item.scope || '',
    knowledgeStatus: 'confirmed',
    effectiveState: 'current',
    baselineId: null,
    constraints: [],
    evidenceRefs: item.evidence_refs?.length ? item.evidence_refs : [briefEvidence.id],
    decisionRef: null,
    topic: item.topic,
    source: 'onboarding'
  }));
  const openQuestions = (analysis.unknowns || []).map((item) => ({
    id: item.id,
    question: item.question,
    why_blocking: item.why_blocking,
    blocking: Boolean(item.blocking),
    answer: String(unknownAnswers[item.question] || '').trim(),
    answered_at: nowIso()
  }));
  const store = ProjectStore.create({
    root: targetRoot,
    name,
    goal,
    audience,
    constraints,
    endpoints,
    evidence,
    objects,
    capabilities,
    rules,
    baselineName,
    formedBy: 'onboarding',
    openQuestions
  });
  atomicWriteJson(store.resolve('brain/onboarding-analysis.json'), {
    at: nowIso(),
    analysis_source: analysis.source,
    analysis
  });
  store.activity({
    type: 'onboarding.completed',
    summary: `建立初始基线，确认 ${rules.length} 条规则`,
    ref: store.project.current_baseline_id
  });
  store.rebuildIndex();
  return store;
}

export function createRequirement(store, {
  title, goal, rawInput = '', baselineId = null, endpointIds = [], scope = null
}) {
  const baseline = baselineId ? store.getBaseline(baselineId) : store.getCurrentBaseline();
  if (!baseline) throw fail('INVALID_INPUT', '项目没有可用基线');
  const requirement = createRequirementEntity({
    productId: store.project.id,
    title,
    goal,
    rawInput,
    baselineId: baseline.id,
    endpoints: endpointIds.length > 0 ? endpointIds : store.project.endpoints.map((item) => item.id),
    scope
  });
  store.saveRequirement(requirement);
  store.activity({
    type: 'requirement.created',
    summary: `创建需求：${requirement.title}`,
    ref: requirement.id
  });
  store.rebuildIndex();
  return requirement;
}

function mergeUnknownAnswers(nextUnknowns, previousUnknowns = []) {
  return nextUnknowns.map((item) => {
    const previous = previousUnknowns.find((old) => old.question === item.question);
    return previous?.answer
      ? { ...item, answer: previous.answer, answered: true }
      : { ...item, answered: Boolean(item.answer), answer: item.answer || '' };
  });
}

function ensureConflictProposals(analysis, context) {
  const proposals = [...(analysis.rule_proposals || [])];
  for (const conflict of analysis.conflicts || []) {
    const existing = conflict.existing_rules?.[0];
    if (!existing) continue;
    const already = proposals.some((item) => item.rule_id === existing.id || item.statement === conflict.proposed_statement);
    if (already) continue;
    const rule = context.rules.find((item) => item.id === existing.id);
    proposals.push({
      kind: 'rule.revise',
      rule_id: existing.id,
      from_revision: existing.revision,
      topic: conflict.topic,
      statement: conflict.proposed_statement,
      scope: rule?.scope || '',
      constraints: [],
      evidence_refs: existing.evidence_refs || [],
      reason: conflict.why || '冲突裁决需要形成规则变更'
    });
  }
  return proposals;
}

export async function analyzeRequirement(store, { requirementId, adapter, budgetChars = 14000 }) {
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  if (!['draft', 'analyzed', 'blocked', 'awaiting_decision'].includes(requirement.status)) {
    throw fail('INVALID_INPUT', `当前状态 ${requirement.status} 不能重新分析`);
  }
  for (const file of ['analysis-resolved.json', 'proposal.json']) {
    try {
      fs.rmSync(store.resolve(`requirements/${requirementId}/${file}`), { force: true });
    } catch {
      // 旧文件不存在或不可删除时继续；重新分析会生成新记录
    }
  }
  for (const artifact of store.listArtifacts(requirementId)) {
    if (artifact.state !== 'stale') store.saveArtifact({ ...artifact, state: 'stale' });
  }
  const requirementBase = {
    ...requirement,
    decision_ref: null,
    resolved_analysis_ref: null,
    effective_title: null,
    effective_goal: null
  };
  const analyzing = checkpoint(requirementBase, 'analyzing', '开始需求分析');
  store.saveRequirement(analyzing);
  const context = resolveContext(store, {
    requirementId,
    baselineId: requirement.baseline_id,
    query: `${requirement.title} ${requirement.goal} ${requirement.raw_input}`
  });
  let analysis;
  try {
    analysis = await adapter.analyzeRequirement({
      product: store.project,
      requirement,
      context,
      contextText: contextToPrompt(context),
      budgetChars
    });
  } catch (error) {
    const errorFile = saveModelError(store, { stage: 'analyzeRequirement', error, requirementId });
    const blocked = checkpoint(analyzing, 'blocked', `需求分析失败：${error.code || 'RUNTIME_FAILED'}`);
    blocked.next_step = '检查模型配置或切换本地规则分析后重试';
    blocked.last_error = { code: error.code || 'RUNTIME_FAILED', message: error.message, log: store.rel(errorFile) };
    store.saveRequirement(blocked);
    throw error;
  }
  const proposals = ensureConflictProposals(analysis, context);
  analysis.rule_proposals = proposals;
  const unknowns = mergeUnknownAnswers(analysis.unknowns || [], requirement.unknowns || []);
  const blockingUnanswered = unknowns.filter((item) => item.blocking && !String(item.answer || '').trim());
  const hasDecision = proposals.length > 0;
  let nextStatus;
  let nextStep;
  if (blockingUnanswered.length > 0) {
    nextStatus = 'blocked';
    nextStep = `回答 ${blockingUnanswered.length} 个阻塞未知项`;
  } else if (hasDecision) {
    nextStatus = 'awaiting_decision';
    nextStep = '处理业务裁决';
  } else {
    nextStatus = 'analyzed';
    nextStep = '生成需求与设计';
  }
  const updated = {
    ...analyzing,
    status: nextStatus,
    revision: analyzing.revision + 1,
    updated_at: nowIso(),
    scope: analysis.scope || requirement.scope,
    impact: analysis.impact || requirement.impact,
    acceptance: analysis.acceptance || requirement.acceptance,
    unknowns,
    analysis_source: analysis.source,
    next_step: nextStep,
    checkpoints: [...analyzing.checkpoints, {
      at: nowIso(), from: 'analyzing', to: nextStatus,
      summary: `分析完成：${analysis.summary || ''}`
    }]
  };
  store.saveRequirement(updated);
  store.saveRequirementFile(requirementId, 'analysis.json', {
    at: nowIso(),
    analysis_source: analysis.source,
    analysis
  });
  store.saveRequirementFile(requirementId, 'analysis-source.json', {
    at: nowIso(),
    source: analysis.source,
    raw_model_output: analysis.raw_model_output || null,
    warnings: analysis.warnings || []
  });
  let proposal = null;
  if (hasDecision) {
    proposal = createRequirementProposal(store, updated, analysis, {
      reason: analysis.proposal_reason || '需求分析形成规则变更建议'
    });
    store.saveRequirement({ ...updated, next_step: '处理业务裁决（绑定提案与基准）' });
  }
  store.activity({
    type: 'requirement.analyzed',
    summary: `分析需求：${requirement.title}（${analysis.source}）`,
    ref: requirementId
  });
  store.rebuildIndex();
  return {
    requirement: store.getRequirement(requirementId),
    analysis,
    proposal,
    context
  };
}

export function answerUnknown(store, { requirementId, unknownId, answer }) {
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  const unknowns = (requirement.unknowns || []).map((item) => (
    item.id === unknownId
      ? { ...item, answer: String(answer || '').trim(), answered: Boolean(String(answer || '').trim()) }
      : item
  ));
  const blockingLeft = unknowns.filter((item) => item.blocking && !item.answer);
  const existingProposal = store.getRequirementProposal(requirementId);
  const appliedProposal = Boolean(existingProposal && (existingProposal.status === 'applied' || requirement.decision_ref));
  let status = requirement.status;
  let nextStep = requirement.next_step;
  if (appliedProposal) {
    // 已应用提案不因事后补答重新打开；保持当前任务阶段
    status = ['blocked', 'awaiting_decision'].includes(requirement.status) ? 'analyzed' : requirement.status;
    nextStep = requirement.next_step || '生成需求与设计';
  } else if (blockingLeft.length > 0) {
    status = 'blocked';
    nextStep = `还有 ${blockingLeft.length} 个阻塞未知项待回答`;
  } else if (existingProposal) {
    status = 'awaiting_decision';
    nextStep = '处理业务裁决';
  } else if (['blocked', 'awaiting_decision'].includes(requirement.status)) {
    status = 'analyzed';
    nextStep = '生成需求与设计';
  }
  const updated = {
    ...requirement,
    unknowns,
    status,
    next_step: nextStep,
    revision: requirement.revision + 1,
    updated_at: nowIso(),
    checkpoints: [...(requirement.checkpoints || []), {
      at: nowIso(), from: requirement.status, to: status,
      summary: `回答未知项：${unknowns.find((item) => item.id === unknownId)?.question || unknownId}`
    }]
  };
  store.saveRequirement(updated);

  if (existingProposal && !appliedProposal) {
    const confirmedAnswers = unknowns
      .filter((item) => item.answer)
      .map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
        blocking: Boolean(item.blocking)
      }));
    const changes = (existingProposal.changes || []).map((change) => {
      const constraints = [...(change.constraints || [])];
      for (const item of confirmedAnswers) {
        const line = `已确认：${item.question} -> ${item.answer}`;
        if (!constraints.includes(line)) constraints.push(line);
      }
      return { ...change, constraints };
    });
    const rebased = {
      ...existingProposal,
      changes,
      confirmed_answers: confirmedAnswers,
      base_revision: updated.revision,
      status: 'pending',
      proposal_hash: '',
      rebased_at: nowIso()
    };
    delete rebased.decision_id;
    delete rebased.decided_at;
    delete rebased.applied_at;
    rebased.proposal_hash = hashProposal(rebased);
    store.saveRequirementProposal(requirementId, rebased);
  } else if (appliedProposal) {
    const confirmedAnswers = unknowns
      .filter((item) => item.answer)
      .map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
        blocking: Boolean(item.blocking)
      }));
    let resolved = null;
    try {
      resolved = JSON.parse(store.readRequirementFile(requirementId, 'analysis-resolved.json'));
      resolved.confirmed_answers = confirmedAnswers;
      resolved.post_decision_answers = confirmedAnswers;
      resolved.acceptance = [...new Set([
        ...(resolved.acceptance || []),
        ...confirmedAnswers.map((item) => `补充确认：${item.question} -> ${item.answer}`)
      ])];
      resolved.core_flows = [...new Set([
        ...(resolved.core_flows || []),
        ...confirmedAnswers.map((item) => `补充确认：${item.answer}`)
      ])];
      store.saveRequirementFile(requirementId, 'analysis-resolved.json', resolved);
    } catch {
      // 没有 resolved 分析的旧任务只保留需求回答，不重开已应用提案
    }
    const artifacts = store.listArtifacts(requirementId);
    for (const artifact of artifacts) {
      if (artifact.state !== 'stale') store.saveArtifact({ ...artifact, state: 'stale' });
    }
    let finalStatus = updated.status;
    let finalNext = updated.next_step;
    if (artifacts.length > 0) {
      if (['generated', 'reviewed'].includes(updated.status)) {
        finalStatus = 'analyzed';
        finalNext = '补充信息已进入分析，请重新生成产物';
      } else if (updated.status === 'delivered') {
        finalStatus = 'delivered';
        finalNext = '补充信息已记录；历史交付保持冻结，如需更新请新建需求';
      } else if (updated.status === 'analyzed') {
        finalNext = '补充信息已进入分析，请重新生成产物';
      }
    }
    if (resolved || artifacts.length > 0) {
      const current = store.getRequirement(requirementId);
      store.saveRequirement({
        ...current,
        status: finalStatus,
        next_step: finalNext,
        acceptance: resolved ? resolved.acceptance : current.acceptance,
        revision: current.revision + 1,
        updated_at: nowIso(),
        checkpoints: [...(current.checkpoints || []), {
          at: nowIso(), from: current.status, to: finalStatus,
          summary: '事后补答进入 resolved 分析；现有产物标记待重新生成'
        }]
      });
      store.rebuildIndex();
    }
  }
  return store.getRequirement(requirementId);
}

export async function buildArtifactsForRequirement(store, requirementId, { tokens = null, adapter = null } = {}) {
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  const blocking = (requirement.unknowns || []).filter((item) => item.blocking && !String(item.answer || '').trim());
  if (blocking.length > 0) throw fail('BLOCKING_UNKNOWN', '存在未回答的阻塞未知项', { questions: blocking.map((item) => item.question) });
  if (requirement.status === 'awaiting_decision') throw fail('INVALID_INPUT', '待裁决需求不能生成产物');
  if (!['analyzed', 'generated', 'reviewed'].includes(requirement.status)) {
    throw fail('INVALID_INPUT', `当前状态 ${requirement.status} 不能生成产物`);
  }
  let analysisRecord;
  try {
    analysisRecord = JSON.parse(store.readRequirementFile(requirementId, 'analysis-resolved.json'));
  } catch {
    analysisRecord = JSON.parse(store.readRequirementFile(requirementId, 'analysis.json')).analysis || {};
  }
  const decision = analysisRecord.decision || null;
  const context = resolveContext(store, {
    requirementId,
    baselineId: requirement.baseline_id,
    query: `${requirement.title} ${requirement.goal} ${requirement.raw_input}`
  });
  const rules = context.rules;
  const designTokens = tokens || defaultTokens();
  let sourceTokens = [];
  try {
    const sourceSpec = JSON.parse(fs.readFileSync(store.resolve('design/source-css-spec.json'), 'utf8'));
    sourceTokens = Array.isArray(sourceSpec.entries) ? sourceSpec.entries : [];
  } catch {
    sourceTokens = [];
  }
  let spec = null;
  const specGeneration = {
    source: analysisRecord.source || 'local-heuristic',
    model: null,
    warning: null,
    page_count: 0
  };
  if (adapter
    && typeof adapter.generateInteractionSpec === 'function'
    && typeof adapter.describe === 'function'
    && adapter.describe().kind === 'openai-compatible') {
    try {
      const modelSpec = await adapter.generateInteractionSpec({
        product: store.project,
        requirement,
        analysis: analysisRecord,
        contextText: contextToPrompt(context)
      });
      if (modelSpec && Array.isArray(modelSpec.pages) && modelSpec.pages.length > 0) {
        spec = completeInteractionSpec(modelSpec, {
          product: store.project, requirement, analysis: analysisRecord, rules, decision
        });
        specGeneration.source = spec.source || 'model';
        specGeneration.model = adapter.describe().model || null;
      }
    } catch (error) {
      specGeneration.warning = {
        code: error.code || 'RUNTIME_FAILED',
        message: error.message || String(error)
      };
      store.saveRequirementFile(requirementId, 'artifacts/spec-generation-error.json', {
        at: nowIso(),
        ...specGeneration.warning,
        details: error.details || null
      });
    }
  }
  if (!spec) {
    const localSpec = buildInteractionSpec({
      product: store.project,
      requirement,
      analysis: analysisRecord,
      rules,
      tokens: designTokens,
      decision
    });
    spec = completeInteractionSpec(localSpec, {
      product: store.project, requirement, analysis: analysisRecord, rules, decision
    });
    specGeneration.source = localSpec.source;
    if (specGeneration.warning) specGeneration.fallback_from = analysisRecord.source || null;
  }
  specGeneration.page_count = spec.pages.length;
  spec = { ...spec, generation: specGeneration };
  analysisRecord.spec_generation = specGeneration;
  store.saveRequirementFile(requirementId, 'artifacts/spec-generation.json', {
    at: nowIso(),
    ...specGeneration,
    pages: spec.pages.map((page) => ({ id: page.id, name: page.name, type: page.type }))
  });
  const paths = suggestedArtifactPaths(requirementId);
  const prototypeHtml = renderPrototypeHtml({
    product: store.project,
    requirement,
    spec,
    tokens: designTokens
  });
  const cssSpec = buildCssSpec({
    tokens: designTokens,
    prototypeHtml,
    scanned: sourceTokens,
    requirement
  });
  const ruleRefs = rules.map((rule) => ({ id: rule.id, revision: rule.revision }));
  const artifacts = [];
  const record = (type, artifactPath, content, title) => {
    const artifact = createArtifact({
      requirementId,
      type,
      path: artifactPath,
      version: '1',
      ruleRefs,
      state: 'draft',
      provider: spec.source,
      providerRevision: artifactRevision(content),
      title
    });
    store.saveArtifact(artifact);
    return artifact;
  };
  artifacts.push(record('interaction-spec', paths.interactionSpec, spec, '交互规格'));
  artifacts.push(record('prototype', paths.prototype, prototypeHtml, 'HTML 原型'));
  artifacts.push(record('css-spec', paths.cssSpec, cssSpec, 'CSS 规范'));
  const doc = buildRequirementMarkdown({
    product: store.project,
    requirement: { ...requirement, status: 'generated' },
    analysis: analysisRecord,
    rules,
    evidence: context.evidence,
    baseline: context.baseline,
    artifacts
  });
  const docArtifact = record('requirement-doc', paths.requirementDoc, doc, '需求文档');
  const mapping = buildMapping({ requirement, rules, artifacts: [docArtifact, ...artifacts] });
  const mappingArtifact = record('mapping', paths.mapping, mapping, '需求与产物映射');
  const ordered = [docArtifact, ...artifacts, mappingArtifact];
  store.saveRequirementFile(requirementId, 'interaction-spec.json', spec);
  store.saveRequirementFile(requirementId, 'artifacts/prototype.html', prototypeHtml);
  store.saveRequirementFile(requirementId, 'artifacts/css-spec.json', cssSpec);
  store.saveRequirementFile(requirementId, 'artifacts/mapping.json', mapping);
  store.saveRequirementFile(requirementId, 'requirement.md', doc);
  const updated = {
    ...requirement,
    status: 'generated',
    next_step: '评审产物并确认交付',
    rule_refs: ruleRefs,
    artifact_refs: ordered.map((artifact) => artifact.id),
    interaction_spec_ref: paths.interactionSpec,
    spec_generation: specGeneration,
    analysis_source: analysisRecord.source || requirement.analysis_source,
    revision: requirement.revision + 1,
    updated_at: nowIso(),
    checkpoints: [...(requirement.checkpoints || []), {
      at: nowIso(), from: requirement.status, to: 'generated',
      summary: `生成 ${ordered.length} 项产物`
    }]
  };
  store.saveRequirement(updated);
  store.activity({
    type: 'artifacts.generated',
    summary: `生成需求文档、交互规格、原型与 CSS 规范：${requirement.title}`,
    ref: requirementId
  });
  store.rebuildIndex();
  return {
    requirement: store.getRequirement(requirementId),
    artifacts: ordered,
    spec,
    prototypeHtml,
    cssSpec,
    context
  };
}

export function reviewRequirement(store, { requirementId, note = '' }) {
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  if (requirement.status !== 'generated') throw fail('INVALID_INPUT', '只有待评审需求可以通过评审');
  const updated = checkpoint(requirement, 'reviewed', note ? `评审通过：${note}` : '评审通过');
  updated.next_step = '创建固定交付版本';
  store.saveRequirement(updated);
  store.activity({ type: 'requirement.reviewed', summary: `评审通过：${requirement.title}`, ref: requirementId });
  return updated;
}

export function dashboard(store) {
  const requirements = store.listRequirements();
  const active = requirements.filter((item) => item.status !== 'delivered');
  const priority = { awaiting_decision: 0, blocked: 1, generated: 2, analyzed: 3, analyzing: 4, draft: 5, reviewed: 6 };
  active.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || String(b.updated_at).localeCompare(String(a.updated_at)));
  const pendingDecisions = requirements.filter((item) => item.status === 'awaiting_decision').length;
  return {
    summary: store.summary(),
    current_baseline: store.getCurrentBaseline(),
    requirements,
    active_requirements: active,
    pending_decisions: pendingDecisions,
    next_task: active[0] || null,
    activity: store.readActivity(16),
    deliveries: store.listDeliveries().slice(0, 5)
  };
}
