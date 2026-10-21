import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeRequirement, recordDecision, applyDecision, activateBaseline,
  createRequirementProposal, verifyProposalIntegrity, buildArtifactsForRequirement,
  answerUnknown, createRequirement
} from '../src/index.js';
import { createLocalAdapter } from '../../runtime-adapter/src/local.js';
import { tempRoot, onboard, addRequirement } from './helpers.js';

async function prepare(root) {
  const { store } = onboard(root);
  const requirement = addRequirement(store);
  const result = await analyzeRequirement(store, {
    requirementId: requirement.id,
    adapter: createLocalAdapter()
  });
  return { store, requirement, ...result };
}

test('需求分析识别冲突并生成待裁决提案', async () => {
  const root = tempRoot();
  const { requirement, analysis, proposal } = await prepare(root);
  assert.equal(requirement.status, 'awaiting_decision');
  assert.equal(analysis.conflicts.length, 1);
  assert.match(analysis.conflicts[0].why, /重复|一次/);
  assert.ok(proposal);
  assert.equal(proposal.status, 'pending');
  assert.equal(proposal.base_revision, requirement.revision);
  assert.match(proposal.proposal_hash, /^[a-f0-9]{64}$/);
});

test('哈希不一致时拒绝裁决', async () => {
  const root = tempRoot();
  const { store, requirement, proposal } = await prepare(root);
  assert.throws(() => recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: 'deadbeef',
    baseRevision: proposal.base_revision,
    action: 'adopt',
    reason: '错误哈希'
  }), (error) => error.code === 'STALE_PROPOSAL');
});

test('提案内容被修改后完整性校验失败', async () => {
  const root = tempRoot();
  const { store, requirement, proposal } = await prepare(root);
  const tampered = { ...proposal, changes: [{ ...proposal.changes[0], statement: '被篡改的规则' }] };
  store.saveRequirementProposal(requirement.id, tampered);
  assert.throws(() => verifyProposalIntegrity(store, requirement.id, tampered), (error) => error.code === 'STALE_PROPOSAL');
});

test('采纳裁决建立 planned 基线且不切换 current', async () => {
  const root = tempRoot();
  const { store, requirement, proposal, analysis } = await prepare(root);
  const currentId = store.project.current_baseline_id;
  const ruleId = analysis.rule_proposals[0].rule_id;
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'adopt',
    reason: '业务确认允许 2 分钟内重复开柜，订单状态不变'
  });
  const result = applyDecision(store, decision.id);
  assert.equal(result.action, 'adopt');
  assert.equal(store.project.current_baseline_id, currentId);
  const planned = store.getBaseline(result.baseline_id);
  assert.equal(planned.status, 'planned');
  const revised = store.getRule(ruleId);
  assert.equal(revised.effective_state, 'planned');
  assert.equal(revised.knowledge_status, 'confirmed');
  assert.equal(revised.decision_ref, decision.id);
  assert.ok(revised.revision >= 2);
  const updated = store.getRequirement(requirement.id);
  assert.equal(updated.baseline_id, planned.id);
  assert.equal(updated.status, 'analyzed');
  const appliedAgain = applyDecision(store, decision.id);
  assert.deepEqual(appliedAgain, result);
});

test('明确激活后才切换 current，并同步规则生效状态', async () => {
  const root = tempRoot();
  const { store, requirement, proposal, analysis } = await prepare(root);
  const oldCurrent = store.project.current_baseline_id;
  const change = analysis.rule_proposals[0];
  const oldRevision = store.getRule(change.rule_id, change.from_revision);
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'adopt',
    reason: '确认变更'
  });
  const result = applyDecision(store, decision.id);
  assert.equal(store.getRule(change.rule_id).effective_state, 'planned');
  activateBaseline(store, result.baseline_id, { reason: '上线确认' });
  assert.equal(store.project.current_baseline_id, result.baseline_id);
  assert.equal(store.getBaseline(result.baseline_id).status, 'current');
  assert.equal(store.getBaseline(oldCurrent).status, 'retired');
  assert.equal(store.getRule(change.rule_id).effective_state, 'current');
  assert.equal(store.getRule(oldRevision.id, oldRevision.revision).effective_state, 'retired');
});

test('保留现行规则时只更新裁决与需求状态', async () => {
  const root = tempRoot();
  const { store, requirement, proposal } = await prepare(root);
  const currentId = store.project.current_baseline_id;
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'keep',
    reason: '业务决定保持现状，需求范围另行调整'
  });
  const result = applyDecision(store, decision.id);
  assert.equal(result.action, 'keep');
  assert.equal(store.project.current_baseline_id, currentId);
  assert.equal(store.listBaselines().length, 1);
  assert.equal(store.getRequirement(requirement.id).status, 'analyzed');
});

