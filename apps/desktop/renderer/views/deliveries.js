import { api, errorText } from '../lib/api.js';
import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';
import * as ui from '../lib/ui.js';

function deliveryCard(delivery) {
  return `<div class="delivery-card">
    <div class="top">
      <div>
        <div class="name">${fmt.escapeHtml(delivery.requirement_title || delivery.requirement_id)}</div>
        <div class="meta"><span class="mono">${fmt.escapeHtml(delivery.id)}</span><span>${fmt.date(delivery.created_at)}</span><span>${(delivery.manifest || []).length} 个文件</span></div>
      </div>
      <span class="badge ${delivery.status === 'exported' ? 'green' : delivery.status === 'failed' ? 'red' : 'gray'}">${fmt.escapeHtml(delivery.status)}</span>
    </div>
    <div class="path">${fmt.escapeHtml(delivery.export_dir || '尚未导出')}</div>
    ${(delivery.warnings || []).length ? `<div class="warn-box">${delivery.warnings.map((item) => fmt.escapeHtml(item)).join('<br>')}</div>` : ''}
    <div class="btn-row">
      <button class="btn small primary" data-open-delivery="${fmt.escapeHtml(delivery.id)}" ${delivery.export_exists ? '' : 'disabled'}>${icons.folder(13)} 打开目录</button>
      <button class="btn small" data-export-delivery="${fmt.escapeHtml(delivery.id)}">${icons.refresh(13)} 重新导出</button>
    </div>
    <div class="manifest-list">
      ${(delivery.manifest || []).slice(0, 5).map((item) => `<div class="manifest-row"><span class="type">${fmt.escapeHtml(item.type)}</span><span class="grow mono">${fmt.escapeHtml(item.path)}</span><span>${fmt.escapeHtml(item.size_label || '')}</span></div>`).join('')}
    </div>
  </div>`;
}

function gitPanel(git) {
  if (!git.isRepo) {
    return `<div class="git-panel">
      <div class="info-box"><strong>当前项目还没有 Git 仓库</strong>项目业务记录可以独立版本化。初始化只会在项目目录创建 .git 与 .gitignore，不会修改业务文件，也不会使用强制参数。</div>
      <button class="btn primary small" id="git-init" data-testid="git-init">初始化 Git 仓库</button>
    </div>`;
  }
  const files = git.files || [];
  return `<div class="git-panel">
    <div class="git-meta">
      <span class="branch-chip">${fmt.escapeHtml(git.branch || 'detached')}</span>
      <span>${git.remote ? `origin：${fmt.escapeHtml(git.remote)}` : '未配置 origin'}</span>
      ${git.upstream ? `<span>${fmt.escapeHtml(git.upstream)} · ↑${git.ahead} ↓${git.behind}</span>` : ''}
      ${git.last_commit ? `<span>最近提交 ${fmt.escapeHtml(git.last_commit.hash)} · ${fmt.escapeHtml(git.last_commit.subject)}</span>` : ''}
    </div>
    ${files.length > 0 ? `
      <div class="git-file-list" data-testid="git-files">
        ${files.map((file, index) => `<label class="git-file">
          <input type="checkbox" data-git-file="${fmt.escapeHtml(file.path)}" ${file.path.startsWith('.runtime') ? '' : 'checked'}>
          <span class="status">${fmt.escapeHtml(file.status)}</span>
          <span class="path" title="${fmt.escapeHtml(file.path)}">${fmt.escapeHtml(file.path)}</span>
          <span class="badge outline" style="margin-left:auto">${fmt.escapeHtml(file.label)}</span>
        </label>`).join('')}
      </div>
      <div class="field">
        <label for="commit-message">提交信息</label>
        <input class="input" id="commit-message" data-testid="git-commit-message" value="${fmt.escapeHtml(`feat: 更新 ${window.phaContext.state.current.summary.name} 业务记录`)}">
      </div>
      <div class="btn-row">
        <button class="btn small primary" id="git-commit" data-testid="git-commit">提交所选文件</button>
      </div>` : `<div class="info-box"><strong>工作区干净</strong>项目文件已全部提交；导出的交付目录仍在本地，不会自动进入 Git。</div>`}
    <div class="btn-row" style="border-top:1px solid var(--paper-2);padding-top:10px">
      <button class="btn small" id="git-push" data-testid="git-push" ${git.remote ? '' : 'disabled'}>${icons.git(13)} 推送到 origin${git.ahead ? `（${git.ahead} 个提交待推送）` : ''}</button>
      <span class="hint">${git.remote ? '只推送到已配置的 origin，不使用强制参数。' : '配置 origin 后可推送。'}</span>
    </div>
    <div class="hint">${fmt.escapeHtml(git.hint || '')}</div>
  </div>`;
}

