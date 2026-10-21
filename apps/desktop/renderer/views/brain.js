import { api, errorText } from '../lib/api.js';
import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';
import * as ui from '../lib/ui.js';

const TABS = [
  { key: 'overview', label: '概况' },
  { key: 'rules', label: '规则' },
  { key: 'objects', label: '业务对象' },
  { key: 'capabilities', label: '能力' },
  { key: 'evidence', label: '来源' },
  { key: 'decisions', label: '裁决' },
  { key: 'baselines', label: '基线' }
];

function empty(text) {
  return `<div class="empty-state"><div class="empty-icon">${icons.info(20)}</div><p>${fmt.escapeHtml(text)}</p></div>`;
}

function overview(data) {
  const current = data.current_baseline;
  const planned = (data.baselines || []).filter((item) => item.status === 'planned');
  const counts = data.summary.counts || {};
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${data.rules.length}</div><div class="stat-label">规则（最新修订）</div></div>
      <div class="stat-card"><div class="stat-value">${data.objects.length}</div><div class="stat-label">业务对象</div></div>
      <div class="stat-card"><div class="stat-value">${data.capabilities.length}</div><div class="stat-label">能力卡</div></div>
      <div class="stat-card"><div class="stat-value">${data.evidence.length}</div><div class="stat-label">来源证据</div></div>
    </div>
    <div class="brain-overview section">
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><div class="card-title">当前基线</div><div class="card-sub">任务默认读取当前基线；已确认的下一版规则保持 planned，不自动覆盖现状。</div></div></div>
          <div class="card-body">
            ${current ? `
              <div class="baseline-card current">
                <div class="top"><div><div class="name">${fmt.escapeHtml(current.name)}</div><div class="meta">${fmt.statusLabel(current.status)} · ${(current.rule_refs || []).length} 条规则 · ${fmt.date(current.activated_at)}</div></div>${fmt.statusBadge('current')}</div>
              </div>` : '<p class="hint">尚无当前基线。</p>'}
            ${planned.length > 0 ? `<div class="divider"></div><div class="section-heading"><h2>计划基线</h2><span class="sub">${planned.length} 个已确认但未生效</span></div><div class="stack">${planned.map((baseline) => `
              <div class="baseline-card">
                <div class="top"><div><div class="name">${fmt.escapeHtml(baseline.name)}</div><div class="meta">${(baseline.rule_refs || []).length} 条规则 · ${fmt.date(baseline.created_at)}</div></div><span class="badge blue">计划生效</span></div>
              </div>`).join('')}</div>` : ''}
          </div>
        </div>
        ${data.import_report ? `
          <div class="card">
            <div class="card-head"><div><div class="card-title">接入记录</div><div class="card-sub">${fmt.escapeHtml(data.import_report.source_root || '')}</div></div></div>
            <div class="card-body">
              <div class="scan-stats">
                <div class="scan-stat"><strong>${data.import_report.stats?.files_scanned || 0}</strong><span>文件</span></div>
                <div class="scan-stat"><strong>${data.import_report.stats?.candidates || 0}</strong><span>候选</span></div>
                <div class="scan-stat"><strong>${(data.import_report.conflicts || []).length}</strong><span>冲突</span></div>
                <div class="scan-stat"><strong>${(data.import_report.current_rule_ids || []).length}</strong><span>当前规则</span></div>
              </div>
              ${(data.import_report.conflicts || []).map((item) => `<div class="list-line warn"><span class="bullet"></span><span><strong>${fmt.escapeHtml(item.topic)}</strong>：${fmt.escapeHtml(item.reason)}</span></div>`).join('')}
              ${(data.import_report.warnings || []).map((item) => `<div class="list-line quiet"><span class="bullet"></span><span>${fmt.escapeHtml(item)}</span></div>`).join('')}
            </div>
          </div>` : ''}
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><div><div class="card-title">最近裁决</div><div class="card-sub">业务判断保留理由与绑定哈希</div></div></div>
          <div class="card-body">
            ${(data.decisions || []).slice(0, 4).map((decision) => `
              <div class="decision-card" style="margin-bottom:8px">
                <div class="cluster"><span class="badge green">${fmt.escapeHtml({ adopt: '采纳', keep: '保留', conditional: '条件采纳' }[decision.chosen?.action] || decision.chosen?.action || '裁决')}</span><span class="tiny muted">${fmt.relative(decision.confirmed_at)}</span></div>
                <div class="reason">${fmt.escapeHtml(decision.reason)}</div>
                <div class="src">${fmt.escapeHtml(fmt.shortHash(decision.proposal_hash, 14))}</div>
              </div>`).join('') || '<p class="hint">尚无裁决记录。</p>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">对象与能力</div></div></div>
          <div class="card-body">
            <div class="chip-list">${data.objects.slice(0, 10).map((item) => `<span class="badge outline">${fmt.escapeHtml(item.name)}</span>`).join('') || '<span class="hint">尚无对象</span>'}</div>
            <div class="chip-list" style="margin-top:10px">${data.capabilities.slice(0, 6).map((item) => `<span class="badge">${fmt.escapeHtml(item.name)}</span>`).join('') || '<span class="hint">尚无能力卡</span>'}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function rulesTab(data) {
  if (data.rules.length === 0) return empty('还没有规则。新建产品或接入已有项目后会形成候选知识与基线。');
  return `<div class="card"><div class="table-wrap"><table class="data-table">
    <thead><tr><th>规则</th><th>状态</th><th>修订</th><th>基线</th><th></th></tr></thead>
    <tbody>${data.rules.map((rule) => `
      <tr class="clickable" data-rule="${fmt.escapeHtml(rule.id)}" data-testid="rule-row">
        <td><div class="main-cell">${fmt.escapeHtml(rule.topic || rule.id)}</div><div class="rule-statement"><span class="small muted">${fmt.escapeHtml(fmt.truncate(rule.statement, 110))}</span>${rule.scope ? `<div class="scope">${fmt.escapeHtml(rule.scope)}</div>` : ''}</div></td>
        <td>${fmt.ruleBadge(rule)}</td>
        <td><span class="mono small">r${rule.revision}${rule.revision_count > 1 ? ` · ${rule.revision_count} 版` : ''}</span></td>
        <td><span class="mono small">${fmt.escapeHtml(rule.baseline_id || '—')}</span></td>
        <td class="actions"><span class="link">查看 ${icons.arrow(12)}</span></td>
      </tr>`).join('')}</tbody>
  </table></div></div>`;
}

function objectsTab(data) {
  if (data.objects.length === 0) return empty('还没有业务对象。');
  return `<div class="card-grid">${data.objects.map((item) => `
    <div class="object-card">
      <div class="cluster"><strong>${fmt.escapeHtml(item.name)}</strong><span class="badge outline mono">${fmt.escapeHtml(item.id)}</span></div>
      ${item.key_fields?.length ? `<div class="fields">关键字段：${fmt.escapeHtml(item.key_fields.join('、'))}</div>` : ''}
      ${item.relations?.length ? `<div class="fields">关系：${fmt.escapeHtml(item.relations.map((relation) => relation.target || relation.kind || relation).join('、'))}</div>` : ''}
      ${item.notes ? `<div class="fields">${fmt.escapeHtml(item.notes)}</div>` : ''}
    </div>`).join('')}</div>`;
}

function capabilitiesTab(data) {
  if (data.capabilities.length === 0) return empty('还没有能力卡。');
  return `<div class="card-grid">${data.capabilities.map((item) => `
    <div class="cap-card">
      <div class="cluster"><strong>${fmt.escapeHtml(item.name)}</strong><span class="badge outline mono">${fmt.escapeHtml(item.id)}</span></div>
      <div class="refs">${fmt.escapeHtml(item.goal || '未填写目标')}</div>
      ${item.rule_refs?.length ? `<div class="refs">规则：${fmt.escapeHtml(item.rule_refs.map((ref) => `${ref.id} r${ref.revision || 1}`).join('、'))}</div>` : ''}
      ${item.exceptions?.length ? `<div class="refs">异常：${fmt.escapeHtml(item.exceptions.join('；'))}</div>` : ''}
    </div>`).join('')}</div>`;
}

function evidenceTab(data) {
  if (data.evidence.length === 0) return empty('还没有来源证据。');
  return `<div class="card-grid">${data.evidence.map((item) => `
    <div class="evidence-card">
      <div class="cluster"><strong>${fmt.escapeHtml(item.title)}</strong><span class="badge outline">${fmt.escapeHtml(item.source_type || 'source')}</span>${item.portable ? '' : '<span class="badge amber">本机来源</span>'}</div>
      <div class="src">${fmt.escapeHtml(item.source_ref || '')}${item.locator ? ` · ${fmt.escapeHtml(item.locator)}` : ''}</div>
      <div class="excerpt">${fmt.escapeHtml(item.raw_excerpt || '')}</div>
      <div class="tiny muted" style="margin-top:8px">采集 ${fmt.date(item.captured_at)} · ${fmt.escapeHtml(item.usage || 'fact')}</div>
    </div>`).join('')}</div>`;
}

function decisionsTab(data) {
  if (data.decisions.length === 0) return empty('还没有裁决记录。');
  return `<div class="stack">${data.decisions.map((item) => `
    <div class="decision-card">
      <div class="cluster">
        <span class="badge green">${fmt.escapeHtml({ adopt: '采纳变更', keep: '保留现行', conditional: '条件采纳' }[item.chosen?.action] || item.chosen?.action || '裁决')}</span>
        ${item.condition ? `<span class="badge amber">${fmt.escapeHtml(item.condition)}</span>` : ''}
        <span class="tiny muted">${fmt.date(item.confirmed_at)}</span>
      </div>
      <div class="reason">${fmt.escapeHtml(item.reason)}</div>
      <div class="meta"><span class="mono">hash ${fmt.escapeHtml(fmt.shortHash(item.proposal_hash, 16))}</span><span>base r${item.base_revision}</span>${item.applied_at ? '<span class="badge green">已应用</span>' : '<span class="badge amber">未应用</span>'}</div>
      ${item.conflict_context?.conflicts?.length ? `<div class="hint" style="margin-top:8px">${item.conflict_context.conflicts.map((conflict) => fmt.escapeHtml(conflict.topic || '')).join(' · ')}</div>` : ''}
    </div>`).join('')}</div>`;
}

function baselinesTab(data) {
  if (data.baselines.length === 0) return empty('还没有基线。');
  const rules = new Map(data.rules.map((rule) => [rule.id, rule]));
  return `<div class="stack">${data.baselines.map((baseline) => `
    <div class="baseline-card ${baseline.status === 'current' ? 'current' : ''}">
      <div class="top">
        <div>
          <div class="name">${fmt.escapeHtml(baseline.name)}</div>
          <div class="meta">${fmt.statusLabel(baseline.status)} · ${(baseline.rule_refs || []).length} 条规则 · ${fmt.date(baseline.created_at)}</div>
        </div>
        <div class="btn-row">
          ${fmt.statusBadge(baseline.status)}
          ${['planned', 'draft'].includes(baseline.status) ? `<button class="btn small soft" data-activate="${fmt.escapeHtml(baseline.id)}" data-testid="baseline-activate">明确生效</button>` : ''}
        </div>
      </div>
      <div class="refs">
        ${(baseline.rule_refs || []).map((ref) => {
          const rule = rules.get(ref.id);
          return `<span class="badge outline mono" title="${fmt.escapeHtml(rule?.statement || '')}">${fmt.escapeHtml(ref.id)} r${ref.revision}</span>`;
        }).join('')}
      </div>
      ${baseline.notes ? `<div class="hint" style="margin-top:8px">${fmt.escapeHtml(baseline.notes)}</div>` : ''}
    </div>`).join('')}</div>`;
}

async function openRuleDrawer(ctx, ruleId) {
  const data = await api('brain:rule', { root: ctx.state.current.root, ruleId });
  const latest = data.revisions[data.revisions.length - 1];
  const drawer = ui.openDrawer({
    eyebrow: '业务规则',
    title: latest?.topic || ruleId,
    sub: `${ruleId} · ${data.revisions.length} 个修订版本`,
    closeOnBackdrop: true,
    content: `
      <div class="stack">
        ${data.revisions.slice().reverse().map((rule, index) => `
          <div class="card">
            <div class="card-head"><div><div class="card-title">修订 r${rule.revision}${index === 0 ? ' · 最新' : ''}</div><div class="card-sub">${fmt.escapeHtml(fmt.date(rule.created_at))}</div></div><div class="cluster">${fmt.ruleBadge(rule)}</div></div>
            <div class="card-body">
              <p style="line-height:1.75">${fmt.escapeHtml(rule.statement)}</p>
              ${rule.scope ? `<div class="hint" style="margin-top:8px">适用范围：${fmt.escapeHtml(rule.scope)}</div>` : ''}
              ${rule.constraints?.length ? `<div class="hint" style="margin-top:8px">约束：${fmt.escapeHtml(rule.constraints.join('；'))}</div>` : ''}
              <div class="proposal-meta">
                <span>基线 ${fmt.escapeHtml(rule.baseline_id || '—')}</span>
                <span>决策 ${fmt.escapeHtml(rule.decision_ref || '—')}</span>
                ${rule.supersedes ? `<span>替代 ${fmt.escapeHtml(rule.supersedes.id)} r${rule.supersedes.revision}</span>` : ''}
              </div>
              ${rule.history_note ? `<div class="hint" style="margin-top:7px">${fmt.escapeHtml(rule.history_note)}</div>` : ''}
            </div>
          </div>`).join('')}
        <div class="card">
          <div class="card-head"><div><div class="card-title">来源证据</div><div class="card-sub">${data.evidence.length} 条</div></div></div>
          <div class="card-body stack" style="gap:10px">
            ${data.evidence.length > 0 ? data.evidence.map((item) => `<div>
              <div class="small" style="font-weight:550">${fmt.escapeHtml(item.title)}</div>
              <div class="mono tiny muted" style="word-break:break-all">${fmt.escapeHtml(item.source_ref || '')}${item.locator ? ` · ${fmt.escapeHtml(item.locator)}` : ''}</div>
              <div class="hint" style="margin-top:4px">${fmt.escapeHtml(fmt.truncate(item.raw_excerpt || '', 220))}</div>
            </div>`).join('') : '<p class="hint">该规则没有关联来源证据。</p>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">关联裁决</div></div></div>
          <div class="card-body stack" style="gap:8px">
            ${data.decisions.length > 0 ? data.decisions.map((decision) => `<div>
              <div class="cluster"><span class="badge green">${fmt.escapeHtml({ adopt: '采纳', keep: '保留', conditional: '条件采纳' }[decision.chosen?.action] || '裁决')}</span><span class="tiny muted">${fmt.date(decision.confirmed_at)}</span></div>
              <div class="small" style="margin-top:5px">${fmt.escapeHtml(decision.reason)}</div>
              ${decision.condition ? `<div class="hint">条件：${fmt.escapeHtml(decision.condition)}</div>` : ''}
            </div>`).join('') : '<p class="hint">该规则没有关联裁决。</p>'}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">引用的基线</div></div></div>
          <div class="card-body">
            ${data.baselines.length > 0 ? data.baselines.map((baseline) => `<div class="list-line"><span class="bullet"></span><span>${fmt.escapeHtml(baseline.name)} ${fmt.statusBadge(baseline.status)}</span></div>`).join('') : '<p class="hint">没有基线引用该规则。</p>'}
          </div>
        </div>
      </div>`
  });
  return drawer;
}

export async function renderBrain(ctx, container) {
  const data = await api('brain:list', { root: ctx.state.current.root });
  const tab = TABS.some((item) => item.key === ctx.state.brainTab) ? ctx.state.brainTab : 'overview';
  ctx.state.brainTab = tab;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Business brain</div>
        <h1 class="page-title">业务大脑</h1>
        <p class="page-sub">当前基线、规则版本、来源与裁决集中在这里。候选知识不等于已生效规则。</p>
      </div>
      <div class="page-actions">
        <span class="sync-chip clean"><span class="dot"></span>${data.summary.counts.rules} 条最新规则</span>
      </div>
    </div>
    <div class="tabs">
      ${TABS.map((item) => `<button class="tab ${tab === item.key ? 'active' : ''}" data-tab="${item.key}" data-testid="brain-tab-${item.key}">${item.label}</button>`).join('')}
    </div>
    <div id="brain-tab-content"></div>`;

  const content = container.querySelector('#brain-tab-content');
  const draw = () => {
    const activeTab = TABS.some((item) => item.key === ctx.state.brainTab) ? ctx.state.brainTab : 'overview';
    content.innerHTML = activeTab === 'overview' ? overview(data)
      : activeTab === 'rules' ? rulesTab(data)
        : activeTab === 'objects' ? objectsTab(data)
          : activeTab === 'capabilities' ? capabilitiesTab(data)
            : activeTab === 'evidence' ? evidenceTab(data)
              : activeTab === 'decisions' ? decisionsTab(data)
                : baselinesTab(data);
    bind();
  };

  const bind = () => {
    content.querySelectorAll('[data-rule]').forEach((row) => {
      row.addEventListener('click', async () => {
        try {
          await openRuleDrawer(ctx, row.dataset.rule);
        } catch (error) {
          ui.toast(errorText(error), 'error');
        }
      });
    });
    content.querySelectorAll('[data-activate]').forEach((button) => {
      button.addEventListener('click', async () => {
        const reason = await ui.promptDialog({
          title: '明确生效',
          sub: '将计划基线切换为当前基线会影响后续需求默认读取的规则。现行基线会保留为已停用，历史交付不漂移。',
          label: '生效依据',
          placeholder: '例如：本期需求已上线，业务负责人确认新规则生效',
          confirmLabel: '切换当前基线'
        });
        if (!reason) return;
        try {
          await api('brain:activate-baseline', {
            root: ctx.state.current.root,
            baselineId: button.dataset.activate,
            reason
          });
          ui.toast('已切换当前基线', 'success');
          await ctx.refreshProject();
        } catch (error) {
          ui.toast(errorText(error), 'error');
        }
      });
    });
  };

  container.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.state.brainTab = button.dataset.tab;
      container.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
      draw();
    });
  });
  draw();
}
