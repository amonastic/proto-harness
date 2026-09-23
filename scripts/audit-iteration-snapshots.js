#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const { config: governance, rootsAlternation } = loadGovernanceConfig(root);
const iterationDirName = governance.iterationDir;
const iterationDir = path.join(root, iterationDirName);
const scanAll = process.argv.includes('--all');
const printBaseline = process.argv.includes('--print-baseline');
const printIssuesJson = process.argv.includes('--print-issues-json');
const baselinePath = path.join(__dirname, 'audit-iteration-snapshots.baseline.json');

const protectedPages = new Set(governance.snapshotAudit.protectedPages || []);
const protectedIds = new Set(governance.snapshotAudit.protectedIds || []);

const sourcePagePattern = new RegExp(`^(\\.\\.\\/)?(?:${rootsAlternation})\\/.+\\.html(?:[?#].*)?$`);
const sourceDocsPattern = new RegExp(`(?:^|["'=(:\\s])(?:\\.\\.\\/)*(?:${rootsAlternation})\\/[^"'<>\\s]*(?:\\/js\\/(?:docs|doc-panel)\\.js)(?:[?#][^"'<>\\s]*)?`, 'g');
const sourceRootPrefixPattern = new RegExp(`^(?:\\.\\.\\/)*(?:${rootsAlternation})\\/`);
const snapshotPattern = /^snapshots\/\d{6}[上下]\/.+\.html(?:[?#].*)?$/;
const localResourceAttrs = /\b(?:src|href)=["']([^"']+)["']/gi;
const issues = [];

function normalizeHtmlVersionInDetail(detail) {
  const safeDetail = detail
    .replace(/([?&])v=<version>/g, '$1v=__VERSION__')
    .replace(/([?&])v=[^&#"'<>\s]+/g, '$1v=__VERSION__');

  return safeDetail
    .replace(/([^"'<>\s：]+\.html)(\?[^"'<>\s：]*)?/g, (match, pathname, query = '') => {
      const rawParams = query.startsWith('?') ? query.slice(1) : '';
      const params = rawParams
        ? rawParams.split('&').filter((part) => part && !part.startsWith('v='))
        : [];
      return `${pathname}?v=<version>${params.length ? `&${params.join('&')}` : ''}`;
    })
    .replace(/([?&])v=__VERSION__/g, '$1v=<version>');
}

function normalizeIssue(issue) {
  return `${issue.file}|${normalizeHtmlVersionInDetail(issue.detail)}`;
}

function loadKnownDebt() {
  if (!fs.existsSync(baselinePath)) return new Set();
  const raw = fs.readFileSync(baselinePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('audit-iteration-snapshots.baseline.json must be an array');
  }
  return new Set(parsed.map((entry) => {
    const separatorIndex = entry.indexOf('|');
    if (separatorIndex < 0) return entry;
    const file = entry.slice(0, separatorIndex);
    const detail = entry.slice(separatorIndex + 1);
    return `${file}|${normalizeHtmlVersionInDetail(detail)}`;
  }));
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function readRel(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fileExistsRel(rel) {
  return fs.existsSync(path.join(root, rel));
}

function addIssue(file, line, detail) {
  issues.push({ file, line, detail });
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function stripQuery(src) {
  return src.split(/[?#]/)[0];
}

function parseSnapshotIteration(src) {
  const match = stripQuery(src).match(/^snapshots\/(\d{6}[上下])\//);
  return match ? match[1] : '';
}

function isExternal(src) {
  return /^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(src)
    || src.startsWith('{{')
    || src.startsWith('<%');
}

function normalizeFromFile(ownerRel, raw) {
  const clean = stripQuery(raw);
  if (isExternal(clean) || clean.startsWith('/')) return '';
  const base = path.dirname(ownerRel);
  return toPosix(path.normalize(path.join(base, clean)));
}

function listIterationPages() {
  if (!fs.existsSync(iterationDir)) return [];
  return fs.readdirSync(iterationDir, { withFileTypes: true })
    .filter((item) => item.isFile() && /^\d{6}[上下]\.html$/.test(item.name))
    .map((item) => `${iterationDirName}/${item.name}`)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function parseIteration(rel) {
  return path.basename(rel, '.html');
}

function iterationRank(value) {
  const match = value.match(/^(\d{6})([上下])$/);
  if (!match) return 0;
  return Number(match[1]) * 2 + (match[2] === '下' ? 1 : 0);
}

function latestIteration(pages) {
  return pages
    .map((rel) => parseIteration(rel))
    .sort((a, b) => iterationRank(b) - iterationRank(a))[0] || '';
}

function activeIteration(pages) {
  const indexRel = `${iterationDirName}/index.html`;
  if (!fileExistsRel(indexRel)) return latestIteration(pages);
  const content = readRel(indexRel);
  const currentCardRe = /<a\b(?=[^>]*\bclass=["'][^"']*\bcurrent\b[^"']*["'])(?=[^>]*\bhref=["'](\d{6}[上下])\.html(?:[?#][^"']*)?["'])[^>]*>/gi;
  const match = currentCardRe.exec(content);
  if (match) return match[1];
  return latestIteration(pages);
}

function extractDataPages(content) {
  const out = [];
  const re = /<[^>]+\bdata-page=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(content))) {
    out.push({ id: match[1], line: lineOf(content, match.index) });
  }
  return out;
}

function extractPageSections(content) {
  const out = [];
  const re = /<div\b[^>]*\bid=["']page-([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(content))) {
    out.push({ id: match[1], line: lineOf(content, match.index) });
  }
  return out;
}

function extractPageNames(content) {
  const objectMatch = content.match(/const\s+pageNames\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!objectMatch) return null;
  const objectStart = objectMatch.index + objectMatch[0].indexOf('{');
  const body = objectMatch[1];
  const out = [];
  const re = /["']([^"']+)["']\s*:/g;
  let match;
  while ((match = re.exec(body))) {
    out.push({ id: match[1], line: lineOf(content, objectStart + 1 + match.index) });
  }
  return out;
}

function extractFooterCount(content) {
  const match = content.match(/共\s*(\d+)\s*个页面/);
  return match ? { count: Number(match[1]), line: lineOf(content, match.index) } : null;
}

function extractIframes(content) {
  const out = [];
  const iframeRe = /<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = iframeRe.exec(content))) {
    const before = content.slice(0, match.index);
    const sectionStart = before.lastIndexOf('<div id="page-');
    const section = sectionStart >= 0 ? content.slice(sectionStart, match.index) : '';
    const idMatch = section.match(/<div\s+id=["']page-([^"']+)["']/);
    out.push({ src: match[1], line: lineOf(content, match.index), pageId: idMatch ? idMatch[1] : '' });
  }
  return out;
}

function auditIndexStructure(rel, content) {
  const nav = extractDataPages(content);
  const sections = extractPageSections(content);
  const pageNames = extractPageNames(content);
  const footer = extractFooterCount(content);
  const navIds = new Map(nav.map((item) => [item.id, item.line]));
  const sectionIds = new Map(sections.map((item) => [item.id, item.line]));

  if (pageNames === null) {
    addIssue(rel, 1, '缺少 pageNames 映射，无法保证菜单与面包屑一致');
  } else {
    const nameIds = new Map(pageNames.map((item) => [item.id, item.line]));
    for (const [id, line] of navIds) {
      if (!nameIds.has(id)) addIssue(rel, line, `菜单 data-page 缺少 pageNames 映射：${id}`);
    }
    for (const [id, line] of nameIds) {
      if (!navIds.has(id)) addIssue(rel, line, `pageNames 存在未挂菜单的页面：${id}`);
    }
  }

  for (const [id, line] of navIds) {
    if (!sectionIds.has(id)) addIssue(rel, line, `菜单 data-page 缺少 iframe 承载区：page-${id}`);
  }
  for (const [id, line] of sectionIds) {
    if (!navIds.has(id)) addIssue(rel, line, `iframe 承载区缺少菜单 data-page：${id}`);
  }
  if (!footer) {
    addIssue(rel, 1, '缺少页脚页面数量');
  } else if (footer.count !== nav.length) {
    addIssue(rel, footer.line, `页脚页面数量 ${footer.count} 与菜单 data-page 数量 ${nav.length} 不一致`);
  }
}

function auditLocalResources(rel, content) {
  let match;
  while ((match = localResourceAttrs.exec(content))) {
    const raw = match[1];
    if (isExternal(raw)) continue;
    const clean = stripQuery(raw);
    if (!clean || clean.startsWith('/')) continue;
    if (sourceRootPrefixPattern.test(clean)) continue;
    const resourceRel = normalizeFromFile(rel, clean);
    if (!resourceRel || resourceRel.includes('*')) continue;
    if (!fileExistsRel(resourceRel)) {
      addIssue(rel, lineOf(content, match.index), `本地资源不存在：${raw}`);
    }
  }
}

function auditSnapshot(snapshotRel, iteration) {
  const content = readRel(snapshotRel);
  const markerExpectations = [
    ['snapshot-of:', null],
    ['snapshot-iteration:', iteration],
    ['snapshot-date:', null]
  ];

  for (const [marker, expected] of markerExpectations) {
    const line = content.split(/\r?\n/).find((item) => item.includes(marker));
    if (!line) {
      addIssue(snapshotRel, 1, `快照缺少元信息：${marker}`);
      continue;
    }
    const actual = line.slice(line.indexOf(marker) + marker.length).replace(/-->/g, '').trim();
    if (expected && actual !== expected) {
      addIssue(snapshotRel, lineOf(content, content.indexOf(line)), `快照元信息 ${marker} 应为 ${expected}，实际为 ${actual}`);
    }
  }

  // 校验 <html> 标签完整性：禁止 <html 跨行 + snapshot 注释内嵌 + lang="zh-CN"> 闭合的畸形写法
  // 畸形写法会导致 lang="zh-CN"> 文本被渲染到页面可见区域
  const htmlTagMatch = content.match(/<html\b[^>]*>/i);
  if (htmlTagMatch) {
    const tagStr = htmlTagMatch[0];
    // 正常 <html> 标签应在同一行内闭合，不包含换行符
    if (tagStr.includes('\n')) {
      addIssue(snapshotRel, lineOf(content, content.indexOf(tagStr)), '<html> 标签跨行闭合，疑似 snapshot 注释误插入标签内部，会导致 lang 属性泄漏为可见文本');
    }
  } else {
    addIssue(snapshotRel, 1, '缺少 <html> 标签');
  }

  const mutableDocsMatches = content.match(sourceDocsPattern) || [];
  for (const mutable of mutableDocsMatches) {
    addIssue(snapshotRel, 1, `快照仍引用三端可变需求数据源：${mutable.trim()}`);
  }

  auditLocalResources(snapshotRel, content);
}

function shouldAuditIframe(scanScopeAll, pageId) {
  return scanScopeAll || enforceBaseline || !pageId || protectedIds.has(`page-${pageId}`);
}

const pages = listIterationPages();
const active = activeIteration(pages);
const knownDebt = loadKnownDebt();
const enforceBaseline = !scanAll && knownDebt.size > 0;
const consideredPages = scanAll
  ? pages
  : enforceBaseline
    ? pages
  : pages.filter((rel) => protectedPages.has(parseIteration(rel)));

for (const rel of consideredPages) {
  const iteration = parseIteration(rel);
  const isHistorical = active ? iterationRank(iteration) < iterationRank(active) : false;
  const content = readRel(rel);
  const iframes = extractIframes(content);

  auditIndexStructure(rel, content);

  for (const iframe of iframes) {
    if (!shouldAuditIframe(scanAll, iframe.pageId)) continue;
    const src = toPosix(iframe.src);
    const normalized = src.replace(/^\.\.\//, '');

    if (isHistorical && sourcePagePattern.test(normalized)) {
      addIssue(rel, iframe.line, `历史迭代不得直接引用源页面：${src}`);
      continue;
    }

    if (isHistorical && snapshotPattern.test(src)) {
      const snapshotIteration = parseSnapshotIteration(src);
      if (snapshotIteration && snapshotIteration !== iteration) {
        addIssue(rel, iframe.line, `历史迭代快照目录应为 snapshots/${iteration}/，实际为 snapshots/${snapshotIteration}/：${src}`);
      }
      const snapshotRel = `${iterationDirName}/${stripQuery(src)}`;
      if (!fileExistsRel(snapshotRel)) {
        addIssue(rel, iframe.line, `快照文件不存在：${src}`);
        continue;
      }
      auditSnapshot(snapshotRel, snapshotIteration || iteration);
    }
  }
}

if (printIssuesJson) {
  console.log(JSON.stringify(issues, null, 2));
  process.exit(0);
}

if (printBaseline) {
  const baseline = Array.from(new Set(issues.map(normalizeIssue))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  console.log(JSON.stringify(baseline, null, 2));
  process.exit(0);
}

const unknownIssues = enforceBaseline
  ? issues.filter((issue) => !knownDebt.has(normalizeIssue(issue)))
  : issues;

if (unknownIssues.length) {
  console.error(`[audit-iteration-snapshots] found ${issues.length} issue(s)`);
  if (enforceBaseline) {
    console.error(`[audit-iteration-snapshots] known debt: ${issues.length - unknownIssues.length}, new issue(s): ${unknownIssues.length}`);
  }
  unknownIssues.slice(0, 100).forEach((issue) => {
    console.error(`${issue.file}:${issue.line}: ${issue.detail}`);
  });
  if (unknownIssues.length > 100) {
    console.error(`[audit-iteration-snapshots] ... ${unknownIssues.length - 100} more`);
  }
  process.exit(1);
}

console.log(`[audit-iteration-snapshots] scanned ${consideredPages.length} iteration pages`);
console.log(`[audit-iteration-snapshots] active iteration: ${active || 'n/a'}`);
if (enforceBaseline) {
  console.log(`[audit-iteration-snapshots] known debt: ${issues.length}, new issue(s): 0`);
}
console.log('[audit-iteration-snapshots] found 0 issues');
