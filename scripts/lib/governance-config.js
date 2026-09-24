#!/usr/bin/env node
/**
 * governance.config.json 读取层
 *
 * 消费方在项目根放置 governance.config.json 声明自身的平台目录、
 * 迭代目录与扫描清单；未提供时回退到内置默认（即仓根本仓库自带的虚构三端示例）。
 * 字段说明参考仓根 governance.config.example.json 与 docs/README.md 的接入指南。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  version: 1,
  platforms: [
    { key: 'web', root: 'admin-portal', label: '管理后台' },
    { key: 'app', root: 'field-app', label: '移动端 App' },
    { key: 'miniapp', root: 'mini-program', label: '小程序' }
  ],
  iterationDir: '迭代索引',
  scratchDir: '零散设计',
  moduleRoots: [],
  docsDirs: [],
  scopedTargets: [],
  allTargets: [],
  snapshotAudit: { protectedPages: [], protectedIds: [] },
  excludedDirs: [],
  businessBrain: {
    root: 'doc/business-brain',
    coreFiles: ['00-大模型入口.md', '03-需求范围判断框架.md'],
    capabilityDir: '业务能力',
    keywords: []
  }
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadGovernanceConfig(root) {
  const configPath = path.join(root, 'governance.config.json');
  let userConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.warn(`[governance-config] 解析失败，回退内置默认：${error.message}`);
    }
  }
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  config.snapshotAudit = { ...DEFAULT_CONFIG.snapshotAudit, ...(userConfig.snapshotAudit || {}) };

  const platformRoots = config.platforms.map((item) => item.root);
  const rootsAlternation = platformRoots.map(escapeRegExp).join('|');

  function inferPlatform(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    const hit = config.platforms.find((item) => norm === item.root || norm.startsWith(`${item.root}/`));
    return hit ? hit.key : 'mixed';
  }

  function isPortalIndexPath(relPath) {
    const norm = relPath.replace(/\\/g, '/');
    return platformRoots.some((rootDir) => norm === `${rootDir}/index.html`);
  }

  function scanTargets(options = {}) {
    const targets = [...platformRoots];
    if (options.includeIteration) targets.unshift(config.iterationDir);
    return targets;
  }

  return {
    config,
    platformRoots,
    rootsAlternation,
    inferPlatform,
    isPortalIndexPath,
    scanTargets
  };
}

module.exports = { loadGovernanceConfig, DEFAULT_CONFIG };
