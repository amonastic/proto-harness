#!/usr/bin/env node
/**
 * 构建全局搜索索引
 *
 * 扫描：
 *   1. 迭代聚合页：迭代索引/*.html（不含 index/待排期/已废弃/问题件）
 *   2. 源文件子模块 index：各端 index.html
 *   3. 外部 docs.js：{js}/docs.js（跳过 snapshots/，与源文件重复）
 *
 * 输出：assets/js/search-index.js
 *   window.__SEARCH_INDEX__ = {
 *     menus: [{ platform, module, group, pageId, title, iterTag, url, sourceType }],
 *     docs:  [{ docId, title, platform, module, pageUrl, snippet, sourceType }]
 *   }
 *
 * 运行：node scripts/build-search-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { loadGovernanceConfig } = require('./lib/governance-config');

const ROOT = path.resolve(__dirname, '..');
const { config: GOVERNANCE, platformRoots } = loadGovernanceConfig(ROOT);
const OUTPUT = path.join(ROOT, 'assets/js/search-index.js');
const SEARCH_INDEX_PREFIX = '/* 自动生成，请勿手动编辑。运行 node scripts/build-search-index.js 重新生成 */\nwindow.__SEARCH_INDEX__ = ';
const SEARCH_INDEX_SUFFIX = ';\n';

// ---------- 工具：去 HTML 标签 ----------
function stripHtml(html) {
    if (!html) return '';
    return String(html)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------- 工具：简版 DOM 解析（正则） ----------
// 提取所有 .nav-item 节点（含 data-page 与内部 span 文本）
function extractNavItems(html) {
    const items = [];
    // 匹配 <div ... class="...nav-item..." ... data-page="xxx" ...> ... </div>
    // nav-item 是单层 div，闭合 </div> 不嵌套同 class，用非贪婪到下一个 </div>
    // 但 nav-item 内部可能有 <span>，需谨慎。用 [^]*? 跨行非贪婪到 </div>
    const re = /<div\b[^>]*\bclass="[^"]*nav-item[^"]*"[^>]*\bdata-page="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const pageId = m[1];
        const inner = m[2];
        // 第一个 <span> 的文本作为菜单名（图标 <i> 之后的 span）
        const spanMatch = inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/);
        let title = spanMatch ? stripHtml(spanMatch[1]) : '';
        // 迭代标记 .nav-item-desc / .nav-item-meta
        const descMatch = inner.match(/<span\b[^>]*class="[^"]*(?:nav-item-desc|nav-item-meta)[^"]*"[^>]*>([\s\S]*?)<\/span>/);
        const iterTag = descMatch ? stripHtml(descMatch[1]) : '';
        if (title) items.push({ pageId, title, iterTag });
    }
    return items;
}

// 提取 #page-{pageId} 下 iframe 的 src
function extractIframeSrc(html, pageId) {
    // 容器 id 形如 page-xxx，iframe src 可能在同 div 内
    const re = new RegExp(
        '<div\\b[^>]*id="page-' + pageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>([\\s\\S]*?)</div>\\s*(?:<div|<!--|</div>\\s*</div>|$)',
        'i'
    );
    const m = html.match(re);
    if (!m) return '';
    const iframeMatch = m[1].match(/<iframe\b[^>]*\bsrc="([^"]+)"/i);
    return iframeMatch ? iframeMatch[1] : '';
}

// 提取最近的 .nav-group-title 文本（从 nav-item 往前找）
function extractGroupForItem(html, itemIndex) {
    // 简化：按 nav-item 在原文的位置，往前找最近的 nav-group-title
    // 由于 extractNavItems 已消耗，这里重做一次定位
    return ''; // 先留空，下面用整体扫描补
}