export async function renderDeliveries(ctx, container) {
  const root = ctx.state.current.root;
  const [data, git] = await Promise.all([
    api('deliveries:list', { root }),
    api('git:status', { root })
  ]);
  ctx.state.current.git = git;
  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Deliveries & sync</div>
        <h1 class="page-title">交付记录</h1>
        <p class="page-sub">每个交付固定需求版本、规则版本、产物摘要与未完成项；历史交付不随源页面漂移。</p>
      </div>
      <div class="page-actions">
        <button class="btn small" id="delivery-refresh">${icons.refresh(14)} 刷新同步状态</button>
      </div>
    </div>

    <div class="grid-2">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><div class="card-title">创建交付版本</div><div class="card-sub">只允许已评审需求；创建后立即导出静态站</div></div></div>
          <div class="card-body">
            ${data.requirements.length > 0 ? `
              <div class="form-grid">
                <div class="field">
                  <label for="delivery-requirement">已评审需求</label>
                  <select class="select" id="delivery-requirement" data-testid="delivery-requirement">
                    ${data.requirements.map((item) => `<option value="${fmt.escapeHtml(item.id)}">${fmt.escapeHtml(item.title)} · ${fmt.escapeHtml(item.baseline_id || '')}</option>`).join('')}
                  </select>
                </div>
                <button class="btn primary" id="delivery-create" data-testid="delivery-create">${icons.package(14)} 创建并导出</button>
                <div class="hint">建议先提交项目文件：创建交付时会绑定当前 Git 提交；未提交时交付清单会明确记录“未绑定提交”。</div>
              </div>` : `<div class="info-box"><strong>暂无已评审需求</strong>先在“需求与设计”中完成产物生成与评审，再创建固定交付。</div>`}
          </div>
        </div>

        <div class="section-heading"><h2>历史交付</h2><span class="sub">${data.deliveries.length} 个版本</span></div>
        ${data.deliveries.length > 0
          ? `<div class="stack">${data.deliveries.map(deliveryCard).join('')}</div>`
          : `<div class="empty-state"><div class="empty-icon">${icons.package(22)}</div><h3>还没有交付版本</h3><p>交付会把需求、规则与产物固定在同一版本，并导出可浏览的静态站。</p></div>`}
      </div>

      <div class="card">
        <div class="card-head"><div><div class="card-title">Git 同步</div><div class="card-sub">项目文件由你控制；密钥与运行日志不进入提交</div></div><span class="badge ${git.isRepo ? (git.clean ? 'green' : 'amber') : 'gray'}">${git.isRepo ? (git.clean ? '已提交' : `${git.changed_count} 项变更`) : '未初始化'}</span></div>
        <div class="card-body">${gitPanel(git)}</div>
      </div>
    </div>`;

  const refreshGit = async () => {
    ctx.state.current.git = await api('git:status', { root });
    await ctx.refreshProject();
  };

  container.querySelector('#delivery-refresh')?.addEventListener('click', () => ctx.refreshProject());
  container.querySelector('#git-init')?.addEventListener('click', async () => {
    try {
      await api('git:init', { root });
      ui.toast('Git 仓库已初始化', 'success');
      await refreshGit();
    } catch (error) { ui.toast(errorText(error), 'error'); }
  });

  container.querySelector('#git-commit')?.addEventListener('click', async (event) => {
    const paths = [...container.querySelectorAll('[data-git-file]:checked')].map((item) => item.dataset.gitFile);
    const message = container.querySelector('#commit-message')?.value.trim();
    if (paths.length === 0) { ui.toast('请选择要提交的文件', 'error'); return; }
    if (!message) { ui.toast('提交信息不能为空', 'error'); return; }
    ui.setBusy(event.currentTarget, true, '提交中…');
    try {
      const result = await api('git:commit', { root, paths, message });
      ui.toast(`已提交 ${result.hash}`, 'success');
      await refreshGit();
    } catch (error) {
      ui.setBusy(event.currentTarget, false);
      ui.toast(errorText(error), 'error');
    }
  });

  container.querySelector('#git-push')?.addEventListener('click', async (event) => {
    const ok = await ui.confirmDialog({
      title: '推送到远端',
      sub: `将当前分支推送到 ${git.remote || 'origin'}。这会让其他协作者看到本次提交；不会使用强制推送。`,
      confirmLabel: '推送'
    });
    if (!ok) return;
    ui.setBusy(event.currentTarget, true, '推送中…');
    try {
      const result = await api('git:push', { root });
      ui.toast(`推送完成：${(result.output || '').split('\n').slice(-2).join(' ')}`, 'success', 5000);
      await refreshGit();
    } catch (error) {
      ui.setBusy(event.currentTarget, false);
      ui.toast(errorText(error), 'error');
    }
  });

  container.querySelector('#delivery-create')?.addEventListener('click', async (event) => {
    const requirementId = container.querySelector('#delivery-requirement')?.value;
    if (!requirementId) return;
    ui.setBusy(event.currentTarget, true, '创建交付…');
    try {
      const delivery = await api('deliveries:create', { root, requirementId });
      const exported = await api('deliveries:export', { root, deliveryId: delivery.id });
      ui.toast(`交付已导出：${exported.export_dir}`, 'success', 6000);
      await ctx.refreshProject();
    } catch (error) {
      ui.setBusy(event.currentTarget, false);
      ui.toast(errorText(error), 'error');
    }
  });

  container.querySelectorAll('[data-open-delivery]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('deliveries:open', { root, deliveryId: button.dataset.openDelivery });
      } catch (error) { ui.toast(errorText(error), 'error'); }
    });
  });

  container.querySelectorAll('[data-export-delivery]').forEach((button) => {
    button.addEventListener('click', async () => {
      ui.setBusy(button, true, '导出中…');
      try {
        const exported = await api('deliveries:export', { root, deliveryId: button.dataset.exportDelivery });
        ui.toast(`已重新导出：${exported.export_dir}`, 'success', 5000);
        await ctx.refreshProject();
      } catch (error) {
        ui.setBusy(button, false);
        ui.toast(errorText(error), 'error');
      }
    });
  });
}
