'use strict';

// H03C：Iteration-Reference 验证器（迭代引用与历史快照目录一致性）。
// 判定规则来源：scripts/audit-iteration-snapshots.js canonical 逻辑（经薄适配层调用，不重新实现）。
// 纯函数：所有判定来自适配层与传入参数，不读取文件系统、不执行 git 命令。
//
// 行为契约：
//   - 历史迭代（isHistorical）引用活页源 → issue『历史迭代不得直接引用源页面：<src>』
//   - 历史迭代引用快照但目录迭代不匹配 → issue『历史迭代快照目录应为 snapshots/<iteration>/，实际为 snapshots/<snapshotIteration>/：<src>』
//   - 当前迭代引用活页源合法，不追加 issue
//   - 存量债务（knownDebt）与新问题分开：newIssues / debtIssues 不混报

const { isHistorical, isLiveSourceRef, isSnapshotRef, parseSnapshotIteration } = require('../adapters/iteration-snapshots-adapter');

function checkIterationReference({ iteration, activeIteration, iframes, knownDebt }) {
  if (typeof iteration !== 'string' || iteration.length === 0) throw new Error('H03C_ITER iteration required');
  if (typeof activeIteration !== 'string' || activeIteration.length === 0) throw new Error('H03C_ITER activeIteration required');
  if (!Array.isArray(iframes)) throw new Error('H03C_ITER iframes must be array');
  const debt = Array.isArray(knownDebt) ? knownDebt : [];

  const historical = isHistorical(iteration, activeIteration);
  const allIssues = [];

  if (historical) {
    for (const iframe of iframes) {
      if (!iframe || typeof iframe.src !== 'string') continue;
      const { src } = iframe;
      const line = Number.isInteger(iframe.line) ? iframe.line : null;

      // 活页源检测（canonical：历史迭代不得直接引用源页面）
      if (isLiveSourceRef(src)) {
        allIssues.push({ type: 'live-source', detail: `历史迭代不得直接引用源页面：${src}`, line });
      }

      // 快照目录一致性检测
      if (isSnapshotRef(src)) {
        const snapshotIteration = parseSnapshotIteration(src);
        if (snapshotIteration && snapshotIteration !== iteration) {
          allIssues.push({
            type: 'snapshot-dir-mismatch',
            detail: `历史迭代快照目录应为 snapshots/${iteration}/，实际为 snapshots/${snapshotIteration}/：${src}`,
            line
          });
        }
      }
    }
  }

  // 存量 vs 新增分类（不混报）
  const debtSet = new Set(debt);
  const debtIssues = allIssues.filter((issue) => debtSet.has(issue.detail));
  const newIssues = allIssues.filter((issue) => !debtSet.has(issue.detail));

  return { verdict: newIssues.length > 0 ? 'fail' : 'pass', isHistorical: historical, newIssues, debtIssues, allIssues };
}

module.exports = {
  checkIterationReference
};
