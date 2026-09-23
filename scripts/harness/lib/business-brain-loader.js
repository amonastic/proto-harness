'use strict';

// P8.2（2026-08-21）：业务外脑加载器。
//
// 职责：
//   1. 读取业务外脑核心文件（00-大模型入口.md + 03-需求范围判断框架.md）
//   2. 按关键词匹配业务能力卡（由需求分词 + 配置 keywords 驱动）
//   3. 模块级缓存，避免同一进程重复读盘（任务包 §6.1 自主决策）
//
// 外部路径不可读时降级：返回空文本 + warnings（不崩溃），由调用方记录 warning。
// 本文件只读外部 Obsidian 业务外脑，不写入、不修改任何外部文件。

const fs = require('fs');
const path = require('path');

const { loadGovernanceConfig } = require('../../lib/governance-config');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const brainConfig = loadGovernanceConfig(HOST_ROOT).config.businessBrain || {};
// 业务外脑根目录：governance.config.json 的 businessBrain.root（相对项目根），
// 可被环境变量 BUSINESS_BRAIN_ROOT 覆盖（绝对路径优先）。
const BRAIN_ROOT = process.env.BUSINESS_BRAIN_ROOT
  || path.resolve(HOST_ROOT, brainConfig.root || 'doc/business-brain');
const CORE_FILES = Object.freeze(brainConfig.coreFiles || ['00-大模型入口.md', '03-需求范围判断框架.md']);
const CAPABILITY_DIR = brainConfig.capabilityDir || '业务能力';
// 默认不预设业务关键词：命中完全由需求表述分词驱动；可用 businessBrain.keywords 扩展。
const DEFAULT_KEYWORDS = Object.freeze(brainConfig.keywords || []);

// 模块级缓存：同一进程内重复调用不重复读盘
const cache = {
  core: null, // { entry: string, scope: string, warnings: string[] }
  cards: null // [{ name, file, text }] 未过滤全量卡
};

function readFileSafe(relPath) {
  const fullPath = path.join(BRAIN_ROOT, relPath);
  try {
    return fs.readFileSync(fullPath, 'utf8');
  } catch (error) {
    return null;
  }
}

function exists(relPath) {
  try {
    return fs.statSync(path.join(BRAIN_ROOT, relPath)).isFile();
  } catch {
    return false;
  }
}

function listCapabilityFiles() {
  const dir = path.join(BRAIN_ROOT, CAPABILITY_DIR);
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

// 读取核心入口文件（00-大模型入口 + 03-需求范围判断框架）
// 返回 { entry, scope, warnings }；任一缺失时对应字段为空串并在 warnings 说明。
function loadBusinessBrain() {
  if (cache.core) return cache.core;

  const warnings = [];
  const entry = readFileSafe(CORE_FILES[0]);
  const scope = readFileSafe(CORE_FILES[1]);
  if (entry === null) warnings.push(`业务外脑核心文件不可读：${CORE_FILES[0]}`);
  if (scope === null) warnings.push(`业务外脑核心文件不可读：${CORE_FILES[1]}`);

  cache.core = {
    entry: entry || '',
    scope: scope || '',
    warnings
  };
  return cache.core;
}

function loadAllCapabilityCards() {
  if (cache.cards) return cache.cards;
  cache.cards = listCapabilityFiles().map((name) => {
    const text = readFileSafe(path.join(CAPABILITY_DIR, name)) || '';
    return { name: name.replace(/\.md$/, ''), file: name, text };
  });
  return cache.cards;
}

// 关键词命中判断：卡名或卡正文包含任一分词即命中
function matchText(text, terms) {
  for (const term of terms) {
    if (text.includes(term)) return true;
  }
  return false;
}

// 按关键词匹配业务能力卡。
// 参数：
//   query    —— 需求表述（分词后与默认关键词合并匹配）
//   keywords —— 可选，追加自定义关键词
// 返回：[{ name, file, matched: string[], snippet }]
function matchCapabilityCards(query, { keywords = [] } = {}) {
  const queryTerms = String(query || '')
    .split(/[\s，。、,;；/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const terms = [...new Set([...DEFAULT_KEYWORDS, ...keywords, ...queryTerms])];

  const matched = [];
  for (const card of loadAllCapabilityCards()) {
    const text = card.text || '';
    const hits = terms.filter((term) => card.name.includes(term) || text.includes(term));
    if (hits.length === 0) continue;
    const firstLine = text.split('\n').find((line) => line.startsWith('# ')) || '';
    matched.push({
      name: card.name,
      file: card.file,
      matched: hits,
      snippet: firstLine.replace(/^#\s*/, '').slice(0, 80)
    });
  }
  return matched;
}

module.exports = {
  BRAIN_ROOT,
  DEFAULT_KEYWORDS,
  loadBusinessBrain,
  matchCapabilityCards,
  loadAllCapabilityCards
};
