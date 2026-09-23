'use strict';

// H03B：仓库图谱（Repository Graph）构造辅助与类型定义。
//
// 图谱是一个纯 JS 对象，由调用方构造并传入验证器；本文件只提供构造辅助函数
// 与 JSDoc 类型定义，不封装任何文件 I/O、不解析真实路径、不执行 git 命令。
//
// 图谱对象最小结构（见任务包第 5 节）：
// {
//   sourceDir: {
//     path, menuItems: [{ pageId, label, monthTag }],
//     iframeCarriers: [{ pageId, src, monthComment }],
//     pageNames: { [pageId]: label },
//     iterationRefs: [pageId]
//   },
//   docsData: {
//     entries: [{ docId, pageId, scriptOrder }],
//     scriptLoadOrder: [scriptPath]
//   },
//   pageBodyText: string
// }

/**
 * @typedef {Object} MenuItem
 * @property {string} pageId
 * @property {string} label
 * @property {string|null} monthTag    // 如 '202608上' / '202608下'；null 表示缺失
 */

/**
 * @typedef {Object} IframeCarrier
 * @property {string} pageId
 * @property {string} src              // iframe src 相对路径
 * @property {string|null} monthComment
 */

/**
 * @typedef {Object} SourceDirGraph
 * @property {string} path
 * @property {MenuItem[]} menuItems
 * @property {IframeCarrier[]} iframeCarriers
 * @property {Object<string,string>} pageNames
 * @property {string[]} iterationRefs
 */

/**
 * @typedef {Object} DocsEntry
 * @property {string} docId
 * @property {string} pageId
 * @property {number} scriptOrder
 */

/**
 * @typedef {Object} DocsDataGraph
 * @property {DocsEntry[]} entries
 * @property {string[]} scriptLoadOrder
 */

/**
 * @typedef {Object} RepositoryGraph
 * @property {SourceDirGraph} sourceDir
 * @property {DocsDataGraph} docsData
 * @property {string} pageBodyText
 */

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`H03B_GRAPH ${label} must be non-empty string`);
}

// ---- 构造辅助（纯函数，无 I/O）----

function createMenuItem({ pageId, label, monthTag = null }) {
  assertNonEmptyString(pageId, 'menuItem.pageId');
  assertNonEmptyString(label, 'menuItem.label');
  if (monthTag !== null && typeof monthTag !== 'string') throw new Error('H03B_GRAPH menuItem.monthTag must be string|null');
  return { pageId, label, monthTag };
}

function createIframeCarrier({ pageId, src, monthComment = null }) {
  assertNonEmptyString(pageId, 'iframeCarrier.pageId');
  assertNonEmptyString(src, 'iframeCarrier.src');
  if (monthComment !== null && typeof monthComment !== 'string') throw new Error('H03B_GRAPH iframeCarrier.monthComment must be string|null');
  return { pageId, src, monthComment };
}

function createSourceDir({ path: dirPath, menuItems = [], iframeCarriers = [], pageNames = {}, iterationRefs = [] }) {
  assertNonEmptyString(dirPath, 'sourceDir.path');
  if (!Array.isArray(menuItems) || !Array.isArray(iframeCarriers) || !Array.isArray(iterationRefs)) {
    throw new Error('H03B_GRAPH sourceDir lists must be arrays');
  }
  if (!pageNames || typeof pageNames !== 'object' || Array.isArray(pageNames)) {
    throw new Error('H03B_GRAPH sourceDir.pageNames must be an object');
  }
  return { path: dirPath, menuItems, iframeCarriers, pageNames, iterationRefs };
}

function createDocsEntry({ docId, pageId, scriptOrder }) {
  assertNonEmptyString(docId, 'docsEntry.docId');
  assertNonEmptyString(pageId, 'docsEntry.pageId');
  if (!Number.isInteger(scriptOrder)) throw new Error('H03B_GRAPH docsEntry.scriptOrder must be integer');
  return { docId, pageId, scriptOrder };
}

function createDocsData({ entries = [], scriptLoadOrder = [] }) {
  if (!Array.isArray(entries) || !Array.isArray(scriptLoadOrder)) {
    throw new Error('H03B_GRAPH docsData lists must be arrays');
  }
  return { entries, scriptLoadOrder };
}

function createGraph({ sourceDir, docsData, pageBodyText = '' }) {
  if (!sourceDir || !docsData) throw new Error('H03B_GRAPH sourceDir and docsData are required');
  if (typeof pageBodyText !== 'string') throw new Error('H03B_GRAPH pageBodyText must be string');
  return { sourceDir, docsData, pageBodyText };
}

// ---- 结构自检（Slice A 完成条件：必需字段非空）----

function assertGraphShape(graph) {
  if (!graph || typeof graph !== 'object') throw new Error('H03B_GRAPH graph must be an object');
  if (!graph.sourceDir || typeof graph.sourceDir.path !== 'string' || graph.sourceDir.path.length === 0) {
    throw new Error('H03B_GRAPH sourceDir.path required');
  }
  if (!Array.isArray(graph.sourceDir.menuItems)) throw new Error('H03B_GRAPH sourceDir.menuItems must be array');
  if (!Array.isArray(graph.sourceDir.iframeCarriers)) throw new Error('H03B_GRAPH sourceDir.iframeCarriers must be array');
  if (!graph.sourceDir.pageNames || typeof graph.sourceDir.pageNames !== 'object') throw new Error('H03B_GRAPH sourceDir.pageNames must be object');
  if (!Array.isArray(graph.sourceDir.iterationRefs)) throw new Error('H03B_GRAPH sourceDir.iterationRefs must be array');
  if (!graph.docsData || !Array.isArray(graph.docsData.entries)) throw new Error('H03B_GRAPH docsData.entries must be array');
  if (!Array.isArray(graph.docsData.scriptLoadOrder)) throw new Error('H03B_GRAPH docsData.scriptLoadOrder must be array');
  if (typeof graph.pageBodyText !== 'string') throw new Error('H03B_GRAPH pageBodyText must be string');
  return graph;
}

module.exports = {
  createMenuItem,
  createIframeCarrier,
  createSourceDir,
  createDocsEntry,
  createDocsData,
  createGraph,
  assertGraphShape
};
