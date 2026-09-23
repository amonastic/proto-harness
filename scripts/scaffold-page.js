#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadGovernanceConfig } = require('./lib/governance-config');

const { config: governance, inferPlatform } = loadGovernanceConfig(path.resolve(__dirname, '..'));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--type') args.type = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--title') args.title = argv[++i];
    else if (a === '--platform') args.platform = argv[++i];
    else if (a === '--doc-mode') args.docMode = argv[++i];
    else if (a === '--doc-delivery') args.docDelivery = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--register') args.register = true;
    else if (a === '--register-only') args.registerOnly = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/scaffold-page.js --type <platform-entry|iteration-index|module-page|portal-index> --out <path> [--title <title>] [--force] [--register]',
    '  node scripts/scaffold-page.js --type <...> --out <path> --register-only',
    '',
    'Examples:',
    '  node scripts/scaffold-page.js --type module-page --out "admin-portal/store-admin/pages/新页面.html" --title "新页面" --register',
    '  node scripts/scaffold-page.js --type iteration-index --out "迭代索引/202604上.html" --title "202604 上 - 迭代详情" --register',
    '  node scripts/scaffold-page.js --type module-page --out "admin-portal/store-admin/pages/格口管理.html" --register-only'
  ].join('\n'));
}

function relPrefix(fromDir, toDir) {
  const rel = path.relative(fromDir, toDir).replace(/\\/g, '/');
  return rel === '' ? '.' : rel;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildModuleMarkers() {
  return [
    '<!-- template-type: module-page -->',
    '<!-- doc-delivery: drawer-first -->',
    '<!-- change-type: safe-add -->',
    '<!-- clone-source: none -->'
  ].join('\n');
}

function buildModuleHtml({ title, assetsPrefix, platform }) {
  const moduleHead = `    <link href="${assetsPrefix}/css/variables.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/common.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/components.css" rel="stylesheet">`;
  const markers = buildModuleMarkers();

  if (platform === 'web') {
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n${markers}\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${title}</title>\n    <script src="${assetsPrefix}/js/tailwind.min.js"></script>\n    <link href="${assetsPrefix}/css/font-awesome.min.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/font-awesome-local.css" rel="stylesheet">\n${moduleHead}\n</head>\n<body>\n    <header class="top-bar" style="padding:12px 24px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">\n        <h1 style="margin:0;font-size:16px;">${title}</h1>\n        <button class="dg-doc-btn" onclick="toggleDocPanel?.()">\n            <i class="fas fa-book"></i><span>需求文档</span>\n        </button>\n    </header>\n    <section style="padding:16px;">\n        页面内容\n    </section>\n    <script src="${assetsPrefix}/js/components/doc-button.js"></script>\n</body>\n</html>\n`;
  }

  if (platform === 'miniapp') {
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n${markers}\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${title}</title>\n    <script src="${assetsPrefix}/js/tailwind.min.js"></script>\n    <link href="${assetsPrefix}/css/font-awesome.min.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/font-awesome-local.css" rel="stylesheet">\n${moduleHead}\n    <style>\n        body { margin: 0; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; background: radial-gradient(circle at top, #334155, #111827 65%); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }\n        .page-wrapper { position: relative; display: flex; align-items: flex-start; gap: 18px; }\n        .dg-doc-btn { position: absolute; right: -118px; top: 16px; display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border: none; border-radius: 14px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; font-size: 12px; cursor: pointer; }\n        .miniapp-frame { width: 393px; height: 852px; overflow: hidden; border-radius: 42px; background: #f5f7fb; box-shadow: 0 0 0 12px #333, 0 0 50px rgba(0, 0, 0, 0.5); }\n        .top-bar { padding: 64px 16px 14px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }\n        .page-content { padding: 16px; color: #64748b; }\n        .safe-area-bottom { height: 24px; }\n    </style>\n</head>\n<body>\n    <div class="page-wrapper">\n        <button class="dg-doc-btn">\n            <i class="fas fa-book"></i><span>需求文档</span>\n        </button>\n        <div class="miniapp-frame">\n            <div class="top-bar">\n                <span style="font-size:16px;color:#1f2937;">返回</span>\n                <strong style="font-size:17px;color:#111827;">${title}</strong>\n                <span style="font-size:14px;color:#1677ff;">操作</span>\n            </div>\n            <main class="page-content">\n                小程序页面内容\n            </main>\n            <div class="safe-area-bottom"></div>\n        </div>\n    </div>\n    <script>\n        window.addEventListener('load', () => {\n            DocPanel?.autoShow?.('scaffold-doc-id');\n        });\n    </script>\n</body>\n</html>\n`;
  }

  return `<!DOCTYPE html>\n<html lang="zh-CN">\n${markers}\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${title}</title>\n    <script src="${assetsPrefix}/js/tailwind.min.js"></script>\n    <link href="${assetsPrefix}/css/font-awesome.min.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/font-awesome-local.css" rel="stylesheet">\n${moduleHead}\n    <style>\n        body { margin: 0; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; background: radial-gradient(circle at top, #334155, #111827 65%); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }\n        .page-wrapper { position: relative; display: flex; align-items: flex-start; gap: 18px; }\n        .dg-doc-btn { position: absolute; right: -118px; top: 16px; display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border: none; border-radius: 14px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; font-size: 12px; cursor: pointer; }\n        .phone-frame { width: 393px; height: 852px; overflow: hidden; border-radius: 50px; background: #f5f7fb; box-shadow: 0 0 0 12px #333, 0 0 50px rgba(0, 0, 0, 0.5); }\n        .status-bar { padding: 16px 24px 6px; display: flex; justify-content: space-between; color: #111827; font-weight: 600; }\n        .top-bar { padding: 8px 16px 14px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }\n        .page-content { padding: 16px; color: #64748b; }\n        .safe-area-bottom { height: 28px; }\n    </style>\n</head>\n<body>\n    <div class="page-wrapper">\n        <button class="dg-doc-btn">\n            <i class="fas fa-book"></i><span>需求文档</span>\n        </button>\n        <div class="phone-frame">\n            <div class="status-bar"><span>16:51</span><span>35%</span></div>\n            <div class="top-bar">\n                <span style="font-size:18px;color:#1f2937;">返回</span>\n                <strong style="font-size:17px;color:#111827;">${title}</strong>\n                <span style="font-size:14px;color:#1677ff;">操作</span>\n            </div>\n            <main class="page-content">\n                App 页面内容\n            </main>\n            <div class="safe-area-bottom"></div>\n        </div>\n    </div>\n    <script>\n        window.addEventListener('load', () => {\n            DocPanel?.autoShow?.('scaffold-doc-id');\n        });\n    </script>\n</body>\n</html>\n`;
}

function buildHtml({ type, title, assetsPrefix, platform }) {
  const baseHead = `    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${title}</title>\n    <script src="${assetsPrefix}/js/tailwind.min.js"></script>\n    <link href="${assetsPrefix}/css/font-awesome.min.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/font-awesome-local.css" rel="stylesheet">`;

  if (type === 'platform-entry') {
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n<!-- template-type: platform-entry -->\n<head>\n${baseHead}\n    <link href="${assetsPrefix}/css/variables.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/common.css" rel="stylesheet">\n    <link href="${assetsPrefix}/css/components.css" rel="stylesheet">\n</head>\n<body>\n    <nav class="system-nav dg-sidebar" data-role="system-sidebar"></nav>\n    <main class="dg-main-content"></main>\n    <script src="${assetsPrefix}/js/components/sidebar-standard.js"></script>\n</body>\n</html>\n`;
  }

  if (type === 'iteration-index') {
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n<!-- template-type: iteration-index -->\n<head>\n${baseHead}\n</head>\n<body>\n    <nav class="system-nav"></nav>\n    <main class="main-content">\n        <!-- 仅放功能入口索引，真实开发在三端目录 -->\n    </main>\n</body>\n</html>\n`;
  }

  if (type === 'portal-index') {
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n<!-- template-type: portal-index -->\n<head>\n${baseHead}\n</head>\n<body>\n    <!-- 总览入口页：卡片聚合，不使用 system-nav -->\n    <main class="min-h-screen p-8">\n        页面入口卡片\n    </main>\n</body>\n</html>\n`;
  }

  return buildModuleHtml({ title, assetsPrefix, platform });
}

function inferPlatformFromPath(relPath) {
  const fromConfig = inferPlatform(relPath);
  return fromConfig === 'mixed' ? 'web' : fromConfig;
}

function detectDocMode(type, platform, content, override) {
  if (override) return override;
  if (type !== 'module-page') return 'none';
  if (content.includes('DocPanel.autoShow(')) {
    if (platform === 'app') return 'app-auto-open';
    if (platform === 'miniapp') return 'miniapp-auto-open';
    return 'mobile-auto-open';
  }
  if ((content.includes('需求文档') || content.includes('doc-panel')) && platform === 'web') return 'web-manual-open';
  return 'none';
}

function detectDocDelivery(type, relPath, content, override) {
  if (override) return override;
  const norm = relPath.replace(/\\/g, '/');
  if (type !== 'module-page') return 'none';
  if (norm.includes('/doc/')) return 'none';
  if (norm.startsWith(`${governance.scratchDir}/`)) return 'none';
  if (/doc-delivery:\s*md-required/i.test(content)) return 'md-required';
  if (/doc-delivery:\s*drawer-only/i.test(content)) return 'drawer-only';
  return 'drawer-first';
}

function registerToSpec({ root, relPath, type, platform, docMode, docDelivery }) {
  const specPath = path.join(root, 'standards', 'ui-spec.json');
  if (!fs.existsSync(specPath)) {
    throw new Error('missing standards/ui-spec.json');
  }

  const content = fs.readFileSync(path.join(root, relPath), 'utf8');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

  const finalPlatform = platform || inferPlatformFromPath(relPath);
  const finalDocMode = detectDocMode(type, finalPlatform, content, docMode);
  const finalDocDelivery = detectDocDelivery(type, relPath, content, docDelivery);
  const normPath = relPath.replace(/\\/g, '/');
  const isManagedDesignPage = !normPath.startsWith(`${governance.scratchDir}/`);
  const hasDoc = isManagedDesignPage ? true : content.includes('需求文档') || content.includes('doc-panel');
  const hasTokenRef = isManagedDesignPage ? true : content.includes('assets/css/variables.css');

  const item = {
    path: relPath,
    type,
    platform: finalPlatform,
    docPanelMode: finalDocMode,
    requiresDocButton: hasDoc,
    requiresTokens: hasTokenRef,
    docDeliveryStrategy: finalDocDelivery
  };

  spec.checks = spec.checks || {};
  spec.checks.pages = spec.checks.pages || [];

  const idx = spec.checks.pages.findIndex((p) => p.path === relPath);
  if (idx >= 0) {
    spec.checks.pages[idx] = item;
  } else {
    spec.checks.pages.push(item);
  }

  spec.updatedAt = today();
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');

  return { item, total: spec.checks.pages.length };
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();

  if (args.registerOnly) args.register = true;

  const allowed = new Set(['platform-entry', 'iteration-index', 'module-page', 'portal-index']);
  if (!allowed.has(args.type) || !args.out) {
    usage();
    process.exit(1);
  }

  const root = process.cwd();
  const outAbs = path.resolve(root, args.out);
  const outDir = path.dirname(outAbs);
  const title = args.title || '新页面';

  if (!outAbs.startsWith(root)) {
    console.error('[scaffold] output path must be inside current workspace');
    process.exit(1);
  }

  if (args.registerOnly) {
    if (!fs.existsSync(outAbs)) {
      console.error('[scaffold] register-only target does not exist');
      process.exit(1);
    }
  } else {
    if (fs.existsSync(outAbs) && !args.force) {
      console.error('[scaffold] target file exists. Use --force to overwrite.');
      process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });
    const prefix = relPrefix(outDir, root);
    const assetsPrefix = `${prefix}/assets`;

    const platform = args.platform || inferPlatformFromPath(path.relative(root, outAbs));
    const html = buildHtml({ type: args.type, title, assetsPrefix, platform });
    fs.writeFileSync(outAbs, html, 'utf8');
    console.log(`[scaffold] created: ${path.relative(root, outAbs)}`);
    console.log(`[scaffold] type: ${args.type}`);
    console.log(`[scaffold] platform template: ${platform}`);
  }

  if (args.register) {
    const relPath = path.relative(root, outAbs).replace(/\\/g, '/');
    const result = registerToSpec({
      root,
      relPath,
      type: args.type,
      platform: args.platform,
      docMode: args.docMode,
      docDelivery: args.docDelivery
    });
    console.log(`[scaffold] registered: ${result.item.path}`);
    console.log(`[scaffold] rule: type=${result.item.type}, platform=${result.item.platform}, docMode=${result.item.docPanelMode}, docDelivery=${result.item.docDeliveryStrategy}`);
    console.log(`[scaffold] strict pages total: ${result.total}`);
  }
})();
