'use strict';

// index-registration task adapter（OSS 通用版）。
//
// 职责：把 page-generation 产出的页面注册到源目录入口（模块 index.html）：
//   - 菜单项（nav-item）
//   - pageNames 键值
//   - page-section iframe 承载
//
// 模式：
//   - dry-run：产出补丁 JSON（index-menu-patch.json）+ 改后 index.html 预览，不写真实文件；
//   - 真实：应用补丁到目标 index.html（页面落位 + 入口闭环）。
//
// 目标与锚点全部来自 context（targetIndex / anchors / menu）或由 governance.config.json 推导；
// 锚点缺失或未命中时返回错误，不静默通过。
// 月份归属：菜单分组（menu.group）必须由调用方给出；未给出时在 warnings 标注待确认（落位闸门）。

const fs = require('fs');
const path = require('path');
const { loadGovernanceConfig } = require('../../lib/governance-config');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_OUT_DIR = path.join(HOST_ROOT, '.harness-runtime', 'tasks');

// 目标 index.html：context.targetIndex 优先；否则 governance moduleRoots 第一项；再退化为首个 web 平台根 index
function resolveTargetIndex(context) {
  if (context && context.targetIndex) {
    return { abs: path.join(HOST_ROOT, context.targetIndex), rel: context.targetIndex };
  }
  const { config } = loadGovernanceConfig(HOST_ROOT);
  if (Array.isArray(config.moduleRoots) && config.moduleRoots.length > 0) {
    const rel = `${config.moduleRoots[0].dir}/index.html`;
    return { abs: path.join(HOST_ROOT, rel), rel };
  }
  const web = (config.platforms || []).find((item) => item.key === 'web') || (config.platforms || [])[0];
  if (web) {
    const rel = `${web.root}/index.html`;
    return { abs: path.join(HOST_ROOT, rel), rel };
  }
  return { abs: null, rel: null };
}

function buildPatch({ pageId, pageTitle, pageFile, docId, targetRel, menu = {} }) {
  return {
    schema_version: 'index-registration-v1',
    target: targetRel,
    page_id: pageId,
    page_title: pageTitle,
    page_file: `pages/${pageFile}`,
    doc_id: docId,
    menu: {
      group: menu.group || null,
      group_note: menu.group ? '' : '菜单分组未指定，迭代归属待调用方确认（落位闸门）',
      insert_after: menu.insertAfter || null,
      item: {
        icon: menu.icon || 'fa-puzzle-piece',
        label: pageTitle,
        desc: ''
      }
    },
    page_names: { [pageId]: pageTitle },
    page_section: {
      comment: pageTitle,
      iframe_src: `pages/${pageFile}`
    }
  };
}

// 应用补丁到 index.html 文本（纯函数；锚点缺失时返回错误，不静默）
function applyIndexPatch(indexHtml, patch) {
  const errors = [];
  const anchors = patch.anchors || {};

  // 1. 菜单项
  const menuItem = `                <div
                    class="nav-item"
                    data-page="${patch.page_id}"
                    onclick="switchPage('${patch.page_id}')"
                >
                    <i class="fas ${patch.menu.item.icon}"></i>
                    <span>${patch.menu.item.label}</span>
                </div>`;
  if (!anchors.menu) {
    errors.push('menu 锚点未提供（context.anchors.menu）');
  } else if (indexHtml.includes(anchors.menu)) {
    indexHtml = indexHtml.replace(anchors.menu, `${anchors.menu}\n${menuItem}`);
  } else {
    errors.push('menu 锚点未命中');
  }

  // 2. pageNames
  const pageNameEntry = `                "${patch.page_id}": "${patch.page_title}",`;
  if (!anchors.pageNames) {
    errors.push('pageNames 锚点未提供（context.anchors.pageNames）');
  } else if (indexHtml.includes(anchors.pageNames)) {
    indexHtml = indexHtml.replace(anchors.pageNames, `${pageNameEntry}\n${anchors.pageNames}`);
  } else {
    errors.push('pageNames 锚点未命中');
  }

  // 3. page-section 承载
  const section = `                <!-- ${patch.page_section.comment} -->
                <div id="page-${patch.page_id}" class="page-section">
                    <iframe
                        src="${patch.page_section.iframe_src}"
                        class="iframe-page"
                    ></iframe>
                </div>`;
  if (!anchors.pageSection) {
    errors.push('page-section 锚点未提供（context.anchors.pageSection）');
  } else if (indexHtml.includes(anchors.pageSection)) {
    indexHtml = indexHtml.replace(anchors.pageSection, `${anchors.pageSection}\n${section}`);
  } else {
    errors.push('page-section 锚点未命中');
  }

  return { ok: errors.length === 0, html: indexHtml, errors };
}

