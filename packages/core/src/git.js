import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fail, isInside, toPosix } from './util.js';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;

async function runGit(root, args, { allowFailure = false, trim = true } = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: root,
      maxBuffer: MAX_BUFFER,
      timeout: 30000,
      windowsHide: true
    });
    return trim ? stdout.trim() : stdout;
  } catch (error) {
    if (allowFailure) return null;
    const detail = (error.stderr || error.message || '').trim().slice(0, 1000);
    throw fail('GIT_FAILED', `git ${args.join(' ')} 失败：${detail}`, {
      command: `git ${args.join(' ')}`,
      stderr: detail
    });
  }
}

function parsePorcelain(text) {
  const files = [];
  const records = String(text || '').split('\0').filter((record) => record.length > 0);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) continue;
    const status = record.slice(0, 2);
    const filePath = record.slice(3);
    const untracked = status === '??';
    if (status[0] === 'R' || status[0] === 'C') {
      // -z 格式：重命名/复制记录后紧跟旧路径记录
      index += 1;
    }
    files.push({
      path: filePath,
      status,
      untracked,
      staged: !untracked && status[0] !== ' ',
      unstaged: !untracked && status[1] !== ' ',
      label: untracked ? '未跟踪' : (status[0] !== ' ' ? '已暂存' : '已修改')
    });
  }
  return files;
}

export async function gitStatus(root) {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside !== 'true') {
    return {
      isRepo: false,
      clean: null,
      files: [],
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      remote: null,
      last_commit: null,
      hint: '当前项目尚未初始化 Git。可初始化后提交项目文件；密钥不会进入项目。'
    };
  }
  const branch = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true });
  const upstream = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { allowFailure: true });
  const remoteRaw = await runGit(root, ['remote', 'get-url', 'origin'], { allowFailure: true });
  const remote = remoteRaw ? remoteRaw.replace(/\/\/[^/@\s]+@/, '//***@') : null;
  const porcelain = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    allowFailure: true, trim: false
  }) || '';
  const lastCommitRaw = await runGit(root, ['log', '-1', '--format=%h%x09%s%x09%cI'], { allowFailure: true });
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await runGit(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'], { allowFailure: true });
    if (counts) {
      const [left, right] = counts.split(/\s+/).map(Number);
      behind = Number.isFinite(left) ? left : 0;
      ahead = Number.isFinite(right) ? right : 0;
    }
  }
  const files = parsePorcelain(porcelain);
  let lastCommit = null;
  if (lastCommitRaw) {
    const [hash, subject, date] = lastCommitRaw.split('\t');
    lastCommit = { hash, subject, date };
  }
  return {
    isRepo: true,
    clean: files.length === 0,
    files,
    branch: branch || null,
    upstream: upstream || null,
    ahead,
    behind,
    remote: remote || null,
    last_commit: lastCommit,
    changed_count: files.length,
    hint: remote
      ? '提交只包含你选择的项目文件；推送不会使用强制参数。'
      : '尚未配置远端；可先本地提交，或使用已有 Git 凭据添加 origin。'
  };
}

function validatePaths(root, paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw fail('INVALID_INPUT', '请选择至少一个要提交的文件');
  }
  return paths.map((item) => {
    const normalized = toPosix(String(item || '')).replace(/^\/+/, '');
    if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw fail('INVALID_INPUT', `提交路径非法：${item}`);
    }
    if (normalized === '.runtime' || normalized.startsWith('.runtime/')) {
      throw fail('INVALID_INPUT', '.runtime 是可重建运行目录，不能提交');
    }
    const abs = path.resolve(root, normalized);
    if (!isInside(root, abs)) throw fail('PATH_OUTSIDE_PROJECT', `路径越出项目：${item}`);
    return normalized;
  });
}

export async function gitInit(root) {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside === 'true') return gitStatus(root);
  await runGit(root, ['init', '-b', 'main'], { allowFailure: true });
  const check = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (check !== 'true') {
    await runGit(root, ['init'], { allowFailure: true });
  }
  return gitStatus(root);
}

export async function gitCommit(root, { paths, message }) {
  if (!String(message || '').trim()) throw fail('INVALID_INPUT', '提交信息不能为空');
  const safePaths = validatePaths(root, paths);
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside !== 'true') throw fail('GIT_FAILED', '当前项目尚未初始化 Git');
  await runGit(root, ['add', '--', ...safePaths]);
  const stagedRaw = await runGit(
    root,
    ['diff', '--cached', '--name-status', '-z', '--find-renames'],
    { allowFailure: true, trim: false }
  );
  const records = String(stagedRaw || '').split('\0').filter(Boolean);
  const selected = safePaths.map((item) => item.replace(/\/+$/, ''));
  const isSelected = (filePath) => selected.some((item) => (
    filePath === item || filePath.startsWith(`${item}/`)
  ));
  const commitPaths = [];
  for (let index = 0; index < records.length;) {
    const status = records[index];
    index += 1;
    if (/^[RC]/.test(status)) {
      const oldPath = records[index];
      const newPath = records[index + 1];
      index += 2;
      if (isSelected(oldPath) || isSelected(newPath)) {
        if (oldPath) commitPaths.push(oldPath);
        if (newPath) commitPaths.push(newPath);
      }
    } else {
      const filePath = records[index];
      index += 1;
      if (filePath && isSelected(filePath)) commitPaths.push(filePath);
    }
  }
  const uniquePaths = [...new Set(commitPaths)];
  if (uniquePaths.length === 0) throw fail('INVALID_INPUT', '所选文件没有可提交的变更');
  await runGit(root, ['commit', '-m', String(message).trim(), '--', ...uniquePaths]);
  const hash = await runGit(root, ['rev-parse', '--short', 'HEAD'], { allowFailure: true });
  const status = await gitStatus(root);
  return { hash, message: String(message).trim(), files: uniquePaths, selected_paths: safePaths, status };
}

export async function gitPush(root) {
  const status = await gitStatus(root);
  if (!status.isRepo) throw fail('GIT_FAILED', '当前项目尚未初始化 Git');
  if (!status.remote) throw fail('GIT_FAILED', '尚未配置 origin 远端，无法推送');
  if (!status.branch) throw fail('GIT_FAILED', '当前没有可推送的分支');
  let output;
  if (status.upstream) {
    output = await runGit(root, ['push']);
  } else {
    output = await runGit(root, ['push', '--set-upstream', 'origin', status.branch]);
  }
  return {
    output,
    status: await gitStatus(root)
  };
}

export async function gitHead(root) {
  const inside = await runGit(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true });
  if (inside !== 'true') return null;
  return runGit(root, ['rev-parse', '--short', 'HEAD'], { allowFailure: true });
}
