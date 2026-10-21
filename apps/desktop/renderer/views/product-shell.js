import { api, errorText } from '../lib/api.js';
import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';
import * as ui from '../lib/ui.js';
import { renderWorkbench } from './workbench.js';
import { renderBrain } from './brain.js';
import { renderRequirements } from './requirements.js';
import { renderDeliveries } from './deliveries.js';

const VIEWS = {
  workbench: { label: '工作台', icon: icons.spark },
  brain: { label: '业务大脑', icon: icons.brain },
  requirements: { label: '需求与设计', icon: icons.doc },
  deliveries: { label: '交付记录', icon: icons.package }
};

function navLink(key, current, root, pending) {
  const view = VIEWS[key];
  const active = current === key ? 'active' : '';
  return `<a class="side-link ${active}" href="#/p/${encodeURIComponent(root)}/${key}" data-testid="nav-${key}">
    ${view.icon(16)}
    <span>${view.label}</span>
    ${key === 'requirements' && pending > 0 ? `<span class="count">${pending}</span>` : ''}
  </a>`;
}

export async function renderProductShell(container, route) {
  const ctx = window.phaContext;
  const current = ctx.state.current;
  if (!current) throw new Error('产品尚未打开');
  const project = current.summary;
  const dashboard = current.dashboard;
  const git = current.git || {};
  const settings = ctx.state.settings;
  const viewKey = VIEWS[route.view] ? route.view : 'workbench';
  const view = VIEWS[viewKey];
  const pending = project.pending || 0;
  const gitLabel = !git.isRepo
    ? '未初始化 Git'
    : git.clean
      ? '工作区干净'
      : `${git.changed_count || 0} 项未提交`;
  const gitClass = !git.isRepo ? '' : git.clean ? 'clean' : 'dirty';
  const model = settings?.model || { kind: 'local-heuristic' };
  const modelText = model.kind === 'local-heuristic'
    ? '本地规则分析'
    : (model.model || '模型未配置');
  const counts = project.counts || {};

  container.innerHTML = `
    <div class="product-shell">
      <aside class="sidebar">
        <div class="sidebar-head">
          <div class="brand">
            <div class="brand-mark" style="background:#E9E7DE;color:#1C241F">PHA</div>
            <div>
              <div class="brand-name">Proto Harness</div>
              <div class="brand-sub">Agent workspace</div>
            </div>
          </div>
          <button class="product-switch" id="switch-product" data-testid="switch-product">
            <span class="product-avatar">${fmt.escapeHtml(fmt.initials(project.name))}</span>
            <span style="min-width:0;flex:1">
              <span class="name">${fmt.escapeHtml(project.name)}</span>
              <span class="meta">${fmt.escapeHtml(project.current_baseline_name || '尚无基线')}</span>
            </span>
            ${icons.chevron(14)}
          </button>
        </div>
        <nav class="side-nav">
          <div class="side-label">产品空间</div>
          ${navLink('workbench', viewKey, current.root, pending)}
          ${navLink('brain', viewKey, current.root, pending)}
          ${navLink('requirements', viewKey, current.root, pending)}
          ${navLink('deliveries', viewKey, current.root, pending)}
        </nav>
        <div class="sidebar-foot">
          <div class="model-chip ${model.kind === 'local-heuristic' ? '' : 'model'}" title="${fmt.escapeHtml(modelText)}">
            <span class="dot"></span>
            <span class="grow">${fmt.escapeHtml(modelText)}</span>
            <button class="link" id="sidebar-model-settings" style="color:inherit">更换</button>
          </div>
          <a class="side-link settings" href="#/settings" data-testid="sidebar-settings">
            ${icons.settings(15)}<span>模型与工具设置</span>
          </a>
        </div>
      </aside>
      <main class="main-shell" id="main-scroll">
        <header class="topline">
          <div class="crumb">
            <button class="link muted" id="crumb-home">我的产品</button>
            ${icons.chevron(12)}
            <strong>${fmt.escapeHtml(project.name)}</strong>
            ${icons.chevron(12)}
            <span>${view.label}</span>
          </div>
          <div class="topline-actions">
            <span class="sync-chip ${gitClass}" title="${fmt.escapeHtml(git.hint || '')}">
              <span class="dot"></span>${fmt.escapeHtml(gitLabel)}
            </span>
            <button class="btn small" id="top-refresh" title="刷新">${icons.refresh(14)}</button>
            <button class="btn primary small" id="top-new-requirement" data-testid="top-new-requirement">${icons.plus(14)} 新需求</button>
          </div>
        </header>
        <div class="content" id="view-root">
          ${ui.loadingBlock('正在准备…')}
        </div>
      </main>
    </div>`;

  container.querySelector('#switch-product').addEventListener('click', () => ctx.navigate('#/home'));
  container.querySelector('#crumb-home').addEventListener('click', () => ctx.navigate('#/home'));
  container.querySelector('#sidebar-model-settings').addEventListener('click', () => ctx.navigate('#/settings'));
  container.querySelector('#top-new-requirement').addEventListener('click', () => ctx.openNewRequirement());
  container.querySelector('#top-refresh').addEventListener('click', () => ctx.refreshProject());

  const viewRoot = container.querySelector('#view-root');
  try {
    if (viewKey === 'workbench') await renderWorkbench(ctx, viewRoot, { counts });
    else if (viewKey === 'brain') await renderBrain(ctx, viewRoot);
    else if (viewKey === 'requirements') await renderRequirements(ctx, viewRoot, route.id);
    else if (viewKey === 'deliveries') await renderDeliveries(ctx, viewRoot);
  } catch (error) {
    console.error(error);
    viewRoot.innerHTML = `<div class="page-head"><div><div class="page-eyebrow">${fmt.escapeHtml(view.label)}</div><h1 class="page-title">页面读取失败</h1></div></div>
      ${ui.errorBox(error)}
      <div class="btn-row" style="margin-top:16px"><button class="btn primary" id="view-retry">重新读取</button></div>`;
    viewRoot.querySelector('#view-retry')?.addEventListener('click', () => ctx.refreshProject());
  }
}
