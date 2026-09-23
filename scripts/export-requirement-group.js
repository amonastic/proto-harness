#!/usr/bin/env node
/**
 * 需求分组导出脚本
 *
 * 把一个迭代索引页里某个一级分组（nav-group）下的所有源页面，
 * 打包成一份单文件自包含 HTML：
 *   - 每个源页面整页内联（外部 CSS -> <style>，外部 JS -> <script>，图片/字体 -> base64 data URI）
 *   - 页面以 <iframe srcdoc> 方式合并进一个外壳页，保留需求抽屉交互
 *   - 不产生任何外部资源引用，手动转发/另存不再丢样式
 *
 * 用法：
 *   node scripts/export-requirement-group.js 迭代索引/202609下.html                 # 列出所有分组
 *   node scripts/export-requirement-group.js 迭代索引/202609下.html --group 快递工号管理
 *   node scripts/export-requirement-group.js 迭代索引/202609下.html --all
 *
 * 输出：需求导出/{迭代名}-{分组名}.html
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const OUTPUT_DIR_REL = '需求导出';

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
    || tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
}

function stripVersion(href) {
  return href.split('?')[0].split('#')[0];
}

function toDataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return null;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function warnMissing(kind, ref, baseDir) {
  console.warn(`  [警告] ${kind} 缺失，保留原引用: ${ref}（基准目录 ${baseDir}）`);
}

/**
 * 解析相对引用：优先按页面目录解析；存量页面存在 ../ 层级写错的情况
 * （如 运维后台/pages 下误写 ../../assets），逐级加一层 ../ 回退重试。
 */
