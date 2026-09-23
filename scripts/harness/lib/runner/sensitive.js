'use strict';

// H02：敏感字段判定（等价独立实现，对齐 scripts/harness/validate-contract.js 中
// CT-07/CT-20 已验证的 SENSITIVE_PATTERNS + findSensitiveFields 逻辑）。
// 用途：运行产物（Trace/Result/Checkpoint 序列化前）含敏感字段时，写盘前拒绝并保留拒绝事件。

const SENSITIVE_PATTERNS = [
  /token/i, /api[_-]?key/i, /secret/i, /password/i, /passwd/i, /cookie/i,
  /authorization/i, /credential/i, /bearer\s+/i, /chain[_-]?of[_-]?thought/i,
  /hidden[_-]?thinking/i, /raw[_-]?chat/i, /access[_-]?token/i
];

// 递归收集敏感字段路径；无敏感返回空数组。
// 等价独立实现对齐 H01（CT-07/CT-20）的值模式判定，并在此基础上同时检测字段名
// （H02 写盘防护语义：名为 api_key/token 等的字段即使值为普通串也属敏感字段，不得落盘）。
function findSensitiveFields(value, pathName, findings) {
  if (typeof value === 'string') {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) findings.push(pathName);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) findSensitiveFields(item, `${pathName}[${index}]`, findings);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const keyPath = `${pathName}.${key}`;
      if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))) findings.push(keyPath);
      findSensitiveFields(value[key], keyPath, findings);
    }
  }
}

function hasSensitiveFields(value) {
  const findings = [];
  findSensitiveFields(value, '', findings);
  return findings;
}

module.exports = {
  SENSITIVE_PATTERNS,
  findSensitiveFields,
  hasSensitiveFields
};
