'use strict';

// H03B：Doc-Panel 验证器（需求抽屉闭环）。
// DocPanel 需求抽屉的合法性由 docId、docsData 数据键、脚本加载顺序三要素决定。
// 纯函数：只解析传入的 docsData 图谱对象，不读取文件系统。
//
// 三项判定（全部为 true 才 pass）：
//   docIdExists —— docsData.entries 中存在 docId 匹配条目
//   noDuplicate —— docId 恰好出现一次（≥2 次违规）
//   scriptOrder —— scriptLoadOrder 中依赖脚本（DocPanel.js 类）索引小于 docs.js 索引

// 依赖脚本识别：文件名包含 doc-panel / DocPanel 的脚本视为依赖。
const DEPENDENCY_SCRIPT_PATTERN = /doc[_-]?panel/i;
// docs 数据源脚本识别，覆盖两种真实形态（20260807 审阅确认，来自仓库实测）：
//   1. 模块级聚合：.../js/docs.js 或 .../js/doc.js（文件名 docs.js/doc.js 结尾）
//   2. 页面级增量：.../js/docs/{页面命名}.js（如 js/docs/merchant-list-edit.js、js/docs/tobacco-mini.js）
const DOCS_SCRIPT_PATTERN = /(^|\/)docs?\.js$|(^|\/)docs\/[^/]+\.js$/;

function checkDocPanel({ docsData, docId }) {
  if (!docsData || typeof docsData !== 'object') throw new Error('H03B_DOC docsData required');
  if (typeof docId !== 'string' || docId.length === 0) throw new Error('H03B_DOC docId required');

  const entries = Array.isArray(docsData.entries) ? docsData.entries : [];
  const loadOrder = Array.isArray(docsData.scriptLoadOrder) ? docsData.scriptLoadOrder : [];

  const checks = { docIdExists: false, noDuplicate: false, scriptOrder: false };
  const violations = [];

  // docIdExists + noDuplicate
  const matching = entries.filter((entry) => entry && entry.docId === docId);
  if (matching.length === 0) {
    checks.docIdExists = false;
    violations.push('docId 不存在于 docsData');
  } else {
    checks.docIdExists = true;
    if (matching.length === 1) {
      checks.noDuplicate = true;
    } else {
      checks.noDuplicate = false;
      violations.push(`重复 docId（出现 ${matching.length} 次）`);
    }
  }

  // scriptOrder：依赖脚本（DocPanel.js 类）必须先于 docs 数据脚本加载（任务包第 7 节契约：
  // 依赖脚本索引 < docs.js 索引 → true；反之为顺序错误）
  const dependencyIndex = loadOrder.findIndex((script) => typeof script === 'string' && DEPENDENCY_SCRIPT_PATTERN.test(script));
  const docsIndex = loadOrder.findIndex((script) => typeof script === 'string' && DOCS_SCRIPT_PATTERN.test(script));
  if (dependencyIndex === -1 || docsIndex === -1) {
    // 缺依赖脚本或缺 docs 数据脚本：无法确认顺序 → 违规（fail-closed）
    checks.scriptOrder = false;
    violations.push(`脚本加载顺序错误：缺少依赖脚本或 docs 数据脚本（dependencyIndex=${dependencyIndex}, docsIndex=${docsIndex}）`);
  } else if (dependencyIndex < docsIndex) {
    checks.scriptOrder = true;
  } else {
    checks.scriptOrder = false;
    violations.push(`脚本加载顺序错误：docs 数据脚本早于依赖脚本加载（dependencyIndex=${dependencyIndex}, docsIndex=${docsIndex}）`);
  }

  const verdict = Object.values(checks).every((value) => value === true) ? 'pass' : 'fail';
  return { verdict, checks, violations };
}

module.exports = {
  DEPENDENCY_SCRIPT_PATTERN,
  DOCS_SCRIPT_PATTERN,
  checkDocPanel
};
