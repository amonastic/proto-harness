'use strict';

// P6/H10A：Diff 生成器。
// 契约（任务包 §8.2）：diff 必须使用 git diff 标准格式（unified diff），不得发明自定义格式。
// 提取来源：模型输出中的 ```diff ... ``` 围栏块，或 --- / +++ 起始的 unified diff 文本块。

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const { shadowRoot, DEFAULT_SHADOW_ROOT: SHADOW_ROOT } = require('./runtime-root');

// 从模型输出文本提取 unified diff（优先 ```diff 围栏；其次裸 ---/+++ 块）
function extractDiff(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```diff\s*\n([\s\S]*?)(?:```|$)/);
  if (fenced && fenced[1].trim().length > 0) {
    const candidate = fenced[1].trimEnd();
    if (looksLikeUnifiedDiff(candidate)) return candidate;
  }
  // 裸 unified diff：以 --- 或 Index: 起始的连续块
  const bare = text.match(/(?:^|\n)(---[^\n]*\n\+\+\+[^\n]*\n[\s\S]*?)(?=\n---[^\n]*\n|\n\S[^\n]*\n$|$)/);
  if (bare && looksLikeUnifiedDiff(bare[1])) return bare[1].trimEnd();
  return null;
}

function looksLikeUnifiedDiff(text) {
  const lines = text.split('\n');
  return lines.some((line) => /^---\s/.test(line)) && lines.some((line) => /^\+\+\+\s/.test(line));
}

function diffPath(provider, family, runId) {
  return path.join(HOST_ROOT, shadowRoot(), provider, family, `${runId}.diff`);
}

// 写入 .diff 文件（相对路径返回）；diffText 为空/未提取 → 不写文件，返回 null
function writeDiffFile({ provider, family, runId, diffText }) {
  const extracted = extractDiff(diffText);
  if (extracted === null) return null;
  const dir = path.join(HOST_ROOT, shadowRoot(), provider, family);
  fs.mkdirSync(dir, { recursive: true });
  const target = diffPath(provider, family, runId);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${extracted}\n`);
  fs.renameSync(tmp, target);
  return path.relative(HOST_ROOT, target);
}

module.exports = { SHADOW_ROOT, extractDiff, looksLikeUnifiedDiff, diffPath, writeDiffFile };
