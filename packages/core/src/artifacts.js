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

const PAGE_TYPE_WORDS = {
  form: ['报名', '登记', '填写', '提交', '申请', '录入', '注册', '表单', '问卷', '姓名', '联系方式', '新增记录'],
  board: ['看板', '工单', '任务', '流转', '待处理', '处理中', '已完成', '受理', '派单', '进度'],
  settings: ['设置', '配置', '参数', '打印', '份数', '纸张', '双面', '开关', '阈值', '偏好', '权限配置'],
  dashboard: ['统计', '概览', '报表', '指标', '趋势', '汇总', '数据大屏'],
  detail: ['详情', '查看详情', '预览', '档案'],
  list: ['列表', '查询', '筛选', '记录', '明细', '管理', '检索', '台账']
};

function pageText(requirement, analysis) {
  const keepCurrent = analysis.decision?.action === 'keep';
  return [
    analysis.effective_title || requirement.title,
    analysis.effective_goal || requirement.goal,
    keepCurrent ? '' : requirement.raw_input,
    analysis.summary,
    ...(analysis.core_flows || []),
    ...(analysis.scope?.in_scope || []),
    ...(analysis.acceptance || []),
    ...(analysis.interaction_hints?.states || [])
  ].filter(Boolean).join(' ');
}

function scoreWords(text, words) {
  return words.reduce((score, word) => score + (text.includes(word) ? 2 : 0), 0);
}

function inferPageType(text) {
  const scores = Object.fromEntries(
    Object.entries(PAGE_TYPE_WORDS).map(([type, words]) => [type, scoreWords(text, words)])
  );
  const priority = ['form', 'board', 'settings', 'dashboard', 'detail', 'list'];
  let best = 'list';
  let bestScore = -1;
  for (const type of priority) {
    if (scores[type] > bestScore) {
      best = type;
      bestScore = scores[type];
    }
  }
  return bestScore <= 0 ? 'list' : best;
}

function shouldSplitPages(text, analysis) {
  const submit = /(填写|提交|报名|申请|登记|录入|注册)/.test(text);
  const manage = /(管理员|运营|审核|查看|列表|看板|查询|处理|配置)/.test(text);
  const roles = (analysis.roles || []).map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean);
  const endpoints = analysis.endpoints || [];
  return (submit && manage && roles.length >= 2) || (submit && endpoints.length >= 2 && (analysis.core_flows || []).length >= 3);
}

function extractExplicitFields(text) {
  const fields = [];
  const regex = /(?:填写|录入|提交|包括|包含|配置|设置|字段(?:为|有|[:：])?)([^。；;\n]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const segments = match[1].split(/[、，,/]|和|与/);
    const hasFieldTrigger = /字段/.test(match[0]);
    if (segments.length < 2 && !hasFieldTrigger) continue;
    const cleaned = segments
      .map((item) => item
        .replace(/等信息|等内容|等资料/g, '')
        .replace(/^(并|且|然后|再|需要|请|填写|录入)/, '')
        .replace(/(并|且|然后)?(提交|保存|取消|返回|查看|确认|完成|进入).*$/, '')
        .trim())
      .filter((item) => item.length >= 2 && item.length <= 12)
      .filter((item) => !/^(提交|保存|查看|确认|完成|处理|页面|保存设置|并保存设置|活动报名|报名列表)$/.test(item));
    for (const name of cleaned) {
      if (!fields.includes(name)) fields.push(name);
    }
    if (fields.length >= 8) break;
  }
  return fields.slice(0, 8);
}

function inferFieldType(name) {
  if (/(是否|开关|启用|允许|需要)/.test(name)) return 'switch';
  if (/(数量|份数|次数|金额|价格|时长|分钟|小时|天数|额度|阈值)/.test(name)) return 'number';
  if (/(日期|截止|开始时间|结束时间)/.test(name)) return 'date';
  if (/(电话|手机|联系方式)/.test(name)) return 'tel';
  if (/(邮箱|邮件)/.test(name)) return 'email';
  if (/(说明|备注|原因|描述|地址|内容)/.test(name)) return 'textarea';
  if (/(状态|类型|部门|角色|纸张|级别|优先级|权限|范围|方式)/.test(name)) return 'select';
  return 'text';
}

function optionsFor(name) {
  if (/状态/.test(name)) return ['待处理', '处理中', '已完成'];
  if (/部门/.test(name)) return ['运营部', '客服部', '财务部'];
  if (/纸张/.test(name)) return ['A4', 'A5', '自定义'];
  if (/类型|级别|优先级/.test(name)) return ['普通', '加急', '紧急'];
  if (/权限|角色/.test(name)) return ['管理员', '运营', '查看者'];
  return [];
}

function normalizedFields(names, fallbackObjects = []) {
  const source = names.length > 0 ? names : fallbackObjects.map((item) => item.name);
  const fields = [];
  for (const name of source) {
    if (!name || fields.some((item) => item.name === name)) continue;
    fields.push({
      name,
      type: inferFieldType(name),
      required: fields.length < 2,
      options: optionsFor(name),
      placeholder: `请输入${name}`
    });
    if (fields.length >= 6) break;
  }
  if (fields.length === 0) {
    fields.push({ name: '业务标识', type: 'text', required: true, options: [], placeholder: '请输入业务标识' });
  }
  return fields;
}

function defaultObjects(analysis) {
  return (analysis.objects || []).map((item) => (typeof item === 'string' ? { name: item } : item)).filter((item) => item.name);
}

function defaultColumns(fields, objects) {
  const columns = fields.slice(0, 4).map((field) => ({ name: field.name, type: field.type }));
  if (columns.length > 0) return columns;
  return [
    { name: objects[0]?.name || '业务标识', type: 'text' },
    { name: '状态', type: 'select' },
    { name: '负责人', type: 'text' },
    { name: '更新时间', type: 'date' }
  ];
}

