#!/usr/bin/env node
/**
 * 需求导出包过期审计（staleness audit）
 *
 * 扫描 需求导出/ 下由 scripts/export-requirement-group.js 预生成的导出文件，
 * 解析文件头 source-iteration / source-group 注释，找回分组内全部源页面，
 * 比对「导出文件 mtime」与「源页面 mtime」：任一源页面晚于导出文件即判定过期。
 *
 * 用途：兜底「直接转发预生成需求包」的场景——运行时实时导出（assets/js/requirement-exporter.js）
 * 本身不存在过期问题，本审计只管预生成文件。
 *
 * 用法：node scripts/audit-export-stale.js
 * 退出码：0=全部新鲜；1=存在过期导出包
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const exportDir = path.join(root, '需求导出');
const { parseIterationIndex } = require('./export-requirement-group.js');

function main() {
  if (!fs.existsSync(exportDir)) {
    console.log('[audit-export-stale] 需求导出/ 不存在，无预生成导出包，跳过。');
    process.exit(0);
  }

  const iterCache = new Map();
  const stale = [];
  const missingSource = [];
  const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.html'));

  for (const file of files) {
    const outPath = path.join(exportDir, file);
    const head = fs.readFileSync(outPath, 'utf8').slice(0, 2000);
    const iterMatch = head.match(/source-iteration:\s*(.+?)(?:\s*-->)?\s*$/m);
    const groupMatch = head.match(/source-group:\s*(.+?)(?:\s*-->)?\s*$/m);
    if (!iterMatch || !groupMatch) {
      console.log(`  [跳过] ${file}（无 source-iteration/source-group 头，非本脚本生成物）`);
      continue;
    }
    const iterName = iterMatch[1].replace(/-->\s*$/, '').trim();
    const groupTitle = groupMatch[1].replace(/-->\s*$/, '').trim();
    const iterRel = `迭代索引/${iterName}.html`;
    const iterAbs = path.join(root, iterRel);
    if (!fs.existsSync(iterAbs)) {
      missingSource.push(`${file} -> ${iterRel} 不存在`);
      continue;
    }
    if (!iterCache.has(iterRel)) iterCache.set(iterRel, parseIterationIndex(iterRel));
    const { groups } = iterCache.get(iterRel);
    const group = groups.find((g) => g.title === groupTitle);
    if (!group) {
      missingSource.push(`${file} -> ${iterName} 中已无分组「${groupTitle}」`);
      continue;
    }
    const exportMtime = fs.statSync(outPath).mtimeMs;
    const newer = group.pages
      .map((p) => ({ name: p.name, src: p.src, mtime: fs.existsSync(path.join(root, p.src)) ? fs.statSync(path.join(root, p.src)).mtimeMs : Infinity }))
      .filter((p) => p.mtime > exportMtime);
    if (newer.length) {
      stale.push({ file, groupTitle, newer });
    }
  }

  if (missingSource.length) {
    console.log('[audit-export-stale] 以下导出包找不到对应源（迭代/分组已变动，建议删除或重新生成）：');
    missingSource.forEach((m) => console.log(`  - ${m}`));
  }

  if (stale.length) {
    console.log('[audit-export-stale] 以下预生成导出包已过期（源页面晚于导出文件），需重跑 npm run export:requirement 刷新：');
    for (const s of stale) {
      console.log(`  - ${s.file}（${s.groupTitle}）过期，受影响源页面：`);
      s.newer.forEach((p) => console.log(`      · ${p.name} <- ${p.src}`));
    }
    process.exit(1);
  }

  if (!missingSource.length) {
    console.log(`[audit-export-stale] 全部 ${files.length} 个预生成导出包均为最新。`);
  } else {
    process.exit(1);
  }
}

if (require.main === module) main();
