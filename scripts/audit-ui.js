#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createProjectScanBoundary } = require('./lib/project-scan-boundary');
const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const scanBoundary = createProjectScanBoundary(root);
const { config: governance, inferPlatform, isPortalIndexPath, scanTargets } = loadGovernanceConfig(root);
const targets = scanTargets({ includeIteration: true });
const consistencySpecPath = path.join(root, 'standards', 'ui-consistency-rules.json');
const docSpecPath = path.join(root, 'standards', 'doc-spec.json');

function loadConsistencySpec() {
  if (!fs.existsSync(consistencySpecPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(consistencySpecPath, 'utf8'));
  } catch (error) {
    console.warn(`[audit-ui] warning: failed to parse standards/ui-consistency-rules.json: ${error.message}`);
    return null;
  }
}

function loadDocSpec() {
  if (!fs.existsSync(docSpecPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(docSpecPath, 'utf8'));
  } catch (error) {
    console.warn(`[audit-ui] warning: failed to parse standards/doc-spec.json: ${error.message}`);
    return null;
  }
}

function walkHtml(dir) {
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
        out.push(path.relative(root, full));
      }
    }
  }
  return out;
}

function walkDocPanelJs(dir) {
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
      } else if (item.isFile() && item.name === 'doc-panel.js') {
        out.push(path.relative(root, full));
      }
    }
  }
  return out;
}

function walkDocsJs(dir) {
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
      } else if (item.isFile() && item.name === 'docs.js') {
        out.push(path.relative(root, full));
      }
    }
  }
  return out;
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function hasAnyReference(content, patterns = []) {
  return patterns.some((pattern) => content.includes(pattern));
}

function inferType(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (isPortalIndexPath(norm)) {
    return 'portal-index';
  }
  if (norm.startsWith(`${governance.iterationDir}/`)) return 'iteration-index';
  if (inferPlatform(norm) !== 'mixed' && norm.split('/').length === 3 && norm.endsWith('/index.html')) {
    return 'platform-entry';
  }
  return 'module-page';
}

