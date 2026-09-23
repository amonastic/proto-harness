'use strict';

// H04（P2）：语料构建器测试——纯函数解析 + 语料结构。
// build-corpus 的扫描核心为纯函数（parse*/buildPayload），测试直接喂入合成 HTML 文本；
// 真实仓库扫描由 npm run harness:corpus:build 验收命令覆盖。

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseIndexMenu,
  parsePageNames,
  parseIframeCarriers,
  parseIterationIframes,
  buildPayload,
  EXCLUDED_DIRS,
  SOURCE_ROOTS
} = require('../../../scripts/harness/corpus/build-corpus');

test('H04-01 parseIndexMenu extracts data-page entries with group month tags', () => {
  const html = '<!-- 202607 -->\n<a data-page="page-a">甲</a>\n<div class="nav-group-title">202606</div>\n<div data-page="page-b"></div>';
  const items = parseIndexMenu(html);
  assert.deepEqual(items.map((item) => item.pageId), ['page-a', 'page-b']);
  assert.equal(items[0].monthTag, '202607', 'month from preceding group comment');
  assert.equal(items[1].monthTag, '202606', 'month from group title');
});

test('H04-02 parsePageNames extracts JS literal pageNames object', () => {
  const html = 'var pageNames = { "page-a": "页面甲", "page-b": "页面乙" };';
  assert.deepEqual(parsePageNames(html), { 'page-a': '页面甲', 'page-b': '页面乙' });
  assert.deepEqual(parsePageNames('<html>no names</html>'), {});
});

test('H04-03 parseIframeCarriers extracts iframe srcs with parent pageId association', () => {
  // 独立 iframe 在前（无 section 上下文 → pageId null）；section 内 iframe 在后（pageId 关联）
  // 注：按行解析无 DOM 边界感知，section 之后的独立 iframe 会继承前一 section 的 pageId（已知局限）
  const html = '<iframe src="../field-app/x.html"></iframe>\n<div id="page-a" class="page-section"><iframe src="pages/a.html"></iframe></div>';
  const carriers = parseIframeCarriers(html);
  assert.deepEqual(carriers[0], { pageId: null, src: '../field-app/x.html' });
  assert.deepEqual(carriers[1], { pageId: 'a', src: 'pages/a.html' });
});

test('H04-04 buildPayload assembles validator inputs per scenario_type', () => {
  const menuItems = [{ pageId: 'page-a', label: '页面甲', monthTag: '202608上' }];
  const entryPayload = buildPayload({
    scenarioType: 'entry-defect',
    pageId: 'page-a',
    menuItems,
    pageNames: { 'page-a': '页面甲' },
    carriers: [{ pageId: 'page-a', src: 'pages/a.html' }],
    iterationRefs: ['page-x'],
    pageBodyText: '',
    docsData: null
  });
  assert.equal(entryPayload.pageId, 'page-a');
  assert.deepEqual(entryPayload.sourceDir.menuItems, menuItems);
  assert.deepEqual(entryPayload.sourceDir.iterationRefs, ['page-x']);
  assert.deepEqual(entryPayload.sourceDir.iframeCarriers, [{ pageId: 'page-a', src: 'pages/a.html', monthComment: null }], 'carrier pageId association must be preserved');

  const snapshotPayload = buildPayload({ scenarioType: 'snapshot-pollution', iterationRefs: ['snapshots/202607上/x.html'] });
  assert.deepEqual(snapshotPayload.iframes, [{ src: 'snapshots/202607上/x.html', line: null }]);
  assert.equal(snapshotPayload.activeIteration, '202608下');
});

test('H04-05 boundary constants come from governance config and cover platform roots', () => {
  assert.ok(Array.isArray(EXCLUDED_DIRS), 'excluded dirs must be an array from governance config (empty when no local config)');
  assert.ok(EXCLUDED_DIRS.every((d) => typeof d === 'string' && d.length > 0), 'excluded dirs must be non-empty strings');
  assert.deepEqual(SOURCE_ROOTS, ['admin-portal', 'field-app', 'mini-program'], 'source roots must match governance platform roots');
});

test('H04-06 corpus fixture shape carries required fields', () => {
  const fixture = {
    corpus_id: 'C-S-ENTRY-01',
    task_id: 'TASK-H04-CORPUS',
    scenario_type: 'entry-defect',
    source_page: 'index.html',
    payload: { pageId: 'x' },
    expected: { verdict: 'pass' }
  };
  for (const field of ['corpus_id', 'task_id', 'scenario_type', 'source_page', 'payload', 'expected']) {
    assert.ok(fixture[field] !== undefined, `fixture must carry ${field}`);
  }
  const dirtyFixture = { ...fixture, baseline_dirty_warning: true };
  assert.equal(dirtyFixture.baseline_dirty_warning, true);
});
