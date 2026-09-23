'use strict';

// H03C：Snapshot-Integrity 验证器（快照完整性：可变 docs / 元信息 / 计数一致）。
// 判定规则来源：scripts/audit-iteration-snapshots.js canonical 逻辑（经薄适配层调用）。
// 纯函数：只解析传入的 snapshotGraph 对象，不读取文件系统。
//
// 行为契约：
//   - 快照内容命中可变 docs 模式 → issue『快照仍引用三端可变需求数据源：<match>』
//   - 缺快照元信息注释（hasMeta=false）→ issue『缺少快照元信息注释』
//   - menu/iframe/pageNames 计数不一致 → issue『menu/iframe/pageNames 数量不一致：menu=.., iframe=.., pageNames=..』
//   - 存量债务（knownDebt）与新问题分开：newIssues / debtIssues 不混报

const { findMutableDocs } = require('../adapters/iteration-snapshots-adapter');

function checkSnapshotIntegrity({ snapshotGraph, knownDebt }) {
  if (!snapshotGraph || typeof snapshotGraph !== 'object') throw new Error('H03C_SNAP snapshotGraph required');
  if (typeof snapshotGraph.content !== 'string') throw new Error('H03C_SNAP snapshotGraph.content required');
  const debt = Array.isArray(knownDebt) ? knownDebt : [];

  const allIssues = [];

  // 可变 docs 引用（canonical sourceDocsPattern，detail 与 canonical 行 276 一致：match.trim()）
  for (const match of findMutableDocs(snapshotGraph.content)) {
    allIssues.push({ type: 'mutable-docs', detail: `快照仍引用三端可变需求数据源：${match.trim()}` });
  }

  // 快照元信息注释
  if (snapshotGraph.hasMeta !== true) {
    allIssues.push({ type: 'missing-meta', detail: '缺少快照元信息注释' });
  }

  // 计数一致性
  const { menuCount, iframeCount, pageNamesCount } = snapshotGraph;
  if (menuCount !== iframeCount || menuCount !== pageNamesCount) {
    allIssues.push({
      type: 'count-mismatch',
      detail: `menu/iframe/pageNames 数量不一致：menu=${menuCount}, iframe=${iframeCount}, pageNames=${pageNamesCount}`
    });
  }

  // 存量 vs 新增分类（不混报）
  const debtSet = new Set(debt);
  const debtIssues = allIssues.filter((issue) => debtSet.has(issue.detail));
  const newIssues = allIssues.filter((issue) => !debtSet.has(issue.detail));

  return { verdict: newIssues.length > 0 ? 'fail' : 'pass', newIssues, debtIssues, allIssues };
}

module.exports = {
  checkSnapshotIntegrity
};
