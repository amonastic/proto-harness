'use strict';

// 治理机制运行时产物根目录解析（日志 / diff / 对比报告 / 准入矩阵）。
//
// 默认落在 `.harness-runtime`。可用 HARNESS_RUNTIME_ROOT 环境变量改写为相对项目根的
// 其它目录：测试文件各自指定独立命名空间，避免并发执行时互相覆盖或删掉对方产物。
// node --test 为每个测试文件起独立进程，因此进程级环境变量即可完成隔离。
//
// HARNESS_SHADOW_ROOT 单独覆盖 shadow 子树，仅用于把日志产物与准入矩阵分开隔离的场景；
// 未设置时由 runtimeRoot() 派生，保持默认路径 `.harness-runtime/shadow` 不变。

const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_RUNTIME_ROOT = '.harness-runtime';
const DEFAULT_SHADOW_ROOT = '.harness-runtime/shadow';

// 只接受项目根内部的相对路径，拒绝 `..` 逃逸与绝对路径。
function sanitizeOverride(value, fallback) {
  if (!value) return fallback;
  const rel = path.posix.normalize(value.replace(/\\/g, '/').replace(/^\/+/, ''));
  if (rel === '.' || rel === '' || rel.startsWith('..') || path.isAbsolute(value)) {
    throw new Error(`runtime root override must stay inside the project root: ${value}`);
  }
  return rel;
}

function runtimeRoot() {
  return sanitizeOverride(process.env.HARNESS_RUNTIME_ROOT, DEFAULT_RUNTIME_ROOT);
}

function shadowRoot() {
  const override = sanitizeOverride(process.env.HARNESS_SHADOW_ROOT, null);
  return override || path.posix.join(runtimeRoot(), 'shadow');
}

function qualificationPath(provider) {
  return path.posix.join(runtimeRoot(), 'qualification', `${provider}.json`);
}

function runtimePath(...segments) {
  return path.join(HOST_ROOT, runtimeRoot(), ...segments);
}

function shadowPath(...segments) {
  return path.join(HOST_ROOT, shadowRoot(), ...segments);
}

module.exports = {
  DEFAULT_RUNTIME_ROOT,
  DEFAULT_SHADOW_ROOT,
  runtimeRoot,
  shadowRoot,
  qualificationPath,
  runtimePath,
  shadowPath,
  HOST_ROOT
};