// 更稳健：一次性扫描，维护当前 group 上下文
function parseNavWithGroups(html) {
    const items = [];
    let currentGroup = '';
    // 用 token 扫描：要么 nav-group-title，要么 nav-item
    const tokenRe = /<div\b[^>]*class="[^"]*nav-group-title[^"]*"[^>]*>([\s\S]*?)<\/div>|<div\b[^>]*\bclass="[^"]*nav-item[^"]*"[^>]*\bdata-page="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
        if (m[1] !== undefined) {
            // nav-group-title
            currentGroup = stripHtml(m[1]);
        } else if (m[2] !== undefined) {
            // nav-item
            const pageId = m[2];
            const inner = m[3];
            const spanMatch = inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/);
            const title = spanMatch ? stripHtml(spanMatch[1]) : '';
            const descMatch = inner.match(/<span\b[^>]*class="[^"]*(?:nav-item-desc|nav-item-meta)[^"]*"[^>]*>([\s\S]*?)<\/span>/);
            const iterTag = descMatch ? stripHtml(descMatch[1]) : '';
            if (title) {
                items.push({ pageId, title, iterTag, group: currentGroup });
            }
        }
    }
    return items;
}

// ---------- 扫描 index.html ----------
function scanIndexFile(absPath, sourceType, platformLabel, moduleLabel) {
    const html = fs.readFileSync(absPath, 'utf8');
    const navItems = parseNavWithGroups(html);
    const results = [];
    for (const it of navItems) {
        const iframeSrc = extractIframeSrc(html, it.pageId);
        // 构造跳转 URL：index.html?page={pageId}
        const relPath = path.relative(ROOT, absPath).replace(/\\/g, '/');
        const url = relPath + '?page=' + encodeURIComponent(it.pageId);
        results.push({
            platform: platformLabel,
            module: moduleLabel,
            group: it.group,
            pageId: it.pageId,
            title: it.title,
            iterTag: it.iterTag,
            url,
            sourceType,
            // 文档关联：iframe 指向的 pages 文件相对路径，用于 docs 反查
            pageFile: iframeSrc ? resolvePageFile(relPath, iframeSrc) : '',
        });
    }
    return results;
}

// 把 iframe src（相对 index.html）解析为相对项目根的路径
function resolvePageFile(indexRel, iframeSrc) {
    if (!iframeSrc) return '';
    // 去掉 query
    const src = iframeSrc.split('?')[0].split('#')[0];
    if (!src) return '';
    // indexRel 形如 "admin-portal/store-admin/index.html"
    const dir = path.dirname(indexRel);
    const resolved = path.posix.normalize(path.posix.join(dir, src));
    return resolved;
}

// ---------- 扫描 docs.js ----------
// docs.js 形如：window.XxxDocData = Object.assign({}, {...}, { "docId": { title, content: `...` } })
// 或：const DOCS = { "docId": { content: `...` } }
// 策略：正则提取所有 "docId": { ... content: `...` } 或 'docId': { ... }
// 由于 content 是模板字符串，含反引号，需匹配 `...` 并处理转义
function extractDocIdsFromJs(jsSource) {
    const docs = [];
    // 匹配 "xxx": { 或 'xxx': { 后面的 content
    // 先找所有 docId：形如 "word-with-dash" : { 且后面有 content:
    const idRe = /["']([a-z0-9][a-z0-9-]*[a-z0-9])["']\s*:\s*\{/g;
    let m;
    const candidates = [];
    while ((m = idRe.exec(jsSource)) !== null) {
        candidates.push({ id: m[1], start: m.index });
    }
    for (const c of candidates) {
        // 从 c.start 往后找最近的 content: ` 或 content:"
        const after = jsSource.slice(c.start);
        // 模板字符串
        const tmplRe = /\bcontent\s*:\s*`([\s\S]*?)`/;
        const tm = after.match(tmplRe);
        if (tm) {
            docs.push({ docId: c.id, content: tm[1] });
            continue;
        }
        // 双引号字符串（含转义）
        const dqRe = /\bcontent\s*:\s*"((?:[^"\\]|\\.)*)"/;
        const dqm = after.match(dqRe);
        if (dqm) {
            docs.push({ docId: c.id, content: dqm[1] });
            continue;
        }
        // 单引号字符串
        const sqRe = /\bcontent\s*:\s*'((?:[^'\\]|\\.)*)'/;
        const sqm = after.match(sqRe);
        if (sqm) {
            docs.push({ docId: c.id, content: sqm[1] });
        }
    }
    return docs;
}

