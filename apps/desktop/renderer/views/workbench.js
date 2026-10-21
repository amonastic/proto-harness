import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';

const ACTION_LABEL = {
  draft: '开始分析',
  analyzing: '查看分析',
  blocked: '回答问题',
  awaiting_decision: '处理裁决',
  analyzed: '生成产物',
  generating: '查看生成',
  generated: '评审产物',
  reviewed: '创建交付',
  delivered: '查看交付'
};

function requirementRow(ctx, requirement, currentBaseline) {
  const baseline = requirement.baseline_id === currentBaseline?.id
    ? (currentBaseline?.name || '当前基线')
    : (requirement.baseline_id || '—');
  return `<tr class="clickable" data-requirement="${fmt.escapeHtml(requirement.id)}" data-testid="workbench-requirement">
    <td>
      <div class="main-cell">${fmt.escapeHtml(requirement.title)}</div>
      <div class="sub-cell">${fmt.escapeHtml(requirement.next_step || '')}</div>
    </td>
    <td>${fmt.statusBadge(requirement.status)}</td>
    <td><span class="mono small">${fmt.escapeHtml(baseline)}</span></td>
    <td class="small muted">${fmt.relative(requirement.updated_at)}</td>
    <td class="actions"><span class="link">${fmt.escapeHtml(ACTION_LABEL[requirement.status] || '打开')} ${icons.arrow(12)}</span></td>
  </tr>`;
}

export async function renderWorkbench(ctx, container) {
  const current = ctx.state.current;
  const data = current.dashboard;
  const requirements = data.requirements || [];
  const active = data.active_requirements || [];
  const pending = requirements.filter((item) => item.status === 'awaiting_decision');
  const next = data.next_task;
  const counts = current.summary.counts || {};
  const currentBaseline = data.current_baseline;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Workbench</div>
        <h1 class="page-title">${fmt.escapeHtml(current.summary.name)}</h1>
        <p class="page-sub">${fmt.escapeHtml(current.summary.goal || '尚未填写产品目标')}</p>
      </div>
      <div class="page-actions">
        <button class="btn" id="wb-open-brain">${icons.brain(14)} 业务大脑</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${counts.rules || 0}</div><div class="stat-label">当前规则</div></div>
      <div class="stat-card"><div class="stat-value">${active.length}</div><div class="stat-label">进行中需求</div></div>
      <div class="stat-card"><div class="stat-value">${pending.length}</div><div class="stat-label">待裁决</div></div>
      <div class="stat-card"><div class="stat-value">${counts.deliveries || 0}</div><div class="stat-label">固定交付</div></div>
    </div>

    <div class="section">
      ${next
        ? `<div class="next-card" data-testid="next-task">
            <div class="orb">${icons.spark(20)}</div>
            <div class="grow">
              <div class="title">${fmt.escapeHtml(next.title)}</div>
              <div class="sub">下一步：${fmt.escapeHtml(next.next_step || '继续处理')} · ${fmt.statusLabel(next.status)}</div>
            </div>
            <button class="btn primary" id="continue-task">${fmt.escapeHtml(ACTION_LABEL[next.status] || '继续')}</button>
          </div>`
        : `<div class="empty-state">
            <div class="empty-icon">${icons.doc(22)}</div>
            <h3>从一项具体需求开始</h3>
            <p>需求会带着当前基线的规则、来源与未知项进入分析。发生业务冲突时，相关生成会暂停，直到你完成裁决。</p>
            <button class="btn primary" id="empty-new-requirement" data-testid="wb-new-requirement">${icons.plus(14)} 发起首项需求</button>
          </div>`}
    </div>

    ${pending.length > 0 ? `
      <div class="section">
        <div class="section-heading"><h2>待你裁决</h2><span class="sub">冲突会阻塞依赖该判断的生成</span></div>
        <div class="stack">
          ${pending.map((item) => `<div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px" data-testid="pending-decision">
            <span class="badge amber">待裁决</span>
            <div class="grow"><div class="card-title">${fmt.escapeHtml(item.title)}</div><div class="card-sub">${fmt.escapeHtml(item.next_step || '比较双方依据后作出选择')}</div></div>
            <button class="btn small primary" data-open-req="${fmt.escapeHtml(item.id)}">处理</button>
          </div>`).join('')}
        </div>
      </div>` : ''}

    <div class="grid-2 section">
      <div>
        <div class="section-heading"><h2>需求任务</h2><span class="sub">${requirements.length} 项</span></div>
        <div class="card">
          ${requirements.length > 0 ? `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>需求</th><th>状态</th><th>基线</th><th>更新</th><th></th></tr></thead>
                <tbody>${requirements.slice(0, 12).map((item) => requirementRow(ctx, item, currentBaseline)).join('')}</tbody>
              </table>
            </div>` : `<div class="card-body muted small">还没有需求任务。</div>`}
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><div class="card-title">当前基线</div><div class="card-sub">后续需求默认读取这一版规则</div></div></div>
          <div class="card-body">
            ${currentBaseline ? `
              <div class="baseline-card current">
                <div class="top"><div><div class="name">${fmt.escapeHtml(currentBaseline.name)}</div><div class="meta">${fmt.statusLabel(currentBaseline.status)} · ${(currentBaseline.rule_refs || []).length} 条规则</div></div>${fmt.statusBadge('current')}</div>
                <div class="refs">${(currentBaseline.rule_refs || []).slice(0, 4).map((ref) => `<span class="badge outline mono">${fmt.escapeHtml(ref.id)} r${ref.revision}</span>`).join('')}</div>
              </div>` : '<p class="hint">尚无当前基线。</p>'}
            <button class="btn small" id="wb-open-baselines" style="margin-top:12px">查看基线与规则</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">最近活动</div><div class="card-sub">运行记录保存在 .runtime，不进入交付</div></div></div>
          <div class="card-body">
            <div class="stack" style="gap:9px">
              ${(data.activity || []).slice(0, 6).map((item) => `<div class="list-line quiet"><span class="bullet"></span><span><span class="small">${fmt.escapeHtml(item.summary || item.type)}</span><span class="tiny muted" style="display:block">${fmt.relative(item.at)}</span></span></div>`).join('') || '<p class="hint">暂无活动记录。</p>'}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  container.querySelectorAll('[data-requirement]').forEach((row) => {
    row.addEventListener('click', () => ctx.navigate(ctx.productHash(current.root, 'requirements', row.dataset.requirement)));
  });
  container.querySelectorAll('[data-open-req]').forEach((button) => {
    button.addEventListener('click', () => ctx.navigate(ctx.productHash(current.root, 'requirements', button.dataset.openReq)));
  });
  const openNext = () => {
    if (next) ctx.navigate(ctx.productHash(current.root, 'requirements', next.id));
  };
  container.querySelector('#continue-task')?.addEventListener('click', openNext);
  container.querySelector('#empty-new-requirement')?.addEventListener('click', () => ctx.openNewRequirement());
  container.querySelector('#wb-open-brain')?.addEventListener('click', () => ctx.navigate(ctx.productHash(current.root, 'brain')));
  container.querySelector('#wb-open-baselines')?.addEventListener('click', () => {
    ctx.state.brainTab = 'baselines';
    ctx.navigate(ctx.productHash(current.root, 'brain'));
  });
}
