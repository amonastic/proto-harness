import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanProjectDirectory, applyImport, createRequirement, analyzeRequirement,
  recordDecision, applyDecision, buildArtifactsForRequirement
} from '../src/index.js';
import { createLocalAdapter } from '../../runtime-adapter/src/local.js';
import { tempRoot, listTree } from './helpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sampleDir = path.join(repoRoot, 'examples', 'existing-project');

test('扫描示例项目识别产品、候选规则、历史冲突与样式', () => {
  const scan = scanProjectDirectory(sampleDir);
  assert.equal(scan.product_guess, '社区驿站取件');
  assert.match(scan.goal_guess, /社区驿站/);
  assert.ok(scan.candidates.length >= 4);
  assert.ok(scan.conflicts.length === 1);
  assert.equal(scan.conflicts[0].topic, '取件码开柜规则');
  assert.match(scan.conflicts[0].why, /当前口径与.*历史口径/);
  assert.ok(scan.pages.some((page) => page.path === 'pages/pickup.html'));
  assert.ok(scan.tokens.some((token) => token.kind === 'color' && token.value === '#1F6F5C'));
  assert.ok(!scan.candidates.some((candidate) => /本目录保持原样/.test(candidate.statement)));
});

test('导入必须完成冲突裁决', () => {
  const scan = scanProjectDirectory(sampleDir);
  assert.throws(() => applyImport({
    targetRoot: path.join(tempRoot(), 'project'),
    scan,
    name: '社区驿站取件',
    goal: '示例',
    endpoints: scan.endpoints_guess,
    selectedCandidateIds: scan.candidates.map((item) => item.id)
  }), (error) => error.code === 'INVALID_INPUT' && /尚未完成裁决/.test(error.message));
});

test('导入生成当前规则、历史规则与裁决记录，且不修改来源目录', () => {
  const before = listTree(sampleDir);
  const scan = scanProjectDirectory(sampleDir);
  const conflict = scan.conflicts[0];
  const target = path.join(tempRoot(), 'imported');
  const applied = applyImport({
    targetRoot: target,
    scan,
    name: '社区驿站取件',
    goal: '验证接入已有项目的候选知识与冲突',
    endpoints: scan.endpoints_guess,
    selectedCandidateIds: scan.candidates.map((item) => item.id),
    conflictResolutions: {
      [conflict.id]: {
        chosenCandidateId: conflict.recommendation,
        reason: '采用当前口径，历史方案保留为已替代'
      }
    }
  });
  assert.ok(applied.currentRules.length >= 4);
  assert.ok(applied.historicalRules.length >= 1);
  assert.ok(applied.historicalRules.every((rule) => rule.knowledge_status === 'superseded'));
  assert.ok(applied.store.listDecisions().length === 1);
  assert.equal(applied.store.getCurrentBaseline().status, 'current');
  assert.ok(fs.existsSync(path.join(target, 'brain', 'import-report.json')));
  assert.ok(fs.existsSync(path.join(target, 'brain', 'asset-map.json')));
  assert.ok(fs.existsSync(path.join(target, 'design', 'source-css-spec.json')));
  assert.deepEqual(listTree(sampleDir), before);
  const imported = applied.store.listRules();
  const current = imported.find((rule) => /仅可开柜一次/.test(rule.statement));
  const historical = imported.find((rule) => /撤销出库/.test(rule.statement));
  assert.ok(current);
  assert.ok(historical);
  assert.equal(historical.knowledge_status, 'superseded');
  assert.equal(current.supersedes?.id, historical.id);
  for (const rule of imported) {
    for (const evidenceId of rule.evidence_refs || []) {
      assert.ok(applied.store.getEvidence(evidenceId), `规则 ${rule.id} 引用了缺失证据 ${evidenceId}`);
    }
  }
});

test('导入项目生成产物时继承来源 CSS 声明值', async () => {
  const scan = scanProjectDirectory(sampleDir);
  const conflict = scan.conflicts[0];
  const applied = applyImport({
    targetRoot: path.join(tempRoot(), 'imported-css'),
    scan,
    name: '社区驿站取件',
    goal: '验证 CSS 继承',
    endpoints: scan.endpoints_guess,
    selectedCandidateIds: scan.candidates.map((item) => item.id),
    conflictResolutions: {
      [conflict.id]: {
        chosenCandidateId: conflict.recommendation,
        reason: '采用当前口径'
      }
    }
  });
  const requirement = createRequirement(applied.store, {
    title: '支持同一取件码 2 分钟内重复开柜',
    goal: '同一取件码在 2 分钟内可重复开柜，不改变订单状态',
    rawInput: '同一取件码在 2 分钟内可重复开柜，不改变订单状态。'
  });
  const analysis = await analyzeRequirement(applied.store, {
    requirementId: requirement.id,
    adapter: createLocalAdapter()
  });
  assert.ok(analysis.context.evidence.length > 0, '需求上下文应包含可解析的来源证据');
  const decision = recordDecision(applied.store, {
    requirementId: requirement.id,
    proposalHash: analysis.proposal.proposal_hash,
    baseRevision: analysis.proposal.base_revision,
    action: 'adopt',
    reason: '确认变更'
  });
  applyDecision(applied.store, decision.id);
  const revisedRule = applied.store.getRule(analysis.proposal.changes[0].rule_id);
  assert.ok(revisedRule.evidence_refs.length > 0, '修订规则应保留来源证据');
  const generated = await buildArtifactsForRequirement(applied.store, requirement.id);
  const cssArtifact = generated.artifacts.find((item) => item.type === 'css-spec');
  const css = JSON.parse(fs.readFileSync(applied.store.resolve(cssArtifact.path), 'utf8'));
  const scanned = css.entries.filter((item) => item.extraction === 'static-scan');
  assert.ok(scanned.length >= 3);
  assert.ok(scanned.some((item) => item.value === '#1F6F5C'));
  assert.ok(scanned.every((item) => item.origin === 'declared'));
});