// 从 docs.js 文件路径推断 platform/module
function inferModuleFromDocsPath(docsAbsPath) {
    const rel = path.relative(ROOT, docsAbsPath).replace(/\\/g, '/');
    // 形如 admin-portal/store-admin/js/docs.js 或 mini-program/js/docs.js
    const parts = rel.split('/');
    // parts[parts.length-1] = 'docs.js', parts[parts.length-2] = 'js'
    // module 取 js 的父目录：parts[parts.length-3]
    if (parts.length >= 3) {
        return { platform: parts[0], module: parts[parts.length - 3] };
    }
    return { platform: parts[0] || '', module: parts[0] || '' };
}

// 找该 docs.js 对应的 index.html，用于建立 docId → pageFile 映射
function findIndexForDocs(docsAbsPath) {
    const dir = path.dirname(path.dirname(docsAbsPath)); // 去掉 js/docs.js
    const indexPath = path.join(dir, 'index.html');
    return fs.existsSync(indexPath) ? indexPath : '';
}

// 全局建立 docId → pageFile 映射：扫描所有子模块 index 的 iframe，得 pageId→pageFile；
// 再扫描每个 pageFile 内容里的 toggleDocPanel('xxx')/DocPanel.toggle('xxx')，得 docId→pageFile
let globalDocIdToPageFile = {};
function buildGlobalDocIdMap(moduleRoots) {
    const pageIdToPageFile = {}; // 跨所有子模块
    for (const r of moduleRoots) {
        const abs = path.join(ROOT, r.dir, 'index.html');
        if (!fs.existsSync(abs)) continue;
        const html = fs.readFileSync(abs, 'utf8');
        const iframeRe = /<div\b[^>]*id="page-([^"]+)"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<!--|$)/g;
        let im;
        while ((im = iframeRe.exec(html)) !== null) {
            const pid = im[1];
            const srcMatch = im[2].match(/<iframe\b[^>]*\bsrc="([^"]+)"/i);
            if (srcMatch) {
                const pf = resolvePageFile(path.relative(ROOT, abs), srcMatch[1]);
                if (pf) pageIdToPageFile[pid] = pf;
            }
        }
    }
    // 扫描每个 pageFile，提取 toggleDocPanel/DocPanel.toggle 的 docId
    const pageFiles = [...new Set(Object.values(pageIdToPageFile))];
    for (const pf of pageFiles) {
        const abs = path.join(ROOT, pf);
        if (!fs.existsSync(abs)) continue;
        const html = fs.readFileSync(abs, 'utf8');
        const re = /(?:DocPanel\.toggle|toggleDocPanel)\(['"]([^'"]+)['"]\)/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            if (!globalDocIdToPageFile[m[1]]) globalDocIdToPageFile[m[1]] = pf;
        }
    }
}

function scanDocsFile(docsAbsPath) {
    const js = fs.readFileSync(docsAbsPath, 'utf8');
    const rawDocs = extractDocIdsFromJs(js);
    if (rawDocs.length === 0) return [];
    const { platform, module } = inferModuleFromDocsPath(docsAbsPath);

    const results = [];
    for (const d of rawDocs) {
        const plain = stripHtml(d.content);
        const snippet = plain.slice(0, 200);
        // 优先用全局映射；回退：docId 与 pageId 同名
        let pageFile = globalDocIdToPageFile[d.docId] || '';
        const pageUrl = pageFile ? pageFile + '?doc=' + encodeURIComponent(d.docId) : '';
        results.push({
            docId: d.docId,
            title: d.docId, // docId 作为标题（实际标题在 content 里，前端可截取）
            platform,
            module,
            pageUrl,
            snippet,
            fullText: plain,
            sourceType: 'docs',
        });
    }
    return results;
}

function normalizePayloadForCompare(payload) {
    if (!payload) return null;
    return {
        menus: payload.menus || [],
        docs: payload.docs || [],
    };
}