// 返回 { ok, patchPath, previewPath, patch, dryRun, warnings, error }
async function runIndexRegistration({ input, provider = 'deepseek', dryRun = false, out = null, verbose = false, context = null }) {
  const warnings = [];
  const pageId = (context && context.pageId) || 'demo-feature-page';
  const pageTitle = (context && context.pageTitle) || '示例功能页';
  const pageFile = (context && context.pageFile) || 'demo-feature-page.html';
  const docId = (context && context.docId) || pageId;

  const target = resolveTargetIndex(context);
  if (!target.abs) {
    return { ok: false, error: { message: '无法确定目标 index.html：请在 context.targetIndex 或 governance moduleRoots 中声明', phase: 'input' }, warnings };
  }

  const patch = buildPatch({ pageId, pageTitle, pageFile, docId, targetRel: target.rel, menu: (context && context.menu) || {} });
  patch.anchors = (context && context.anchors) || {};
  if (!(context && context.menu && context.menu.group)) {
    warnings.push('菜单分组未指定：迭代归属月份待确认（落位闸门）');
  }

  const baseName = out ? path.resolve(HOST_ROOT, out) : path.join(DEFAULT_OUT_DIR, 'index-menu-patch.json');
  const previewPath = path.join(path.dirname(baseName), 'index-preview.html');
  fs.mkdirSync(path.dirname(baseName), { recursive: true });

  // dry-run：只写补丁 + 预览；真实：应用补丁并写回 index.html
  if (dryRun) {
    let indexHtml = '';
    try {
      indexHtml = fs.readFileSync(target.abs, 'utf8');
    } catch (error) {
      warnings.push(`index.html 读取失败（dry-run 预览跳过）：${error.message}`);
    }
    if (indexHtml) {
      const applied = applyIndexPatch(indexHtml, patch);
      if (applied.ok) {
        fs.writeFileSync(previewPath, applied.html);
      } else {
        warnings.push(`补丁预览应用失败：${applied.errors.join('；')}`);
      }
    }
    const artifact = { ...patch, dry_run: true, preview_path: path.relative(HOST_ROOT, previewPath), warnings };
    fs.writeFileSync(baseName, `${JSON.stringify(artifact, null, 2)}\n`);
    return { ok: true, patchPath: baseName, previewPath, patch, dryRun, warnings };
  }

  // 真实模式：应用补丁写回 index.html
  if (!fs.existsSync(target.abs)) {
    return { ok: false, error: { message: `index.html 不存在：${target.rel}`, phase: 'input' }, warnings };
  }
  const indexHtml = fs.readFileSync(target.abs, 'utf8');
  const applied = applyIndexPatch(indexHtml, patch);
  if (!applied.ok) {
    return { ok: false, error: { message: `补丁应用失败：${applied.errors.join('；')}`, phase: 'apply' }, warnings };
  }
  fs.writeFileSync(target.abs, applied.html);
  warnings.push('注意：真实写入 index.html 前需确认迭代月份归属（落位闸门）');
  return { ok: true, patchPath: target.abs, previewPath: null, patch, dryRun: false, warnings };
}

module.exports = {
  resolveTargetIndex,
  buildPatch,
  applyIndexPatch,
  runIndexRegistration
};
