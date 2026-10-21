import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../src/store.js';
import { createEndpoint, createRuleRevision } from '../src/models.js';
import { tempRoot, onboard } from './helpers.js';

test('创建项目写入稳定 ID、规则修订与当前基线', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  assert.ok(fs.existsSync(path.join(store.root, 'project.json')));
  assert.ok(fs.existsSync(path.join(store.root, 'brain', 'rules')));
  const baseline = store.getCurrentBaseline();
  assert.equal(baseline.status, 'current');
  assert.equal(store.project.current_baseline_id, baseline.id);
  assert.ok(store.listRules().length >= 2);
  const rule = store.listRules()[0];
  assert.match(rule.id, /^RULE-/);
  assert.ok(fs.existsSync(path.join(store.root, 'brain', 'rules', rule.id, `r-${rule.revision}.json`)));
});

test('重新打开项目保留实体，项目版本递增且不残留临时文件', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const before = store.project.revision;
  store.updateProject({ goal: '调整后的目标' });
  const reopened = ProjectStore.open(store.root);
  assert.equal(reopened.project.goal, '调整后的目标');
  assert.ok(reopened.project.revision > before);
  const tempFiles = fs.readdirSync(store.root).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(tempFiles, []);
});

test('规则修订保留历史，latest 指向最新修订', () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const rule = store.listRules()[0];
  const revised = createRuleRevision({
    productId: store.project.id,
    ruleId: rule.id,
    revision: rule.revision + 1,
    statement: `${rule.statement}（修订）`,
    knowledgeStatus: 'confirmed',
    effectiveState: 'planned',
    baselineId: null,
    supersedes: rule,
    topic: rule.topic
  });
  store.saveRuleRevision(revised);
  assert.equal(store.getRule(rule.id).revision, rule.revision + 1);
  assert.equal(store.getRule(rule.id, rule.revision).statement, rule.statement);
  const index = store.getRuleIndex(rule.id);
  assert.deepEqual(index.revisions, [1, 2]);
});

test('项目列表可扫描目录并返回摘要', () => {
  const root = tempRoot();
  onboard(root, { folder: 'a' });
  onboard(root, { folder: 'b', product: { name: '第二个产品', goal: '验证列表' } });
  const list = ProjectStore.list(root);
  assert.equal(list.length, 2);
  assert.ok(list.every((item) => item.name && item.current_baseline_id));
});

test('端点创建保持角色与平台', () => {
  const endpoint = createEndpoint({ name: '作业端 App', role: '店员', platform: 'App' });
  assert.equal(endpoint.name, '作业端 App');
  assert.equal(endpoint.platform, 'App');
  assert.match(endpoint.id, /^EP-/);
});
