import { api, errorText } from '../lib/api.js';
import * as fmt from '../lib/format.js';
import { icons } from '../lib/icons.js';
import * as ui from '../lib/ui.js';

const STATUS_STEPS = [
  { label: '分析', match: ['draft', 'analyzing', 'blocked'] },
  { label: '业务裁决', match: ['awaiting_decision'] },
  { label: '需求与设计', match: ['analyzed', 'generating'] },
  { label: '评审', match: ['generated'] },
  { label: '交付', match: ['reviewed', 'delivered'] }
];

function stepIndex(status) {
  const index = STATUS_STEPS.findIndex((item) => item.match.includes(status));
  return index === -1 ? 0 : index;
}

function stepper(status) {
  const active = stepIndex(status);
  return `<div class="stepper">${STATUS_STEPS.map((step, index) => {
    const cls = index < active ? 'done' : index === active ? 'active' : '';
    return `<span class="step ${cls}"><span class="num">${index + 1}</span>${step.label}</span>`;
  }).join('')}</div>`;
}

function requirementList(ctx, requirements) {
  const pending = requirements.filter((item) => item.status === 'awaiting_decision');
  return `
    <div class="page-head">
      <div>
        <div class="page-eyebrow">Requirements & design</div>
        <h1 class="page-title">需求与设计</h1>
        <p class="page-sub">每个需求固定基线、影响范围、裁决与产物版本；纠偏会让受影响产物变为待核对。</p>
      </div>
      <div class="page-actions">
        <span class="sync-chip"><span class="dot"></span>${requirements.length} 项任务</span>
      </div>
    </div>
    ${pending.length > 0 ? `<div class="model-banner" style="background:var(--amber-soft);border-color:#E7D2B6;color:#7A4A15">
      <span class="dot" style="background:var(--amber)"></span>
      <span class="grow">有 ${pending.length} 项需求等待业务裁决；裁决完成前不会生成相关产物。</span>
    </div>` : ''}
    <div class="card">
      ${requirements.length > 0 ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>需求</th><th>状态</th><th>基线</th><th>分析来源</th><th>更新</th><th></th></tr></thead>
        <tbody>${requirements.map((item) => `<tr class="clickable" data-req="${fmt.escapeHtml(item.id)}" data-testid="requirement-row">
          <td><div class="main-cell">${fmt.escapeHtml(item.title)}</div><div class="sub-cell">${fmt.escapeHtml(item.next_step || '')}</div></td>
          <td>${fmt.statusBadge(item.status)}</td>
          <td><span class="mono small">${fmt.escapeHtml(item.baseline_id || '—')}</span></td>
          <td>${fmt.sourceChip(item.analysis_source)}</td>
          <td class="small muted">${fmt.relative(item.updated_at)}</td>
          <td class="actions"><span class="link">打开 ${icons.arrow(12)}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty-state"><div class="empty-icon">${icons.doc(22)}</div><h3>还没有需求</h3><p>发起需求后，系统会读取当前基线、分析影响，并在业务冲突处暂停，等待你的裁决。</p><button class="btn primary" id="req-empty-new" data-testid="req-new">${icons.plus(14)} 发起首项需求</button></div>`}
    </div>`;
}

function bindList(ctx, container) {
  container.querySelectorAll('[data-req]').forEach((row) => {
    row.addEventListener('click', () => ctx.navigate(ctx.productHash(ctx.state.current.root, 'requirements', row.dataset.req)));
  });
  container.querySelector('#req-empty-new')?.addEventListener('click', () => ctx.openNewRequirement());
}

function actionBar(ctx, detail) {
  const req = detail.requirement;
  if (req.status === 'awaiting_decision') {
    return `<button class="btn primary" id="scroll-decision" data-testid="req-decision-cta">前往裁决</button>`;
  }
  if (req.status === 'blocked') {
    return `<button class="btn primary" id="req-analyze" data-testid="req-analyze">${icons.refresh(14)} 重新分析</button>`;
  }
  if (req.status === 'draft') {
    return `<button class="btn primary" id="req-analyze" data-testid="req-analyze">${icons.play(14)} 开始分析</button>`;
  }
  if (['analyzing', 'generating'].includes(req.status)) {
    return `<button class="btn" disabled><span class="spinner"></span>处理中…</button>`;
  }
  if (req.status === 'analyzed') {
    return `<button class="btn primary" id="req-generate" data-testid="req-generate">${icons.spark(14)} 生成需求与设计</button>`;
  }
  if (req.status === 'generated') {
    return `<button class="btn" id="req-regenerate" data-testid="req-regenerate">${icons.refresh(14)} 重新生成</button>
      <button class="btn primary" id="req-review" data-testid="req-review">${icons.check(14)} 评审通过</button>`;
  }
  if (req.status === 'reviewed') {
    return `<button class="btn primary" id="req-deliver" data-testid="req-deliver">${icons.package(14)} 创建交付版本</button>`;
  }
  if (req.status === 'delivered') {
    return `<button class="btn primary" id="req-open-delivery" data-testid="req-open-delivery">${icons.folder(14)} 打开交付目录</button>`;
  }
  return '';
}

function unknownsBlock(detail) {
  const unknowns = detail.requirement.unknowns || [];
  if (unknowns.length === 0) return '<p class="hint">本次分析没有记录未知项。</p>';
  return `<div class="stack">${unknowns.map((item, index) => `
    <div class="unknown-item ${item.blocking && !item.answer ? 'blocking' : ''}">
      <div class="unknown-q">
        ${item.blocking ? '<span class="flag">阻塞</span>' : '<span class="flag" style="color:var(--muted);background:var(--paper-2);border-color:var(--line)">提示</span>'}
        <span>${fmt.escapeHtml(item.question)}</span>
      </div>
      <div class="why">${fmt.escapeHtml(item.why_blocking || '')}</div>
      ${item.answer
        ? `<div class="answered">已回答：${fmt.escapeHtml(item.answer)}</div>`
        : `<div class="unknown-answer">
            <input class="input" data-unknown="${fmt.escapeHtml(item.id)}" placeholder="写下业务确认，或明确按现状处理" data-testid="unknown-answer-${index}">
            <button class="btn small primary" data-save-unknown="${fmt.escapeHtml(item.id)}" data-testid="unknown-save-${index}">保存</button>
          </div>`}
    </div>`).join('')}</div>`;
}

function conflictCards(proposal) {
  const conflicts = proposal.conflicts || [];
  if (conflicts.length === 0) return '';
  return `<div class="stack">${conflicts.map((conflict) => `
    <div class="conflict-card">
      <div class="conflict-head"><span class="flag"></span><strong>${fmt.escapeHtml(conflict.topic || '业务口径冲突')}</strong><span class="badge red">需要裁决</span>${conflict.heuristic ? '<span class="badge outline">启发式识别</span>' : ''}</div>
      <div class="conflict-cols">
        <div class="conflict-col">
          <div class="conflict-label">现行规则</div>
          ${(conflict.existing_rules || []).map((rule) => `<p>${fmt.escapeHtml(rule.statement)}</p><span class="ref">${fmt.escapeHtml(rule.id)} · r${rule.revision}</span>`).join('')}
        </div>
        <div class="conflict-col">
          <div class="conflict-label">新需求口径</div>
          <p>${fmt.escapeHtml(conflict.proposed_statement || '')}</p>
        </div>
      </div>
      <div class="conflict-body">
        <div class="hint">${fmt.escapeHtml(conflict.why || '')}</div>
      </div>
    </div>`).join('')}</div>`;
}

function changesBlock(proposal) {
  const changes = proposal.changes || [];
  if (changes.length === 0) return '<p class="hint">本提案没有规则变更。</p>';
  return `<div class="stack">${changes.map((change) => `
    <div class="list-line">
      <span class="bullet"></span>
      <span><span class="badge outline mono">${change.kind === 'rule.revise' ? '修订' : '新增'} ${fmt.escapeHtml(change.rule_id || '')}${change.from_revision ? ` r${change.from_revision} → r${Number(change.from_revision) + 1}` : ''}</span>
        <div style="margin-top:5px">${fmt.escapeHtml(change.statement)}</div>
        ${change.reason ? `<div class="hint">${fmt.escapeHtml(change.reason)}</div>` : ''}
      </span>
    </div>`).join('')}</div>`;
}

function decisionForm(proposal) {
  return `<div class="decision-form">
    <div class="conflict-label">你的裁决</div>
    <div class="choice-list">
      <label class="choice" data-choice="adopt">
        <input type="radio" name="decision-action" value="adopt" data-testid="decision-adopt">
        <span><strong>采用新口径</strong><span>新规则进入计划基线；现行基线保持不变，直到明确生效。</span></span>
      </label>
      <label class="choice" data-choice="keep">
        <input type="radio" name="decision-action" value="keep" data-testid="decision-keep">
        <span><strong>保留现行规则</strong><span>按当前基线继续；需求范围需要调整或另行评审。</span></span>
      </label>
      <label class="choice" data-choice="conditional">
        <input type="radio" name="decision-action" value="conditional" data-testid="decision-conditional">
        <span><strong>附加条件后采用</strong><span>把适用条件写入规则范围，再进入计划基线。</span></span>
      </label>
    </div>
    <div class="field hidden" id="condition-field">
      <label for="decision-condition">生效条件</label>
      <input class="input" id="decision-condition" data-testid="decision-condition" placeholder="例如：仅适用于已完成签收的订单">
    </div>
    <div class="field">
      <label for="decision-reason">裁决理由 <span class="label-note">必填，会进入决策记录</span></label>
      <textarea class="textarea" id="decision-reason" data-testid="decision-reason" placeholder="写清业务判断与依据，后续任务会引用它"></textarea>
    </div>
    <div class="decision-foot">
      <div class="proposal-meta"><span>proposal ${fmt.escapeHtml(fmt.shortHash(proposal.proposal_hash, 14))}</span><span>base r${proposal.base_revision}</span></div>
      <button class="btn primary" id="decision-submit" data-testid="decision-submit" disabled>确认并应用裁决</button>
    </div>
    <div id="decision-error"></div>
  </div>`;
}

function proposalBlock(detail) {
  const proposal = detail.proposal;
  const req = detail.requirement;
  if (!proposal) {
    return `<div class="card"><div class="card-head"><div><div class="card-title">业务裁决</div><div class="card-sub">本次分析没有产生规则变更建议</div></div></div><div class="card-body"><p class="hint">如果后续发现业务口径差异，可以重新分析或在大脑中提出规则变更。</p></div></div>`;
  }
  if (proposal.status === 'applied' || req.status !== 'awaiting_decision') {
    return `<div class="card">
      <div class="card-head"><div><div class="card-title">业务裁决</div><div class="card-sub">裁决绑定提案哈希与基准版本</div></div><div>${proposal.status === 'applied' ? '<span class="badge green">已应用</span>' : proposal.status === 'decided' ? '<span class="badge amber">已记录未应用</span>' : fmt.statusBadge(req.status)}</div></div>
      <div class="card-body stack">
        ${changesBlock(proposal)}
        ${detail.decision ? `<div class="info-box"><strong>裁决：${fmt.escapeHtml({ adopt: '采用新口径', keep: '保留现行规则', conditional: '附加条件后采用' }[detail.decision.chosen?.action] || detail.decision.chosen?.action || '')}</strong>${fmt.escapeHtml(detail.decision.reason)}${detail.decision.condition ? `<br>条件：${fmt.escapeHtml(detail.decision.condition)}` : ''}</div>` : ''}
        <div class="proposal-meta"><span>proposal ${fmt.escapeHtml(fmt.shortHash(proposal.proposal_hash, 16))}</span><span>base r${proposal.base_revision}</span>${detail.decision ? `<span>decision ${fmt.escapeHtml(fmt.shortHash(detail.decision.id, 14))}</span>` : ''}</div>
      </div>
    </div>`;
  }
  return `<div class="card">
    <div class="card-head"><div><div class="card-title">业务裁决</div><div class="card-sub">选择必须绑定当前提案；不提供通用“同意继续”。</div></div><span class="badge amber">需要裁决</span></div>
    <div class="card-body stack">
      ${conflictCards(proposal)}
      <div>
        <div class="section-heading"><h2>拟变更规则</h2><span class="sub">${(proposal.changes || []).length} 项</span></div>
        ${changesBlock(proposal)}
      </div>
      ${proposal.reason ? `<div class="info-box"><strong>为什么需要裁决</strong>${fmt.escapeHtml(proposal.reason)}</div>` : ''}
      ${decisionForm(proposal)}
    </div>
  </div>`;
}

function analysisBlock(detail) {
  const analysis = detail.analysis || {};
  const req = detail.requirement;
  return `<div class="card">
    <div class="card-head"><div><div class="card-title">需求基线</div><div class="card-sub">${fmt.escapeHtml(analysis.summary || '尚未形成分析摘要')}</div></div>${fmt.sourceChip(analysis.source)}</div>
    <div class="card-body stack">
      <div class="kv">
        <div class="kv-row"><dt>目标</dt><dd>${fmt.escapeHtml(req.goal)}</dd></div>
        <div class="kv-row"><dt>范围内</dt><dd>${fmt.listItems(req.scope?.in_scope || analysis.scope?.in_scope, { empty: '尚未填写' })}</dd></div>
        <div class="kv-row"><dt>明确不做</dt><dd>${fmt.listItems(req.scope?.out_of_scope || analysis.scope?.out_of_scope, { empty: '尚未填写' })}</dd></div>
        <div class="kv-row"><dt>角色与端</dt><dd>${fmt.escapeHtml((analysis.roles || []).map((item) => item.name || item).join('、') || '未识别')} · ${fmt.escapeHtml((analysis.endpoints || []).map((item) => item.name || item).join('、') || '未识别')}</dd></div>
        <div class="kv-row"><dt>分析来源</dt><dd>${fmt.escapeHtml(analysis.source === 'local-heuristic' ? '本地规则分析（不调用模型）' : analysis.source || '未记录')}</dd></div>
      </div>
      ${(analysis.core_flows || []).length ? `<div><div class="section-heading"><h2>核心流程</h2></div>${fmt.listItems(analysis.core_flows)}</div>` : ''}
      ${(req.impact?.actual || []).length || (req.impact?.verify || []).length ? `<div class="grid-3">
        <div><div class="conflict-label">实际修改</div>${fmt.listItems(req.impact?.actual || analysis.impact?.actual, { empty: '未识别' })}</div>
        <div><div class="conflict-label">需要核对</div>${fmt.listItems(req.impact?.verify || analysis.impact?.verify, { empty: '未识别' })}</div>
        <div><div class="conflict-label">保持既有行为</div>${fmt.listItems(req.impact?.keep || analysis.impact?.keep, { empty: '未识别' })}</div>
      </div>` : ''}
      ${(req.acceptance || analysis.acceptance || []).length ? `<div><div class="section-heading"><h2>验收条件</h2></div>${fmt.listItems(req.acceptance || analysis.acceptance)}</div>` : ''}
    </div>
  </div>`;
}

function cssSpecHtml(cssSpec) {
  const entries = cssSpec?.entries || [];
  const colors = entries.filter((item) => item.kind === 'color');
  const others = entries.filter((item) => item.kind !== 'color');
  const originLabel = (value) => ({ declared: '声明值', template: '模板默认', computed: '浏览器计算' }[value] || value || '');
  return `
    <div class="hint">颜色、字体、圆角与间距按来源区分。首版不生成浏览器计算值；静态扫描会单独标注。</div>
    <div class="spec-swatches">
      ${colors.map((item) => `<div class="swatch-card">
        <span class="swatch" style="background:${fmt.escapeHtml(item.value)}"></span>
        <div><strong>${fmt.escapeHtml(item.value)}</strong><span>${fmt.escapeHtml(item.usage || '')}</span><em>${fmt.escapeHtml(originLabel(item.origin))}${item.extraction ? ` · ${fmt.escapeHtml(item.extraction)}` : ''}</em></div>
      </div>`).join('') || '<p class="hint">没有颜色条目。</p>'}
    </div>
    <table class="spec-table"><thead><tr><th>类型</th><th>值</th><th>用途</th><th>来源</th></tr></thead>
      <tbody>${others.map((item) => `<tr><td>${fmt.escapeHtml(item.kind)}</td><td><code>${fmt.escapeHtml(item.value)}</code></td><td>${fmt.escapeHtml(item.usage || '')}</td><td>${fmt.escapeHtml(originLabel(item.origin))}${item.extraction ? ` · ${fmt.escapeHtml(item.extraction)}` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">没有其他规范条目。</td></tr>'}</tbody>
    </table>`;
}

function artifactsBlock(ctx, detail) {
  const artifacts = detail.artifacts || [];
  if (artifacts.length === 0) {
    return `<div class="card"><div class="card-head"><div><div class="card-title">需求与设计产物</div><div class="card-sub">生成后会包含需求文档、交互规格、原型、CSS 规范与映射</div></div></div><div class="card-body"><p class="hint">完成裁决后即可生成。</p></div></div>`;
  }
  const tabs = [
    { key: 'prototype', label: 'HTML 原型' },
    { key: 'css', label: 'CSS 规范' },
    { key: 'spec', label: '交互规格' },
    { key: 'doc', label: '需求文档' },
    { key: 'mapping', label: '映射' }
  ];
  const active = tabs.some((tab) => tab.key === ctx.state.artifactTab) ? ctx.state.artifactTab : 'prototype';
  const prototype = artifacts.find((item) => item.type === 'prototype');
  const preview = prototype?.preview_url || '';
  const safePreview = preview.startsWith('pha-preview://') ? preview : '';
  let body = '';
  if (active === 'prototype') {
    body = safePreview
      ? `<div class="hint" style="margin:10px 0">隔离沙箱预览；原型数据为演示数据，不代表生产系统。</div><div class="preview-shell"><iframe class="preview-frame" sandbox="allow-scripts" src="${fmt.escapeHtml(safePreview)}" title="交互原型" data-testid="artifact-preview"></iframe></div>`
      : '<p class="hint">原型文件不可用。</p>';
  } else if (active === 'css') {
    body = cssSpecHtml(detail.cssSpec);
  } else if (active === 'spec') {
    body = `<pre class="code-block" data-testid="artifact-spec">${fmt.escapeHtml(fmt.json(detail.spec || {}))}</pre>`;
  } else if (active === 'doc') {
    body = `<div class="markdown-body">${fmt.markdown(detail.document || '')}</div>`;
  } else {
    const mapping = detail.mapping || {};
    body = `<div class="mapping-list">${(mapping.artifacts || []).map((item) => `<div class="mapping-row"><span class="badge outline">${fmt.escapeHtml(item.type)}</span><span class="grow mono small">${fmt.escapeHtml(item.path)}</span><span class="small muted">${fmt.escapeHtml(item.provider || '')}</span></div>`).join('') || '<p class="hint">没有映射记录。</p>'}</div>
      <div class="hint" style="margin-top:10px">规则引用：${(mapping.rule_refs || []).map((ref) => `${fmt.escapeHtml(ref.id)} r${ref.revision}`).join('、') || '无'}</div>`;
  }
  return `<div class="card">
    <div class="card-head"><div><div class="card-title">需求与设计产物</div><div class="card-sub">${artifacts.length} 项固定产物；与需求、规则版本共同进入交付清单</div></div>
      <button class="btn small" data-show-artifact="${fmt.escapeHtml(prototype?.path || '')}">定位文件</button>
    </div>
    <div class="card-body">
      <div class="artifact-tabs" id="artifact-tabs">
        ${tabs.map((tab) => `<button class="artifact-tab ${active === tab.key ? 'active' : ''}" data-artifact-tab="${tab.key}" data-testid="artifact-tab-${tab.key}">${tab.label}</button>`).join('')}
      </div>
      <div id="artifact-content">${body}</div>
      <div class="proposal-meta" style="margin-top:12px">${artifacts.map((item) => `<span>${fmt.escapeHtml(item.type)} · ${fmt.escapeHtml(item.state)}</span>`).join('')}</div>
    </div>
  </div>`;
}

function contextColumn(detail) {
  const req = detail.requirement;
  return `<div class="stack">
    <div class="card">
      <div class="card-head"><div><div class="card-title">${fmt.escapeHtml(detail.baseline?.name || '基线')}</div><div class="card-sub">${fmt.escapeHtml(detail.baseline?.status || '')} · 需求固定使用此版本</div></div>${detail.baseline ? fmt.statusBadge(detail.baseline.status) : ''}</div>
      <div class="card-body">
        ${detail.baseline?.status === 'planned' ? '<div class="warn-box" style="margin-bottom:10px">本需求使用计划基线：规则已确认但尚未切换为当前生效。</div>' : ''}
        <div class="stack" style="gap:10px">
          ${(detail.rules || []).map((rule) => `<div class="rule-statement">
            <div class="cluster" style="gap:6px">${fmt.ruleBadge(rule)}<span class="mono tiny">${fmt.escapeHtml(rule.id)} r${rule.revision}</span></div>
            <div class="small" style="margin-top:5px">${fmt.escapeHtml(rule.statement)}</div>
          </div>`).join('') || '<p class="hint">该基线没有规则。</p>'}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div><div class="card-title">来源证据</div><div class="card-sub">${(detail.evidence || []).length} 条</div></div></div>
      <div class="card-body stack" style="gap:8px">
        ${(detail.evidence || []).slice(0, 6).map((item) => `<div><div class="small" style="font-weight:550">${fmt.escapeHtml(item.title)}</div><div class="mono tiny muted" style="word-break:break-all">${fmt.escapeHtml(item.source_ref || '')}</div></div>`).join('') || '<p class="hint">暂无来源证据。</p>'}
      </div>
    </div>
    ${(detail.history || []).length > 0 ? `<div class="card">
      <div class="card-head"><div><div class="card-title">现行/历史对照</div><div class="card-sub">避免把已替代口径当作当前规则</div></div></div>
      <div class="card-body stack" style="gap:9px">
        ${detail.history.slice(0, 5).map((rule) => `<div><div class="cluster">${fmt.ruleBadge(rule)}<span class="mono tiny">${fmt.escapeHtml(rule.id)} r${rule.revision}</span></div><div class="small" style="margin-top:4px">${fmt.escapeHtml(rule.statement)}</div>${rule.reason ? `<div class="hint">${fmt.escapeHtml(rule.reason)}</div>` : ''}</div>`).join('')}
      </div>
    </div>` : ''}
    <div class="card">
      <div class="card-head"><div><div class="card-title">版本信息</div></div></div>
      <div class="card-body">
        <div class="kv-list">
          <div class="row"><span>需求 ID</span><strong class="mono">${fmt.escapeHtml(req.id)}</strong></div>
          <div class="row"><span>需求修订</span><strong>r${req.revision}</strong></div>
          <div class="row"><span>基线</span><strong class="mono">${fmt.escapeHtml(req.baseline_id || '')}</strong></div>
          <div class="row"><span>分析来源</span><strong>${fmt.escapeHtml(req.analysis_source || '未记录')}</strong></div>
          <div class="row"><span>规格生成</span><strong>${fmt.escapeHtml(req.spec_generation ? `${req.spec_generation.source}${req.spec_generation.page_count ? ` · ${req.spec_generation.page_count} 页` : ''}` : '尚未生成')}</strong></div>
        </div>
        <button class="btn small" id="open-project-folder" style="margin-top:12px">${icons.folder(13)} 打开项目目录</button>
      </div>
    </div>
    ${(detail.deliverables || []).length > 0 ? `<div class="card">
      <div class="card-head"><div><div class="card-title">交付版本</div></div></div>
      <div class="card-body stack" style="gap:8px">
        ${detail.deliverables.map((item) => `<div class="cluster"><span class="badge green">${fmt.escapeHtml(item.status)}</span><span class="mono tiny">${fmt.escapeHtml(item.id)}</span><span class="tiny muted">${fmt.date(item.created_at)}</span></div>`).join('')}
      </div>
    </div>` : ''}
  </div>`;
}

function detailPage(ctx, detail) {
  const req = detail.requirement;
  const analysis = analysisBlock(detail);
  const unknowns = `<div class="card">
    <div class="card-head"><div><div class="card-title">未知项</div><div class="card-sub">阻塞未知项会阻止生成与发布</div></div></div>
    <div class="card-body">${unknownsBlock(detail)}</div>
  </div>`;
  const decision = `<div id="decision-anchor">${proposalBlock(detail)}</div>`;
  const artifacts = artifactsBlock(ctx, detail);
  const artifactFirst = ['generated', 'reviewed', 'delivered'].includes(req.status);
  const decisionFirst = req.status === 'awaiting_decision';
  const mainBlocks = artifactFirst
    ? `${artifacts}${decision}${analysis}${unknowns}`
    : decisionFirst
      ? `${decision}${analysis}${unknowns}`
      : `${analysis}${unknowns}${decision}${artifacts}`;
  return `
    <div class="page-head">
      <div>
        <button class="link muted small" id="back-to-list">← 需求列表</button>
        <div class="page-eyebrow" style="margin-top:10px">Requirement</div>
        <h1 class="page-title">${fmt.escapeHtml(req.title)}</h1>
        <p class="page-sub">${fmt.escapeHtml(req.goal)}</p>
        <div class="cluster" style="margin-top:10px">
          ${fmt.statusBadge(req.status)}
          ${fmt.sourceChip(req.analysis_source)}
          <span class="mono small">${fmt.escapeHtml(req.id)} · r${req.revision}</span>
        </div>
      </div>
      <div class="page-actions">${actionBar(ctx, detail)}</div>
    </div>
    ${stepper(req.status)}
    ${req.next_step ? `<div class="next-card" style="margin-bottom:18px"><div class="orb">${icons.arrow(19)}</div><div class="grow"><div class="title">下一步</div><div class="sub">${fmt.escapeHtml(req.next_step)}</div></div></div>` : ''}
    <div id="req-error"></div>
    ${req.last_error ? `<div class="error-box" style="margin-bottom:16px"><strong>上次分析失败：${fmt.escapeHtml(req.last_error.code || 'RUNTIME_FAILED')}</strong>${fmt.escapeHtml(req.last_error.message || '')}${req.last_error.log ? `<br>日志：<span class="mono">${fmt.escapeHtml(req.last_error.log)}</span>` : ''}</div>` : ''}
    ${req.spec_generation?.warning ? `<div class="warn-box" style="margin-bottom:16px"><strong>模型规格生成失败，已回退本地规则规格</strong>${fmt.escapeHtml(req.spec_generation.warning.message || req.spec_generation.warning.code || '')}</div>` : ''}
    <div class="grid-2">
      <div class="stack">${mainBlocks}</div>
      ${contextColumn(detail)}
    </div>`;
}

function bindDetail(ctx, container, detail) {
  const root = ctx.state.current.root;
  const req = detail.requirement;
  const showError = (error) => {
    const box = container.querySelector('#req-error');
    if (box) box.innerHTML = ui.errorBox(error);
    ui.toast(errorText(error), 'error');
  };
  container.querySelector('#back-to-list')?.addEventListener('click', () => ctx.navigate(ctx.productHash(root, 'requirements')));

  container.querySelectorAll('[data-save-unknown]').forEach((button) => {
    button.addEventListener('click', async () => {
      const input = container.querySelector(`[data-unknown="${CSS.escape(button.dataset.saveUnknown)}"]`);
      const answer = input?.value.trim();
      if (!answer) { ui.toast('请先填写回答', 'error'); return; }
      ui.setBusy(button, true, '保存中');
      try {
        await api('requirements:answer-unknown', { root, requirementId: req.id, unknownId: button.dataset.saveUnknown, answer });
        ui.toast('已保存回答', 'success');
        await ctx.refreshProject();
      } catch (error) {
        ui.setBusy(button, false);
        showError(error);
      }
    });
  });

  const analyze = async (button) => {
    ui.setBusy(button, true, '分析中…');
    try {
      await api('requirements:analyze', { root, requirementId: req.id });
      ui.toast('分析完成', 'success');
      await ctx.refreshProject();
    } catch (error) {
      ui.setBusy(button, false);
      showError(error);
    }
  };
  container.querySelector('#req-analyze')?.addEventListener('click', (event) => analyze(event.currentTarget));

  const generate = async (button) => {
    ui.setBusy(button, true, '生成中…');
    try {
      await api('requirements:generate', { root, requirementId: req.id });
      ui.toast('产物已生成', 'success');
      await ctx.refreshProject();
    } catch (error) {
      ui.setBusy(button, false);
      showError(error);
    }
  };
  container.querySelector('#req-generate')?.addEventListener('click', (event) => generate(event.currentTarget));
  container.querySelector('#req-regenerate')?.addEventListener('click', (event) => generate(event.currentTarget));

  container.querySelector('#req-review')?.addEventListener('click', async () => {
    const ok = await ui.confirmDialog({
      title: '评审通过',
      sub: '确认需求文档、交互规格、原型与 CSS 规范已经核对，并引用同一规则版本。评审通过后可以创建固定交付。',
      confirmLabel: '评审通过'
    });
    if (!ok) return;
    try {
      await api('requirements:review', { root, requirementId: req.id, note: '客户端评审通过' });
      ui.toast('已记录评审通过', 'success');
      await ctx.refreshProject();
    } catch (error) {
      showError(error);
    }
  });

  container.querySelector('#req-deliver')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    ui.setBusy(button, true, '创建交付…');
    try {
      const delivery = await api('deliveries:create', { root, requirementId: req.id });
      const exported = await api('deliveries:export', { root, deliveryId: delivery.id });
      ui.toast(`交付已导出：${exported.export_dir}`, 'success', 6000);
      await ctx.refreshProject();
    } catch (error) {
      ui.setBusy(button, false);
      showError(error);
    }
  });

  container.querySelector('#req-open-delivery')?.addEventListener('click', async () => {
    const delivery = (detail.deliverables || [])[0];
    if (!delivery) { ui.toast('没有可打开的交付版本', 'error'); return; }
    try {
      await api('deliveries:open', { root, deliveryId: delivery.id });
    } catch (error) {
      showError(error);
    }
  });

  container.querySelector('#scroll-decision')?.addEventListener('click', () => {
    container.querySelector('#decision-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  container.querySelector('#open-project-folder')?.addEventListener('click', async () => {
    try {
      await api('shell:open-path', { root, path: root });
    } catch (error) {
      showError(error);
    }
  });

  container.querySelectorAll('[data-artifact-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      ctx.state.artifactTab = button.dataset.artifactTab;
      container.querySelectorAll('[data-artifact-tab]').forEach((item) => item.classList.toggle('active', item === button));
      const html = artifactsBlock(ctx, detail);
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;
      const newContent = wrapper.querySelector('#artifact-content').innerHTML;
      container.querySelector('#artifact-content').innerHTML = newContent;
      bindArtifactShow(ctx, container, detail);
    });
  });
  bindArtifactShow(ctx, container, detail);

  const decision = container.querySelector('#decision-anchor');
  if (decision) {
    const radios = decision.querySelectorAll('input[name="decision-action"]');
    const conditionField = decision.querySelector('#condition-field');
    const reason = decision.querySelector('#decision-reason');
    const submit = decision.querySelector('#decision-submit');
    const sync = () => {
      if (!submit) return;
      const action = [...radios].find((radio) => radio.checked)?.value || '';
      decision.querySelectorAll('.choice').forEach((choice) => choice.classList.toggle('selected', choice.dataset.choice === action));
      conditionField?.classList.toggle('hidden', action !== 'conditional');
      submit.disabled = !action || !reason?.value.trim() || (action === 'conditional' && !decision.querySelector('#decision-condition')?.value.trim());
    };
    radios.forEach((radio) => radio.addEventListener('change', sync));
    reason?.addEventListener('input', sync);
    decision.querySelector('#decision-condition')?.addEventListener('input', sync);
    submit?.addEventListener('click', async () => {
      const action = [...radios].find((radio) => radio.checked)?.value;
      const message = reason?.value.trim();
      const condition = decision.querySelector('#decision-condition')?.value.trim() || '';
      if (!action || !message) return;
      ui.setBusy(submit, true, '应用中…');
      try {
        await api('brain:decide', {
          root,
          requirementId: req.id,
          proposalHash: detail.proposal.proposal_hash,
          baseRevision: detail.proposal.base_revision,
          action,
          reason: message,
          condition
        });
        ui.toast('裁决已应用', 'success');
        await ctx.refreshProject();
      } catch (error) {
        ui.setBusy(submit, false);
        const errorBox = decision.querySelector('#decision-error');
        if (errorBox) {
          errorBox.innerHTML = `${ui.errorBox(error)}${error.code === 'STALE_PROPOSAL' ? '<button class="btn small" id="reload-proposal" style="margin-top:8px">重新读取当前提案</button>' : ''}`;
          errorBox.querySelector('#reload-proposal')?.addEventListener('click', () => ctx.refreshProject());
        }
        ui.toast(errorText(error), 'error');
      }
    });
    sync();
  }
}