function demoValue(field, index) {
  if (field.type === 'select') return field.options?.[index % Math.max(field.options.length, 1)] || '示例状态';
  if (field.type === 'number') return String(index + 1);
  if (field.type === 'date') return `2026-10-${String(21 + index).padStart(2, '0')}`;
  if (field.type === 'switch') return index % 2 === 0 ? '开启' : '关闭';
  if (/姓名/.test(field.name)) return ['林晓', '周然', '陈一'][index % 3];
  if (/部门/.test(field.name)) return ['运营部', '客服部', '财务部'][index % 3];
  if (/联系方式|电话|手机/.test(field.name)) return '138****000' + (index + 1);
  if (/标题|名称/.test(field.name)) return ['示例记录 A', '示例记录 B', '示例记录 C'][index % 3];
  return ['示例值 A', '示例值 B', '示例值 C'][index % 3];
}

function buildDemoRows(columns) {
  return [0, 1, 2].map((index) => Object.fromEntries(columns.map((column) => [
    column.name,
    demoValue(column, index)
  ])));
}

function boardColumnsFromText(text) {
  const found = ['待处理', '处理中', '已完成'].filter((name) => text.includes(name));
  if (found.length >= 2) return found;
  if (/看板|工单|任务/.test(text)) return ['待处理', '处理中', '已完成'];
  return [];
}

function boardColumnCards(columns, pageFields, text) {
  const statusField = pageFields.find((field) => /状态/.test(field.name));
  const titleField = pageFields.find((field) => /标题|名称|主题|工单/.test(field.name)) || pageFields[0];
  return columns.map((column, index) => ({
    name: column,
    count: index === 0 ? 2 : index === 1 ? 1 : 1,
    cards: [0, 1].slice(0, index === 0 ? 2 : 1).map((cardIndex) => ({
      title: `${titleField?.name || '业务记录'} ${index + 1}-${cardIndex + 1}`,
      meta: `${statusField?.name || '状态'}：${column}`,
      owner: ['林晓', '周然'][(index + cardIndex) % 2],
      tag: cardIndex === 0 ? '演示' : '示例'
    }))
  }));
}

function settingsGroups(fields, text) {
  const groupName = /打印/.test(text) ? '打印设置' : /权限/.test(text) ? '权限设置' : /通知/.test(text) ? '通知设置' : '业务设置';
  return [{
    title: groupName,
    description: '演示配置项；真实值以后端契约为准。',
    items: fields.map((field) => ({
      name: field.name,
      type: field.type,
      value: field.type === 'switch' ? true : demoValue(field, 0),
      options: field.options || []
    }))
  }];
}

function dashboardMetrics(objects, text) {
  const labels = objects.slice(0, 4).map((item) => `${item.name}总量`);
  const defaults = /工单|任务/.test(text) ? ['待处理工单', '今日完成', '平均处理时长'] : ['业务总量', '本期新增', '完成率'];
  return (labels.length > 0 ? labels : defaults).slice(0, 4).map((label, index) => ({
    label,
    value: ['128', '24', '92%', '6.4'][index] || '—',
    hint: index === 0 ? '示例聚合值' : '演示指标'
  }));
}

function commonPageFields({ requirement, analysis, endpoint, roles, decisionNote, effectiveTitle }) {
  const blockers = (requirement.unknowns || []).filter((item) => item.blocking && !item.answer);
  return {
    responsibility: `在「${endpoint.name}」中完成“${effectiveTitle}”相关操作，并按当前基线规则给出可解释的结果。`,
    entry_conditions: [
      `角色进入「${endpoint.name}」`,
      `当前需求使用基线：${requirement.baseline_id}`
    ],
    roles: [...new Set([endpoint.role, ...roles])].filter(Boolean).slice(0, 4),
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
    acceptance_refs: (requirement.acceptance || analysis.acceptance || []).slice(0, 5),
    decision_note: decisionNote
  };
}