function resolveRef(ref, baseDir) {
  const clean = stripVersion(ref);
  for (let up = 0; up <= 4; up++) {
    const candidate = path.resolve(baseDir, '../'.repeat(up) + clean);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 内联 CSS 文本里的 url(...) 引用，baseDir 为该 CSS 的所在目录 */
function inlineCssUrls(css, baseDir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, quote, url) => {
    if (/^(data:|https?:|\/\/|#)/.test(url)) return m;
    const file = resolveRef(url, baseDir);
    if (!file) {
      warnMissing('CSS 资源', url, baseDir);
      return m;
    }
    const uri = toDataUri(file);
    return uri ? `url(${quote}${uri}${quote})` : m;
  });
}

/** 把单个源页面 HTML 变成自包含 HTML */
function inlinePage(pageRelPath, query) {
  const pageAbs = path.join(root, pageRelPath);
  const pageDir = path.dirname(pageAbs);
  let html = fs.readFileSync(pageAbs, 'utf8');

  // 0. 入口携带 query（如 ?view=order 的复用挂载）：srcdoc 里 location.search 为空，
  //    注入 URLSearchParams 垫片，把空 search 映射到入口 query，页面读参逻辑不变
  if (query) {
    const shim = `<script data-export-query>(function(){var q='${query}';var O=window.URLSearchParams;window.URLSearchParams=function(i){if(i==null||i===''||i===window.location.search){return new O(q);}return new O(i);};})();</script>`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + '\n    ' + shim);
    } else {
      html = shim + html;
    }
  }
  const warningsBefore = null;

  // 1. 外部 CSS -> <style>
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = getAttr(tag, 'href');
    const rel = (getAttr(tag, 'rel') || '').toLowerCase();
    if (!href || !rel.includes('stylesheet') || !/\.css(\?|#|$)/i.test(href)) return tag;
    const file = resolveRef(href, pageDir);
    if (!file) {
      warnMissing('CSS 文件', href, pageDir);
      return tag;
    }
    const css = inlineCssUrls(fs.readFileSync(file, 'utf8'), path.dirname(file));
    return `<style data-inlined-from="${toPosix(stripVersion(href))}">\n${css}\n</style>`;
  });

  // 2. 外部 JS -> 内联 <script>
  html = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
    const file = resolveRef(src, pageDir);
    if (!file) {
      warnMissing('JS 文件', src, pageDir);
      return tag;
    }
    const js = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script data-inlined-from="${toPosix(stripVersion(src))}">\n${js}\n</script>`;
  });

  // 3. <img> 图片 -> base64
  html = html.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (m, head, src, tail) => {
    if (/^(data:|https?:|\/\/)/.test(src)) return m;
    const file = resolveRef(src, pageDir);
    if (!file) {
      warnMissing('图片', src, pageDir);
      return m;
    }
    const uri = toDataUri(file);
    return uri ? head + uri + tail : m;
  });

  // 4. 页面内联 <style>（非脚本注入的）里的 url(...) -> base64，基准为页面目录
  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) => {
    if (attrs && attrs.includes('data-inlined-from')) return m;
    return `<style${attrs}>${inlineCssUrls(css, pageDir)}</style>`;
  });

  // 5. 导出口径（2026-09-09 用户裁决）：需求抽屉只保留当前迭代区块，
  //    历史版本区块不进导出包。兼容两种存量形态：
  //    doc-builder 生成的 -history 类、手写「历史收起」区块（只有 doc-version-block 基类）
  const filterStyle = `<style data-export-filter>details.doc-version-block:not(.doc-version-block-current){display:none!important}</style>`;
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `    ${filterStyle}\n</head>`);
  } else {
    html = filterStyle + html;
  }

  return html;
}

/** 从迭代索引页解析：pageNames、pageId->iframe src、分组结构 */
function parseIterationIndex(iterRelPath) {
  const abs = path.join(root, iterRelPath);
  const html = fs.readFileSync(abs, 'utf8');
  const iterDir = path.dirname(abs);

  const pageNames = {};
  const pnMatch = html.match(/const\s+pageNames\s*=\s*(\{[\s\S]*?\});/);
  if (pnMatch) {
    try {
      Object.assign(pageNames, JSON.parse(pnMatch[1].replace(/,(\s*\})$/, '$1')));
    } catch (e) {
      // 宽松解析：逐条提取
      const re = /"([^"]+)"\s*:\s*"([^"]+)"/g;
      let m;
      while ((m = re.exec(pnMatch[1]))) pageNames[m[1]] = m[2];
    }
  }

  const frameSrc = {};
  const frameQuery = {};
  const frameRe = /<div\s+id="page-([^"]+)"\s+class="page-section"[^>]*>\s*<iframe\s+src="([^"]+)"/g;
  let fm;
  while ((fm = frameRe.exec(html))) {
    const rawSrc = fm[2];
    const qIndex = rawSrc.indexOf('?');
    const query = qIndex >= 0 ? rawSrc.slice(qIndex + 1) : '';
    const fileRel = toPosix(path.relative(root, path.join(iterDir, qIndex >= 0 ? rawSrc.slice(0, qIndex) : rawSrc)));
    frameSrc[fm[1]] = fileRel;
    frameQuery[fm[1]] = query;
  }

  const groups = [];
  const groupRe = /<div\s+class="nav-group">([\s\S]*?)(?=<div\s+class="nav-group">|<div\s+class="nav-bottom-fixed")/g;
  let gm;
  while ((gm = groupRe.exec(html))) {
    const block = gm[1];
    const titleMatch = block.match(/<div class="nav-group-title">[\s\S]*?<span>([^<]+)<\/span>/);
    if (!titleMatch) continue;
    if (titleMatch[1].includes('迭代入口')) continue; // 跳过导航入口区
    const pages = [];
    const itemRe = /data-page="([^"]+)"/g;
    let im;
    while ((im = itemRe.exec(block))) {
      const pid = im[1];
      if (pid === 'overview') continue;
      if (frameSrc[pid]) {
        pages.push({ id: pid, name: pageNames[pid] || pid, src: frameSrc[pid], query: frameQuery[pid] || '' });
      }
    }
    if (pages.length) groups.push({ title: titleMatch[1].trim(), pages });
  }

  return { pageNames, groups };
}

function escapeSrcdoc(html) {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildWrapper(iterName, group, generatedAt) {
  const frames = group.pages.map((p, i) => {
    const inner = inlinePage(p.src, p.query);
    return `        <iframe id="frame-${i}" class="exp-frame${i === 0 ? ' active' : ''}" data-name="${p.name}" srcdoc="${escapeSrcdoc(inner)}"></iframe>`;
  }).join('\n');

  const navItems = group.pages.map((p, i) => {
    const endLabel = p.name.includes('·') ? p.name.split('·').pop().trim() : '';
    const pageLabel = p.name.includes('·') ? p.name.split('·')[0].trim() : p.name;
    return `                <button class="exp-nav-item${i === 0 ? ' active' : ''}" data-frame="frame-${i}" type="button">
                    <span class="exp-nav-page">${pageLabel}</span>
                    ${endLabel ? `<span class="exp-nav-end">${endLabel}</span>` : ''}
                </button>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<!-- generated-by: scripts/export-requirement-group.js -->
<!-- generated-at: ${generatedAt} -->
<!-- source-iteration: ${iterName} -->
<!-- source-group: ${group.title} -->
<!-- 本文件为自包含导出物：全部样式/脚本/图片已内联，可直接转发或另存，勿手工编辑 -->
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${iterName} · ${group.title} · 需求包</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif; display: flex; height: 100vh; overflow: hidden; background: #F1F5F9; }
        .exp-nav { width: 264px; flex-shrink: 0; background: linear-gradient(180deg, #1E293B 0%, #0F172A 100%); color: #CBD5E1; display: flex; flex-direction: column; }
        .exp-nav-head { padding: 20px 18px 14px; border-bottom: 1px solid #334155; }
        .exp-nav-iter { font-size: 12px; color: #94A3B8; }
        .exp-nav-title { font-size: 17px; font-weight: 700; color: #fff; margin-top: 4px; }
        .exp-nav-meta { font-size: 11px; color: #64748B; margin-top: 6px; }
        .exp-nav-list { flex: 1; overflow-y: auto; padding: 10px 0; }
        .exp-nav-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 18px; background: none; border: none; border-left: 3px solid transparent; color: #CBD5E1; font-size: 14px; text-align: left; cursor: pointer; }
        .exp-nav-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
        .exp-nav-item.active { background: rgba(59,130,246,0.14); color: #fff; border-left-color: #3B82F6; }
        .exp-nav-end { flex-shrink: 0; font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(148,163,184,0.18); color: #94A3B8; }
        .exp-nav-foot { padding: 12px 18px; border-top: 1px solid #334155; font-size: 11px; color: #64748B; line-height: 1.7; }
        .exp-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .exp-header { padding: 10px 20px; background: #fff; border-bottom: 1px solid #E2E8F0; font-size: 13px; color: #64748B; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .exp-header strong { color: #1E293B; }
        .exp-stage { flex: 1; position: relative; background: #F8FAFC; }
        .exp-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: none; background: #fff; display: none; }
        .exp-frame.active { display: block; }
    </style>
</head>
<body>
    <aside class="exp-nav">
        <div class="exp-nav-head">
            <div class="exp-nav-iter">${iterName}</div>
            <div class="exp-nav-title">${group.title}</div>
            <div class="exp-nav-meta">共 ${group.pages.length} 个页面 · 需求包导出</div>
        </div>
        <div class="exp-nav-list">
${navItems}
        </div>
        <div class="exp-nav-foot">
            每页右上角「需求文档」按钮可查看该页需求说明。<br>
            本文件已内联全部样式与资源，可整包转发给开发。
        </div>
    </aside>
    <main class="exp-main">
        <div class="exp-header">
            <span><strong>${iterName}</strong> · ${group.title} · 需求包</span>
            <span>生成时间 ${generatedAt}</span>
        </div>
        <div class="exp-stage">
${frames}
        </div>
    </main>
    <script>
        (function () {
            var items = document.querySelectorAll('.exp-nav-item');
            items.forEach(function (item) {
                item.addEventListener('click', function () {
                    items.forEach(function (it) { it.classList.remove('active'); });
                    item.classList.add('active');
                    document.querySelectorAll('.exp-frame').forEach(function (f) { f.classList.remove('active'); });
                    document.getElementById(item.getAttribute('data-frame')).classList.add('active');
                });
            });
        })();
    </script>
</body>
</html>
`;
}

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|\s]+/g, '');
}

function main() {
  const args = process.argv.slice(2);
  const iterPath = args.find((a) => !a.startsWith('--'));
  if (!iterPath) {
    console.log('用法: node scripts/export-requirement-group.js <迭代索引html> [--group 分组名] [--all]');
    process.exit(1);
  }
  const iterRel = toPosix(path.relative(root, path.resolve(iterPath)));
  const iterName = path.basename(iterRel, '.html');
  const { groups } = parseIterationIndex(iterRel);

  const groupArg = args.includes('--group') ? args[args.indexOf('--group') + 1] : null;
  const doAll = args.includes('--all');
  const targets = doAll ? groups : groups.filter((g) => g.title === groupArg);

  if (!targets.length) {
    console.log(`未找到匹配分组。${iterName} 现有分组：`);
    groups.forEach((g) => console.log(`  - ${g.title}（${g.pages.length} 页）`));
    process.exit(groupArg ? 1 : 0);
  }

  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const outDir = path.join(root, OUTPUT_DIR_REL);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const group of targets) {
    console.log(`导出分组「${group.title}」（${group.pages.length} 页）:`);
    group.pages.forEach((p) => console.log(`  - ${p.name} <- ${p.src}`));
    const html = buildWrapper(iterName, group, generatedAt);
    const outName = `${sanitizeName(iterName)}-${sanitizeName(group.title)}.html`;
    const outPath = path.join(outDir, outName);
    fs.writeFileSync(outPath, html);
    const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
    console.log(`  => ${toPosix(path.join(OUTPUT_DIR_REL, outName))}（${sizeMB} MB）\n`);
  }
}

module.exports = { parseIterationIndex, inlinePage, buildWrapper };

if (require.main === module) main();
