'use strict';

// P9.3（2026-08-21）：ui-spec-generation task adapter。
//
// 职责：把 requirement-interview 产出的需求基线（baseline）转换为 UI 规格 HTML。
// UI 规格是开发规格文档（非真实页面），允许包含需求说明与验收项。
//
// 模式：
//   - dry-run / 真实 均使用确定性模板（UI 规格本质是结构化文档，模板可满足；
//     模型增强生成留待后续批次，任务包 P9 验证标准只要求 workflow 产出 4 类文件）。
//
// 产物：UI-*.html（.harness-runtime/tasks/ 下，dry_run 标记写入规格文档元信息区）。

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_OUT_DIR = path.join(HOST_ROOT, '.harness-runtime', 'tasks');

function slugify(input, fallback) {
  const cleaned = String(input || '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function listItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '<li class="empty">无</li>';
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
}

// 从需求基线生成 UI 规格 HTML
function buildUiSpecHtml({ baseline, input, dryRun, taskId }) {
  const b = baseline || {};
  const rap = b.roles_and_platforms || {};
  const scope = b.scope || {};
  const platformTags = (rap.platforms || []).map((p) => `<span class="tag">${escapeHtml(p)}</span>`).join(' ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>UI 规格：${escapeHtml(b.title || taskId)}</title>
<style>
body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 32px auto; max-width: 860px; color: #333; line-height: 1.7; }
h1 { font-size: 22px; border-bottom: 2px solid #1890ff; padding-bottom: 8px; }
h2 { font-size: 17px; margin-top: 28px; color: #1890ff; }
.tag { display: inline-block; background: #e6f4ff; color: #0958d9; border-radius: 4px; padding: 2px 8px; margin-right: 6px; font-size: 13px; }
.meta { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #666; }
li { margin: 4px 0; }
.empty { color: #999; }
</style>
</head>
<body>
<h1>UI 规格：${escapeHtml(b.title || '未命名需求')}</h1>
<div class="meta">
<p><strong>任务 ID：</strong>${escapeHtml(taskId)}</p>
<p><strong>需求输入：</strong>${escapeHtml(input)}</p>
<p><strong>涉及端：</strong>${platformTags}</p>
<p><strong>规格模式：</strong>${dryRun ? 'dry-run（链路验证产物，非最终规格）' : '正式'}</p>
</div>

<h2>一、根问题</h2>
<p>${escapeHtml(b.target || '')}</p>

<h2>二、角色与端</h2>
<ul>
<li>角色：${escapeHtml((rap.roles || []).join('、') || '无')}</li>
<li>前端影响：${escapeHtml(rap.frontend_impact || '')}</li>
<li>后端影响：${escapeHtml(rap.backend_impact || '')}</li>
</ul>

<h2>三、核心流程</h2>
<ul>
${listItems(b.core_flows)}
</ul>

<h2>四、数据与权限</h2>
<p><strong>数据来源：</strong>${escapeHtml((b.data_and_permission || {}).data_source || '')}</p>
<p><strong>权限控制：</strong>${escapeHtml((b.data_and_permission || {}).permission_control || '')}</p>

<h2>五、页面结构（静态原型）</h2>
<ol>
<li>页面标题：${escapeHtml(b.title || '')}</li>
<li>主内容：按核心流程生成的配置列表（名称、说明、创建时间、状态、操作）</li>
<li>操作：与核心流程对应的新增与移除入口</li>
<li>空态：列表为空时展示空态提示</li>
<li>分页：超过单页容量时分页展示</li>
</ol>

<h2>六、验收标准</h2>
<ul>
${listItems(b.acceptance_criteria)}
</ul>

<h2>七、范围边界</h2>
<p><strong>范围内：</strong></p>
<ul>${listItems(scope.in_scope)}</ul>
<p><strong>范围外：</strong></p>
<ul>${listItems(scope.out_of_scope)}</ul>

<h2>八、风险与异常</h2>
<ul>
${listItems(b.risks_and_boundaries)}
</ul>
</body>
</html>
`;
}

// 返回 { ok, outPath, uiSpecPath, warnings, error }
async function runUiSpecGeneration({ input, provider = 'deepseek', dryRun = false, out = null, verbose = false, context = null }) {
  const warnings = [];
  const baseline = (context && context.baseline) || input || {};
  const taskId = (context && context.taskId) || slugify(String(baseline.title || 'UI'), 'UI-SPEC');
  const uiName = `UI-${taskId.replace(/^REQ-/, '')}.html`;
  const outPath = out ? path.resolve(HOST_ROOT, out) : path.join(DEFAULT_OUT_DIR, uiName);

  const html = buildUiSpecHtml({ baseline, input: (context && context.input) || '', dryRun, taskId });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return { ok: true, outPath, taskId, dryRun, warnings };
}

module.exports = {
  buildUiSpecHtml,
  runUiSpecGeneration
};
