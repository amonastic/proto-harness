import { api, errorText } from './lib/api.js';
import * as fmt from './lib/format.js';
import { icons } from './lib/icons.js';
import * as ui from './lib/ui.js';
import { renderHome } from './views/home.js';
import { renderProductShell } from './views/product-shell.js';
import { renderSettingsPage } from './views/settings.js';
import { openNewProduct } from './views/wizards/new-product.js';
import { openImportProject } from './views/wizards/import-project.js';
import { openNewRequirement } from './views/wizards/new-requirement.js';

const state = {
  settings: null,
  projects: [],
  current: null,
  appInfo: null,
  brainTab: 'overview',
  artifactTab: 'prototype'
};

function productHash(root, view = 'workbench', id = '') {
  const base = `#/p/${encodeURIComponent(root)}/${view}`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

function parseRoute() {
  const hash = window.location.hash || '#/home';
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (segments[0] === 'settings') return { name: 'settings' };
  if (segments[0] === 'p' && segments[1]) {
    return {
      name: 'product',
      root: decodeURIComponent(segments[1]),
      view: segments[2] || 'workbench',
      id: segments[3] ? decodeURIComponent(segments[3]) : ''
    };
  }
  return { name: 'home' };
}

async function ensureProduct(root, { force = false } = {}) {
  if (!force && state.current && state.current.root === root) return state.current;
  const data = await api('projects:open', { root });
  state.current = data;
  return data;
}

async function renderRoute({ forceProduct = false } = {}) {
  const app = document.getElementById('app');
  const route = parseRoute();
  try {
    if (route.name === 'settings') {
      if (!state.settings) state.settings = await api('settings:get');
      document.title = '设置 · Proto Harness Agent';
      await renderSettingsPage(app, route);
      return;
    }
    if (route.name === 'product') {
      app.innerHTML = `<div class="boot-screen"><span class="spinner"></span><p>正在打开产品…</p></div>`;
      await ensureProduct(route.root, { force: forceProduct });
      document.title = `${state.current.summary.name} · Proto Harness Agent`;
      await renderProductShell(app, route);
      return;
    }
    document.title = 'Proto Harness Agent';
    await renderHome(app);
  } catch (error) {
    console.error(error);
    document.title = '打开失败 · Proto Harness Agent';
    app.innerHTML = `
      <div class="home">
        <header class="home-topbar">
          <div class="brand"><div class="brand-mark">PHA</div><div><div class="brand-name">Proto Harness Agent</div><div class="brand-sub">Local product intelligence</div></div></div>
        </header>
        <main class="home-main">
          <div class="empty-state">
            <h3>无法打开当前页面</h3>
            <p>${fmt.escapeHtml(errorText(error)).replaceAll('\n', '<br>')}</p>
            <div class="btn-row" style="justify-content:center">
              <button class="btn primary" id="retry-route">重新尝试</button>
              <button class="btn" id="back-home">回到我的产品</button>
            </div>
          </div>
        </main>
      </div>`;
    document.getElementById('retry-route')?.addEventListener('click', () => renderRoute({ forceProduct: true }));
    document.getElementById('back-home')?.addEventListener('click', () => navigate('#/home'));
  }
}

function navigate(hash) {
  if (window.location.hash === hash) {
    renderRoute();
    return;
  }
  window.location.hash = hash;
}

async function refreshProject() {
  if (!state.current) return;
  try {
    const data = await api('projects:open', { root: state.current.root });
    state.current = data;
    state.projects = await api('projects:list');
    if (parseRoute().name === 'product') await renderProductShell(document.getElementById('app'), parseRoute());
    else await renderRoute();
  } catch (error) {
    ui.toast(errorText(error), 'error');
  }
}

const ctx = {
  api,
  state,
  fmt,
  icons,
  ui,
  errorText,
  navigate,
  productHash,
  openProduct: (root, view = 'workbench') => navigate(productHash(root, view)),
  refreshProject,
  refreshProjects: async () => {
    state.projects = await api('projects:list');
  },
  openNewProduct: () => openNewProduct(ctx),
  openImportProject: () => openImportProject(ctx),
  openNewRequirement: () => openNewRequirement(ctx),
  reloadSettings: async () => {
    state.settings = await api('settings:get');
    state.appInfo = await api('app:info');
    return state.settings;
  }
};

window.phaContext = ctx;

async function boot() {
  try {
    state.settings = await api('settings:get');
    state.projects = await api('projects:list');
  } catch (error) {
    const app = document.getElementById('app');
    app.innerHTML = `<div class="boot-screen"><span class="boot-mark">PHA</span><p>${fmt.escapeHtml(errorText(error)).replaceAll('\n', '<br>')}</p></div>`;
    return;
  }
  window.addEventListener('hashchange', () => renderRoute());
  await renderRoute();
}

boot();
