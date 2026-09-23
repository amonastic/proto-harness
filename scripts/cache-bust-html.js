#!/usr/bin/env node

/**
 * cache-bust-html.js
 *
 * 为 HTML 文件中引用的本地 .css/.js 资源追加/更新 ?v= 版本号。
 * 本脚本会清理本地 .html 链接上已有的 ?v=，但不会给 .html 链接写入版本号；
 * 否则页面间互相引用会让入口页、迭代索引和历史页产生链式 diff。
 *
 * 两种模式：
 *   1. 内容 hash 模式（默认）：?v=<资源文件内容 hash 前 8 位>
 *      资源文件未改动时 hash 不变，HTML 的 ?v= 也不变，git diff 保持干净。
 *   2. 手动指定模式：--version=XXX，所有资源统一使用该版本号（兼容旧行为）。
 *
 * 用法：
 *   node scripts/cache-bust-html.js              # 预览（内容 hash）
 *   node scripts/cache-bust-html.js --write      # 写入（内容 hash）
 *   node scripts/cache-bust-html.js --write --version=20260622170000  # 旧模式
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = path.resolve(__dirname, '..');
const write = process.argv.includes('--write');
const argVersion = process.argv.find((arg) => arg.startsWith('--version='));
const useManualVersion = !!argVersion;
const manualVersion = argVersion ? argVersion.slice('--version='.length) : null;
const SKIP_DIRS = new Set([
  '.git',
  '.claude',
  '.codex',
  '.cursor',
  '.gemini',
  '.roo',
  '.trae',
  '.windsurf',
  '.qoder',
  '.continue',
  '.opencode',
  '.codebuddy',
  'node_modules'
]);

const HASHED_EXTENSIONS = new Set(['.css', '.js']);
const CLEAN_VERSION_EXTENSIONS = new Set(['.html']);

// 资源文件内容 hash 缓存：filePath -> hash 前 8 位
const hashCache = new Map();

function walkHtmlFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkHtmlFiles(path.join(dir, entry.name), files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function shouldSkipUrl(url) {
  const value = url.trim();
  return (
    !value ||
    value.startsWith('#') ||
    value.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith('{{') ||
    value.startsWith('${')
  );
}

/**
 * 计算资源文件内容的 hash 前 8 位。
 * 如果文件不存在（如跨目录引用、外部路径），返回 null，表示跳过该资源。
 */
function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

function parseLocalUrl(url) {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
  const ext = path.extname(pathname).toLowerCase();

  return { pathname, query, hash, ext };
}

function buildUrl(pathname, query, hash) {
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}

function getResourceHash(resourcePath) {
  if (hashCache.has(resourcePath)) {
    return hashCache.get(resourcePath);
  }
  let result = null;
  try {
    if (fs.existsSync(resourcePath) && fs.statSync(resourcePath).isFile()) {
      const ext = path.extname(resourcePath).toLowerCase();
      if (HASHED_EXTENSIONS.has(ext)) {
        result = hashContent(fs.readFileSync(resourcePath));
      }
    }
  } catch (_err) {
    // 读取失败，返回 null，跳过该资源
    result = null;
  }
  hashCache.set(resourcePath, result);
  return result;
}

/**
 * 为单个 URL 追加/更新版本号。
 * - 手动模式：统一使用 manualVersion
 * - 内容 hash 模式：解析资源文件路径，计算 hash；文件不存在则保留原值
 */
function addVersion(url, htmlFileDir) {
  if (shouldSkipUrl(url)) return url;

  const { pathname, query, hash, ext } = parseLocalUrl(url);
  const params = new URLSearchParams(query);

  if (CLEAN_VERSION_EXTENSIONS.has(ext)) {
    if (!params.has('v')) return url;
    params.delete('v');
    return buildUrl(pathname, params.toString(), hash);
  }

  if (!HASHED_EXTENSIONS.has(ext)) return url;

  // 计算版本号
  let versionValue;
  if (useManualVersion) {
    versionValue = manualVersion;
  } else {
    // 解析资源文件绝对路径
    const resourcePath = path.resolve(htmlFileDir, pathname);
    versionValue = getResourceHash(resourcePath);
    if (!versionValue) {
      // 资源文件不存在，不修改该 URL
      return url;
    }
  }

  params.set('v', versionValue);
  return buildUrl(pathname, params.toString(), hash);
}

function processHtml(content, htmlFileDir) {
  return content.replace(/\b(href|src)=("|')([^"']+)\2/g, (match, attr, quote, url) => {
    const nextUrl = addVersion(url, htmlFileDir);
    if (nextUrl === url) return match;
    return `${attr}=${quote}${nextUrl}${quote}`;
  });
}

const htmlFiles = walkHtmlFiles(rootDir);
const changed = [];

for (const file of htmlFiles) {
  const original = fs.readFileSync(file, 'utf8');
  const htmlFileDir = path.dirname(file);
  const next = processHtml(original, htmlFileDir);
  if (next === original) continue;

  changed.push(path.relative(rootDir, file));
  if (write) {
    fs.writeFileSync(file, next);
  }
}

const modeDesc = useManualVersion
  ? `manual version ${manualVersion}`
  : 'content hash for CSS/JS and clean HTML links';

console.log(`${write ? 'Updated' : 'Would update'} ${changed.length} HTML file(s) with ${modeDesc}.`);
if (changed.length > 0 && changed.length <= 30) {
  for (const file of changed) {
    console.log(`- ${file}`);
  }
} else if (changed.length > 30) {
  for (const file of changed.slice(0, 20)) {
    console.log(`- ${file}`);
  }
  console.log(`... and ${changed.length - 20} more`);
}