function pickDrawerWidth(content) {
  // 1) 优先识别 doc-panel 节点上的 Tailwind 宽度
  const panelTagPatterns = [
    /<[^>]+id=["']doc-panel["'][^>]*>/gi,
    /<[^>]+id=["']docPanel["'][^>]*>/gi
  ];

  for (const tagPattern of panelTagPatterns) {
    const tags = content.match(tagPattern) || [];
    for (const tag of tags) {
      const tw = tag.match(/w-\[(\d+)px\]/);
      if (tw) return `${tw[1]}px`;
      const inline = tag.match(/width\s*:\s*(\d+)px/i);
      if (inline) return `${inline[1]}px`;
    }
  }

  // 2) 识别 CSS 中 doc-panel 选择器的宽度
  const cssPatterns = [
    /\.doc-panel\s*\{[\s\S]*?width\s*:\s*(\d+)px/gi,
    /#doc-panel\s*\{[\s\S]*?width\s*:\s*(\d+)px/gi,
    /#docPanel\s*\{[\s\S]*?width\s*:\s*(\d+)px/gi
  ];
  for (const css of cssPatterns) {
    const m = css.exec(content);
    if (m) return `${m[1]}px`;
  }

  return null;
}

function shouldAuditCssTokens(rel, type) {
  const norm = rel.replace(/\\/g, '/');
  if (type !== 'module-page') return false;
  if (norm.includes('/doc/')) return false;
  return true;
}

function shouldAuditIconSource(rel, type) {
  const norm = rel.replace(/\\/g, '/');
  if (type !== 'module-page') return false;
  if (norm.includes('/doc/')) return false;
  return true;
}

function shouldAuditPageBodyBoundaries(rel, type) {
  const norm = rel.replace(/\\/g, '/');
  if (type !== 'module-page') return false;
  if (norm.includes('/doc/')) return false;
  return true;
}

function detectForbiddenPageText(content, forbiddenTexts = []) {
  return forbiddenTexts.filter((text) => content.includes(text));
}

function stripAllowedControlRails(content) {
  return content
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<aside[^>]+class=["'][^"']*(sim-panel|design-control-rail|prototype-control-rail)[^"']*["'][^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<div[^>]+class=["'][^"']*(desktop-panel|design-control-rail|prototype-control-rail)[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '</div>')
    .replace(/<div[^>]+class=["'][^"']*doc-panel[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<script/gi, '<script')
    .replace(/<div[^>]+id=["']docPanel["'][^>]*>[\s\S]*?<\/div>\s*<script/gi, '<script')
    .replace(/<div[^>]+id=["']doc-panel["'][^>]*>[\s\S]*?<\/div>\s*<script/gi, '<script');
}

function detectDevControlsInsidePhone(content) {
  const usesSharedDocPanel = content.includes('doc-panel.js') || content.includes('DocPanel.toggle(') || content.includes('DocPanel.autoShow(') || content.includes('dg-doc-btn');
  const hasInlineDocPanel = content.includes('class="doc-panel"') || content.includes("class='doc-panel'") || content.includes('id="docPanel"') || content.includes("id='docPanel'") || content.includes('id="doc-panel"') || content.includes("id='doc-panel'");
  if (usesSharedDocPanel && !hasInlineDocPanel) return [];

  const framePattern = /<[^>]+class=["'][^"']*(iphone-frame|phone-frame|miniapp-frame|phone-shell|cabinet-frame)[^"']*["'][^>]*>/i;
  const frameMatch = framePattern.exec(content);
  if (!frameMatch) return [];

  const firstDocButtonIndex = content.search(/<button[^>]+class=["'][^"']*doc-btn[^"']*["'][^>]*>/i);
  if (firstDocButtonIndex !== -1 && firstDocButtonIndex < frameMatch.index) return [];

  const sanitized = stripAllowedControlRails(content);
  const phoneRegion = sanitized.slice(frameMatch.index);
  const labels = ['需求文档', 'CSS规范'];
  return labels.filter((label) => phoneRegion.includes(label));
}

function detectDesignOnlyArtifacts(content, forbiddenTexts = []) {
  const sanitized = stripAllowedControlRails(content);
  return forbiddenTexts.filter((text) => sanitized.includes(text));
}

function getExpectedDrawerWidth(platform, consistencySpec) {
  const widthConfig = consistencySpec?.docDrawer?.layout?.width || {};
  if (platform === 'web') return widthConfig.web || null;
  if (platform === 'app') return widthConfig.app || widthConfig.mobile || null;
  if (platform === 'miniapp') return widthConfig.miniapp || widthConfig.mobile || null;
  return widthConfig.mobile || null;
}

function detectChangeType(content) {
  const commentMatch = content.match(/change-type:\s*([a-z-]+)/i);
  if (commentMatch) return commentMatch[1].toLowerCase();

  const attrMatch = content.match(/data-change-type=["']([a-z-]+)["']/i);
  if (attrMatch) return attrMatch[1].toLowerCase();

  return null;
}

function detectSafeAddScopeCreep(content) {
  const forbiddenPatterns = [
    'filter-chip',
    'toolbar-chip',
    'summary-bar',
    'summary-strip',
    'tabs-nav',
    'segmented-control'
  ];

  return forbiddenPatterns.filter((pattern) => content.includes(pattern));
}

function extractStatusLabels(content) {
  const labels = new Set();
  const patterns = [
    />\s*(待处理|处理中|已完成|已关闭|异常)\s*</g,
    /["'`](待处理|处理中|已完成|已关闭|异常)["'`]/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content))) {
      labels.add(match[1]);
    }
  }

  return [...labels];
}

const files = targets.flatMap(walkHtml);
const docPanelScripts = targets.flatMap(walkDocPanelJs);
const docsScripts = targets.flatMap(walkDocsJs);
const consistencySpec = loadConsistencySpec();
const docSpec = loadDocSpec();
const issues = [];
const widths = new Map();
const statusLabelUsage = new Map();

for (const rel of files) {
  const content = read(rel);
  const type = inferType(rel);
  const platform = inferPlatform(rel);

  const hasSystemNav = content.includes('system-nav');
  const hasDoc = content.includes('doc-panel') || content.includes('doc-button.js') || content.includes('DocPanel.') || content.includes('dg-doc-btn') || /<button[^>]*>[\s\S]{0,120}需求文档/.test(content);
  const hasAutoOpen = content.includes('DocPanel.autoShow(');
  const hasDocEntryStd = content.includes('dg-doc-btn') || content.includes('doc-button.js') || content.includes('doc-panel.js');
  const statusLabels = extractStatusLabels(content);

  if (statusLabels.length) {
    statusLabelUsage.set(rel, statusLabels);
  }

  if (type === 'module-page' && hasSystemNav) {
    issues.push({ level: 'P1', rule: '模板边界', file: rel, detail: '模块业务页包含 platform 级 system-nav' });
  }

  if (platform === 'web' && type === 'module-page' && hasDoc && hasAutoOpen) {
    issues.push({ level: 'P1', rule: '抽屉默认策略', file: rel, detail: 'Web 模块页命中 DocPanel.autoShow，应默认关闭' });
  }

  if ((platform === 'app' || platform === 'miniapp') && type === 'module-page' && hasDoc && !hasAutoOpen) {
    issues.push({ level: 'P2', rule: '抽屉默认策略', file: rel, detail: `${platform} 模块页缺少 DocPanel.autoShow，建议默认打开` });
  }

  if (hasDoc && !hasDocEntryStd) {
    issues.push({ level: 'P2', rule: '入口一致性', file: rel, detail: '需求文档入口未接入 dg-doc-btn/doc-button.js/doc-panel.js' });
  }

  if (consistencySpec?.css?.mustReferenceAny?.length && shouldAuditCssTokens(rel, type)) {
    const hasCssTokenRef = hasAnyReference(content, consistencySpec.css.mustReferenceAny);
    if (!hasCssTokenRef) {
      issues.push({ level: 'P2', rule: 'CSS Token 引用', file: rel, detail: '模块页未引用 variables.css 设计 token 文件' });
    }
  }

  if (consistencySpec?.icons?.allowedSources?.length && shouldAuditIconSource(rel, type)) {
    const declaredSources = consistencySpec.icons.allowedSources.filter((source) => content.includes(source));
    const usesIconTag = content.includes('<i class=');
    if (usesIconTag && !declaredSources.length) {
      issues.push({ level: 'P2', rule: '图标来源', file: rel, detail: '页面使用图标但未接入允许的图标资源' });
    }
  }

  if (consistencySpec?.docDrawer?.entry && hasDoc) {
    const preferredLabel = consistencySpec.docDrawer.entry.preferredLabel;
    const hasPreferredLabel = content.includes(preferredLabel);
    if (!hasPreferredLabel) {
      issues.push({ level: 'P3', rule: '文档入口文案', file: rel, detail: `需求文档入口未使用推荐文案“${preferredLabel}”` });
    }
  }

  if (shouldAuditPageBodyBoundaries(rel, type)) {
    const forbiddenTexts = docSpec?.iterationMergeRules?.forbiddenInPageContent || [];
    const hits = detectForbiddenPageText(content, forbiddenTexts);
    if (hits.length) {
      issues.push({
        level: 'P1',
        rule: '页面正文越界',
        file: rel,
        detail: `页面正文出现禁止写入的说明性文案：${hits.join('、')}`
      });
    }

    const devControlHits = detectDevControlsInsidePhone(content);
    if (devControlHits.length) {
      issues.push({
        level: 'P1',
        rule: '开发按钮位置',
        file: rel,
        detail: `手机页面正文命中开发控制按钮文案：${devControlHits.join('、')}`
      });
    }

    const designArtifactHits = detectDesignOnlyArtifacts(content, consistencySpec?.devArtifacts?.forbiddenTexts || []);
    if (designArtifactHits.length) {
      issues.push({
        level: 'P1',
        rule: '设计稿控制越界',
        file: rel,
        detail: `页面内容命中设计稿控制文案：${designArtifactHits.join('、')}`
      });
    }

    const changeType = detectChangeType(content);
    if (changeType === 'safe-add') {
      const scopeCreepHits = detectSafeAddScopeCreep(content);
      if (scopeCreepHits.length) {
        issues.push({
          level: 'P2',
          rule: 'Safe-Add 越界',
          file: rel,
          detail: `safe-add 页面检测到可能超出“仅新增字段/紧凑重排”的结构：${scopeCreepHits.join('、')}`
        });
      }
    }
  }

  if (hasDoc) {
    const width = pickDrawerWidth(content);
    if (width) {
      if (!widths.has(width)) widths.set(width, []);
      widths.get(width).push(rel);

      const expectedWidth = getExpectedDrawerWidth(platform, consistencySpec);
      if (expectedWidth && width !== expectedWidth) {
        issues.push({
          level: 'P2',
          rule: '抽屉宽度',
          file: rel,
          detail: `${platform} 页面抽屉宽度为 ${width}，与基线 ${expectedWidth} 不一致`
        });
      }
    }
  }
}

for (const rel of docPanelScripts) {
  const content = read(rel);
  const platform = inferPlatform(rel);
  const tw = content.match(/w-\[(\d+)px\]/);
  const inline = content.match(/width\s*:\s*(\d+)px/);
  const width = tw ? `${tw[1]}px` : inline ? `${inline[1]}px` : null;
  if (width) {
    if (!widths.has(width)) widths.set(width, []);
    widths.get(width).push(`${rel} (script)`);

    const expectedWidth = getExpectedDrawerWidth(platform, consistencySpec);
    if (expectedWidth && width !== expectedWidth) {
      issues.push({
        level: 'P2',
        rule: '抽屉宽度',
        file: rel,
        detail: `${platform} 抽屉组件宽度为 ${width}，与基线 ${expectedWidth} 不一致`
      });
    }
  }

  const drawerContentHits = detectDesignOnlyArtifacts(content, docSpec?.drawerPresentationRules?.forbiddenDrawerContent || []);
  if (drawerContentHits.length) {
    issues.push({
      level: 'P1',
      rule: '抽屉内容越界',
      file: rel,
      detail: `需求抽屉内容命中禁止项：${drawerContentHits.join('、')}`
    });
  }

  const cssSpecRules = consistencySpec?.docDrawer?.cssSpec;
  if (cssSpecRules) {
    if (cssSpecRules.mustSupportPageLevelSpec && !content.includes(cssSpecRules.pageLevelHook)) {
      issues.push({
        level: 'P1',
        rule: '抽屉 CSS 规范能力',
        file: rel,
        detail: `抽屉组件缺少页面级 CSS 规范读取能力：${cssSpecRules.pageLevelHook}`
      });
    }

    const missingVisualPatterns = (cssSpecRules.requiredVisualPatterns || []).filter((pattern) => !content.includes(pattern));
    if (missingVisualPatterns.length) {
      issues.push({
        level: 'P1',
        rule: '抽屉最小布局能力',
        file: rel,
        detail: `抽屉组件缺少 CSS 规范页所需的最小布局能力：${missingVisualPatterns.join('、')}`
      });
    }
  }
}

for (const rel of docsScripts) {
  const content = read(rel);
  const cssSpecRules = consistencySpec?.docDrawer?.cssSpec;
  if (!cssSpecRules) continue;

  const hasCssDataset = content.includes('DOCS_CSS_DATA');
  const hasCssGetter = content.includes('getDocCssContent');
  if (!hasCssDataset || !hasCssGetter) {
    issues.push({
      level: 'P2',
      rule: '页面级 CSS 规范',
      file: rel,
      detail: 'docs.js 缺少页面级 CSS 规范数据或读取函数（DOCS_CSS_DATA / getDocCssContent）'
    });
    continue;
  }

  const missingSections = (cssSpecRules.requiredSections || []).filter((title) => !content.includes(title));
  if (missingSections.length) {
    issues.push({
      level: 'P2',
      rule: 'CSS 规范结构',
      file: rel,
      detail: `页面级 CSS 规范缺少推荐章节：${missingSections.join('、')}`
    });
  }
}

if (consistencySpec?.statusLabels?.preferredSet?.length) {
  for (const [rel, labels] of statusLabelUsage.entries()) {
    const extra = labels.filter((label) => !consistencySpec.statusLabels.preferredSet.includes(label));
    if (extra.length) {
      issues.push({
        level: 'P3',
        rule: '状态标签集合',
        file: rel,
        detail: `发现未进入推荐集合的状态文案：${extra.join('、')}`
      });
    }
  }
}

issues.sort((a, b) => (a.level > b.level ? 1 : -1));

const widthRows = [...widths.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([w, list]) => `| ${w} | ${list.length} | ${list.slice(0, 5).join('<br>')} |`)
  .join('\n');

const issueRows = issues
  .map((x) => `| ${x.level} | ${x.rule} | ${x.file} | ${x.detail} |`)
  .join('\n');

const statusRows = [...statusLabelUsage.entries()]
  .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
  .map(([file, labels]) => `| ${file} | ${labels.join('、')} |`)
  .join('\n');

const nextSteps = issues.length
  ? [
      '1. 先清理 P1（模板边界 + 设计稿控制越界 + 抽屉内容越界）。',
      '2. 再收敛 P2（抽屉宽度、入口样式、默认策略统一）。',
      '3. 修复后执行 `npm run check:all` 复核。'
    ]
  : [
      '1. 新增页面后先执行 `npm run register:missing:write` 自动补登记。',
      '2. 每次产出完成执行 `npm run lint:ui`，把分叉拦在提交前。',
      '3. 每周执行一次 `npm run audit:ui` 归档快照。'
    ];

const report = `# 平台一致性审计报告\n\n- 审计时间：${new Date().toISOString()}\n- 页面总数：${files.length}\n- 问题总数：${issues.length}\n\n## 抽屉宽度分布（用于识别参数不一致）\n\n| 宽度 | 页面数 | 示例页面 |\n|---|---:|---|\n${widthRows || '| 无 | 0 | - |'}\n\n## 状态标签采样\n\n| 文件 | 命中状态文案 |\n|---|---|\n${statusRows || '| - | 无采样 |'}\n\n## 问题清单\n\n| 优先级 | 规则 | 文件 | 问题描述 |\n|---|---|---|---|\n${issueRows || '| - | - | - | 无问题 |'}\n\n## 建议下一步\n\n${nextSteps.join('\n')}\n`;

const output = path.join(root, '一致性审计报告.md');
fs.writeFileSync(output, report, 'utf8');

console.log(`[audit-ui] scanned ${files.length} html files`);
console.log(`[audit-ui] found ${issues.length} issues`);
console.log(`[audit-ui] report -> 一致性审计报告.md`);
