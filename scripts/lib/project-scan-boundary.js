const path = require('path');
const { execFileSync } = require('child_process');

const BOUNDARY_VERSION = 'project-scan-boundary-v1';

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function readGitlinkRoots(root) {
  let output;
  try {
    output = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-s', '-z'], {
      cwd: root,
      encoding: 'utf8'
    });
  } catch (_) {
    return [];
  }

  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.match(/^160000\s+[a-f0-9]{40}\s+\d+\t(.+)$/))
    .filter(Boolean)
    .map((match) => toPosix(match[1]).replace(/\/$/, ''))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function isNestedClaudeWorktree(relativePath) {
  const parts = toPosix(relativePath).split('/').filter(Boolean);
  return parts.some((part, index) => part === '.claude' && parts[index + 1] === 'worktrees');
}

function createProjectScanBoundary(root) {
  const gitlinkRoots = readGitlinkRoots(root);

  function relative(fullPath) {
    return toPosix(path.relative(root, fullPath));
  }

  function isInsideGitlink(relativePath) {
    const rel = toPosix(relativePath).replace(/\/$/, '');
    return gitlinkRoots.some((gitlink) => rel === gitlink || rel.startsWith(`${gitlink}/`));
  }

  function shouldSkipPath(fullPath) {
    const rel = relative(fullPath);
    const name = path.basename(fullPath);
    return name === '.git'
      || name === 'node_modules'
      || isNestedClaudeWorktree(rel)
      || isInsideGitlink(rel);
  }

  return {
    version: BOUNDARY_VERSION,
    gitlinkRoots,
    shouldSkipDirectory: shouldSkipPath,
    shouldSkipPath
  };
}

module.exports = {
  BOUNDARY_VERSION,
  createProjectScanBoundary,
  isNestedClaudeWorktree,
  readGitlinkRoots,
  toPosix
};
