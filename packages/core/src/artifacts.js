import { SCHEMA } from './models.js';
import { escapeHtml, hashObject, makeId, slugify } from './util.js';

export function defaultTokens() {
  return {
    schema_version: 'pha-tokens-v1',
    source: 'template',
    colors: [
      { name: 'ink', value: '#1D1D1B', usage: '主文本与标题' },
      { name: 'muted', value: '#6F6D66', usage: '次要说明' },
      { name: 'paper', value: '#F6F5F1', usage: '页面背景' },
      { name: 'surface', value: '#FFFFFF', usage: '内容卡片' },
      { name: 'accent', value: '#1F6F5C', usage: '主操作与当前状态' },
      { name: 'accent-soft', value: '#E3EFEA', usage: '选中背景与轻提示' },
      { name: 'border', value: '#E3E0D8', usage: '分隔线与卡片描边' },
      { name: 'warning', value: '#B5622A', usage: '待裁决与风险提醒' },
      { name: 'danger', value: '#A33A32', usage: '错误与破坏性操作' }
    ],
    typography: [
      { name: '正文', value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif', usage: '页面正文' },
      { name: '数据与编号', value: 'ui-monospace, SFMono-Regular, Menlo, monospace', usage: '规则 ID、版本号与数据' }
    ],
    radii: [
      { name: '卡片', value: '14px', usage: '内容卡片与原型面板' },
      { name: '控件', value: '9px', usage: '按钮与输入框' }
    ],
    spacing: [
      { name: '页面', value: '32px', usage: '页面外边距' },
      { name: '区块', value: '20px', usage: '卡片之间' },
      { name: '紧凑', value: '8px', usage: '控件内部' }
    ]
  };
}

function tokenColor(tokens, name, fallback) {
  return tokens?.colors?.find((item) => item.name === name)?.value || fallback;
}

function primaryEndpoint(product, requirement) {
  const refs = requirement.endpoint_refs || [];
  return product.endpoints.find((item) => refs.includes(item.id)) || product.endpoints[0] || { name: '业务端', role: '使用者' };
}

export function buildInteractionSpec({ product, requirement, analysis = {}, rules = [], tokens = null }) {
  const endpoint = primaryEndpoint(product, requirement);
  const objects = (analysis.objects || []).map((item) => (typeof item === 'string' ? { name: item } : item)).filter((item) => item.name);
  const pageName = analysis.interaction_hints?.primary_page_name || requirement.title;
  const ruleText = rules.map((rule) => `${rule.statement}`).join('；');
  const conflicts = analysis.conflicts || [];
  const blockers = (requirement.unknowns || []).filter((item) => item.blocking);
  const fields = objects.slice(0, 6).map((item) => ({
    name: item.name,
    type: '文本',
    required: false,
    note: '原型演示字段，真实字段以后端契约为准'
  }));
  if (fields.length === 0) {
    fields.push({ name: '业务标识', type: '文本', required: true, note: '原型演示字段' });
  }
  const states = [
    {
      name: '默认',
      behavior: analysis.core_flows?.[1] || `依据当前基线规则判断是否允许在「${endpoint.name}」继续操作`
    },
    {
      name: '空数据',
      behavior: '没有可展示的业务记录时，说明空数据原因并提供主操作入口'
    },
    {
      name: '异常',
      behavior: conflicts.length > 0
        ? `存在待裁决冲突：${conflicts[0].why || '业务口径未确认'}`
        : (analysis.impact?.verify?.[0] || '规则不满足、无权限或数据异常时给出明确阻断原因')
    }
  ];
  const pages = [{
    id: `PAGE-${slugify(pageName, 'main', 32).toUpperCase()}`,
    name: pageName,
    responsibility: `在「${endpoint.name}」中完成“${requirement.title}”相关操作，并按当前基线规则给出可解释的结果。`,
    entry_conditions: [
      `角色进入「${endpoint.name}」`,
      `当前需求使用基线：${requirement.baseline_id}`
    ],
    roles: [endpoint.role, ...(analysis.roles || []).map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean)].slice(0, 4),
    components: ['页面标题', '业务依据', '筛选或操作区', '结果列表或确认区', '状态反馈'],
    states,
    fields,
    behaviors: analysis.core_flows?.length > 0
      ? analysis.core_flows
      : [
          `在「${endpoint.name}」发起操作`,
          '系统读取当前基线的适用规则',
          '按规则结果继续或阻断，并给出原因'
        ],
    feedback: ['操作成功：显示结果与关联业务对象', '操作阻断：显示命中的规则与下一步', '待裁决：暂停依赖该判断的生成'],
    exceptions: [
      analysis.impact?.verify?.[0] || '历史数据或快照与当前规则不一致',
      ...(blockers.length > 0 ? blockers.map((item) => `待确认：${item.question}`) : [])
    ],
    design_constraints: [
      '主操作使用 accent 色，错误与阻断使用 danger 色',
      '规则 ID、版本和基线必须可见',
      '演示数据不得被理解为真实业务数据'
    ],
    acceptance_refs: (requirement.acceptance || []).slice(0, 5)
  }];
  return {
    schema_version: SCHEMA.interactionSpec,
    requirement_id: requirement.id,
    baseline_id: requirement.baseline_id,
    source: analysis.source || 'local-heuristic',
    summary: analysis.summary || '',
    rules: rules.map((rule) => ({
      id: rule.id, revision: rule.revision, statement: rule.statement,
      knowledge_status: rule.knowledge_status, effective_state: rule.effective_state
    })),
    evidence_refs: (analysis.evidence_refs || []).slice(0, 10),
    pages,
    tokens_used: tokens ? 'design/tokens.json' : null,
    note: ruleText ? '页面行为必须与所列规则版本一致。' : '当前没有可引用的规则版本，需补充业务依据。'
  };
}