function buildPage({ type, name, requirement, analysis, endpoint, roles, rules, decisionNote, effectiveTitle, index, text }) {
  const objects = defaultObjects(analysis);
  const explicitFields = extractExplicitFields(requirement.raw_input || text);
  const fields = normalizedFields(explicitFields, objects);
  const common = commonPageFields({
    requirement, analysis, endpoint, roles, decisionNote, effectiveTitle
  });
  const ruleHint = rules.length > 0 ? `规则校验：${rules.map((rule) => rule.statement).join('；')}` : '';
  if (type === 'form') {
    return {
      ...common,
      id: `PAGE-FORM-${index + 1}`,
      type,
      layout: 'single',
      name,
      components: ['页面标题', '说明区', '表单字段', '主操作', '校验与成功反馈'],
      primary_action: /报名/.test(text) ? '提交报名' : /申请/.test(text) ? '提交申请' : '提交',
      actions: [/报名/.test(text) ? '提交报名' : '提交', '保存草稿'],
      fields,
      columns: [],
      states: [
        { name: '填写', behavior: ruleHint || '填写字段后提交，系统按业务规则校验' },
        { name: '校验失败', behavior: '必填项为空或格式不正确时，逐字段提示并保留已填内容' },
        { name: '提交成功', behavior: '提交成功后展示结果编号与下一步' }
      ]
    };
  }
  if (type === 'board') {
    const columns = defaultColumns(fields, objects);
    const boardNames = boardColumnsFromText(text);
    return {
      ...common,
      id: `PAGE-BOARD-${index + 1}`,
      type,
      layout: 'board',
      name,
      components: ['筛选区', '看板列', '业务卡片', '状态操作', '空状态'],
      primary_action: /工单/.test(text) ? '新建工单' : '新建任务',
      actions: [/工单/.test(text) ? '新建工单' : '新建任务', '筛选'],
      fields: columns.map((column, columnIndex) => ({
        name: column.name, type: column.type, required: columnIndex === 0, options: [], placeholder: `输入${column.name}`
      })),
      columns,
      demo_rows: buildDemoRows(columns),
      board_columns: boardColumnCards(boardNames, columns.map((column) => ({ name: column.name, type: column.type })), text),
      states: [
        { name: '默认', behavior: ruleHint || '按状态列展示业务卡片，可切换筛选' },
        { name: '空数据', behavior: '当前筛选条件下没有卡片，提供新建入口' },
        { name: '异常', behavior: '数据加载失败或状态流转被规则阻断时，保留当前筛选并说明原因' }
      ]
    };
  }
  if (type === 'settings') {
    return {
      ...common,
      id: `PAGE-SETTINGS-${index + 1}`,
      type,
      layout: 'single',
      name,
      components: ['设置分组', '配置项', '保存栏', '恢复默认'],
      primary_action: '保存设置',
      actions: ['保存设置', '恢复默认'],
      fields,
      columns: [],
      groups: settingsGroups(fields, text),
      states: [
        { name: '默认', behavior: ruleHint || '修改配置后保存，变更按当前规则生效' },
        { name: '空数据', behavior: '没有可配置项时显示说明与联系管理员入口' },
        { name: '异常', behavior: '保存失败时保留已修改值并说明失败原因' }
      ]
    };
  }
  if (type === 'dashboard') {
    return {
      ...common,
      id: `PAGE-DASHBOARD-${index + 1}`,
      type,
      layout: 'single',
      name,
      components: ['指标卡', '趋势区', '筛选区', '明细入口'],
      primary_action: '查看明细',
      actions: ['切换时间范围', '查看明细'],
      fields: [],
      columns: [],
      metrics: dashboardMetrics(objects, text),
      states: [
        { name: '默认', behavior: ruleHint || '按时间范围展示聚合指标与明细入口' },
        { name: '空数据', behavior: '统计周期内没有数据时显示空态与时间范围说明' },
        { name: '异常', behavior: '指标计算失败时保留筛选条件并说明原因' }
      ]
    };
  }
  if (type === 'detail') {
    return {
      ...common,
      id: `PAGE-DETAIL-${index + 1}`,
      type,
      layout: 'single',
      name,
      components: ['标题区', '字段详情', '关联记录', '操作区'],
      primary_action: '返回列表',
      actions: ['返回列表'],
      fields,
      columns: [],
      sections: [
        { title: '目标', items: [analysis.effective_goal || requirement.goal] },
        { title: '范围', items: analysis.scope?.in_scope?.length ? analysis.scope.in_scope : ['按当前基线处理'] }
      ],
      states: [
        { name: '默认', behavior: ruleHint || '展示业务对象详情与关联记录' },
        { name: '空数据', behavior: '记录不存在或已被删除时显示空态' },
        { name: '异常', behavior: '无权查看或加载失败时说明原因' }
      ]
    };
  }
  const columns = defaultColumns(fields, objects);
  return {
    ...common,
    id: `PAGE-LIST-${index + 1}`,
    type: 'list',
    layout: 'single',
    name,
    components: ['页面标题', '筛选区', '列表主表', '行操作', '空状态'],
    primary_action: '新建记录',
    actions: ['新建记录', '筛选'],
    fields: columns.map((column, columnIndex) => ({
      name: column.name, type: column.type, required: columnIndex === 0, options: [], placeholder: `输入${column.name}`
    })),
    columns,
    demo_rows: buildDemoRows(columns),
    states: [
      { name: '默认', behavior: ruleHint || '按筛选条件展示业务记录' },
      { name: '空数据', behavior: '没有符合条件的记录时说明空数据原因并提供主操作' },
      { name: '异常', behavior: analysis.impact?.verify?.[0] || '规则不满足、无权限或数据异常时给出明确阻断原因' }
    ]
  };
}

export function buildInteractionSpec({ product, requirement, analysis = {}, rules = [], tokens = null, decision = null }) {
  const endpoint = primaryEndpoint(product, requirement);
  const endpointList = product.endpoints.length > 0
    ? product.endpoints.filter((item) => (requirement.endpoint_refs || []).includes(item.id))
    : [endpoint];
  const endpoints = endpointList.length > 0 ? endpointList : [endpoint];
  const roles = (analysis.roles || []).map((item) => (typeof item === 'string' ? item : item.name)).filter(Boolean);
  const text = pageText(requirement, analysis);
  const effectiveTitle = analysis.effective_title || requirement.title;
  const activeDecision = decision || analysis.decision || null;
  const decisionNote = activeDecision
    ? `业务裁决：${{ adopt: '采用新口径', keep: '保留现行规则', conditional: '附加条件后采用' }[activeDecision.chosen?.action] || activeDecision.chosen?.action || '已裁决'}。${activeDecision.reason || ''}${activeDecision.condition ? ` 条件：${activeDecision.condition}` : ''}`
    : '';
  const type = inferPageType(text);
  const pages = [];
  if (shouldSplitPages(text, analysis) && type !== 'settings' && type !== 'dashboard') {
    const firstType = type === 'form' ? 'form' : type;
    const secondType = /看板|工单|任务|进度/.test(text) ? 'board' : 'list';
    pages.push(buildPage({
      type: firstType,
      name: `${effectiveTitle} · 提交`,
      requirement, analysis, endpoint: endpoints[0], roles, rules, decisionNote,
      effectiveTitle, index: 0, text
    }));
    pages.push(buildPage({
      type: secondType,
      name: `${effectiveTitle} · 管理`,
      requirement, analysis, endpoint: endpoints[1] || endpoints[0], roles, rules, decisionNote,
      effectiveTitle, index: 1, text
    }));
  } else {
    const pageName = type === 'board' ? `${effectiveTitle} · 看板`
      : type === 'settings' ? `${effectiveTitle} · 设置`
        : effectiveTitle;
    pages.push(buildPage({
      type,
      name: pageName,
      requirement, analysis, endpoint: endpoints[0], roles, rules, decisionNote,
      effectiveTitle, index: 0, text
    }));
  }
  return {
    schema_version: SCHEMA.interactionSpec,
    requirement_id: requirement.id,
    baseline_id: requirement.baseline_id,
    source: analysis.source || 'local-heuristic',
    summary: analysis.summary || '',
    effective_title: effectiveTitle,
    decision: activeDecision ? {
      action: activeDecision.chosen?.action || null,
      reason: activeDecision.reason || '',
      condition: activeDecision.condition || '',
      rejected_changes: analysis.rejected_changes || []
    } : null,
    rules: rules.map((rule) => ({
      id: rule.id, revision: rule.revision, statement: rule.statement,
      constraints: rule.constraints || [],
      knowledge_status: rule.knowledge_status, effective_state: rule.effective_state
    })),
    evidence_refs: (analysis.evidence_refs || []).slice(0, 10),
    pages,
    note: rules.length > 0 ? '页面行为必须与所列规则版本一致。' : '当前没有可引用的规则版本，需补充业务依据。'
  };
}

