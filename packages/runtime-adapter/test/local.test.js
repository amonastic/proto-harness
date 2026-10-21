import test from 'node:test';
import assert from 'node:assert/strict';
import { localRequirementAnalysis, localProductAnalysis, createLocalAdapter } from '../src/index.js';

const product = {
  name: '社区驿站取件',
  goal: '取件核销',
  constraints: [],
  endpoints: [{ id: 'e1', name: '作业端 App', role: '门店店员', platform: 'App' }]
};

const context = {
  rules: [{
    id: 'RULE-PICKUP-ONCE', revision: 1, topic: '取件码',
    statement: '每个取件码仅可开柜一次', knowledge_status: 'confirmed',
    effective_state: 'current', evidence_refs: []
  }]
};

test('本地分析识别“一次限制 vs 重复开柜”冲突', () => {
  const analysis = localRequirementAnalysis({
    product,
    requirement: {
      title: '支持同一取件码 2 分钟内重复开柜',
      goal: '同一取件码在 2 分钟内可重复开柜，不改变订单状态',
      raw_input: '同一取件码在 2 分钟内可重复开柜，不改变订单状态。'
    },
    context
  });
  assert.equal(analysis.source, 'local-heuristic');
  assert.equal(analysis.conflicts.length, 1);
  assert.equal(analysis.conflicts[0].existing_rules[0].id, 'RULE-PICKUP-ONCE');
  assert.equal(analysis.rule_proposals[0].kind, 'rule.revise');
  assert.match(analysis.summary, /本地规则引擎/);
});

test('本地分析不编造缺失阈值，并标记阻塞未知项', () => {
  const analysis = localRequirementAnalysis({
    product,
    requirement: {
      title: '支持重复开柜',
      goal: '取件码可以重复开柜',
      raw_input: '取件码可重复开柜。'
    },
    context
  });
  assert.ok(analysis.unknowns.some((item) => item.blocking && /时间窗口/.test(item.question)));
  assert.doesNotMatch(analysis.summary, /\d+\s*分钟/);
});

test('产品分析从约束提取候选规则并保留来源标识', () => {
  const analysis = localProductAnalysis({
    product: {
      name: '驿站',
      goal: '取件',
      audience: '店员',
      constraints: ['每个取件码仅可开柜一次'],
      endpoints: product.endpoints
    },
    references: [{ title: '规则.md', text: '重复开柜不得改变订单状态。' }]
  });
  assert.ok(analysis.candidate_rules.length >= 1);
  assert.ok(analysis.candidate_rules.every((item) => item.source === 'local-heuristic'));
  assert.equal(analysis.objects.some((item) => item.name === '取件码'), true);
});

test('本地适配器声明自身为非模型分析', async () => {
  const adapter = createLocalAdapter();
  const description = adapter.describe();
  assert.equal(description.kind, 'local-heuristic');
  assert.equal(description.model, null);
  const result = await adapter.analyzeRequirement({
    product,
    requirement: { title: 'x', goal: 'y', raw_input: '页面文案调整。' },
    context
  });
  assert.equal(result.source, 'local-heuristic');
});
