'use strict';

// H04（P2）：Fixture 语料构建器。
// 从真实仓库按 project-scan-boundary-v1 边界扫描三端 index.html 菜单结构、docs 数据与
// 迭代索引 iframe 指向，生成 fixture 语料库（JSON 文件集合）。
//
// 契约（任务包 5.1）：
//   1. 边界：project-scan-boundary-v1（排除 .claude/worktrees/** 与 gitlink），额外排除 governance 配置 excludedDirs
//   2. 扫描三端源目录 index.html 菜单结构与 docs.js 数据
//   3. 扫描 迭代索引/*.html 的 iframe 指向，区分活页源与快照
//   4. 输出 fixture 数组：corpus_id / scenario_type / source_page / payload（验证器输入）
//   5. dirty 文件对应页面 → baseline_dirty_warning: true（不跳过不静默）
//   6. 源目录缺失 → scan_status: failed；index 无菜单 → scenario_type: malformed-index
//
// 只读扫描：不修改任何真实页面/规则文件；git status 仅用于 dirty 检测（只读）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createProjectScanBoundary } = require('../../lib/project-scan-boundary');
const { parseStatusOutput } = require('../validators/dirty-scope');
const { runValidatorFor } = require('./oracle');

const { loadGovernanceConfig } = require('../../lib/governance-config');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const { config: GOVERNANCE, platformRoots } = loadGovernanceConfig(HOST_ROOT);
const EXCLUDED_DIRS = Object.freeze(GOVERNANCE.excludedDirs || []);
const SOURCE_ROOTS = Object.freeze(platformRoots);
const ITERATION_DIR = GOVERNANCE.iterationDir;
const OUT_FILE = 'tests/harness/fixtures/corpus/corpus.json';

// ---- 纯函数解析（可测，无 I/O）----

// 提取 index.html 的菜单项：data-page 属性 + 分组月份标注。
// 真实形态（20260812 实测）：月份在分组注释/标题（<!-- 202607 --> / nav-group-title 202607），
// 格式为 YYYYMM（无上下后缀）；menuItems 如实记录，契约不符由 fixture extraction_note 说明。
function parseIndexMenu(htmlText) {
  const items = [];
  let currentMonth = null;
  const lines = htmlText.split('\n');
  for (const line of lines) {
    const monthComment = line.match(/<!--\s*(\d{6})\s*-->/);
    const monthTitle = line.match(/nav-group-title[^>]*>(\d{6})</);
    if (monthComment) currentMonth = monthComment[1];
    else if (monthTitle) currentMonth = monthTitle[1];
    const page = line.match(/data-page="([A-Za-z0-9_-]+)"/);
    if (page) {
      items.push({ pageId: page[1], monthTag: currentMonth });
    }
  }
  return items;
}

// 提取 pageNames 对象（JS 字面量形态：pageNames = { "a": "甲", ... } 或 pageNames: {...}）
function parsePageNames(htmlText) {
  const names = {};
  const blockPattern = /pageNames\s*=\s*\{([^}]*)\}/;
  const match = htmlText.match(blockPattern);
  if (match) {
    const entryPattern = /["']([A-Za-z0-9_-]+)["']\s*:\s*["']([^"']*)["']/g;
    let entry;
    while ((entry = entryPattern.exec(match[1])) !== null) {
      names[entry[1]] = entry[2];
    }
  }
  return names;
}

// 提取 iframe 承载（真实形态 20260812 实测：iframe 位于 <div id="page-<pageId>" class="page-section"> 内，
// pageId 从父容器 id 提取；无关联容器时 pageId 为 null）
function parseIframeCarriers(htmlText) {
  const carriers = [];
  const lines = htmlText.split('\n');
  let currentPageId = null;
  for (const line of lines) {
    const section = line.match(/id="page-([A-Za-z0-9_-]+)"\s+class="page-section"/);
    if (section) {
      currentPageId = section[1];
      // 不 continue：section 与 iframe 可能同行，仍需检查当行 src
    }
    const src = line.match(/<iframe\s+src="([^"]+)"/);
    if (src) {
      carriers.push({ pageId: currentPageId, src: src[1] });
    }
  }
  return carriers;
}

// 提取迭代索引 iframe 指向（活页源 vs 快照）
function parseIterationIframes(htmlText) {
  const iframes = [];
  const srcPattern = /<iframe[^>]*src="([^"]+)"/g;
  let match;
  while ((match = srcPattern.exec(htmlText)) !== null) {
    iframes.push({ src: match[1], line: null });
  }
  return iframes;
}

