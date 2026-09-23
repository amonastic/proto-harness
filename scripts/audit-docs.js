#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createProjectScanBoundary } = require('./lib/project-scan-boundary');
const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const scanBoundary = createProjectScanBoundary(root);
const specPath = path.join(root, 'standards', 'doc-spec.json');
const targets = loadGovernanceConfig(root).scanTargets();
const inlineVersionSectionKeys = new Set([
  'field-spec',
  'interaction-rules',
  'exceptions-boundaries',
  'testing-notes',
  'acceptance-criteria'
]);

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function walkMarkdown(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const cur = stack.pop();
    const items = fs.readdirSync(cur, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(cur, item.name);
      if (item.isDirectory()) {
        if (scanBoundary.shouldSkipDirectory(full)) continue;
        stack.push(full);
      } else if (item.isFile() && item.name === '需求文档.md') {
        out.push(toPosix(path.relative(root, full)));
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function walkHtmlFiles(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const cur = stack.pop();
    const items = fs.readdirSync(cur, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(cur, item.name);
      if (item.isDirectory()) {
        if (scanBoundary.shouldSkipDirectory(full)) continue;
        stack.push(full);
      } else if (item.isFile() && item.name.endsWith('.html')) {
        out.push(toPosix(path.relative(root, full)));
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

// versionLayeringRule 机检：内联抽屉存在多期新增说明但未使用 doc-version-block 版本区块分层
function detectDrawerVersionLayering(content) {
  if (!/doc-rich-content|doc-drawer/.test(content)) return false;
  if (/doc-version-block/.test(content)) return false;
  const marks = content.match(/本期新增/g) || [];
  return marks.length >= 2;
}

function getHeadingEntries(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line, index) => ({ raw: line, line: index + 1 }))
    .filter((item) => /^#{1,6}\s+/.test(item.raw.trim()))
    .map((item) => ({
      line: item.line,
      level: item.raw.trim().match(/^#{1,6}/)[0].length,
      title: item.raw.trim().replace(/^#{1,6}\s+/, '').trim()
    }));
}

function hasAnyText(content, words = []) {
  return words.some((word) => content.includes(word));
}

function shouldSkipDoc(relPath, content, exclude = {}) {
  const markers = exclude.markers || [];
  const hitMarker = markers.find((word) => content.includes(word));
  if (hitMarker) {
    return { skip: true, reason: `marker:${hitMarker}` };
  }

  if (/doc-delivery:\s*drawer-only/i.test(content)) {
    return { skip: true, reason: 'doc-delivery:drawer-only' };
  }

  return { skip: false, reason: null };
}

function matchSections(headingEntries, sections) {
  return sections.map((section) => {
    const matched = headingEntries.find((entry) => section.aliases.some((alias) => entry.title.includes(alias)));
    return {
      key: section.key,
      title: section.title,
      matched: matched ? matched.title : null,
      line: matched ? matched.line : null
    };
  });
}

function isRequiredSectionHeading(title, sections) {
  return sections.some((section) => section.aliases.some((alias) => title.includes(alias)));
}

function buildSectionBodies(markdown, sectionMatches) {
  const lines = markdown.split(/\r?\n/);
  const matched = sectionMatches.filter((item) => item.line).sort((a, b) => a.line - b.line);
  const bodies = new Map();

  matched.forEach((item, index) => {
    const start = item.line;
    const end = index + 1 < matched.length ? matched[index + 1].line - 1 : lines.length;
    bodies.set(item.key, lines.slice(start, end).join('\n'));
  });

  return bodies;
}

function detectSectionOrderProblems(sectionMatches, headingEntries, sections) {
  const matched = sectionMatches.filter((item) => item.line);
  const problems = [];

  for (let i = 1; i < matched.length; i += 1) {
    const prev = matched[i - 1];
    const cur = matched[i];
    if (prev.line > cur.line) {
      const hasBlockReset = headingEntries.some((entry) => {
        if (entry.line <= cur.line || entry.line >= prev.line) return false;
        return entry.level <= 2 && !isRequiredSectionHeading(entry.title, sections);
      });
      if (hasBlockReset) continue;
      problems.push(`${prev.title} 应在 ${cur.title} 之前`);
    }
  }

  return problems;
}

function compileVersionPatterns(spec = {}) {
  const patterns = spec.qualityChecks?.versionTagPatterns || [];
  return patterns.map((p) => new RegExp(p));
}

function hasVersionMarker(content, markers = [], patterns = []) {
  if (markers.some((marker) => content.includes(marker))) return true;
  return patterns.some((pattern) => pattern.test(content));
}

function detectInlineVersionPlacement(content, sectionBodies, markers = [], patterns = []) {
  if (!hasVersionMarker(content, markers, patterns)) {
    return { hasVersion: false, inlineHits: [], topSummaryOnly: false };
  }

  const inlineHits = [...inlineVersionSectionKeys].filter((key) => hasVersionMarker(sectionBodies.get(key) || '', markers, patterns));
  const lines = content.split(/\r?\n/);
  const firstInlineLine = [...inlineVersionSectionKeys]
    .map((key) => sectionBodies.get(key) || '')
    .find((body) => body);

  const topExcerpt = firstInlineLine ? content.slice(0, content.indexOf(firstInlineLine)) : lines.slice(0, 40).join('\n');
  const topSummaryOnly = hasVersionMarker(topExcerpt, markers, patterns) && inlineHits.length === 0;

  return {
    hasVersion: true,
    inlineHits,
    topSummaryOnly
  };
}

function buildReport({ docs, results, skippedDocs, spec, htmlResults }) {
  const issueRows = results
    .flatMap((item) => item.issues.map((issue) => `| ${item.path} | ${issue.level} | ${issue.type} | ${issue.detail} |`))
    .join('\n');

  const htmlIssueRows = htmlResults
    .flatMap((item) => item.issues.map((issue) => `| ${item.path} | ${issue.level} | ${issue.type} | ${issue.detail} |`))
    .join('\n');

  const skippedRows = skippedDocs.map((item) => `| ${item.path} | ${item.reason} |`).join('\n');

  const deliveryPolicy = spec.deliveryPolicy || {};
  const strategies = deliveryPolicy.strategies || {};

  return `# 需求文档审计报告

- 审计时间：${new Date().toISOString()}
- 发现文档数：${docs.length}
- 实际审计数：${results.length}
- 排除数：${skippedDocs.length}
- 内联抽屉页审计数：${htmlResults.length}
- 规则版本：${spec.version}
- 默认文档交付策略：${deliveryPolicy.defaultStrategy || 'drawer-first'}

## 审计范围

${spec.scope.targets.map((target) => `- ${target}`).join('\n')}

## 文档交付策略说明

${Object.entries(strategies)
    .map(([key, value]) => `- ${key}：${value}`)
    .join('\n') || '- drawer-first：默认以抽屉文档为主交付'}

## 排除清单

| 文件 | 原因 |
|---|---|
${skippedRows || '| - | 无排除项 |'}

## 问题清单

| 文件 | 级别 | 类型 | 说明 |
|---|---|---|---|
${issueRows || '| - | - | - | 无问题 |'}

## 内联抽屉版本区块检查

依据 versionLayeringRule：内联抽屉存在多期新增说明时必须使用 doc-version-block 版本区块分层（当前迭代置顶展开、历史收起）。

| 文件 | 级别 | 类型 | 说明 |
|---|---|---|---|
${htmlIssueRows || '| - | - | - | 无问题 |'}

## 建议动作

1. 仅当文档交付策略为 \`md-required\` 时，再强制新增或重写 \`需求文档.md\`。
2. 普通迭代页优先补齐页面抽屉文档，不要只写 md。
3. 存量 md 优先补齐“状态与分支”“异常与边界”“待确认项”。
`;
}

(function main() {
  if (!fs.existsSync(specPath)) {
    console.error('[audit-docs] missing standards/doc-spec.json');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const docs = targets.flatMap(walkMarkdown);
  const results = [];
  const skippedDocs = [];
  const htmlResults = [];
  let inlineDrawerPages = 0;
  const versionPatterns = compileVersionPatterns(spec);

  for (const rel of targets.flatMap(walkHtmlFiles)) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    if (!/doc-rich-content|doc-drawer/.test(content)) continue;
    inlineDrawerPages += 1;
    if (!detectDrawerVersionLayering(content)) continue;
    htmlResults.push({
      path: rel,
      issues: [{
        level: 'P2',
        type: '版本区块缺失',
        detail: '内联抽屉存在多期新增说明但未使用 doc-version-block 版本区块分层（当前迭代置顶展开、历史收起）'
      }]
    });
  }

  for (const rel of docs) {
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    const skipState = shouldSkipDoc(rel, content, spec.scope?.exclude || {});
    if (skipState.skip) {
      skippedDocs.push({ path: rel, reason: skipState.reason });
      continue;
    }

    const headingEntries = getHeadingEntries(content);
    const sectionMatches = matchSections(headingEntries, spec.requiredSections || []);
    const sectionBodies = buildSectionBodies(content, sectionMatches);
    const missingSections = sectionMatches.filter((item) => !item.matched);
    const orderProblems = detectSectionOrderProblems(sectionMatches, headingEntries, spec.requiredSections || []);
    const versionPlacement = detectInlineVersionPlacement(
      content,
      sectionBodies,
      spec.qualityChecks?.versionMarkers || [],
      versionPatterns
    );
    const issues = [];

    if (missingSections.length) {
      issues.push({
        level: 'P2',
        type: '结构缺失',
        detail: `缺少章节：${missingSections.map((item) => item.title).join('、')}`
      });
    }

    const matchedCount = sectionMatches.length - missingSections.length;
    if (matchedCount < (spec.qualityChecks?.recommendedMinSections || 0)) {
      issues.push({
        level: 'P2',
        type: '完整度不足',
        detail: `命中章节 ${matchedCount} 个，低于建议值 ${spec.qualityChecks.recommendedMinSections}`
      });
    }

    if (orderProblems.length) {
      issues.push({
        level: 'P2',
        type: '章节顺序异常',
        detail: `章节顺序不符合模板推荐：${orderProblems.join('；')}`
      });
    }

    if (!hasAnyText(content, spec.qualityChecks?.mustMentionAny?.states || [])) {
      issues.push({
        level: 'P2',
        type: '状态缺失',
        detail: '未识别到明确状态说明或状态文案'
      });
    }

    if (!hasAnyText(content, spec.qualityChecks?.mustMentionAny?.limits || [])) {
      issues.push({
        level: 'P3',
        type: '边界缺失',
        detail: '未识别到异常、限制、提示或校验相关描述'
      });
    }

    const styleHits = (spec.writingStyle?.avoid || []).filter((word) => content.includes(word));
    if (styleHits.length) {
      issues.push({
        level: 'P3',
        type: '行文漂移',
        detail: `检测到待避免表达：${styleHits.join('、')}`
      });
    }

    if (versionPlacement.topSummaryOnly) {
      issues.push({
        level: 'P2',
        type: '版本标记漂移',
        detail: '检测到版本说明集中写在顶部摘要，未内联到具体条目'
      });
    }

    results.push({ path: rel, issues });
  }

  const output = path.join(root, '需求文档审计报告.md');
  const report = buildReport({ docs, results, skippedDocs, spec, htmlResults });
  fs.writeFileSync(output, report, 'utf8');

  const issueCount = results.reduce((sum, item) => sum + item.issues.length, 0)
    + htmlResults.reduce((sum, item) => sum + item.issues.length, 0);
  console.log(`[audit-docs] discovered ${docs.length} docs`);
  console.log(`[audit-docs] skipped ${skippedDocs.length} docs`);
  console.log(`[audit-docs] audited ${results.length} docs`);
  console.log(`[audit-docs] inline drawer pages checked: ${inlineDrawerPages}`);
  console.log(`[audit-docs] drawer version-block violations: ${htmlResults.reduce((sum, item) => sum + item.issues.length, 0)}`);
  console.log(`[audit-docs] found ${issueCount} issues`);
  console.log('[audit-docs] report -> 需求文档审计报告.md');
})();