test('无提案时返回 null，不制造机械确认', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const requirement = addRequirement(store, {
    title: '调整页面说明',
    goal: '只调整文案，不改变业务规则',
    rawInput: '把页面说明文字改得更清楚。'
  });
  const proposal = createRequirementProposal(store, requirement, { rule_proposals: [] });
  assert.equal(proposal, null);
});

test('保留现行规则的产物不实现被否决口径，并保留裁决记录', async () => {
  const root = tempRoot();
  const { store, requirement, proposal } = await prepare(root);
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'keep',
    reason: '业务决定保持一次开柜现状，不实施重复开柜'
  });
  applyDecision(store, decision.id);
  const resolved = JSON.parse(store.readRequirementFile(requirement.id, 'analysis-resolved.json'));
  assert.equal(resolved.decision.action, 'keep');
  assert.equal(resolved.effective_title, '按现行规则处理');
  assert.ok(resolved.rejected_changes.length > 0);
  assert.ok(resolved.final_rules.every((rule) => rule.effective_state === 'current'));

  const generated = await buildArtifactsForRequirement(store, requirement.id);
  assert.equal(generated.spec.decision.action, 'keep');
  assert.equal(generated.spec.effective_title, '按现行规则处理');
  assert.ok(generated.spec.rules.every((rule) => rule.effective_state === 'current'));
  const pageText = JSON.stringify(generated.spec.pages);
  assert.doesNotMatch(pageText, /2 分钟内可重复/);
  assert.match(generated.prototypeHtml, /未采纳：/);
  assert.match(generated.prototypeHtml, /仅可开柜一次/);
  const doc = fs.readFileSync(store.resolve(generated.artifacts.find((item) => item.type === 'requirement-doc').path), 'utf8');
  assert.match(doc, /保留现行规则/);
  assert.match(doc, /被否决口径/);
  assert.match(doc, /不采纳：/);
});

test('补答阻塞问题会重绑提案，业务条件进入规则与产物', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const requirement = addRequirement(store, {
    title: '支持取件码重复开柜',
    goal: '取件码可以重复开柜',
    rawInput: '取件码可重复开柜。'
  });
  const analyzed = await analyzeRequirement(store, {
    requirementId: requirement.id,
    adapter: createLocalAdapter()
  });
  assert.equal(analyzed.requirement.status, 'blocked');
  const blocking = analyzed.requirement.unknowns.find((item) => item.blocking);
  assert.ok(blocking);
  const answered = answerUnknown(store, {
    requirementId: requirement.id,
    unknownId: blocking.id,
    answer: '2 分钟，超时后拒绝并提示'
  });
  assert.equal(answered.status, 'awaiting_decision');
  const rebased = store.getRequirementProposal(requirement.id);
  assert.equal(rebased.base_revision, answered.revision);
  assert.ok(rebased.confirmed_answers.some((item) => /2 分钟/.test(item.answer)));
  assert.ok(rebased.changes[0].constraints.some((item) => /2 分钟/.test(item)));

  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: rebased.proposal_hash,
    baseRevision: rebased.base_revision,
    action: 'adopt',
    reason: '确认 2 分钟窗口，超时拒绝'
  });
  applyDecision(store, decision.id);
  const ruleRef = store.getRequirement(requirement.id).rule_refs.find((ref) => ref.id === rebased.changes[0].rule_id);
  const rule = store.getRule(ruleRef.id, ruleRef.revision);
  assert.ok(rule.constraints.some((item) => /2 分钟/.test(item)));
  const resolved = JSON.parse(store.readRequirementFile(requirement.id, 'analysis-resolved.json'));
  assert.ok(resolved.confirmed_answers.some((item) => /2 分钟/.test(item.answer)));

  const generated = await buildArtifactsForRequirement(store, requirement.id);
  const specRule = generated.spec.rules.find((item) => item.id === ruleRef.id);
  assert.ok(specRule.constraints.some((item) => /2 分钟/.test(item)));
});

