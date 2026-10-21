import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitInit, gitStatus, gitCommit, gitPush } from '../src/index.js';
import { tempRoot, onboard } from './helpers.js';

process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || 'Proto Harness Test';
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || 'test@example.invalid';
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || 'Proto Harness Test';
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || 'test@example.invalid';

test('Git 初始化、状态与按选择提交', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  let status = await gitStatus(store.root);
  assert.equal(status.isRepo, false);
  status = await gitInit(store.root);
  assert.equal(status.isRepo, true);
  assert.ok(status.files.some((file) => file.path === 'project.json'));
  const committed = await gitCommit(store.root, {
    paths: ['project.json', 'brain', 'requirements', 'README.md', '.gitignore'],
    message: 'feat: 初始业务基线'
  });
  assert.match(committed.hash, /^[a-f0-9]+$/);
  status = await gitStatus(store.root);
  assert.equal(status.clean, true);
  assert.ok(status.last_commit);
});

test('拒绝提交 .runtime 与越界路径', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  await gitInit(store.root);
  await assert.rejects(() => gitCommit(store.root, {
    paths: ['.runtime/index.json'], message: 'test'
  }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(() => gitCommit(store.root, {
    paths: ['../outside'], message: 'test'
  }), (error) => error.code === 'INVALID_INPUT' || error.code === 'PATH_OUTSIDE_PROJECT');
});

test('没有远端时推送返回可解释错误', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  await gitInit(store.root);
  await gitCommit(store.root, { paths: ['project.json'], message: 'init' });
  await assert.rejects(() => gitPush(store.root), (error) => error.code === 'GIT_FAILED' && /origin/.test(error.message));
});

test('提交后可以推送到已配置的 bare 远端', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  await gitInit(store.root);
  await gitCommit(store.root, { paths: ['project.json', 'brain'], message: 'feat: 初始提交' });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pha-bare-'));
  execFileSync('git', ['init', '--bare', bare]);
  execFileSync('git', ['-C', store.root, 'remote', 'add', 'origin', bare]);
  const result = await gitPush(store.root);
  assert.ok(result.status.remote);
  assert.equal(result.status.ahead, 0);
  const refs = execFileSync('git', ['--git-dir', bare, 'show-ref']).toString();
  assert.match(refs, /refs\/heads\/main/);
});
