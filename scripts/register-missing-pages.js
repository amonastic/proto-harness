#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createProjectScanBoundary } = require('./lib/project-scan-boundary');
const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const scanBoundary = createProjectScanBoundary(root);
const { config: governance, inferPlatform: inferPlatformByConfig, isPortalIndexPath, scanTargets } = loadGovernanceConfig(root);
const specPath = path.join(root, 'standards', 'ui-spec.json');

function parseArgs(argv) {
  return {
    write: argv.includes('--write'),
    help: argv.includes('--help') || argv.includes('-h')
  };
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/register-missing-pages.js',
    '  node scripts/register-missing-pages.js --write'
  ].join('\n'));
}

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

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
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

function inferType(relPath) {
  const rel = toPosix(relPath);
  if (rel === `${governance.iterationDir}/index.html` || isPortalIndexPath(rel)) {
    return 'portal-index';
  }
  if (rel.startsWith(`${governance.iterationDir}/`)) return 'iteration-index';
  if (rel.endsWith('/index.html') && rel.split('/').length === 3) return 'platform-entry';
  return 'module-page';
}

function inferPlatform(relPath) {
  const rel = toPosix(relPath);
  const fromConfig = inferPlatformByConfig(rel);
  if (fromConfig !== 'mixed') return fromConfig;
  if (rel.includes('小程序')) return 'miniapp';
  if (rel.includes('APP')) return 'app';
  return 'web';
}

function inferDocMode(type, platform, content) {
  if (type !== 'module-page') return 'none';
  if (content.includes('DocPanel.autoShow(')) {
    if (platform === 'app') return 'app-auto-open';
    if (platform === 'miniapp') return 'miniapp-auto-open';
    return 'mobile-auto-open';
  }
  if ((content.includes('需求文档') || content.includes('doc-panel')) && platform === 'web') return 'web-manual-open';
  return 'none';
}

function inferDocDeliveryStrategy(relPath, type) {
  const rel = toPosix(relPath);
  if (type !== 'module-page') return 'none';
  if (rel.includes('/doc/')) return 'none';
  if (rel.startsWith(`${governance.scratchDir}/`)) return 'none';
  return 'drawer-first';
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  if (!fs.existsSync(specPath)) {
    console.error('[register-missing] missing standards/ui-spec.json');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  spec.checks = spec.checks || {};
  spec.checks.pages = spec.checks.pages || [];
  spec.checks.htmlTargets = spec.checks.htmlTargets || scanTargets({ includeIteration: true });
  spec.checks.ignoreHtmlPatterns = spec.checks.ignoreHtmlPatterns || [];
  if (typeof spec.checks.enforceHtmlRegistration !== 'boolean') {
    spec.checks.enforceHtmlRegistration = true;
  }

  const allHtml = spec.checks.htmlTargets
    .flatMap(walkHtml)
    .filter((rel) => !isIgnored(rel, spec.checks.ignoreHtmlPatterns))
    .sort();
  const untrackedHtml = args.write ? new Set() : listUntrackedHtml();
  const registeredHtml = allHtml.filter((rel) => !untrackedHtml.has(rel));
  const existing = new Set(spec.checks.pages.map((p) => toPosix(p.path)));

  const added = [];
  for (const rel of registeredHtml) {
    if (existing.has(rel)) continue;
    const content = read(rel);
    const type = inferType(rel);
    const platform = inferPlatform(rel);
    const isManagedDesignPage = !rel.startsWith(`${governance.scratchDir}/`);
    const hasDoc = isManagedDesignPage ? true : content.includes('需求文档') || content.includes('doc-panel');
    const hasTokenRef = isManagedDesignPage ? true : content.includes('assets/css/variables.css');

    added.push({
      path: rel,
      type,
      platform,
      docPanelMode: inferDocMode(type, platform, content),
      requiresDocButton: hasDoc,
      requiresTokens: hasTokenRef,
      docDeliveryStrategy: inferDocDeliveryStrategy(rel, type)
    });
  }

  if (!added.length) {
    console.log('[register-missing] no missing html pages');
    console.log(`[register-missing] total registered: ${spec.checks.pages.length}`);
    if (untrackedHtml.size) {
      console.log(`[register-missing] skipped untracked html pages in read-only mode: ${untrackedHtml.size}`);
    }
    process.exit(0);
  }

  console.log(`[register-missing] missing pages: ${added.length}`);
  added.forEach((x) => console.log(` - ${x.path} (${x.type}, ${x.platform}, ${x.docPanelMode}, ${x.docDeliveryStrategy})`));

  if (!args.write) {
    console.log('[register-missing] dry-run complete. use --write to update ui-spec');
    process.exit(0);
  }

  spec.checks.pages.push(...added);
  spec.checks.pages.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  spec.updatedAt = today();

  fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  console.log(`[register-missing] ui-spec updated. total registered: ${spec.checks.pages.length}`);
})();
