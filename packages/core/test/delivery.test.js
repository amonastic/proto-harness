import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from '../src/util.js';
import {
  analyzeRequirement, recordDecision, applyDecision, buildArtifactsForRequirement,
  reviewRequirement, createDeliveryRecord, exportDelivery, deliveryCheck
} from '../src/index.js';
import { createLocalAdapter } from '../../runtime-adapter/src/local.js';
import { tempRoot, onboard, addRequirement } from './helpers.js';

async function readyForDelivery() {
  const root = tempRoot();
  const { store } = onboard(root);
  const requirement = addRequirement(store);
  const analysis = await analyzeRequirement(store, {
    requirementId: requirement.id,
    adapter: createLocalAdapter()
  });
  const decision = recordDecision(store, {
    requirementId: requirement.id,
    proposalHash: analysis.proposal.proposal_hash,
    baseRevision: analysis.proposal.base_revision,
    action: 'adopt',
    reason: '确认规则变更'
  });
  applyDecision(store, decision.id);
  const generated = await buildArtifactsForRequirement(store, requirement.id);
  reviewRequirement(store, { requirementId: requirement.id, note: '产物核对完成' });
  return { store, requirement, generated };
}

test('生成需求文档、交互规格、原型、CSS 规范与映射', async () => {
  const { store, requirement, generated } = await readyForDelivery();
  assert.equal(generated.artifacts.length, 5);
  for (const artifact of generated.artifacts) {
    assert.ok(fs.existsSync(store.resolve(artifact.path)), artifact.path);
  }
  const spec = JSON.parse(fs.readFileSync(store.resolve(generated.artifacts.find((item) => item.type === 'interaction-spec').path), 'utf8'));
  assert.ok(spec.pages.length >= 1);
  assert.ok(spec.rules.length >= 1);
  const prototype = fs.readFileSync(store.resolve(generated.artifacts.find((item) => item.type === 'prototype').path), 'utf8');
  assert.match(prototype, /交互原型 · 演示数据/);
  assert.match(prototype, /业务依据/);
  assert.doesNotMatch(prototype, /https?:\/\//);
  const css = JSON.parse(fs.readFileSync(store.resolve(generated.artifacts.find((item) => item.type === 'css-spec').path), 'utf8'));
  assert.ok(css.entries.some((item) => item.kind === 'color'));
  assert.ok(css.entries.every((item) => item.origin !== 'computed'));
  assert.equal(store.getRequirement(requirement.id).status, 'reviewed');
});

test('交付导出固定清单、静态站与 planned 基线提示', async () => {
  const { store, requirement } = await readyForDelivery();
  const delivery = createDeliveryRecord(store, { requirementId: requirement.id, sourceCommit: null });
  assert.equal(delivery.manifest.length, 5);
  assert.ok(delivery.manifest.every((item) => item.sha256.length === 64));
  const exported = exportDelivery(store, delivery.id);
  assert.equal(exported.delivery.status, 'exported');
  assert.ok(fs.existsSync(path.join(exported.export_path, 'index.html')));
  assert.ok(fs.existsSync(path.join(exported.export_path, 'manifest.json')));
  const index = fs.readFileSync(path.join(exported.export_path, 'index.html'), 'utf8');
  assert.match(index, /固定交付版本/);
  assert.match(index, /打开交互原型/);
  assert.match(index, /planned 基线/);
  assert.doesNotMatch(index, /api[_-]?key/i);
  assert.equal(store.getRequirement(requirement.id).status, 'delivered');
  assert.ok(store.listDeliveries().length === 1);
});

test('失效产物阻止交付', async () => {
  const { store, requirement, generated } = await readyForDelivery();
  const prototype = generated.artifacts.find((item) => item.type === 'prototype');
  store.saveArtifact({ ...prototype, state: 'stale' });
  assert.throws(() => createDeliveryRecord(store, { requirementId: requirement.id }), (error) => error.code === 'DELIVERY_INCOMPLETE');
});

test('缺失冻结资源可被交付检查发现', async () => {
  const { store, requirement } = await readyForDelivery();
  const delivery = createDeliveryRecord(store, { requirementId: requirement.id });
  const prototype = delivery.manifest.find((item) => item.type === 'prototype');
  fs.rmSync(path.join(store.deliveryDir(delivery.id), prototype.frozen_path));
  const check = deliveryCheck(store, delivery.id);
  assert.equal(check.ok, false);
  assert.ok(check.missing.includes(prototype.frozen_path));
});

test('交付创建后修改源产物，历史导出保持不变', async () => {
  const { store, requirement } = await readyForDelivery();
  const delivery = createDeliveryRecord(store, { requirementId: requirement.id });
  const first = exportDelivery(store, delivery.id);
  const prototypeArtifact = delivery.manifest.find((item) => item.type === 'prototype');
  const exportedPrototype = path.join(first.export_path, prototypeArtifact.path);
  const firstHash = sha256File(exportedPrototype);
  const firstIndex = fs.readFileSync(path.join(first.export_path, 'index.html'), 'utf8');
  const firstDoc = fs.readFileSync(path.join(first.export_path, 'requirements', requirement.id, 'requirement.md'), 'utf8');

  fs.appendFileSync(store.resolve(prototypeArtifact.path), '\n<!-- live modification after delivery -->\n');
  fs.appendFileSync(store.resolve(`requirements/${requirement.id}/requirement.md`), '\n- 交付后修改的活文档\n');

  const second = exportDelivery(store, delivery.id);
  assert.equal(sha256File(exportedPrototype), firstHash);
  assert.equal(fs.readFileSync(path.join(second.export_path, 'index.html'), 'utf8'), firstIndex);
  assert.equal(fs.readFileSync(path.join(second.export_path, 'requirements', requirement.id, 'requirement.md'), 'utf8'), firstDoc);
  const check = deliveryCheck(store, delivery.id);
  assert.equal(check.ok, true);
});
