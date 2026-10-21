import { api, errorText } from '../lib/api.js';
import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';
import * as ui from '../lib/ui.js';

function modelBanner(settings) {
  const model = settings?.model;
  if (!model || model.kind === 'local-heuristic') {
    return `<div class="model-banner">
      <span class="dot"></span>
      <span class="grow">当前使用<strong>本地规则分析</strong>：只从输入与来源材料提取候选知识，不调用模型。可在设置中接入 OpenAI 兼容服务。</span>
      <button class="btn small" id="banner-settings">模型设置</button>
    </div>`;
  }
  if (!model.hasKey || !model.model) {
    return `<div class="model-banner" style="background:var(--amber-soft);border-color:#E7D2B6;color:#7A4A15">
      <span class="dot" style="background:var(--amber)"></span>
      <span class="grow">模型服务尚未配置完整：需要服务地址、模型 ID 与 API Key。</span>
      <button class="btn small" id="banner-settings">完成配置</button>
    </div>`;
  }
  return '';
}

function projectCard(project) {
  const counts = project.counts || {};
  const pending = project.pending || 0;
  return `
    <button class="project-card" type="button" data-root="${fmt.escapeHtml(project.path)}" data-testid="project-card">
      <div class="project-card-top">
        <div>
          <div class="project-name">${fmt.escapeHtml(project.name)}</div>
          <div class="project-meta" style="margin-top:5px">
            <span>${fmt.escapeHtml(project.current_baseline_name || '尚无基线')}</span>
            <span>${counts.rules || 0} 条规则</span>
          </div>
        </div>
        ${pending > 0 ? `<span class="badge amber">${pending} 项待裁决</span>` : '<span class="badge green">可用</span>'}
      </div>
      <div class="project-goal">${fmt.escapeHtml(project.goal || '尚未填写产品目标')}</div>
      <div class="project-foot">
        <span class="id">${fmt.escapeHtml(project.id || '')}</span>
        <span class="small muted">${fmt.relative(project.updated_at)}</span>
      </div>
    </button>`;
}

export async function renderHome(container) {
  const ctx = window.phaContext;
  const [projects, settings, appInfo] = await Promise.all([
    api('projects:list'),
    api('settings:get'),
    api('app:info')
  ]);
  ctx.state.projects = projects;
  ctx.state.settings = settings;
  ctx.state.appInfo = appInfo;
  const pending = projects.reduce((sum, item) => sum + (item.pending || 0), 0);
  const deliveries = projects.reduce((sum, item) => sum + (item.counts?.deliveries || 0), 0);
  const model = settings.model;
  const modelLabel = model.kind === 'local-heuristic'
    ? '本地规则分析'
    : (model.model ? `模型 · ${model.model}` : '模型未配置');

  container.innerHTML = `
    <div class="home">
      <header class="home-topbar">
        <div class="brand">
          <div class="brand-mark">PHA</div>
          <div>
            <div class="brand-name">Proto Harness Agent</div>
            <div class="brand-sub">Local product intelligence</div>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="btn ghost small" id="home-settings" data-testid="home-settings">${icons.settings(15)} 设置</button>
        </div>
      </header>
      <main class="home-main">
        <section class="hero">
          <div class="hero-copy">
            <div class="hero-eyebrow">Product brain · Requirements · Delivery</div>
            <h1 class="hero-title">把产品判断，<br>留在项目里。</h1>
            <p class="hero-sub">从目标、资料和已有规则出发，让每一次需求分析、冲突裁决与交付版本都能找到依据。项目文件属于你，模型与 Git 凭据留在本机。</p>
            <div class="hero-actions">
              <button class="btn primary" id="home-new-product" data-testid="home-new-product">${icons.plus(15)} 新建产品</button>
              <button class="btn" id="home-import-project" data-testid="home-import-project">${icons.folder(15)} 接入已有项目</button>
            </div>
          </div>
          <div class="hero-side">
            <div class="hero-stat accent">
              <div><div class="label">当前分析来源</div><div class="value">${fmt.escapeHtml(modelLabel)}</div></div>
              <div class="hint">${model.kind === 'local-heuristic' ? '未调用模型；候选知识需人工确认' : (model.hasKey ? 'API Key 保存在系统安全存储' : '需要完成模型凭据配置')}</div>
            </div>
            <div class="hero-stat">
              <div><div class="label">工作区</div><div class="value">${projects.length} 个产品 · ${pending} 项待裁决</div></div>
              <div class="hint">${deliveries} 个固定交付版本；所有业务记录保存在本地项目文件</div>
            </div>
          </div>
        </section>

        ${modelBanner(settings)}

        <div class="section-head">
          <div>
            <h2 class="section-title">我的产品</h2>
            <div class="section-sub">一个业务产品一个空间；同一业务体系下的多个端共享业务大脑。</div>
          </div>
        </div>
        ${projects.length > 0
          ? `<div class="project-grid">${projects.map(projectCard).join('')}</div>`
          : `<div class="empty-state">
              <div class="empty-icon">${icons.brain(22)}</div>
              <h3>从一个具体产品开始</h3>
              <p>新建产品会先形成业务基线，再进入首项需求；接入已有项目会先建立资产映射与候选知识，不改动原始目录。</p>
              <div class="btn-row" style="justify-content:center">
                <button class="btn primary" id="empty-new">${icons.plus(15)} 新建产品</button>
                <button class="btn" id="empty-import">${icons.folder(15)} 接入已有项目</button>
              </div>
            </div>`}
      </main>
    </div>`;

  const openProject = async (root) => {
    try {
      ctx.openProduct(root);
    } catch (error) {
      ui.toast(errorText(error), 'error');
    }
  };
  container.querySelectorAll('[data-root]').forEach((card) => {
    card.addEventListener('click', () => openProject(card.dataset.root));
  });
  container.querySelector('#home-new-product')?.addEventListener('click', () => ctx.openNewProduct());
  container.querySelector('#home-import-project')?.addEventListener('click', () => ctx.openImportProject());
  container.querySelector('#empty-new')?.addEventListener('click', () => ctx.openNewProduct());
  container.querySelector('#empty-import')?.addEventListener('click', () => ctx.openImportProject());
  container.querySelector('#home-settings')?.addEventListener('click', () => ctx.navigate('#/settings'));
  container.querySelector('#banner-settings')?.addEventListener('click', () => ctx.navigate('#/settings'));
}
