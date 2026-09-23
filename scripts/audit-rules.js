#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const mapPath = path.join(root, 'standards', 'rule-map.json');
const repoPointerPattern = (() => {
  const { config, rootsAlternation } = loadGovernanceConfig(root);
  const iterationDir = config.iterationDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:\\.\\.?\\/|\\.[a-zA-Z0-9_-]+\\/|harness\\/|standards\\/|scripts\\/|templates\\/|doc\\/|(?:${rootsAlternation})\\/|${iterationDir}\\/|AGENTS\\.md$|CLAUDE\\.md$|DEVELOPMENT\\.md$|package\\.json$)`);
})();
const hardFailures = [];
const warnings = [];

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function addHardFailure(type, detail) {
  hardFailures.push({ type, detail });
}

function addWarning(type, detail) {
  warnings.push({ type, detail });
}

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n');
}

function walk(baseDir) {
  const absBase = path.join(root, baseDir || '.');
  if (!fs.existsSync(absBase)) return [];
  const out = [];
  const stack = [absBase];

  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      if (item.name === '.git' || item.name === 'node_modules' || item.name === 'worktrees') continue;
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (item.isFile()) out.push(toPosix(path.relative(root, full)));
    }
  }

  return out;
}

function globToRegExp(pattern) {
  function translate(fragment) {
    let source = '';

    for (let index = 0; index < fragment.length; index += 1) {
      const char = fragment[index];

      if (char === '*' && fragment[index + 1] === '*') {
        if (fragment[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
        continue;
      }

      if (char === '*') {
        source += '[^/]*';
        continue;
      }

      if (char === '?') {
        source += '[^/]';
        continue;
      }

      if (char === '{') {
        const end = fragment.indexOf('}', index + 1);
        if (end !== -1) {
          const alternatives = fragment
            .slice(index + 1, end)
            .split(',')
            .map((value) => translate(value.trim()));
          source += `(?:${alternatives.join('|')})`;
          index = end;
          continue;
        }
      }

      source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }

    return source;
  }

  return new RegExp(`^${translate(pattern)}$`);
}

function globBase(pattern) {
  const wildcardIndex = pattern.search(/[?*{]/);
  const stable = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const slashIndex = stable.lastIndexOf('/');
  return slashIndex === -1 ? '.' : stable.slice(0, slashIndex) || '.';
}

function discoverFiles(discovery) {
  const found = new Set();
  for (const rule of discovery || []) {
    if (rule.kind === 'exact') {
      for (const relPath of rule.paths || []) {
        if (fs.existsSync(path.join(root, relPath))) found.add(relPath);
      }
      continue;
    }

    if (rule.kind === 'glob' && rule.pattern) {
      const matcher = globToRegExp(rule.pattern);
      for (const relPath of walk(globBase(rule.pattern))) {
        if (matcher.test(relPath)) found.add(relPath);
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function stripFrontmatter(content) {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---\n', 4);
  return end === -1 ? content : content.slice(end + 5);
}

function normalizeMirrorBody(content) {
  return stripFrontmatter(content)
    .split('\n')
    .filter((line) => !/^> 生成自 .+，勿直接编辑；修改请改母本后同步。$/.test(line.trim()))
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function compareMirrors(ruleMap) {
  for (const group of ruleMap.mirrorGroups || []) {
    const sourceAbs = path.join(root, group.source);
    if (!fs.existsSync(sourceAbs)) {
      addHardFailure('镜像母本缺失', `${group.id}: ${group.source}`);
      continue;
    }

    const sourceContent = readText(group.source);
    for (const mirror of group.mirrors || []) {
      const mirrorAbs = path.join(root, mirror);
      if (!fs.existsSync(mirrorAbs)) {
        addHardFailure('镜像缺失', `${group.id}: ${mirror}`);
        continue;
      }

      const mirrorContent = readText(mirror);
      const same = group.comparison === 'normalized-body'
        ? normalizeMirrorBody(sourceContent) === normalizeMirrorBody(mirrorContent)
        : sourceContent === mirrorContent;
      if (!same) addHardFailure('镜像漂移', `${group.id}: ${mirror} != ${group.source}`);
    }
  }
}

function shouldIgnorePointer(candidate, line) {
  if (!candidate) return true;
  if (/^(https?:|file:|mailto:|app:|skill:|npm:)/.test(candidate)) return true;
  if (/[/\\][*?]|[{}<>$]|\.\.\.|\[.+\]|YYYY|2026MM/.test(candidate)) return true;
  if (/^(node|npm|git|rg|jq)\b/.test(candidate)) return true;
  if (/不存在|未落地|不得新建|不新建|禁止新增|示例|例如|候选路径|目标目录|acceptable|avoid/i.test(line)) return true;
  return false;
}

function normalizePointer(raw) {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[，。；：、,;:）)]+$/g, '')
    .replace(/\?.*$/, '')
    .replace(/#[^/]*$/, '');
}

function looksLikeRepoPointer(candidate) {
  return repoPointerPattern.test(candidate);
}

function resolvePointer(sourceRel, candidate) {
  if (candidate.startsWith('./') || candidate.startsWith('../')) {
    return toPosix(path.normalize(path.join(path.dirname(sourceRel), candidate)));
  }
  return toPosix(path.normalize(candidate));
}

function checkDeadPointers(ruleMap) {
  for (const entry of ruleMap.files || []) {
    if (entry.role === 'archived' || entry.layer === '流程') continue;
    if (!/\.(?:md|mdc)$/.test(entry.path)) continue;
    const abs = path.join(root, entry.path);
    if (!fs.existsSync(abs)) continue;

    const lines = readText(entry.path).split('\n');
    lines.forEach((line, index) => {
      const candidates = [];
      for (const match of line.matchAll(/`([^`\n]+)`/g)) candidates.push(match[1]);
      for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) candidates.push(match[1]);

      for (const raw of candidates) {
        const candidate = normalizePointer(raw);
        if (shouldIgnorePointer(candidate, line) || !looksLikeRepoPointer(candidate)) continue;
        if (/\s/.test(candidate)) continue;
        const resolved = resolvePointer(entry.path, candidate);
        if (!fs.existsSync(path.join(root, resolved))) {
          addWarning('死指针', `${entry.path}:${index + 1}: ${candidate}`);
        }
      }
    });
  }
}

