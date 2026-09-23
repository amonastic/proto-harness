#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createProjectScanBoundary } = require('./lib/project-scan-boundary');
const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const scanBoundary = createProjectScanBoundary(root);
const { config: governance, isPortalIndexPath, scanTargets } = loadGovernanceConfig(root);
const specPath = path.join(root, 'standards', 'ui-spec.json');

if (!fs.existsSync(specPath)) {
  console.error('[lint-ui] missing standards/ui-spec.json');
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const pages = spec?.checks?.pages || [];
const htmlTargets = spec?.checks?.htmlTargets || scanTargets({ includeIteration: true });
const ignoreHtmlPatterns = spec?.checks?.ignoreHtmlPatterns || [];
const enforceHtmlRegistration = spec?.checks?.enforceHtmlRegistration !== false;
const tokenFile = spec?.rules?.designTokens?.requiredFile || 'assets/css/variables.css';
const docButtonClass = spec?.rules?.docButton?.requiredClass || 'dg-doc-btn';
const errors = [];

function toPosix(p) {
  return p.replace(/\\/g, '/');
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
        out.push(toPosix(path.relative(root, full)));
      }
    }
  }
  return out;
}

function inferTypeFromPath(relPath) {
  const rel = toPosix(relPath);
  if (rel === `${governance.iterationDir}/index.html` || isPortalIndexPath(rel)) {
    return 'portal-index';
  }
  if (rel.startsWith(`${governance.iterationDir}/`)) return 'iteration-index';
  if (rel.endsWith('/index.html') && rel.split('/').length === 3) return 'platform-entry';
  return 'module-page';
}

function readFile(relPath) {
  const abs = path.join(root, relPath);
  return fs.readFileSync(abs, 'utf8');
}

function hasAny(content, patterns = []) {
  return patterns.some((p) => content.includes(p));
}

function isIgnored(relPath, patterns = []) {
  const rel = toPosix(relPath);
  return patterns.some((pattern) => rel.includes(toPosix(pattern)));
}

function listUntrackedHtml() {
  try {
    return new Set(execSync('git -c core.quotepath=false ls-files --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8'
    })
      .split(/\r?\n/)
      .filter((rel) => rel.endsWith('.html'))
      .map(toPosix));
  } catch (_) {
    return new Set();
  }
}

function checkTemplateBoundary(page, content) {
  const boundary = spec?.rules?.templateBoundaries?.[page.type];
  if (!boundary) return;

  if (boundary.mustContainAny && !hasAny(content, boundary.mustContainAny)) {
    errors.push(`${page.path}: ${page.type} 缺少必要结构 (${boundary.mustContainAny.join(' / ')})`);
  }

  if (boundary.mustNotContain) {
    const hit = boundary.mustNotContain.find((p) => content.includes(p));
    if (hit) {
      errors.push(`${page.path}: ${page.type} 命中禁止结构 (${hit})`);
    }
  }
}

function checkDocMode(page, content) {
  if (!page.docPanelMode || page.docPanelMode === 'none') return;
  const mode = spec?.rules?.docPanelMode?.[page.docPanelMode];
  if (!mode) return;

  (mode.requiredPatterns || []).forEach((pattern) => {
    if (!content.includes(pattern)) {
      errors.push(`${page.path}: 未满足 ${page.docPanelMode} 规则，缺少 ${pattern}`);
    }
  });

  (mode.forbiddenPatterns || []).forEach((pattern) => {
    if (content.includes(pattern)) {
      errors.push(`${page.path}: 违反 ${page.docPanelMode} 规则，包含 ${pattern}`);
    }
  });
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseCssDeclarations(body) {
  const declarations = {};
  body.split(';').forEach((part) => {
    const idx = part.indexOf(':');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().toLowerCase();
    if (key) declarations[key] = value;
  });
  return declarations;
}

function isTransparentBackground(value = '') {
  const normalized = value.replace(/\s+/g, '');
  return !normalized ||
    normalized === 'transparent' ||
    normalized === 'none' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === 'rgb(0,0,0,0)' ||
    normalized === 'hsla(0,0%,0%,0)';
}

function checkBlockingModalOverlay(page, content) {
  const styleBlocks = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => stripCssComments(m[1]));
  for (const css of styleBlocks) {
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = ruleRe.exec(css))) {
      const selector = match[1].trim();
      const selectorLower = selector.toLowerCase();
      if (!/(modal-mask|dialog-mask|overlay)/.test(selectorLower)) continue;
      if (/\.active\b|:/.test(selectorLower)) continue;

      const declarations = parseCssDeclarations(match[2]);
      const fixedFullScreen = declarations.position === 'fixed' && declarations.inset === '0';
      const background = declarations.background || declarations['background-color'] || '';
      const blocksPointer = declarations['pointer-events'] !== 'none';
      if (fixedFullScreen && !isTransparentBackground(background) && blocksPointer) {
        errors.push(`${page.path}: 业务弹窗遮罩 ${selector} 使用 fixed + inset:0 + 非透明背景且缺少 pointer-events:none，会阻断需求文档入口或抽屉操作`);
      }
    }
  }
}

if (enforceHtmlRegistration) {
  const untrackedHtml = listUntrackedHtml();
  const discovered = htmlTargets
    .flatMap(walkHtml)
    .filter((rel) => !isIgnored(rel, ignoreHtmlPatterns))
    .filter((rel) => !untrackedHtml.has(rel));
  const registered = new Set(pages.map((p) => toPosix(p.path)));
  const missing = discovered.filter((p) => !registered.has(p)).sort();

  for (const rel of missing) {
    const type = inferTypeFromPath(rel);
    errors.push(`${rel}: 未加入 ui-spec 检查名单。执行: node scripts/scaffold-page.js --type ${type} --out "${rel}" --register-only`);
  }
}

for (const page of pages) {
  const abs = path.join(root, page.path);
  if (!fs.existsSync(abs)) {
    errors.push(`${page.path}: file not found`);
    continue;
  }

  const content = readFile(page.path);

  if (page.requiresTokens && !content.includes(tokenFile)) {
    errors.push(`${page.path}: 未引用 ${tokenFile}`);
  }

  if (page.requiresDocButton) {
    const hasClass = content.includes(docButtonClass);
    const hasEnhancer = content.includes('doc-button.js');
    const hasDocPanelRuntime = content.includes('doc-panel.js');
    if (!hasClass && !hasEnhancer && !hasDocPanelRuntime) {
      errors.push(`${page.path}: 需求文档入口未接入 ${docButtonClass}/doc-button.js/doc-panel.js`);
    }
  }

  checkTemplateBoundary(page, content);
  checkDocMode(page, content);
  checkBlockingModalOverlay(page, content);
}

if (errors.length) {
  console.error('[lint-ui] FAILED');
  errors.forEach((e) => console.error(` - ${e}`));
  process.exit(1);
}

console.log(`[lint-ui] OK (${pages.length} pages checked)`);
