'use strict';

// page-generation task adapter（OSS 通用版）。
//
// 职责：把 UI 规格（需求基线）转换为业务页面 HTML（静态原型）+ 页面级需求抽屉
// 数据源（js/docs/{docId}.js，页面级增量数据源规则）。
//
// 产物路径：
//   - dry-run：.harness-runtime/tasks/pages/{file} + .harness-runtime/tasks/pages/docs/{docId}.js
//   - 真实：{目标模块}/pages/{file} + {目标模块}/js/docs/{docId}.js
//     目标模块由 context.sourceModuleDir 或 governance.config.json（moduleRoots 第一项 / web 平台根）推导
//
// 页面约束：
//   - 真实页面 DOM 不得包含需求说明、开发说明、测试提示、dry_run 标记等词（剔除清单）；
//   - clone-source / 页面标识 / 示例数据全部由 context 注入，默认为中性虚构演示值；
//   - 需求抽屉数据源使用页面级 js/docs/{docId}.js，注册 window.DocsData（doc-panel 需读同一全局）。

const fs = require('fs');
const path = require('path');
const { loadGovernanceConfig } = require('../../lib/governance-config');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_OUT_DIR = path.join(HOST_ROOT, '.harness-runtime', 'tasks', 'pages');

const DEFAULT_PAGE_ID = 'demo-feature-page';
const DEFAULT_PAGE_TITLE = '示例功能页';
const DEFAULT_PAGE_FILE = 'demo-feature-page.html';

