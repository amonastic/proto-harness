import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRequirement, recordDecision, applyDecision, activateBaseline,
  createRequirementProposal, verifyProposalIntegrity
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
