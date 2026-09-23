'use strict';

// H03D：Experience-Proof 验证器（体验证明：入口/触发/DOM/截图四要素）。
// 判定规则来源：harness/03-任务契约.md 验证方式（DOM 断言、截图要素）+ AGENTS.md 可见改动证据闭环。
// 纯函数：只解析传入的 proof 对象，不访问真实浏览器、不检查截图文件存在性、不执行 git 命令。
//
// 五项判定（全部为 true 才 pass）：
//   entryBound         —— entryPath 非空非 null（真实入口路径）
//   triggerBound       —— triggerAction 非空非 null（触发动作）
//   domAsserted        —— domAssertions 长度 > 0（DOM 断言）
//   screenshotRecorded —— screenshotPath 非空非 null（截图路径记录）
//   notSyntaxOnly      —— checkType 不为 'syntax-only'/'search-only'（语法/搜索检查不等于可见效果已验证）

const SYNTAX_ONLY_TYPES = Object.freeze(['syntax-only', 'search-only']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function checkExperienceProof({ proof }) {
  if (!proof || typeof proof !== 'object') throw new Error('H03D_PROOF proof required');

  const checks = { entryBound: false, triggerBound: false, domAsserted: false, screenshotRecorded: false, notSyntaxOnly: false };
  const violations = [];

  // entryBound
  if (isNonEmptyString(proof.entryPath)) {
    checks.entryBound = true;
  } else {
    violations.push('缺真实入口路径');
  }

  // triggerBound
  if (isNonEmptyString(proof.triggerAction)) {
    checks.triggerBound = true;
  } else {
    violations.push('缺触发动作');
  }

  // domAsserted
  if (Array.isArray(proof.domAssertions) && proof.domAssertions.length > 0) {
    checks.domAsserted = true;
  } else {
    violations.push('缺 DOM 断言');
  }

  // screenshotRecorded
  if (isNonEmptyString(proof.screenshotPath)) {
    checks.screenshotRecorded = true;
  } else {
    violations.push('缺截图路径记录');
  }

  // notSyntaxOnly
  if (!SYNTAX_ONLY_TYPES.includes(proof.checkType)) {
    checks.notSyntaxOnly = true;
  } else {
    violations.push('检查类型不合格（语法/搜索检查不等于用户可见效果已验证）');
  }

  const verdict = Object.values(checks).every((value) => value === true) ? 'pass' : 'fail';
  return { verdict, checks, violations };
}

module.exports = {
  SYNTAX_ONLY_TYPES,
  checkExperienceProof
};
