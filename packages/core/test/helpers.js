import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProductFromAnalysis, createRequirement } from '../src/index.js';
import { localProductAnalysis } from '../../runtime-adapter/src/local.js';

export function tempRoot(prefix = 'pha-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function baseProduct(overrides = {}) {
  return {
    name: '社区驿站取件',
    goal: '让取件码短时重复开柜而不改变订单状态',
    audience: '门店店员与取件人',
    constraints: ['每个取件码仅可开柜一次', '重复开柜不得改变订单签收状态，不得触发新的物流推送'],
    endpoints: [{ name: '作业端 App', role: '门店店员', platform: 'App' }],
    ...overrides
  };
}

export function onboard(root, overrides = {}) {
  const product = baseProduct(overrides.product);
  const analysis = localProductAnalysis({ product, references: overrides.references || [] });
  const unknownAnswers = overrides.unknownAnswers || Object.fromEntries(
    analysis.unknowns.map((item) => [item.question, '按现有流程处理'])
  );
  const store = createProductFromAnalysis({
    targetRoot: path.join(root, overrides.folder || 'project'),
    name: product.name,
    goal: product.goal,
    audience: product.audience,
    constraints: product.constraints,
    endpoints: product.endpoints,
    references: overrides.references || [],
    analysis,
    unknownAnswers,
    baselineName: overrides.baselineName
  });
  return { store, product, analysis };
}

export function addRequirement(store, overrides = {}) {
  return createRequirement(store, {
    title: '支持同一取件码 2 分钟内重复开柜',
    goal: '同一取件码在 2 分钟内可重复打开原柜原格，不改变订单状态',
    rawInput: '同一取件码在 2 分钟内可重复开柜，不改变订单状态。',
    baselineId: store.project.current_baseline_id,
    ...overrides
  });
}

export function listTree(root) {
  const out = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const rel = path.join(prefix, entry.name);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  }
  walk(root);
  return out.sort();
}
