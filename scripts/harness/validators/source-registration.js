'use strict';

// H03B：Source-Registration 验证器（源页面入口闭环）。
// 判定规则来源：harness/03-任务契约.md（新增页面与目录引用契约）+ DEVELOPMENT.md 第46-66条。
// 纯函数：只解析传入的 sourceDir 图谱对象，不读取文件系统、不执行 git 命令。
//
// 五项判定（全部为 true 才 pass）：
//   menu           —— menuItems 存在 pageId 条目（源目录真实注册）
//   carrier        —— iframeCarriers 存在 pageId 条目（页面承载区）
//   pageNames      —— pageNames[pageId] 存在且非空
//   monthTag       —— menuItems 该条目 monthTag 匹配 /^\d{6}[上下]$/（如 202608上/下）
//   notIterationOnly—— pageId 不在 iterationRefs，或同时在 menuItems（迭代引用不覆盖真实注册）

const MONTH_TAG_PATTERN = /^\d{6}[上下]$/;

function checkSourceRegistration({ sourceDir, pageId }) {
  if (!sourceDir || typeof sourceDir !== 'object') throw new Error('H03B_SRC sourceDir required');
  if (typeof pageId !== 'string' || pageId.length === 0) throw new Error('H03B_SRC pageId required');

  const menuItems = Array.isArray(sourceDir.menuItems) ? sourceDir.menuItems : [];
  const carriers = Array.isArray(sourceDir.iframeCarriers) ? sourceDir.iframeCarriers : [];
  const pageNames = sourceDir.pageNames && typeof sourceDir.pageNames === 'object' ? sourceDir.pageNames : {};
  const iterationRefs = Array.isArray(sourceDir.iterationRefs) ? sourceDir.iterationRefs : [];

  const menuItem = menuItems.find((item) => item && item.pageId === pageId) || null;
  const carrierItem = carriers.find((item) => item && item.pageId === pageId) || null;

  const checks = { menu: false, carrier: false, pageNames: false, monthTag: false, notIterationOnly: false };
  const violations = [];

  // menu
  if (menuItem) {
    checks.menu = true;
  } else {
    violations.push('缺菜单项');
  }

  // carrier
  if (carrierItem) {
    checks.carrier = true;
  } else {
    violations.push('缺 iframe 承载区');
  }

  // pageNames
  const pageNameValue = pageNames[pageId];
  if (typeof pageNameValue === 'string' && pageNameValue.length > 0) {
    checks.pageNames = true;
  } else {
    violations.push('pageNames 缺对应 pageId');
  }

  // monthTag
  if (menuItem && typeof menuItem.monthTag === 'string' && MONTH_TAG_PATTERN.test(menuItem.monthTag)) {
    checks.monthTag = true;
  } else {
    violations.push('月份标签格式不合法或缺失');
  }

  // notIterationOnly：pageId 只出现在 iterationRefs 且不在 menuItems → 仅迭代引用
  const inIteration = iterationRefs.includes(pageId);
  if (inIteration && !menuItem) {
    checks.notIterationOnly = false;
    violations.push('仅迭代引用（pageId 只在 iterationRefs，非源目录真实注册）');
  } else {
    checks.notIterationOnly = true;
  }

  const verdict = Object.values(checks).every((value) => value === true) ? 'pass' : 'fail';
  return { verdict, checks, violations };
}

module.exports = {
  MONTH_TAG_PATTERN,
  checkSourceRegistration
};