function bindArtifactShow(ctx, container, detail) {
  container.querySelectorAll('[data-show-artifact]').forEach((button) => {
    button.addEventListener('click', async () => {
      const artifactPath = button.dataset.showArtifact;
      if (!artifactPath) return;
      try {
        await api('shell:show-item', { root: ctx.state.current.root, path: ctx.state.current.root + '/' + artifactPath });
      } catch (error) {
        ui.toast(errorText(error), 'error');
      }
    });
  });
}

export async function renderRequirements(ctx, container, id) {
  const root = ctx.state.current.root;
  if (!id) {
    const requirements = await api('requirements:list', { root });
    container.innerHTML = requirementList(ctx, requirements);
    bindList(ctx, container);
    return;
  }
  try {
    const detail = await api('requirements:get', { root, requirementId: id });
    container.innerHTML = detailPage(ctx, detail);
    bindDetail(ctx, container, detail);
  } catch (error) {
    container.innerHTML = `<div class="page-head"><div><div class="page-eyebrow">需求</div><h1 class="page-title">无法读取需求</h1></div></div>${ui.errorBox(error)}
      <div class="btn-row" style="margin-top:16px"><button class="btn" id="req-back">返回需求列表</button></div>`;
    container.querySelector('#req-back')?.addEventListener('click', () => ctx.navigate(ctx.productHash(root, 'requirements')));
  }
}
