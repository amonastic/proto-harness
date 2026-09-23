#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createProjectScanBoundary } = require('./lib/project-scan-boundary');
const { loadGovernanceConfig } = require('./lib/governance-config');

const root = process.cwd();
const scanBoundary = createProjectScanBoundary(root);
const { config: governance, scanTargets } = loadGovernanceConfig(root);
const scopedTargets = governance.scopedTargets || [];
const allTargets = (governance.allTargets && governance.allTargets.length)
  ? governance.allTargets
  : [...scanTargets({ includeIteration: true }), 'doc', 'standards'];
const scanAll = process.argv.includes('--all');

const allowedExampleMarker = 'audit:allow-version-rule-example';
const forbidden = [
  '本期新增｜',
  '本期调整｜',
  '本期变更｜',
  '[本期新增]',
  '[本期调整]',
  '[本期变更]'
];

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function walk(dir) {
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
        if (item.name.startsWith('.')) continue;
        stack.push(full);
      } else if (item.isFile() && /\.(html|js|md|json)$/.test(item.name)) {
        out.push(toPosix(path.relative(root, full)));
      }
    }
  }
  return out;
}

function lineAllowed(lines, index) {
  const from = Math.max(0, index - 2);
  const to = Math.min(lines.length, index + 3);
  return lines.slice(from, to).some((line) => line.includes(allowedExampleMarker));
}

const files = (scanAll ? allTargets.flatMap(walk) : scopedTargets)
  .filter((rel) => fs.existsSync(path.join(root, rel)))
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));
const issues = [];

for (const rel of files) {
  if (rel.startsWith('迭代索引/snapshots/')) continue;
  const content = fs.readFileSync(path.join(root, rel), 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (lineAllowed(lines, index)) return;
    for (const word of forbidden) {
      if (line.includes(word)) {
        issues.push({
          file: rel,
          line: index + 1,
          detail: `版本标签禁止动作前缀：${word}`
        });
      }
    }
  });
}

if (issues.length) {
  console.error(`[audit-version-tags] found ${issues.length} issue(s)`);
  issues.slice(0, 80).forEach((issue) => {
    console.error(`${issue.file}:${issue.line}: ${issue.detail}`);
  });
  if (issues.length > 80) {
    console.error(`[audit-version-tags] ... ${issues.length - 80} more`);
  }
  process.exit(1);
}

console.log(`[audit-version-tags] scanned ${files.length} files`);
console.log('[audit-version-tags] found 0 issues');
