'use strict';

// H03C：迭代快照薄适配层（iteration-snapshots-adapter）。
//
// 本文件是 scripts/audit-iteration-snapshots.js（canonical）与 H03C 验证器之间的唯一桥梁。
// canonical 脚本已按 governance.config.json 配置化（三端根目录不再硬编码）；
// 本适配层同步按同一配置生成正则，语义与 canonical 保持一致；
// 后续维护以 canonical 为准，不得在本文件重新定义或偏离。
//
// knownDebt 格式约定（调用方职责）：
//   H03C 验证器的 knownDebt 参数为 issue detail 字符串列表（detail-only）；
//   canonical 脚本自身的 baseline 为 `${file}|${detail}` 格式并做 HTML 版本归一化。
//   调用方如需以 canonical baseline 驱动本适配层，须自行剥离 `${file}|` 前缀后传入，
//   或按 detail-only 维护 knownDebt；适配层不承担两种格式的隐式互转。

const path = require('path');
const { loadGovernanceConfig } = require('../../lib/governance-config');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const { rootsAlternation } = loadGovernanceConfig(HOST_ROOT);

// ---- canonical 常量（按 governance 配置生成，语义与 canonical 一致）----
const sourcePagePattern = new RegExp(`^(\\.\\.\\/)?(?:${rootsAlternation})\\/.+\\.html(?:[?#].*)?$`);
const sourceDocsPattern = new RegExp(`(?:^|["'=(:\\s])(?:\\.\\.\\/)*(?:${rootsAlternation})\\/[^"'<>\\s]*(?:\\/js\\/(?:docs|doc-panel)\\.js)(?:[?#][^"'<>\\s]*)?`, 'g');
const snapshotPattern = /^snapshots\/\d{6}[上下]\/.+\.html(?:[?#].*)?$/;

// ---- canonical 函数（逐字节一致，来源行号见注释）----

// 来源行 83-85：去掉 query/hash 后缀
function stripQuery(src) {
  return src.split(/[?#]/)[0];
}

// 来源行 117-121：迭代排名；/^(\d{6})([上下])$/ → Number(match[1]) * 2 + (下=1, 上=0)
function iterationRank(value) {
  const match = value.match(/^(\d{6})([上下])$/);
  if (!match) return 0;
  return Number(match[1]) * 2 + (match[2] === '下' ? 1 : 0);
}

// 来源行 87-90：从快照 src 提取迭代标识；不匹配返回 ''（适配层接口约定返回 null 表示不可解析）
function parseSnapshotIteration(src) {
  const match = stripQuery(src).match(/^snapshots\/(\d{6}[上下])\//);
  return match ? match[1] : null;
}

// ---- 适配层封装接口（语义与 canonical 一致，active 由调用方传入）----

// canonical 行 298：isHistorical = active ? iterationRank(iteration) < iterationRank(active) : false
function isHistorical(iteration, active) {
  if (!active) return false;
  return iterationRank(iteration) < iterationRank(active);
}

// canonical 行 307-309：先去除一个 '../' 前缀再做活页源模式检测
function isLiveSourceRef(src) {
  const normalized = src.replace(/^\.\.\//, '');
  return sourcePagePattern.test(normalized);
}

// canonical 行 274：返回可变 docs 引用命中列表（String.match 会重置 lastIndex）
function findMutableDocs(text) {
  return text.match(sourceDocsPattern) || [];
}

// canonical 行 314：快照 src 格式检测
function isSnapshotRef(src) {
  return snapshotPattern.test(src);
}

module.exports = {
  // canonical 常量暴露（供验证器/测试核对，不重新定义）
  sourcePagePattern,
  sourceDocsPattern,
  snapshotPattern,
  // 接口
  iterationRank,
  isHistorical,
  isLiveSourceRef,
  findMutableDocs,
  isSnapshotRef,
  parseSnapshotIteration
};