// 目标模块目录：context.sourceModuleDir 优先；否则 governance moduleRoots 第一项；再退化为 web 平台根
function resolveSourceDirs(context) {
  if (context && context.sourceModuleDir) {
    const rel = context.sourceModuleDir;
    return { pagesDir: path.join(HOST_ROOT, rel, 'pages'), docsDir: path.join(HOST_ROOT, rel, 'js', 'docs'), rel };
  }
  const { config } = loadGovernanceConfig(HOST_ROOT);
  const first = (config.moduleRoots || [])[0];
  const web = (config.platforms || []).find((item) => item.key === 'web') || (config.platforms || [])[0];
  const rel = first ? first.dir : (web ? web.root : null);
  if (!rel) return { pagesDir: null, docsDir: null, rel: null };
  return { pagesDir: path.join(HOST_ROOT, rel, 'pages'), docsDir: path.join(HOST_ROOT, rel, 'js', 'docs'), rel };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 页面 HTML（静态原型，无开发/需求说明词）；示例数据为中性虚构条目
function buildPageHtml({ baseline, pageTitle, docId, cloneSource }) {
  const rows = [
    ['示例条目 A', '2026-08-18 10:24', '已启用', '移除'],
    ['示例条目 B', '2026-08-19 09:05', '已停用', '移除']
  ]
    .map(
      (row) => `<tr>
              <td>${row[0]}</td>
              <td>${row[1]}</td>
              <td><span class="status-badge">${row[2]}</span></td>
              <td><button class="btn-link">${row[3]}</button></td>
            </tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<!-- template-type: module-page -->
<!-- clone-source: ${cloneSource} -->
<!-- change-type: safe-add -->
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle}</title>
    <script src="../../../assets/js/tailwind.min.js"></script>
    <link href="../../../assets/css/font-awesome.min.css" rel="stylesheet">
    <link href="../../../assets/css/font-awesome-local.css" rel="stylesheet">
    <link href="../../../assets/css/variables.css" rel="stylesheet">
    <link href="../../../assets/css/common.css" rel="stylesheet">
    <link href="../../../assets/css/components.css" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
            background: #f0f2f5;
        }
        .page-container { padding: 24px; max-width: 960px; }
        .page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        .page-title { font-size: 18px; font-weight: 600; color: #1f2937; }
        .page-note {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 8px;
            color: #1e40af;
            font-size: 13px;
            padding: 10px 14px;
            margin-bottom: 16px;
            line-height: 1.6;
        }
        .toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
        .btn-primary {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #1890ff;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 8px 16px;
            font-size: 14px;
            cursor: pointer;
        }
        .btn-primary:hover { background: #40a9ff; }
        .list-card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); overflow: hidden; }
        .list-table { width: 100%; border-collapse: collapse; }
        .list-table th {
            text-align: left;
            font-size: 13px;
            color: #6b7280;
            font-weight: 500;
            padding: 12px 16px;
            border-bottom: 1px solid #f3f4f6;
            background: #fafafa;
        }
        .list-table td { font-size: 14px; color: #374151; padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
        .status-badge {
            display: inline-block;
            background: #fef2f2;
            color: #b91c1c;
            border-radius: 999px;
            padding: 2px 10px;
            font-size: 12px;
        }
        .btn-link { background: none; border: none; color: #1890ff; cursor: pointer; font-size: 13px; padding: 0; }
        .btn-link:hover { color: #40a9ff; }
        .empty-state { text-align: center; color: #9ca3af; padding: 48px 0; font-size: 14px; }
        .pagination-area {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            font-size: 13px;
            color: #6b7280;
        }
        .pagination { display: flex; gap: 6px; }
        .page-btn {
            min-width: 28px;
            height: 28px;
            border: 1px solid #e5e7eb;
            background: #fff;
            border-radius: 6px;
            color: #6b7280;
            cursor: pointer;
            font-size: 12px;
        }
        .page-btn.active { background: #1890ff; color: #fff; border-color: #1890ff; }
        /* 添加弹窗 */
        .modal-mask {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 100;
            align-items: center;
            justify-content: center;
        }
        .modal-mask.show { display: flex; }
        .modal-box { width: 420px; background: #fff; border-radius: 12px; padding: 24px; }
        .modal-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #1f2937; }
        .form-item { margin-bottom: 14px; }
        .form-label { display: block; font-size: 13px; color: #374151; margin-bottom: 6px; }
        .form-input {
            width: 100%;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 14px;
            box-sizing: border-box;
        }
        .form-input:focus { outline: none; border-color: #1890ff; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
        .btn-ghost { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; color: #374151; }
    </style>
</head>
<body>
    <div class="page-container">
        <div class="page-header">
            <div class="page-title"><i class="fas fa-puzzle-piece" style="color:#1890ff;margin-right:8px;"></i>${pageTitle}</div>
            <button class="btn-doc dg-doc-btn" onclick="DocPanel.toggle('${docId}')">需求文档</button>
        </div>
        <div class="page-note">维护示例名单：名单内条目在消费端按已保存配置生效。</div>
        <div class="toolbar">
            <button class="btn-primary" onclick="document.getElementById('addModal').classList.add('show')"><i class="fas fa-plus"></i>新增条目</button>
        </div>
        <div class="list-card">
            <table class="list-table">
                <thead>
                    <tr>
                        <th>名称</th>
                        <th>创建时间</th>
                        <th>状态</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
${rows}
                </tbody>
            </table>
            <div class="pagination-area">
                <div class="pagination-info">共 2 条记录，第 1 / 1 页</div>
                <div class="pagination">
                    <button class="page-btn" disabled><i class="fas fa-chevron-left"></i></button>
                    <button class="page-btn active">1</button>
                    <button class="page-btn" disabled><i class="fas fa-chevron-right"></i></button>
                </div>
            </div>
        </div>
    </div>

    <!-- 新增条目弹窗 -->
    <div class="modal-mask" id="addModal">
        <div class="modal-box">
            <div class="modal-title">新增条目</div>
            <div class="form-item">
                <label class="form-label">条目名称</label>
                <input class="form-input" type="text" placeholder="请输入条目名称">
            </div>
            <div class="form-item">
                <label class="form-label">备注说明</label>
                <input class="form-input" type="text" placeholder="请输入备注说明">
            </div>
            <div class="modal-actions">
                <button class="btn-ghost" onclick="document.getElementById('addModal').classList.remove('show')">取消</button>
                <button class="btn-primary" onclick="document.getElementById('addModal').classList.remove('show')">确认</button>
            </div>
        </div>
    </div>

    <!-- ====== 需求文档抽屉 ====== -->
    <script src="../js/docs.js"></script>
    <script src="../js/docs/${docId}.js"></script>
    <script src="../js/doc-panel.js"></script>
    <script src="../../../assets/js/components/doc-button.js"></script>
    <script src="../../../assets/js/home-fab.js"></script>
</body>
</html>
`;
}

// 页面级需求抽屉数据源（业务口径，不含开发/测试词）
function buildDocsJs({ baseline, pageTitle, docId }) {
  const b = baseline || {};
  const acceptance = (b.acceptance_criteria || []).map((item) => escapeHtml(item)).join('<br>');
  const risks = (b.risks_and_boundaries || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
  return `(function () {
  var target = window.DocsData || {};

  target["${docId}"] = {
    title: "${pageTitle}",
    footer: "需求文档 | ${pageTitle}",
    content: \`
        <section class="doc-section">
          <h3>${pageTitle}</h3>
          <div class="doc-rule-card">
            <div class="doc-rule-line"><span>功能说明</span><p>示例配置页：授权角色可维护名单条目，条目在消费端按已保存配置生效。</p></div>
            <div class="doc-rule-line"><span>涉及端</span><p>配置端（名单维护）；消费端（按配置生效）。</p></div>
            <div class="doc-rule-line"><span>名单维护</span><p>仅授权角色可新增、移除名单条目。</p></div>
            <div class="doc-rule-line"><span>生效方式</span><p>名单保存后生效，消费端按最新配置执行。</p></div>
          </div>
        </section>

        <section class="doc-section">
          <h3>验收标准</h3>
          <p>${acceptance}</p>
        </section>

        <section class="doc-section">
          <h3>异常边界</h3>
          <ul>${risks}</ul>
        </section>
    \`
  };
})();
`;
}

function slugify(input, fallback) {
  const cleaned = String(input || '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

// 返回 { ok, pagePath, docsPath, pageId, pageTitle, dryRun, warnings, error }
async function runPageGeneration({ input, provider = 'deepseek', dryRun = false, out = null, verbose = false, context = null }) {
  const warnings = [];
  const baseline = (context && context.baseline) || {};
  const taskId = (context && context.taskId) || slugify(String(baseline.title || 'PAGE'), 'PAGE');
  const pageId = (context && context.pageId) || DEFAULT_PAGE_ID;
  const pageTitle = (context && context.pageTitle) || DEFAULT_PAGE_TITLE;
  const pageFile = (context && context.pageFile) || DEFAULT_PAGE_FILE;
  const docId = (context && context.docId) || pageId;
  const cloneSource = (context && context.cloneSource) || '示例项目内成熟页面（待 governance 示例落定后回填）';

  // 产物路径：dry-run 放 runtime，真实模式写源目录
  let pageDir;
  let docsDir;
  if (dryRun) {
    pageDir = path.join(HOST_ROOT, '.harness-runtime', 'tasks', 'pages');
    docsDir = path.join(pageDir, 'docs');
  } else {
    const dirs = resolveSourceDirs(context);
    if (!dirs.pagesDir) {
      return { ok: false, error: { message: '无法确定目标模块目录：请在 context.sourceModuleDir 或 governance moduleRoots 中声明', phase: 'input' }, warnings };
    }
    pageDir = dirs.pagesDir;
    docsDir = dirs.docsDir;
  }
  const pagePath = out ? path.resolve(HOST_ROOT, out) : path.join(pageDir, pageFile);
  const docsPath = path.join(docsDir, `${docId}.js`);

  const pageHtml = buildPageHtml({ baseline, pageTitle, docId, cloneSource });
  const docsJs = buildDocsJs({ baseline, pageTitle, docId });
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(pagePath, pageHtml);
  fs.writeFileSync(docsPath, docsJs);

  return { ok: true, pagePath, docsPath, pageId, pageTitle, taskId, dryRun, warnings };
}

module.exports = {
  DEFAULT_PAGE_ID,
  DEFAULT_PAGE_TITLE,
  DEFAULT_PAGE_FILE,
  resolveSourceDirs,
  buildPageHtml,
  buildDocsJs,
  runPageGeneration
};