export function buildRequirementMarkdown({
  product, requirement, analysis = {}, rules = [], evidence = [], baseline = null, artifacts = []
}) {
  const lines = [];
  lines.push(`# ${requirement.title}`);
  lines.push('');
  lines.push(`- 需求 ID：\`${requirement.id}\``);
  lines.push(`- 产品：${product.name}`);
  lines.push(`- 基线：${baseline ? `${baseline.name}（${baseline.status}）` : requirement.baseline_id}`);
  lines.push(`- 状态：${requirement.status}`);
  lines.push(`- 分析来源：${analysis.source === 'local-heuristic' ? '本地规则分析（非模型）' : analysis.source || '未记录'}`);
  lines.push('');
  lines.push('## 1 目标');
  lines.push('');
  lines.push(requirement.goal);
  lines.push('');
  if (requirement.raw_input) {
    lines.push('### 原始输入');
    lines.push('');
    lines.push('```text');
    lines.push(requirement.raw_input);
    lines.push('```');
    lines.push('');
  }
  lines.push('## 2 范围');
  lines.push('');
  lines.push('**范围内**');
  lines.push('');
  for (const item of requirement.scope?.in_scope || analysis.scope?.in_scope || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('**明确不做**');
  lines.push('');
  for (const item of requirement.scope?.out_of_scope || analysis.scope?.out_of_scope || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 3 业务依据');
  lines.push('');
  if (rules.length === 0) {
    lines.push('当前基线没有可引用的规则版本，需求只能作为候选继续整理。');
  } else {
    lines.push('| 规则 | 版本 | 状态 | 正文 |');
    lines.push('| --- | --- | --- | --- |');
    for (const rule of rules) {
      lines.push(`| ${rule.id} | r${rule.revision} | ${rule.knowledge_status}/${rule.effective_state} | ${String(rule.statement).replaceAll('|', '\\|')} |`);
    }
  }
  lines.push('');
  if (evidence.length > 0) {
    lines.push('### 来源证据');
    lines.push('');
    for (const item of evidence) {
      lines.push(`- **${item.title}**：${item.source_ref || '项目内记录'}${item.locator ? `（${item.locator}）` : ''}`);
    }
    lines.push('');
  }
  lines.push('## 4 角色与端');
  lines.push('');
  const endpointNames = (analysis.endpoints || []).map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean);
  lines.push(`- 角色：${(analysis.roles || []).map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean).join('、') || '未识别'}`);
  lines.push(`- 端：${endpointNames.join('、') || product.endpoints.map((item) => item.name).join('、')}`);
  lines.push('');
  lines.push('## 5 核心流程');
  lines.push('');
  for (const [index, item] of (analysis.core_flows || []).entries()) {
    lines.push(`${index + 1}. ${item}`);
  }
  lines.push('');
  lines.push('## 6 影响分析');
  lines.push('');
  lines.push('**实际修改**');
  lines.push('');
  for (const item of requirement.impact?.actual || analysis.impact?.actual || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('**需要核对**');
  lines.push('');
  for (const item of requirement.impact?.verify || analysis.impact?.verify || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('**保持既有行为**');
  lines.push('');
  for (const item of requirement.impact?.keep || analysis.impact?.keep || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 7 规则冲突与裁决');
  lines.push('');
  if ((analysis.conflicts || []).length === 0) {
    lines.push('本次分析未识别到规则冲突。');
  } else {
    for (const conflict of analysis.conflicts) {
      lines.push(`### ${conflict.topic}`);
      lines.push('');
      lines.push(`- 现行规则：${conflict.existing_rules.map((rule) => `${rule.id} r${rule.revision}：${rule.statement}`).join('；')}`);
      lines.push(`- 新口径：${conflict.proposed_statement}`);
      lines.push(`- 冲突原因：${conflict.why}`);
      lines.push('');
    }
  }
  lines.push('## 8 未知项');
  lines.push('');
  if ((requirement.unknowns || []).length === 0) {
    lines.push('无记录的未知项。');
  } else {
    for (const item of requirement.unknowns) {
      lines.push(`- [${item.blocking ? '阻塞' : '非阻塞'}] ${item.question}${item.answer ? `\n  - 回答：${item.answer}` : ''}`);
    }
  }
  lines.push('');
  lines.push('## 9 验收条件');
  lines.push('');
  for (const item of requirement.acceptance || analysis.acceptance || []) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## 10 产物');
  lines.push('');
  for (const artifact of artifacts) {
    lines.push(`- ${artifact.type}：\`${artifact.path}\`（${artifact.state}）`);
  }
  lines.push('');
  lines.push('## 11 交付边界');
  lines.push('');
  lines.push('- 本需求文档描述预期行为，不代表后端或生产系统已完成。');
  lines.push('- 规则是否生效以基线状态为准；planned 规则不自动覆盖 current 规则。');
  lines.push('- 交付版本固定需求、规则与产物版本；后续变更需重新生成或核对。');
  lines.push('');
  return lines.join('\n');
}

function prototypeCss(tokens) {
  const c = (name, fallback) => tokenColor(tokens, name, fallback);
  return `
    :root {
      --ink: ${c('ink', '#1D1D1B')};
      --muted: ${c('muted', '#6F6D66')};
      --paper: ${c('paper', '#F6F5F1')};
      --surface: ${c('surface', '#FFFFFF')};
      --accent: ${c('accent', '#1F6F5C')};
      --accent-soft: ${c('accent-soft', '#E3EFEA')};
      --border: ${c('border', '#E3E0D8')};
      --warning: ${c('warning', '#B5622A')};
      --danger: ${c('danger', '#A33A32')};
      --radius: 14px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; background: var(--paper); color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .topbar {
      height: 48px; display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; background: #1C1D1A; color: #F4F2EC; font-size: 12px;
      letter-spacing: .08em;
    }
    .topbar .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; }
    .topbar .dot { width: 8px; height: 8px; border-radius: 50%; background: #7BC6A8; }
    .badge { border: 1px solid rgba(255,255,255,.25); border-radius: 999px; padding: 3px 9px; color: #D8D5CC; }
    main { max-width: 1180px; margin: 0 auto; padding: 34px 28px 48px; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; margin-bottom: 10px; }
    h1 { font-size: 30px; line-height: 1.2; margin: 0 0 10px; letter-spacing: -.02em; }
    .lede { margin: 0; color: var(--muted); max-width: 720px; line-height: 1.7; font-size: 14px; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 22px; margin-top: 28px; }
    .panel, .aside { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
    .panel { overflow: hidden; }
    .page-tabs, .state-tabs { display: flex; gap: 6px; padding: 14px 18px 0; flex-wrap: wrap; }
    .tab {
      border: 1px solid transparent; background: transparent; color: var(--muted);
      border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer;
    }
    .tab[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); border-color: #C9E0D7; font-weight: 600; }
    .page-body { padding: 22px; }
    .state-block { display: none; }
    .state-block.active { display: block; }
    .toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 16px; }
    .toolbar h2 { margin: 0; font-size: 16px; }
    .toolbar .hint { color: var(--muted); font-size: 12px; }
    .btn {
      border: 1px solid var(--border); background: var(--surface); color: var(--ink);
      padding: 9px 14px; border-radius: 9px; font-size: 13px; cursor: pointer;
    }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn.danger { background: #FBEEEC; border-color: #E6C4BF; color: var(--danger); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding: 10px 8px; border-bottom: 1px solid var(--border); }
    td { padding: 12px 8px; border-bottom: 1px solid #EFEDE6; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; }
    .pill.warn { background: #F7E9DE; color: var(--warning); }
    .empty, .error { padding: 44px 24px; text-align: center; }
    .empty h3, .error h3 { margin: 0 0 8px; font-size: 16px; }
    .empty p, .error p { margin: 0 auto 18px; color: var(--muted); max-width: 420px; line-height: 1.7; font-size: 13px; }
    .error { background: #FDF6F4; border-top: 1px solid #F0DAD5; }
    .error h3 { color: var(--danger); }
    .aside { padding: 20px; height: fit-content; }
    .aside h2 { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }
    .aside h2:not(:first-child) { margin-top: 22px; }
    .rule { border-left: 2px solid var(--accent); padding: 2px 0 2px 10px; margin-bottom: 12px; }
    .rule code { font-size: 10px; color: var(--muted); display: block; margin-bottom: 4px; }
    .rule p { margin: 0; font-size: 12px; line-height: 1.6; }
    .aside ul { margin: 0; padding-left: 16px; color: var(--muted); font-size: 12px; line-height: 1.7; }
    .footer-note { margin-top: 18px; color: var(--muted); font-size: 11px; line-height: 1.6; }
    @media (max-width: 860px) { .layout { grid-template-columns: 1fr; } }
  `;
}

export function renderPrototypeHtml({ product, requirement, spec, tokens = defaultTokens() }) {
  const page = spec.pages[0];
  const color = (name, fallback) => tokenColor(tokens, name, fallback);
  const fields = page.fields.length > 0 ? page.fields : [{ name: '业务标识' }, { name: '状态' }];
  const rows = [
    Object.fromEntries(fields.map((field, index) => [field.name, index === 0 ? '示例记录 A' : (index === 1 ? '示例状态' : '示例值')])),
    Object.fromEntries(fields.map((field, index) => [field.name, index === 0 ? '示例记录 B' : (index === 1 ? '示例状态' : '示例值')]))
  ];
  const tableHead = fields.map((field) => `<th>${escapeHtml(field.name)}</th>`).join('');
  const tableRows = rows.map((row) => `<tr>${fields.map((field) => `<td>${escapeHtml(row[field.name])}</td>`).join('')}</tr>`).join('');
  const ruleItems = spec.rules.length > 0
    ? spec.rules.map((rule) => `<div class="rule"><code>${escapeHtml(rule.id)} · r${rule.revision}</code><p>${escapeHtml(rule.statement)}</p></div>`).join('')
    : '<p class="lede">暂无可引用规则版本。</p>';
  const acceptanceItems = (page.acceptance_refs || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const stateTabs = page.states.map((state, index) => (
    `<button class="tab" role="tab" aria-selected="${index === 0}" data-state="${escapeHtml(state.name)}">${escapeHtml(state.name)}</button>`
  )).join('');
  const stateBlocks = page.states.map((state, index) => {
    if (index === 1 || /空/.test(state.name)) {
      return `<section class="state-block${index === 0 ? ' active' : ''}" data-state-panel="${escapeHtml(state.name)}">
        <div class="empty"><h3>还没有可展示的记录</h3><p>${escapeHtml(state.behavior || '当前筛选条件下没有数据。')}</p><button class="btn primary">发起操作</button></div>
      </section>`;
    }
    if (index === 2 || /异常|错误/.test(state.name)) {
      return `<section class="state-block${index === 0 ? ' active' : ''}" data-state-panel="${escapeHtml(state.name)}">
        <div class="error"><h3>操作未完成</h3><p>${escapeHtml(state.behavior || '当前条件不满足业务规则。')}</p><button class="btn danger">查看依据</button></div>
      </section>`;
    }
    return `<section class="state-block${index === 0 ? ' active' : ''}" data-state-panel="${escapeHtml(state.name)}">
      <div class="toolbar"><h2>${escapeHtml(page.name)}</h2><span class="hint">${escapeHtml(state.behavior || '')}</span></div>
      <div class="toolbar"><div><span class="pill">规则校验通过</span></div><div><button class="btn">查看详情</button> <button class="btn primary">${escapeHtml(requirement.title.slice(0, 12))}</button></div></div>
      <table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(requirement.title)} · 交互原型</title>
<style>${prototypeCss(tokens)}</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="dot"></span> PROTO HARNESS AGENT</div>
  <span class="badge">交互原型 · 演示数据</span>
</header>
<main>
  <div class="eyebrow">${escapeHtml(product.name)} / ${escapeHtml(page.name)}</div>
  <h1>${escapeHtml(requirement.title)}</h1>
  <p class="lede">${escapeHtml(page.responsibility)}</p>
  <div class="layout">
    <section class="panel">
      <div class="state-tabs" role="tablist">${stateTabs}</div>
      <div class="page-body">${stateBlocks}</div>
    </section>
    <aside class="aside">
      <h2>业务依据</h2>
      ${ruleItems}
      <h2>验收关注</h2>
      <ul>${acceptanceItems || '<li>规则在主路径生效，并能给出明确反馈。</li>'}</ul>
      <p class="footer-note">原型用于表达预期行为与状态，不代表生产系统已完成。演示数据不可作为真实业务记录。</p>
    </aside>
  </div>
</main>
<script>
(function () {
  var tabs = document.querySelectorAll('[data-state]');
  var panels = document.querySelectorAll('[data-state-panel]');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (item) { item.setAttribute('aria-selected', String(item === tab)); });
      panels.forEach(function (panel) {
        panel.classList.toggle('active', panel.getAttribute('data-state-panel') === tab.getAttribute('data-state'));
      });
    });
  });
})();
</script>
</body>
</html>`;
}

export function buildCssSpec({ tokens = defaultTokens(), prototypeHtml = '', scanned = [], requirement }) {
  const entries = [];
  const push = (entry) => {
    const key = `${entry.kind}|${entry.value}|${entry.usage}|${entry.origin}`;
    if (entries.some((item) => `${item.kind}|${item.value}|${item.usage}|${item.origin}` === key)) return;
    entries.push(entry);
  };
  for (const item of tokens.colors || []) {
    push({
      kind: 'color', value: item.value, usage: item.usage || item.name,
      component_id: 'COMPONENT-TOKENS', state: 'default',
      origin: tokens.source === 'template' ? 'template' : 'declared',
      source_ref: 'design/tokens.json', token_name: item.name
    });
  }
  for (const item of tokens.typography || []) {
    push({
      kind: 'font', value: item.value, usage: item.usage || item.name,
      component_id: 'COMPONENT-TOKENS', state: 'default',
      origin: tokens.source === 'template' ? 'template' : 'declared',
      source_ref: 'design/tokens.json', token_name: item.name
    });
  }
  for (const item of tokens.radii || []) {
    push({
      kind: 'radius', value: item.value, usage: item.usage || item.name,
      component_id: 'COMPONENT-TOKENS', state: 'default',
      origin: tokens.source === 'template' ? 'template' : 'declared',
      source_ref: 'design/tokens.json', token_name: item.name
    });
  }
  for (const item of tokens.spacing || []) {
    push({
      kind: 'spacing', value: item.value, usage: item.usage || item.name,
      component_id: 'COMPONENT-TOKENS', state: 'default',
      origin: tokens.source === 'template' ? 'template' : 'declared',
      source_ref: 'design/tokens.json', token_name: item.name
    });
  }
  push({
    kind: 'color', value: tokenColor(tokens, 'accent', '#1F6F5C'),
    usage: '原型主操作按钮默认态', component_id: 'COMPONENT-PRIMARY-ACTION',
    state: 'default', origin: 'template', source_ref: 'artifacts/prototype.html'
  });
  push({
    kind: 'color', value: tokenColor(tokens, 'danger', '#A33A32'),
    usage: '原型错误与阻断反馈', component_id: 'COMPONENT-ERROR',
    state: 'error', origin: 'template', source_ref: 'artifacts/prototype.html'
  });
  for (const item of scanned) {
    push({
      kind: item.kind || 'color', value: item.value, usage: item.usage || item.name || '来源样式',
      component_id: item.component_id || 'COMPONENT-SOURCE', state: item.state || 'default',
      origin: 'declared', extraction: 'static-scan', source_ref: item.source_ref || '',
      token_name: item.name || undefined
    });
  }
  return {
    schema_version: 'pha-css-spec-v1',
    requirement_id: requirement?.id || null,
    generated_at: new Date().toISOString(),
    note: 'origin 区分声明（declared）、模板默认（template）与浏览器计算值（computed）。首版没有 computed 值；static-scan 表示从源码静态读取。',
    entries
  };
}

export function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r/g, '').split('\n');
  const out = [];
  let inCode = false;
  let inUl = false;
  let inOl = false;
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  const inline = (text) => escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (/^```/.test(line)) {
      flushParagraph(); closeLists();
      if (!inCode) out.push('<pre><code>');
      else out.push('</code></pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    if (/^\s*$/.test(line)) { flushParagraph(); closeLists(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph(); closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }
    if (/^\|/.test(line)) {
      flushParagraph(); closeLists();
      out.push(`<p class="table-line">${inline(line)}</p>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph(); closeLists();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

export function htmlDocument(title, body, extraCss = '') {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  :root { --ink:#1D1D1B; --muted:#6F6D66; --paper:#F6F5F1; --surface:#fff; --accent:#1F6F5C; --border:#E3E0D8; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif; line-height:1.7; }
  header.top { background:#1C1D1A; color:#F4F2EC; padding:16px 28px; display:flex; justify-content:space-between; align-items:center; font-size:12px; letter-spacing:.08em; }
  header.top a { color:#CFE6DC; text-decoration:none; }
  main { max-width:860px; margin:0 auto; padding:40px 28px 64px; }
  h1 { font-size:30px; line-height:1.25; letter-spacing:-.02em; }
  h2 { margin-top:34px; font-size:20px; }
  h3 { margin-top:24px; font-size:15px; }
  p, li { font-size:14px; }
  code { background:#EDEAE2; padding:1px 5px; border-radius:4px; font-size:12px; }
  pre { background:#23241F; color:#EDEAE2; padding:16px; border-radius:10px; overflow:auto; }
  pre code { background:transparent; padding:0; }
  blockquote { border-left:3px solid var(--accent); margin:0; padding-left:14px; color:var(--muted); }
  .table-line { font-family:ui-monospace,Menlo,monospace; font-size:12px; border-bottom:1px solid var(--border); padding:6px 0; margin:0; }
  footer { max-width:860px; margin:0 auto; padding:0 28px 40px; color:var(--muted); font-size:12px; }
  ${extraCss}
</style>
</head>
<body>
<header class="top"><span>PROTO HARNESS AGENT · 固定交付</span><span>${escapeHtml(new Date().toISOString().slice(0, 10))}</span></header>
<main>${body}</main>
<footer>交付内容由固定版本生成；规则是否生效以交付清单中的基线状态为准。</footer>
</body>
</html>`;
  return html.replace(/[ \t]+$/gm, '');
}

export function artifactRevision(content) {
  return hashObject(content).slice(0, 16);
}

export function suggestedArtifactPaths(requirementId) {
  return {
    requirementDoc: `requirements/${requirementId}/requirement.md`,
    interactionSpec: `requirements/${requirementId}/interaction-spec.json`,
    prototype: `requirements/${requirementId}/artifacts/prototype.html`,
    cssSpec: `requirements/${requirementId}/artifacts/css-spec.json`,
    mapping: `requirements/${requirementId}/artifacts/mapping.json`
  };
}

export function buildMapping({ requirement, rules, artifacts }) {
  return {
    schema_version: 'pha-artifact-mapping-v1',
    requirement_id: requirement.id,
    baseline_id: requirement.baseline_id,
    rule_refs: rules.map((rule) => ({ id: rule.id, revision: rule.revision })),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      path: artifact.path,
      provider: artifact.provider,
      state: artifact.state
    })),
    note: '页面级映射；节点级映射需在具备稳定节点标识的设计工具中建立。'
  };
}

export { makeId };