// 按 scenario_type 组装 payload（验证器输入）
function buildPayload({ scenarioType, pageId, menuItems, pageNames, carriers, iterationRefs, pageBodyText, docsData, iteration, activeIteration }) {
  switch (scenarioType) {
    case 'entry-defect':
      return {
        sourceDir: {
          path: 'index.html',
          menuItems,
          iframeCarriers: carriers.map((item) => ({ pageId: item.pageId, src: item.src, monthComment: null })),
          pageNames,
          iterationRefs
        },
        pageId
      };
    case 'drawer-defect':
      return docsData ? { docsData, docId: docsData.docId } : { pageBodyText };
    case 'snapshot-pollution':
      return {
        iteration: iteration || '202608下',
        activeIteration: activeIteration || '202608下',
        iframes: iterationRefs.map((src) => ({ src, line: null })),
        knownDebt: []
      };
    default:
      return {};
  }
}

// ---- 文件系统扫描（只读）----

function listIndexHtmlFiles(boundary) {
  const results = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (boundary.shouldSkipDirectory(full)) continue;
        if (EXCLUDED_DIRS.includes(entry.name)) continue;
        walk(full);
      } else if (entry.name === 'index.html') {
        const rel = path.relative(HOST_ROOT, full).split(path.sep).join('/');
        results.push({ full, rel });
      }
    }
  };
  for (const root of SOURCE_ROOTS) {
    walk(path.join(HOST_ROOT, root));
  }
  return results;
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function listIterationHtmlFiles() {
  const dir = path.join(HOST_ROOT, ITERATION_DIR);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^\d{6}(上|下)\.html$/.test(name))
    .sort()
    .map((name) => ({ name, iteration: name.replace(/\.html$/, '') }));
}

// dirty 检测（只读 git status --short；core.quotepath=false 防中文路径八进制转义；引号路径剥离）
function detectDirtyFiles() {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', 'status', '--short'], { cwd: HOST_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) return [];
  return parseStatusOutput(result.stdout).map((entry) => entry.path.replace(/^"(.*)"$/, '$1'));
}

// ---- 主流程 ----

