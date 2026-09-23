'use strict';

// H03A：Dirty-Scope 验证器（Dirty 范围验证器）。
// 规则唯一来源：harness/01-强制闸门.md 第 15 条（脏工作区保护五分层）。
// 纯函数：只解析传入的 statusOutput 字符串，不执行真实 git 命令、不读取文件系统。
//
// 分层（与第 15 条五分层模板一一对应）：
//   target        —— 出现在 statusOutput 且属于 targetFiles 的文件（本轮允许暂存）
//   readonly      —— targetFiles 中以 "ro:" 前缀声明的"依赖但不修改"文件；出现在 Modified 中即违规
//   existing_dirty—— 出现在 statusOutput 但不在 targetFiles 内的已跟踪 Modified 文件（列出，不提交不清理）
//   high_risk     —— 命中任一 forbiddenGlobs 模式的文件；出现即违规
//   untracked     —— statusOutput 中以 ?? 开头的文件（列出，不暂存）
//
// 判定：high_risk 非空 或 readonly 被改 → verdict 'fail'；否则 'pass'。
// 冲突优先：同一文件同时命中 target 与 forbiddenGlobs → high_risk 优先（D00-08）。

// ---- 最小 glob 匹配（纯函数，无外部依赖）----
// 支持：*（段内任意字符，不含 /）、**（跨段）、?（单字符，不含 /）。
function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, '/');
  let pattern = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        // **：跨段任意（含空）
        pattern += '(?:.*/)?[^/]*';
        if (normalized[i + 2] === '/') {
          pattern += '.*';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
    } else if (ch === '?') {
      pattern += '[^/]';
    } else if ('.+^$()[]{}|\\'.includes(ch)) {
      pattern += `\\${ch}`;
    } else {
      pattern += ch;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function matchesAnyGlob(filePath, globs) {
  return globs.some((glob) => {
    if (typeof glob !== 'string' || glob.length === 0) return false;
    return globToRegExp(glob).test(filePath);
  });
}

// 解析 git status --short 输出。返回 [{ index, worktree, path }]。
// 行格式：XY path（X=index/staged 状态，Y=worktree 状态）或 "?? path"。
function parseStatusOutput(statusOutput) {
  const entries = [];
  if (typeof statusOutput !== 'string' || statusOutput.length === 0) return entries;
  for (const rawLine of statusOutput.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    const untracked = line.startsWith('?? ');
    if (untracked) {
      entries.push({ index: '?', worktree: '?', path: line.slice(3), untracked: true });
      continue;
    }
    const code = line.slice(0, 2);
    const path = line.slice(3);
    if (code.length < 2 || path.length === 0) continue;
    entries.push({ index: code[0], worktree: code[1], path, untracked: false });
  }
  return entries;
}

function isModified(entry) {
  return !entry.untracked && (entry.index === 'M' || entry.index === 'A' || entry.worktree === 'M' || entry.index === 'R');
}

// 判定 Dirty 范围。
// 输入：{ statusOutput: string, targetFiles: string[], forbiddenGlobs: string[] }
//  targetFiles 条目支持 "ro:<path>" 前缀声明 readonly（依赖但不修改）文件。
// 输出：{ layers: { target, readonly, existing_dirty, high_risk, untracked }, verdict: 'pass'|'fail', violations: string[] }
function checkDirtyScope({ statusOutput, targetFiles, forbiddenGlobs }) {
  const targets = Array.isArray(targetFiles) ? targetFiles : [];
  const globs = Array.isArray(forbiddenGlobs) ? forbiddenGlobs : [];

  const readonlyFiles = new Set();
  const writableTargets = new Set();
  for (const entry of targets) {
    if (typeof entry !== 'string') continue;
    if (entry.startsWith('ro:')) {
      readonlyFiles.add(entry.slice(3));
    } else {
      writableTargets.add(entry);
    }
  }

  const normalize = (value) => value.replace(/^\.\//, '').replace(/\/+$/, '');
  const targetSet = new Set([...writableTargets].map(normalize));
  const readonlySet = new Set([...readonlyFiles].map(normalize));

  const layers = { target: [], readonly: [], existing_dirty: [], high_risk: [], untracked: [] };
  const violations = [];

  for (const entry of parseStatusOutput(statusOutput)) {
    const path = normalize(entry.path);

    // high_risk 优先（D00-08：同时命中 target 与 forbiddenGlobs → high_risk 且 fail）
    if (matchesAnyGlob(path, globs)) {
      layers.high_risk.push(entry.path);
      violations.push(`high_risk 命中禁止模式：${entry.path}`);
      continue;
    }

    if (entry.untracked) {
      layers.untracked.push(entry.path);
      continue;
    }

    if (readonlySet.has(path)) {
      if (isModified(entry)) {
        layers.readonly.push(entry.path);
        violations.push(`readonly 文件被修改：${entry.path}`);
      } else {
        layers.readonly.push(entry.path);
      }
      continue;
    }

    if (targetSet.has(path)) {
      layers.target.push(entry.path);
      continue;
    }

    if (isModified(entry)) {
      layers.existing_dirty.push(entry.path);
    } else {
      // 其他状态（D、U、? 等非 M 且非目标）——不归类，静默保留
    }
  }

  const verdict = violations.length > 0 ? 'fail' : 'pass';
  return { layers, verdict, violations };
}

module.exports = {
  globToRegExp,
  matchesAnyGlob,
  parseStatusOutput,
  checkDirtyScope
};