function validateMap(ruleMap) {
  const registered = new Set();
  for (const entry of ruleMap.files || []) {
    if (!entry.path || !entry.layer || !entry.role) {
      addHardFailure('地图结构错误', JSON.stringify(entry));
      continue;
    }
    if (registered.has(entry.path)) addHardFailure('地图重复登记', entry.path);
    registered.add(entry.path);
    if (!fs.existsSync(path.join(root, entry.path))) addHardFailure('登记路径失效', entry.path);
    if (entry.role === 'mirror' && !entry.source) addHardFailure('镜像缺少 source', entry.path);
  }

  for (const relPath of discoverFiles(ruleMap.discovery)) {
    if (!registered.has(relPath)) addWarning('未登记规则文件', relPath);
  }
}

function printReport(ruleMap) {
  console.log(`[audit-rules] registered ${ruleMap.files?.length || 0} rule file(s)`);
  console.log(`[audit-rules] checked ${ruleMap.mirrorGroups?.length || 0} mirror group(s)`);

  if (warnings.length) {
    console.warn(`[audit-rules] ${warnings.length} warning(s)`);
    warnings.forEach((item) => console.warn(`WARN ${item.type}: ${item.detail}`));
  }

  if (hardFailures.length) {
    console.error(`[audit-rules] ${hardFailures.length} hard failure(s)`);
    hardFailures.forEach((item) => console.error(`ERROR ${item.type}: ${item.detail}`));
    process.exitCode = 1;
    return;
  }

  console.log('[audit-rules] found 0 hard failures');
}

(function main() {
  if (!fs.existsSync(mapPath)) {
    console.error('[audit-rules] missing standards/rule-map.json');
    process.exit(1);
  }

  let ruleMap;
  try {
    ruleMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (error) {
    console.error(`[audit-rules] invalid rule map: ${error.message}`);
    process.exit(1);
  }

  validateMap(ruleMap);
  compareMirrors(ruleMap);
  checkDeadPointers(ruleMap);
  printReport(ruleMap);
})();
