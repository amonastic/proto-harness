'use strict';

// H03D：Delivery-Manifest 验证器（交付清单：遗漏/状态/cache bust/线上状态）。
// 判定规则来源：AGENTS.md 手动上传交付规则（cache bust hash 收敛、四状态区分、docs 独立数据源必列）。
// 纯函数：只解析传入的 manifest 对象与 requiredFiles 列表，不读取 git log、不检查文件系统。
//
// 四项判定（全部为 true 才 pass）：
//   allRequiredPresent   —— requiredFiles 每条至少出现在清单四个分组之一
//   statusesValid        —— 所有文件 status ∈ ['local','committed','pushed','online']
//   cacheBustValid       —— 清单含 HTML 文件时 cacheBustVerified 必须为 true
//   onlineStatusDeclared —— onlineUploadStatus 属于 ['pending','done','not-required'] 且非 undefined

const STATUS_ENUM = Object.freeze(['local', 'committed', 'pushed', 'online']);
const ONLINE_STATUS_ENUM = Object.freeze(['pending', 'done', 'not-required']);

function collectAllEntries(manifest) {
  const entries = [];
  for (const group of ['htmlFiles', 'docsDataFiles', 'entryFiles', 'sharedDeps']) {
    const list = manifest[group];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === 'object') entries.push({ ...item, _group: group });
      }
    }
  }
  return entries;
}

function checkDeliveryManifest({ manifest, requiredFiles }) {
  if (!manifest || typeof manifest !== 'object') throw new Error('H03D_MANIFEST manifest required');
  if (!Array.isArray(requiredFiles)) throw new Error('H03D_MANIFEST requiredFiles must be array');

  const checks = { allRequiredPresent: false, statusesValid: false, cacheBustValid: false, onlineStatusDeclared: false };
  const violations = [];

  const allEntries = collectAllEntries(manifest);
  const presentPaths = new Set(allEntries.map((entry) => entry.path).filter((path) => typeof path === 'string'));

  // allRequiredPresent
  const missing = requiredFiles.filter((path) => !presentPaths.has(path));
  if (missing.length === 0) {
    checks.allRequiredPresent = true;
  } else {
    for (const path of missing) violations.push(`清单遗漏文件：${path}`);
  }

  // statusesValid
  const invalidStatuses = allEntries.filter((entry) => !STATUS_ENUM.includes(entry.status)).map((entry) => entry.status);
  if (invalidStatuses.length === 0) {
    checks.statusesValid = true;
  } else {
    for (const value of [...new Set(invalidStatuses)]) violations.push(`无效状态值：${value}`);
  }

  // cacheBustValid：有 HTML 文件时 cacheBustVerified 必须 true
  const hasHtml = Array.isArray(manifest.htmlFiles) && manifest.htmlFiles.length > 0;
  if (!hasHtml) {
    checks.cacheBustValid = true; // 无 HTML 文件不适用，视为通过
  } else if (manifest.cacheBustVerified === true) {
    checks.cacheBustValid = true;
  } else {
    checks.cacheBustValid = false;
    violations.push('cache bust 未经 hash 收敛验证（版本号不等于验证通过）');
  }

  // onlineStatusDeclared
  if (ONLINE_STATUS_ENUM.includes(manifest.onlineUploadStatus)) {
    checks.onlineStatusDeclared = true;
  } else {
    checks.onlineStatusDeclared = false;
    violations.push('线上上传状态未声明');
  }

  const verdict = Object.values(checks).every((value) => value === true) ? 'pass' : 'fail';
  return { verdict, checks, violations };
}

module.exports = {
  STATUS_ENUM,
  ONLINE_STATUS_ENUM,
  checkDeliveryManifest
};