function defaultStatesForType(type) {
  if (type === 'form') {
    return [
      { name: '填写', behavior: '填写字段后提交，系统按业务规则校验' },
      { name: '校验失败', behavior: '必填项为空或格式不正确时，逐字段提示并保留已填内容' },
      { name: '提交成功', behavior: '提交成功后展示结果编号与下一步' }
    ];
  }
  return [
    { name: '默认', behavior: '' },
    { name: '空数据', behavior: '当前没有可展示的内容。' },
    { name: '异常', behavior: '当前条件不满足业务规则或数据加载失败。' }
  ];
}

export function completeInteractionSpec(spec, { product, requirement, analysis = {}, rules = [], decision = null }) {
  const objects = defaultObjects(analysis);
  const effectiveDecision = decision || analysis.decision || spec.decision || null;
  const decisionNote = effectiveDecision
    ? `业务裁决：${{ adopt: '采用新口径', keep: '保留现行规则', conditional: '附加条件后采用' }[effectiveDecision.chosen?.action || effectiveDecision.action] || '已裁决'}。${effectiveDecision.reason || ''}${effectiveDecision.condition ? ` 条件：${effectiveDecision.condition}` : ''}`
    : '';
  const pages = (spec.pages || []).map((page, index) => {
    const pageTextValue = [
      page.name,
      page.responsibility,
      ...(page.behaviors || []),
      ...(page.fields || []).map((field) => (typeof field === 'string' ? field : field.name))
    ].filter(Boolean).join(' ');
    const type = page.type || inferPageType(pageTextValue);
    const fields = (page.fields || []).length > 0
      ? page.fields.map((field) => (typeof field === 'string' ? { name: field } : field)).map((field, fieldIndex) => ({
          ...field,
          name: String(field.name || `字段${fieldIndex + 1}`),
          type: field.type || inferFieldType(field.name || ''),
          required: field.required !== false && fieldIndex < 2,
          options: field.options || optionsFor(field.name || ''),
          placeholder: field.placeholder || `请输入${field.name || '内容'}`
        }))
      : normalizedFields(extractExplicitFields(pageTextValue), objects);
    const columns = (page.columns || []).length > 0
      ? page.columns
      : defaultColumns(fields, objects);
    const primaryAction = page.primary_action || (type === 'form' ? '提交' : type === 'settings' ? '保存设置' : type === 'board' ? '新建工单' : type === 'dashboard' ? '查看明细' : '新建记录');
    const normal = {
      ...page,
      id: page.id || `PAGE-${index + 1}`,
      type,
      layout: page.layout || (type === 'board' ? 'board' : 'single'),
      name: page.name || `${requirement.title} · ${index + 1}`,
      responsibility: page.responsibility || `按需求与规则完成页面 ${index + 1} 的职责。`,
      roles: page.roles || [],
      entry_conditions: page.entry_conditions || [],
      components: page.components || [],
      states: (page.states || []).length > 0 ? page.states : defaultStatesForType(type),
      fields,
      columns,
      demo_rows: (page.demo_rows || []).length > 0 ? page.demo_rows : buildDemoRows(columns),
      primary_action: primaryAction,
      actions: (page.actions || []).length > 0 ? page.actions : [primaryAction],
      behaviors: page.behaviors || analysis.core_flows || [],
      feedback: page.feedback || [],
      exceptions: page.exceptions || [],
      design_constraints: page.design_constraints || [],
      acceptance_refs: page.acceptance_refs || requirement.acceptance || [],
      decision_note: page.decision_note || decisionNote
    };
    if (type === 'board' && (normal.board_columns || []).length === 0) {
      normal.board_columns = boardColumnCards(boardColumnsFromText(pageTextValue), columns, pageTextValue);
    }
    if (type === 'settings' && (normal.groups || []).length === 0) {
      normal.groups = settingsGroups(fields, pageTextValue);
    }
    if (type === 'dashboard' && (normal.metrics || []).length === 0) {
      normal.metrics = dashboardMetrics(objects, pageTextValue);
    }
    if (type === 'detail' && (normal.sections || []).length === 0) {
      normal.sections = [{ title: '需求目标', items: [requirement.goal] }];
    }
    return normal;
  });
  return {
    ...spec,
    schema_version: SCHEMA.interactionSpec,
    requirement_id: requirement.id,
    baseline_id: requirement.baseline_id,
    source: spec.source || analysis.source || 'local-heuristic',
    summary: spec.summary || analysis.summary || '',
    effective_title: spec.effective_title || analysis.effective_title || requirement.title,
    decision: effectiveDecision ? {
      action: effectiveDecision.chosen?.action || effectiveDecision.action || null,
      reason: effectiveDecision.reason || '',
      condition: effectiveDecision.condition || '',
      rejected_changes: analysis.rejected_changes || spec.decision?.rejected_changes || []
    } : null,
    rules: (spec.rules || []).length > 0 ? spec.rules : rules.map((rule) => ({
      id: rule.id, revision: rule.revision, statement: rule.statement,
      constraints: rule.constraints || [],
      knowledge_status: rule.knowledge_status, effective_state: rule.effective_state
    })),
    pages
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
  lines.push(analysis.effective_goal || requirement.goal);
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
    for (const rule of rules) {
      if ((rule.constraints || []).length > 0) {
        lines.push('');
        lines.push(`- ${rule.id} 约束：${rule.constraints.join('；')}`);
      }
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
  if (analysis.decision) {
    const actionLabel = { adopt: '采用新口径', keep: '保留现行规则', conditional: '附加条件后采用' }[analysis.decision.action] || analysis.decision.action;
    lines.push(`- 裁决：${actionLabel}`);
    lines.push(`- 理由：${analysis.decision.reason || ''}`);
    if (analysis.decision.condition) lines.push(`- 生效条件：${analysis.decision.condition}`);
    lines.push('');
    if (analysis.decision.action === 'keep') {
      lines.push('本次需求不实施被否决的新口径；页面与交付产物按现行规则生成。');
      if ((analysis.rejected_changes || []).length > 0) {
        lines.push('');
        lines.push('**被否决口径**');
        lines.push('');
        for (const change of analysis.rejected_changes) {
          lines.push(`- ${change.statement}`);
        }
        lines.push('');
      }
    }
  } else if ((analysis.conflicts || []).length === 0) {
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
  if (analysis.spec_generation?.warning) {
    lines.push('');
    lines.push(`> 规格生成警告：${analysis.spec_generation.warning.message || analysis.spec_generation.warning.code}`);
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
    .page-panel { display: none; }
    .page-panel.active { display: block; }
    .page-panel-head { padding: 20px 22px 4px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .page-panel-head h2 { margin: 4px 0 6px; font-size: 20px; letter-spacing: -.02em; }
    .page-panel-head p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.65; max-width: 620px; }
    .page-type { color: var(--accent); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .page-tabs { border-bottom: 1px solid var(--border); padding: 12px 18px 0; }
    .state-hint { color: var(--muted); font-size: 11px; margin-bottom: 12px; }
    .proto-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
    .proto-filter { border: 1px solid var(--border); background: #FBFAF7; border-radius: 8px; padding: 7px 10px; color: var(--muted); font-size: 12px; }
    .proto-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .proto-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .proto-label { font-size: 12px; font-weight: 600; color: var(--ink); }
    .proto-label .required { color: var(--danger); margin-left: 3px; }
    .proto-input { width: 100%; border: 1px solid var(--border); background: #fff; border-radius: 8px; padding: 9px 10px; font-size: 12px; color: var(--ink); font-family: inherit; }
    .proto-field.has-error .proto-input { border-color: #D9A49C; background: #FFF9F7; }
    .field-error { color: var(--danger); font-size: 10px; }
    .proto-switch { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); padding: 8px 0; }
    .proto-switch input { accent-color: var(--accent); }
    .form-actions { display: flex; gap: 8px; margin-top: 18px; padding-top: 14px; border-top: 1px solid #EFEDE6; }
    .board { display: grid; grid-template-columns: repeat(3, minmax(190px, 1fr)); gap: 10px; overflow-x: auto; }
    .board-column { background: #F4F2EC; border: 1px solid var(--border); border-radius: 10px; padding: 10px; min-height: 220px; }
    .board-head { display: flex; justify-content: space-between; color: var(--ink); font-size: 12px; font-weight: 600; margin-bottom: 9px; }
    .board-count { color: var(--muted); font-family: ui-monospace, Menlo, monospace; font-size: 10px; background: #fff; border-radius: 999px; padding: 1px 6px; }
    .board-card { background: #fff; border: 1px solid var(--border); border-radius: 9px; padding: 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 5px; }
    .board-card strong { font-size: 12px; }
    .board-card > span { color: var(--muted); font-size: 11px; }
    .board-meta { display: flex; justify-content: space-between; align-items: center; color: var(--muted); font-size: 10px; }
    .tag { border-radius: 999px; background: #F7E9DE; color: var(--warning); padding: 2px 6px; }
    .board-add { width: 100%; border: 1px dashed #D5D0C4; background: transparent; color: var(--muted); border-radius: 8px; padding: 7px; font-size: 11px; cursor: pointer; }
    .settings-groups { display: grid; gap: 14px; }
    .settings-group { border: 1px solid var(--border); border-radius: 11px; overflow: hidden; }
    .settings-group-head { background: #FBFAF7; padding: 12px 14px; border-bottom: 1px solid #EFEDE6; }
    .settings-group-head h3 { margin: 0 0 3px; font-size: 13px; }
    .settings-group-head p { margin: 0; color: var(--muted); font-size: 11px; }
    .setting-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 12px 14px; border-bottom: 1px solid #F2F0EA; }
    .setting-row:last-child { border-bottom: 0; }
    .setting-row strong { display: block; font-size: 12px; }
    .setting-row span { color: var(--muted); font-size: 10px; }
    .setting-row .proto-input { width: 220px; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .metric-card { background: #F4F7F4; border: 1px solid #DCE7E0; border-radius: 11px; padding: 14px; }
    .metric-card span { display: block; color: var(--muted); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
    .metric-card strong { display: block; margin-top: 7px; font-size: 26px; letter-spacing: -.04em; color: var(--ink); }
    .metric-card em { display: block; margin-top: 3px; color: var(--accent); font-size: 10px; font-style: normal; }
    .trend-card { margin-top: 12px; border: 1px solid var(--border); border-radius: 11px; padding: 14px; }
    .bars { display: grid; gap: 9px; }
    .bar-row { display: grid; grid-template-columns: 52px 1fr 32px; gap: 9px; align-items: center; color: var(--muted); font-size: 10px; }
    .bar-track { height: 8px; background: #EEF2EE; border-radius: 999px; overflow: hidden; }
    .bar { height: 100%; background: var(--accent); border-radius: 999px; }
    .bar-row em { font-style: normal; text-align: right; color: var(--muted); }
    .detail-sections { display: grid; gap: 10px; }
    .detail-section { border: 1px solid var(--border); border-radius: 10px; padding: 13px 14px; }
    .detail-section h3 { margin: 0 0 7px; font-size: 13px; }
    .detail-section ul { margin: 0; padding-left: 17px; color: var(--muted); font-size: 12px; line-height: 1.7; }
    .success-box { text-align: center; padding: 46px 24px; }
    .success-mark { width: 44px; height: 44px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; margin: 0 auto 12px; font-size: 20px; font-weight: 700; }
    .success-box h3 { margin: 0 0 7px; font-size: 17px; }
    .success-box p { margin: 0 auto 16px; color: var(--muted); font-size: 12px; max-width: 420px; line-height: 1.7; }
    .error-inline { border: 1px solid #F0DAD5; background: #FDF6F4; color: var(--danger); border-radius: 8px; padding: 9px 11px; font-size: 11px; margin-bottom: 12px; }
    .decision-banner { margin-top: 16px; border: 1px solid #E5D7C3; background: #FBF6EE; border-radius: 10px; padding: 11px 13px; display: flex; flex-direction: column; gap: 3px; }
    .decision-banner strong { font-size: 11px; color: #7A4A15; }
    .decision-banner span { font-size: 11px; color: var(--muted); line-height: 1.6; }
    .decision-banner ul { margin: 4px 0 0; padding-left: 17px; color: var(--muted); font-size: 10.5px; line-height: 1.6; }
    @media (max-width: 860px) {
      .layout { grid-template-columns: 1fr; }
      .proto-form-grid, .metric-grid { grid-template-columns: 1fr; }
    }
  `;
}

function formFieldHtml(field, { showError = false } = {}) {
  const required = field.required ? '<span class="required">*</span>' : '';
  const error = showError && field.required ? '<span class="field-error">此项为必填，请补充</span>' : '';
  const label = `<span class="proto-label">${escapeHtml(field.name)}${required}</span>`;
  if (field.type === 'switch') {
    return `<label class="proto-field ${showError && field.required ? 'has-error' : ''}">${label}
      <span class="proto-switch"><input type="checkbox" checked> <span>启用</span></span>${error}</label>`;
  }
  if (field.type === 'select') {
    const options = (field.options || []).map((option) => `<option>${escapeHtml(option)}</option>`).join('');
    return `<label class="proto-field ${showError && field.required ? 'has-error' : ''}">${label}
      <select class="proto-input">${options || '<option>请选择</option>'}</select>${error}</label>`;
  }
  if (field.type === 'textarea') {
    return `<label class="proto-field ${showError && field.required ? 'has-error' : ''}">${label}
      <textarea class="proto-input" rows="3" placeholder="${escapeHtml(field.placeholder || '')}"></textarea>${error}</label>`;
  }
  const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text';
  return `<label class="proto-field ${showError && field.required ? 'has-error' : ''}">${label}
    <input class="proto-input" type="${type}" placeholder="${escapeHtml(field.placeholder || '')}">${error}</label>`;
}

function formHtml(page, { showError = false } = {}) {
  const fields = page.fields?.length ? page.fields : [{ name: '业务标识', type: 'text', required: true }];
  const actions = page.actions?.length ? page.actions : [page.primary_action || '提交'];
  return `<form class="proto-form" onsubmit="return false">
    <div class="proto-form-grid">${fields.map((field) => formFieldHtml(field, { showError })).join('')}</div>
    <div class="form-actions">
      <button class="btn primary" type="button">${escapeHtml(actions[0] || '提交')}</button>
      ${actions.slice(1).map((action) => `<button class="btn" type="button">${escapeHtml(action)}</button>`).join('')}
    </div>
  </form>`;
}

function listHtml(page) {
  const columns = page.columns?.length ? page.columns : (page.fields || []).map((field) => ({ name: field.name, type: field.type }));
  const rows = page.demo_rows?.length ? page.demo_rows : [0, 1, 2].map((index) => Object.fromEntries(columns.map((column) => [column.name, demoValue(column, index)])));
  return `<div class="proto-toolbar">
      <span class="proto-filter">全部记录</span>
      <span class="grow"></span>
      <button class="btn" type="button">筛选</button>
      <button class="btn primary" type="button">${escapeHtml(page.primary_action || '新建记录')}</button>
    </div>
    <table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.name)}</th>`).join('')}<th>操作</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.name] ?? '')}</td>`).join('')}<td><span class="link">查看</span></td></tr>`).join('')}</tbody></table>`;
}

function boardHtml(page) {
  const board = page.board_columns?.length ? page.board_columns : [
    { name: '待处理', count: 2, cards: [{ title: '示例工单 1', meta: '待受理', owner: '林晓', tag: '演示' }] },
    { name: '处理中', count: 1, cards: [{ title: '示例工单 2', meta: '处理中', owner: '周然', tag: '演示' }] },
    { name: '已完成', count: 1, cards: [{ title: '示例工单 3', meta: '已完成', owner: '陈一', tag: '演示' }] }
  ];
  return `<div class="proto-toolbar">
      <span class="proto-filter">全部工单</span>
      <span class="grow"></span>
      <button class="btn" type="button">筛选</button>
      <button class="btn primary" type="button">${escapeHtml(page.primary_action || '新建工单')}</button>
    </div>
    <div class="board">${board.map((column) => `<div class="board-column" data-board-column="${escapeHtml(column.name)}">
      <div class="board-head"><span>${escapeHtml(column.name)}</span><span class="board-count">${column.count ?? column.cards?.length ?? 0}</span></div>
      ${(column.cards || []).map((card) => `<div class="board-card"><strong>${escapeHtml(card.title || '')}</strong><span>${escapeHtml(card.meta || '')}</span><div class="board-meta"><span>${escapeHtml(card.owner || '未分配')}</span><span class="tag">${escapeHtml(card.tag || '示例')}</span></div></div>`).join('')}
      <button class="board-add" type="button">+ 新建</button>
    </div>`).join('')}</div>`;
}

function settingsHtml(page) {
  const groups = page.groups?.length ? page.groups : [{ title: '业务设置', items: (page.fields || []).map((field) => ({ name: field.name, type: field.type, value: demoValue(field, 0), options: field.options || [] })) }];
  return `<div class="settings-groups">${groups.map((group) => `<section class="settings-group">
    <div class="settings-group-head"><h3>${escapeHtml(group.title)}</h3><p>${escapeHtml(group.description || '')}</p></div>
    ${(group.items || []).map((item) => `<div class="setting-row">
      <div><strong>${escapeHtml(item.name)}</strong><span>演示配置项</span></div>
      ${item.type === 'switch'
        ? '<label class="proto-switch"><input type="checkbox" checked><span>开启</span></label>'
        : item.type === 'select'
          ? `<select class="proto-input">${(item.options || []).map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select>`
          : `<input class="proto-input" value="${escapeHtml(item.value ?? '')}">`}
    </div>`).join('')}
  </section>`).join('')}</div>
  <div class="form-actions"><button class="btn primary" type="button">保存设置</button><button class="btn" type="button">恢复默认</button></div>`;
}

function dashboardHtml(page) {
  const metrics = page.metrics?.length ? page.metrics : [{ label: '业务总量', value: '128', hint: '示例聚合值' }];
  return `<div class="metric-grid">${metrics.map((metric) => `<div class="metric-card"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong><em>${escapeHtml(metric.hint || '')}</em></div>`).join('')}</div>
    <div class="trend-card"><div class="proto-toolbar"><strong>趋势（演示）</strong><span class="grow"></span><button class="btn small" type="button">本月</button></div>
      <div class="bars">${[42, 66, 54, 78, 61, 88].map((height, index) => `<div class="bar-row"><span>第 ${index + 1} 周</span><div class="bar-track"><div class="bar" style="width:${height}%"></div></div><em>${height * 12}</em></div>`).join('')}</div>
    </div>`;
}

function detailHtml(page) {
  const sections = page.sections?.length ? page.sections : [{ title: '业务信息', items: ['演示数据，具体字段以后端契约为准'] }];
  return `<div class="detail-sections">${sections.map((section) => `<section class="detail-section"><h3>${escapeHtml(section.title)}</h3><ul>${(section.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`).join('')}</div>`;
}

function emptyHtml(page, state) {
  return `<div class="empty"><h3>${escapeHtml(page.type === 'form' ? '还没有填写内容' : '还没有可展示的记录')}</h3><p>${escapeHtml(state.behavior || '当前筛选条件下没有数据。')}</p><button class="btn primary" type="button">${escapeHtml(page.primary_action || '发起操作')}</button></div>`;
}

function errorHtml(page, state) {
  return `<div class="error"><h3>操作未完成</h3><p>${escapeHtml(state.behavior || '当前条件不满足业务规则。')}</p><button class="btn danger" type="button">查看业务依据</button></div>`;
}

function successHtml(page, state) {
  return `<div class="success-box"><div class="success-mark">✓</div><h3>提交成功</h3><p>${escapeHtml(state.behavior || '记录已保存，可以继续查看或发起下一项操作。')}</p><button class="btn primary" type="button">查看结果</button></div>`;
}

function stateContent(page, state) {
  const name = state.name || '';
  if (/空/.test(name)) return emptyHtml(page, state);
  if (/异常|错误|失败/.test(name)) {
    if (page.type === 'form') {
      return `<div class="error-inline">${escapeHtml(state.behavior || '校验未通过')}</div>${formHtml(page, { showError: true })}`;
    }
    return errorHtml(page, state);
  }
  if (/成功/.test(name)) return successHtml(page, state);
  if (page.type === 'form') return formHtml(page);
  if (page.type === 'board') return boardHtml(page);
  if (page.type === 'settings') return settingsHtml(page);
  if (page.type === 'dashboard') return dashboardHtml(page);
  if (page.type === 'detail') return detailHtml(page);
  return listHtml(page);
}

function pagePanelHtml(page, index) {
  const states = page.states?.length ? page.states : [
    { name: '默认', behavior: '' },
    { name: '空数据', behavior: '没有记录。' },
    { name: '异常', behavior: '加载失败。' }
  ];
  return `<section class="page-panel ${index === 0 ? 'active' : ''}" data-page-panel="${escapeHtml(page.id)}" data-page-type="${escapeHtml(page.type)}">
    <div class="page-panel-head"><div><span class="page-type">${escapeHtml({
      form: '表单', board: '看板', list: '列表', settings: '设置', dashboard: '概览', detail: '详情'
    }[page.type] || page.type)}</span><h2>${escapeHtml(page.name)}</h2><p>${escapeHtml(page.responsibility || '')}</p></div>
      <span class="pill">${escapeHtml(page.roles?.join(' · ') || '使用者')}</span></div>
    <div class="state-tabs" role="tablist">${states.map((state, stateIndex) => `<button class="tab" role="tab" aria-selected="${stateIndex === 0}" data-state-tab="${escapeHtml(page.id)}" data-state-name="${escapeHtml(state.name)}">${escapeHtml(state.name)}</button>`).join('')}</div>
    <div class="page-body">${states.map((state, stateIndex) => `<section class="state-block ${stateIndex === 0 ? 'active' : ''}" data-state-panel="${escapeHtml(page.id)}" data-state-name="${escapeHtml(state.name)}">
      <div class="state-hint">${escapeHtml(state.behavior || '')}</div>
      ${stateContent(page, state)}
    </section>`).join('')}</div>
  </section>`;
}

export function renderPrototypeHtml({ product, requirement, spec, tokens = defaultTokens() }) {
  const pages = spec.pages?.length ? spec.pages : [{
    id: 'PAGE-1', type: 'list', name: requirement.title,
    responsibility: '', roles: [], fields: [], columns: [], demo_rows: [],
    states: [{ name: '默认', behavior: '' }], acceptance_refs: []
  }];
  const effectiveTitle = spec.effective_title || requirement.title;
  const ruleItems = spec.rules?.length > 0
    ? spec.rules.map((rule) => `<div class="rule"><code>${escapeHtml(rule.id)} · r${rule.revision}</code><p>${escapeHtml(rule.statement)}</p>${(rule.constraints || []).length ? `<ul>${rule.constraints.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div>`).join('')
    : '<p class="lede">暂无可引用规则版本。</p>';
  const acceptanceItems = [...new Set(pages.flatMap((page) => page.acceptance_refs || []))]
    .map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const decision = spec.decision;
  const rejected = decision?.rejected_changes || [];
  const decisionBanner = decision
    ? `<div class="decision-banner"><strong>业务裁决 · ${escapeHtml({ adopt: '采用新口径', keep: '保留现行规则', conditional: '附加条件后采用' }[decision.action] || decision.action || '已裁决')}</strong><span>${escapeHtml(decision.reason || '')}${decision.condition ? ` · 条件：${escapeHtml(decision.condition)}` : ''}</span>${rejected.length ? `<ul>${rejected.map((change) => `<li>未采纳：${escapeHtml(change.statement)}</li>`).join('')}</ul>` : ''}</div>`
    : '';
  const pageTabs = pages.length > 1
    ? `<div class="page-tabs" role="tablist">${pages.map((page, index) => `<button class="tab page-tab" role="tab" aria-selected="${index === 0}" data-page-tab="${escapeHtml(page.id)}">${escapeHtml(page.name)}</button>`).join('')}</div>`
    : '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(effectiveTitle)} · 交互原型</title>
<style>${prototypeCss(tokens)}</style>
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="dot"></span> PROTO HARNESS AGENT</div>
  <span class="badge">交互原型 · 演示数据</span>
</header>
<main>
  <div class="eyebrow">${escapeHtml(product.name)} / ${escapeHtml(spec.pages?.length > 1 ? `${pages.length} 个页面` : pages[0].name)}</div>
  <h1>${escapeHtml(effectiveTitle)}</h1>
  <p class="lede">${escapeHtml(pages[0].responsibility || '')}</p>
  ${decisionBanner}
  <div class="layout">
    <section class="panel">
      ${pageTabs}
      ${pages.map((page, index) => pagePanelHtml(page, index)).join('')}
    </section>
    <aside class="aside">
      <h2>业务依据</h2>
      ${ruleItems}
      <h2>页面结构</h2>
      <ul>${pages.map((page) => `<li>${escapeHtml(page.name)} · ${escapeHtml({ form: '表单', board: '看板', list: '列表', settings: '设置', dashboard: '概览', detail: '详情' }[page.type] || page.type)}</li>`).join('')}</ul>
      <h2>验收关注</h2>
      <ul>${acceptanceItems || '<li>规则在主路径生效，并能给出明确反馈。</li>'}</ul>
      <p class="footer-note">原型用于表达预期行为与状态，不代表生产系统已完成。演示数据不可作为真实业务记录。</p>
    </aside>
  </div>
</main>
<script>
(function () {
  var pageTabs = document.querySelectorAll('[data-page-tab]');
  var pagePanels = document.querySelectorAll('[data-page-panel]');
  pageTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      pageTabs.forEach(function (item) { item.setAttribute('aria-selected', String(item === tab)); });
      pagePanels.forEach(function (panel) {
        panel.classList.toggle('active', panel.getAttribute('data-page-panel') === tab.getAttribute('data-page-tab'));
      });
    });
  });
  document.querySelectorAll('[data-state-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var pageId = tab.getAttribute('data-state-tab');
      var stateName = tab.getAttribute('data-state-name');
      document.querySelectorAll('[data-state-tab]').forEach(function (item) {
        if (item.getAttribute('data-state-tab') === pageId) {
          item.setAttribute('aria-selected', String(item === tab));
        }
      });
      document.querySelectorAll('[data-state-panel]').forEach(function (panel) {
        if (panel.getAttribute('data-state-panel') === pageId) {
          panel.classList.toggle('active', panel.getAttribute('data-state-name') === stateName);
        }
      });
    });
  });
})();
</script>
</body>
</html>`;
  return html.replace(/[ \t]+$/gm, '');
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