function buildCorpus() {
  const boundary = createProjectScanBoundary(HOST_ROOT);
  const indexFiles = listIndexHtmlFiles(boundary);
  const dirtyFiles = detectDirtyFiles();
  const iterationFiles = listIterationHtmlFiles();
  const activeIteration = iterationFiles.length > 0 ? iterationFiles[iterationFiles.length - 1].iteration : '202608下';
  const iterationRefs = [];
  for (const { name, iteration } of iterationFiles) {
    const html = readFileSafe(path.join(HOST_ROOT, ITERATION_DIR, name));
    if (html) iterationRefs.push({ iteration, refs: parseIterationIframes(html).map((item) => item.src) });
  }

  const fixtures = [];
  let sequence = 0;
  let scanFailed = false;

  for (const { full, rel } of indexFiles) {
    const html = readFileSafe(full);
    const endName = rel.split('/')[1] || rel;
    const moduleName = rel.split('/').slice(1, 3).join('-') || endName;
    sequence += 1;
    const corpusId = `C-${endName.slice(0, 1)}-${moduleName}-${String(sequence).padStart(2, '0')}`;

    if (html === null) {
      scanFailed = true;
      fixtures.push({
        corpus_id: corpusId,
        task_id: 'TASK-H04-CORPUS',
        scenario_type: 'scan-failed',
        source_page: rel,
        payload: {},
        // P5/H09（2026-08-19 用户裁决）：fixture 补 priority 分级，结构性缺陷族归 P1
        priority: 'P1',
        expected: { verdict: 'fail', reason: `source index unreadable: ${rel}` }
      });
      continue;
    }

    const menuItems = parseIndexMenu(html).map((item) => ({ pageId: item.pageId, label: item.pageId, monthTag: item.monthTag }));
    const pageNames = parsePageNames(html);
    const carriers = parseIframeCarriers(html);

    if (menuItems.length === 0 && Object.keys(pageNames).length === 0) {
      fixtures.push({
        corpus_id: corpusId,
        task_id: 'TASK-H04-CORPUS',
        scenario_type: 'malformed-index',
        source_page: rel,
        payload: {},
        // P5/H09（2026-08-19 用户裁决）：entry-defect/snapshot-pollution 为 P0，malformed-index 为 P1
        priority: 'P1',
        expected: { verdict: 'fail', reason: 'index.html lacks menu and pageNames' }
      });
      continue;
    }

    // 逐菜单项生成 entry-defect fixture（payload 为 source-registration 输入）
    const samplePageId = menuItems.length > 0 ? menuItems[0].pageId : Object.keys(pageNames)[0];
    const dirty = dirtyFiles.some((dirtyPath) => {
      // 精确匹配：dirty 路径等于本 index.html 相对路径，或其位于本 index 所属目录下
      return dirtyPath === rel || (dirtyPath.startsWith(`${rel.split('/').slice(0, -1).join('/')}/`) && dirtyPath.endsWith('.html'));
    });
    const fixture = {
      corpus_id: corpusId,
      task_id: 'TASK-H04-CORPUS',
      scenario_type: 'entry-defect',
      source_page: rel,
      // P5/H09（2026-08-19 用户裁决）：entry-defect 对应 H00A INC-001 返工族，归 P0
      priority: 'P0',
      payload: buildPayload({
        scenarioType: 'entry-defect',
        pageId: samplePageId,
        menuItems,
        pageNames,
        carriers,
        iterationRefs: iterationRefs.flatMap((item) => item.refs)
      })
    };
    // 首次固化：expected 与验证器当前行为一致（oracle 复用 H03A-D 验证器）
    fixture.expected = { verdict: runValidatorFor(fixture).verdict };
    // 提取说明：真实菜单月份为 YYYYMM（无上下后缀），与契约 /^\d{6}[上下]$/ 不符时如实标注
    const firstMonth = menuItems.length > 0 ? menuItems[0].monthTag : null;
    if (firstMonth !== null && !/^\d{6}[上下]$/.test(firstMonth)) {
      fixture.extraction_note = `真实菜单月份格式 ${firstMonth}（YYYYMM）与契约 monthTag 格式 /^\\d{6}[上下]$/ 不符，monthTag 判定如实 fail`;
    }
    if (dirty) fixture.baseline_dirty_warning = true;
    fixtures.push(fixture);
  }

  // 快照污染 fixture：历史迭代引用活页源（非 snapshots/ 指向）为缺陷样本
  for (const { iteration, refs } of iterationRefs) {
    const historical = iteration !== activeIteration;
    const liveRefs = refs.filter((src) => !src.includes('snapshots/'));
    if (!historical || liveRefs.length === 0) continue;
    for (const src of liveRefs.slice(0, 2)) {
      sequence += 1;
      const fixture = {
        corpus_id: `C-IT-INDEX-${String(sequence).padStart(2, '0')}`,
        task_id: 'TASK-H04-CORPUS',
        scenario_type: 'snapshot-pollution',
        source_page: ITERATION_DIR,
        // P5/H09（2026-08-19 用户裁决）：snapshot-pollution 对应 T-1 快照红线，归 P0
        priority: 'P0',
        payload: buildPayload({ scenarioType: 'snapshot-pollution', iteration, activeIteration, iterationRefs: [src] })
      };
      fixture.expected = { verdict: runValidatorFor(fixture).verdict };
      fixtures.push(fixture);
    }
  }

  // 写盘（原子）
  const outRel = path.join(HOST_ROOT, OUT_FILE);
  fs.mkdirSync(path.dirname(outRel), { recursive: true });
  fs.writeFileSync(`${outRel}.tmp`, `${JSON.stringify({ schema_version: 'h04-corpus-v1', built_at: new Date().toISOString(), fixture_count: fixtures.length, fixtures }, null, 2)}\n`);
  fs.renameSync(`${outRel}.tmp`, outRel);

  return { fixture_count: fixtures.length, scan_failed: scanFailed, fixtures };
}

// CLI
if (require.main === module) {
  try {
    const result = buildCorpus();
    process.stdout.write(`${JSON.stringify({ fixture_count: result.fixture_count, scan_failed: result.scan_failed, out: OUT_FILE }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`H04_CORPUS_BUILD_FAILED ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXCLUDED_DIRS,
  SOURCE_ROOTS,
  parseIndexMenu,
  parsePageNames,
  parseIframeCarriers,
  parseIterationIframes,
  buildPayload,
  buildCorpus
};