function readExistingPayload() {
    if (!fs.existsSync(OUTPUT)) return null;
    const current = fs.readFileSync(OUTPUT, 'utf8');
    if (!current.startsWith(SEARCH_INDEX_PREFIX) || !current.endsWith(SEARCH_INDEX_SUFFIX)) return null;
    const json = current.slice(SEARCH_INDEX_PREFIX.length, -SEARCH_INDEX_SUFFIX.length);
    try {
        return JSON.parse(json);
    } catch (err) {
        return null;
    }
}

function payloadContentChanged(nextPayload) {
    const existingPayload = readExistingPayload();
    if (!existingPayload) return true;
    return JSON.stringify(normalizePayloadForCompare(existingPayload)) !== JSON.stringify(normalizePayloadForCompare(nextPayload));
}

// 自动发现子模块：各平台根目录下含 index.html 的一级子目录
function discoverModuleRoots() {
    const out = [];
    for (const rootDir of platformRoots) {
        const abs = path.join(ROOT, rootDir);
        if (!fs.existsSync(abs)) continue;
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const dir = `${rootDir}/${entry.name}`;
            if (fs.existsSync(path.join(ROOT, dir, 'index.html'))) {
                out.push({ dir, label: entry.name });
            }
        }
    }
    return out;
}

// ---------- 主流程 ----------
function main() {
    const menus = [];
    const docs = [];

    // 1. 迭代聚合页
    const iterDir = path.join(ROOT, GOVERNANCE.iterationDir);
    const iterFiles = fs.existsSync(iterDir) ? fs.readdirSync(iterDir).filter(f => /^20\d{4}.*\.html$/.test(f)) : [];
    for (const f of iterFiles) {
        const abs = path.join(iterDir, f);
        const iterName = f.replace(/\.html$/, '');
        const items = scanIndexFile(abs, 'iteration', '迭代索引', iterName);
        menus.push(...items);
    }

    // 2. 源文件子模块 index（governance.config.json 的 moduleRoots；空则按 platforms 自动发现一级子目录）
    const moduleRoots = GOVERNANCE.moduleRoots.length
        ? GOVERNANCE.moduleRoots
        : discoverModuleRoots();
    for (const r of moduleRoots) {
        const abs = path.join(ROOT, r.dir, 'index.html');
        if (!fs.existsSync(abs)) continue;
        const items = scanIndexFile(abs, 'source', '源文件', r.label);
        menus.push(...items);
    }

    // 建立 docId → pageFile 全局映射（供 docs 扫描用）
    buildGlobalDocIdMap(moduleRoots);

    // 3. docs.js（governance.config.json 的 docsDirs；空则按 moduleRoots 自动发现 js/docs.js）
    const docsDirs = GOVERNANCE.docsDirs.length
        ? GOVERNANCE.docsDirs
        : moduleRoots.map((r) => `${r.dir}/js`).filter((d) => fs.existsSync(path.join(ROOT, d, 'docs.js')));
    for (const d of docsDirs) {
        const abs = path.join(ROOT, d, 'docs.js');
        if (!fs.existsSync(abs)) continue;
        const items = scanDocsFile(abs);
        docs.push(...items);
    }

    // 输出：仅当菜单或文档内容变化时刷新 builtAt，避免 pre-push 因时间戳反复创建提交。
    const payloadContent = {
        menus,
        docs,
    };
    if (!payloadContentChanged(payloadContent)) {
        console.log('索引构建完成：');
        console.log('  菜单项：' + menus.length);
        console.log('  文档数：' + docs.length);
        console.log('  输出：' + path.relative(ROOT, OUTPUT));
        console.log('  内容无变化，保持现有 builtAt');
        return;
    }

    const payload = Object.assign({ builtAt: new Date().toISOString() }, payloadContent);
    const js = SEARCH_INDEX_PREFIX + JSON.stringify(payload, null, 2) + SEARCH_INDEX_SUFFIX;
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, js, 'utf8');

    console.log('索引构建完成：');
    console.log('  菜单项：' + menus.length);
    console.log('  文档数：' + docs.length);
    console.log('  输出：' + path.relative(ROOT, OUTPUT));
}

main();
