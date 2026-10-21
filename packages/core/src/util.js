import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(input, fallback = 'item', max = 40) {
  const cleaned = String(input || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return cleaned || fallback;
}

export function shortHash(value, length = 6) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

export function makeId(prefix, label, entropy = 5) {
  const slug = slugify(label, 'item', 28).toUpperCase();
  const tail = crypto.randomBytes(4).toString('hex').slice(0, entropy).toUpperCase();
  return `${prefix}-${slug}-${tail}`;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function atomicWriteText(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function atomicWriteJson(filePath, value) {
  atomicWriteText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readJsonIfExists(filePath, fallback = null) {
  try {
    return readJson(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function safeResolve(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!isInside(root, resolved)) {
    const error = new Error(`路径越出项目目录：${relativePath}`);
    error.code = 'PATH_OUTSIDE_PROJECT';
    throw error;
  }
  return resolved;
}

export function relativeTo(root, target) {
  return toPosix(path.relative(root, target));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function clampText(value, max = 4000) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字）`;
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function stripMarkdown(value) {
  return String(value || '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#>*_`[\]]/g, '')
    .replace(/\(([^)]+)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: String(text || '') };
  const data = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) data[key] = raw;
  }
  return { data, body: String(text || '').slice(match[0].length) };
}

export function compactJoin(parts, separator = ' · ') {
  return parts.filter(Boolean).join(separator);
}

export function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`缺少必填字段：${field}`);
    error.code = 'INVALID_INPUT';
    error.details = { field };
    throw error;
  }
}

export function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}
