import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveContext, contextToPrompt, analyzeRequirement, recordDecision, applyDecision
} from '../src/index.js';
import { createLocalAdapter } from '../../runtime-adapter/src/local.js';
import { tempRoot, onboard, addRequirement } from './helpers.js';

test('上下文按当前基线返回规则与证据', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const context = resolveContext(store, { query: '取件码 开柜' });
  assert.equal(context.baseline.status, 'current');
  assert.ok(context.rules.length >= 2);
  assert.ok(context.rules.every((rule) => rule.revision >= 1));
  assert.ok(context.evidence.length >= 1);
  assert.match(contextToPrompt(context), /适用规则/);
});

test('planned 基线上下文包含新旧修订对照', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const requirement = addRequirement(store);
  const analysisResult = await analyzeRequirement(store, {
    requirementId: requirement.id,
    adapter: createLocalAdapter()
  });
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: analysisResult.proposal.proposal_hash,
    baseRevision: analysisResult.proposal.base_revision,
    action: 'adopt',
    reason: '确认变更'
  });
  applyDecision(store, decision.id);
  const updated = store.getRequirement(requirement.id);
  const context = resolveContext(store, { requirementId: requirement.id });
  assert.equal(context.baseline.id, updated.baseline_id);
  assert.equal(context.baseline.status, 'planned');
  assert.ok(context.rules.some((rule) => rule.effective_state === 'planned'));
  assert.ok(context.history.some((rule) => rule.effective_state === 'current'));
});

test('上下文预算不足时保留直接相关规则并报告省略范围', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const context = resolveContext(store, { query: '取件码', budgetChars: 1 });
  assert.equal(context.truncated, true);
  assert.ok(context.warnings.some((item) => /预算/.test(item)));
  assert.equal(context.rules.length, 1);
});

test('未知项随需求进入上下文', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const requirement = addRequirement(store);
  const unknowns = [{
    id: 'U-1', question: '超过时间窗口如何反馈？', why_blocking: '影响规则',
    blocking: true, answered: false, answer: ''
  }];
  const updated = { ...requirement, unknowns };
  store.saveRequirement(updated);
  const context = resolveContext(store, { requirementId: requirement.id });
  assert.deepEqual(context.unknowns.map((item) => item.question), ['超过时间窗口如何反馈？']);
});