test('计划基线不阻塞另一项仍基于现行规则的需求', async () => {
  const root = tempRoot();
  const { store, requirement, proposal, analysis } = await prepare(root);
  const currentId = store.project.current_baseline_id;
  const ruleId = analysis.rule_proposals[0].rule_id;
  const firstDecision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'adopt',
    reason: '第一项需求采用 2 分钟口径'
  });
  applyDecision(store, firstDecision.id);
  assert.equal(store.project.current_baseline_id, currentId);

  const second = createRequirement(store, {
    title: '支持同一取件码 5 分钟内重复开柜',
    goal: '同一取件码在 5 分钟内可重复开柜，不改变订单状态',
    rawInput: '同一取件码在 5 分钟内可重复开柜，不改变订单状态。'
  });
  const secondAnalysis = await analyzeRequirement(store, {
    requirementId: second.id,
    adapter: createLocalAdapter()
  });
  assert.ok(secondAnalysis.proposal, '第二项需求应能基于现行基线形成提案');
  const secondDecision = recordDecision(store, {
    requirementId: second.id,
    proposalHash: secondAnalysis.proposal.proposal_hash,
    baseRevision: secondAnalysis.proposal.base_revision,
    action: 'adopt',
    reason: '第二项需求采用 5 分钟口径'
  });
  applyDecision(store, secondDecision.id);
  assert.equal(store.project.current_baseline_id, currentId);
  const planned = store.listBaselines().filter((item) => item.status === 'planned');
  assert.equal(planned.length, 2);
  assert.ok(store.getRule(ruleId, 2));
  assert.ok(store.getRule(ruleId, 3));
  assert.notEqual(store.getRequirement(second.id).baseline_id, currentId);
});

test('条件采纳把生效条件写入规则范围与约束', async () => {
  const root = tempRoot();
  const { store, requirement, proposal, analysis } = await prepare(root);
  const ruleId = analysis.rule_proposals[0].rule_id;
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'conditional',
    condition: '仅适用于已完成签收的订单',
    reason: '在限定范围内允许重复开柜'
  });
  applyDecision(store, decision.id);
  const requirementAfter = store.getRequirement(requirement.id);
  const ref = requirementAfter.rule_refs.find((item) => item.id === ruleId);
  const rule = store.getRule(ref.id, ref.revision);
  assert.match(rule.scope, /仅适用于已完成签收的订单/);
  assert.ok(rule.constraints.includes('生效条件：仅适用于已完成签收的订单'));
});

test('已应用提案不因事后补答非阻塞问题而重新打开', async () => {
  const root = tempRoot();
  const { store, requirement, proposal } = await prepare(root);
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: proposal.proposal_hash,
    baseRevision: proposal.base_revision,
    action: 'adopt',
    reason: '先采纳变更'
  });
  applyDecision(store, decision.id);
  const adopted = store.getRequirement(requirement.id);
  const baselineBefore = adopted.baseline_id;
  const firstArtifacts = await buildArtifactsForRequirement(store, requirement.id);
  assert.equal(firstArtifacts.requirement.status, 'generated');
  const withUnknown = store.getRequirement(requirement.id);
  store.saveRequirement({
    ...withUnknown,
    unknowns: [...(withUnknown.unknowns || []), {
      id: 'U-POST', question: '是否需要向店员发送通知？', why_blocking: '非阻塞的体验补充',
      blocking: false, answered: false, answer: ''
    }],
    revision: withUnknown.revision + 1
  });
  const answered = answerUnknown(store, {
    requirementId: requirement.id,
    unknownId: 'U-POST',
    answer: '需要，在结果页提示即可'
  });
  assert.equal(answered.status, 'analyzed');
  assert.equal(answered.baseline_id, baselineBefore);
  assert.equal(answered.next_step, '补充信息已进入分析，请重新生成产物');
  const proposalAfter = store.getRequirementProposal(requirement.id);
  assert.equal(proposalAfter.status, 'applied');
  assert.equal(store.getDecision(decision.id).applied_at != null, true);
  assert.ok(store.listArtifacts(requirement.id).every((artifact) => artifact.state === 'stale'));
  const resolved = JSON.parse(store.readRequirementFile(requirement.id, 'analysis-resolved.json'));
  assert.ok(resolved.post_decision_answers.some((item) => /通知/.test(item.question)));
  assert.ok(resolved.acceptance.some((item) => /在结果页提示/.test(item)));
  assert.ok(resolved.core_flows.some((item) => /在结果页提示/.test(item)));
  const generated = await buildArtifactsForRequirement(store, requirement.id);
  assert.equal(generated.requirement.status, 'generated');
  assert.ok(generated.spec.post_decision_answers.some((item) => /通知/.test(item.question)));
  assert.match(generated.prototypeHtml, /在结果页提示即可/);
});
