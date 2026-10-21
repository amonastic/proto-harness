import {
  sentences, detectObjects, detectRoles, ruleLikeSentences, detectEndpoints,
  sentenceTopic, summarize, overlapScore, contradicts, RULE_MARKERS
} from './text.js';

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function makeUnknown(question, whyBlocking, blocking = false) {
  return {
    id: `U-${Math.abs(hashCode(question)).toString(36).slice(0, 6)}`,
    question,
    why_blocking: whyBlocking,
    blocking,
    answered: false,
    answer: '',
    owner: '业务负责人'
  };
}

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < String(text).length; i += 1) {
    hash = ((hash << 5) - hash) + String(text).charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function endpointsFromProduct(product) {
  return (product.endpoints || []).map((item) => ({
    name: item.name, role: item.role, platform: item.platform, id: item.id
  }));
}

function pickEndpoints(product, text) {
  const existing = endpointsFromProduct(product);
  if (existing.length === 0) return detectEndpoints(text);
  const inferred = detectEndpoints(text);
  const mentioned = existing.filter((item) => text.includes(item.name) || (
    item.platform === 'App' && /APP|App|app|作业|骑手|司机/.test(text)
  ) || (item.platform === 'Web' && /后台|管理端|配置/.test(text)));
  return mentioned.length > 0 ? mentioned : existing;
}

function buildObjects(text, references = []) {
  const names = detectObjects(`${text}\n${references.map((item) => item.text || '').join('\n')}`);
  return names.slice(0, 8).map((name) => ({
    name,
    key_fields: [],
    relations: [],
    reason: '从输入与来源材料中识别到的业务对象',
    evidence_refs: []
  }));
}

function buildRoles(text, endpoints) {
  const roles = detectRoles(text);
  if (roles.length === 0) {
    for (const endpoint of endpoints) roles.push(endpoint.role);
  }
  return unique(roles).slice(0, 6).map((name) => ({
    name,
    endpoint: endpoints.find((item) => item.role === name)?.name || endpoints[0]?.name || '',
    reason: '从角色词与端描述中识别'
  }));
}

function buildCapabilities(ruleSentences, objects, endpoints, goal) {
  const groups = new Map();
  for (const sentence of ruleSentences) {
    const object = detectObjects(sentence)[0] || objects[0]?.name || '业务对象';
    if (!groups.has(object)) groups.set(object, []);
    groups.get(object).push(sentence);
  }
  const capabilities = [];
  for (const [object, rules] of groups) {
    capabilities.push({
      name: `管理${object}`,
      goal: goal || `围绕${object}完成业务操作并保持一致口径`,
      objects: [object],
      rules,
      preconditions: [],
      exceptions: ['操作对象不存在或状态不允许时给出明确反馈'],
      endpoints: endpoints.map((item) => item.name)
    });
  }
  if (capabilities.length === 0 && objects.length > 0) {
    capabilities.push({
      name: `管理${objects[0].name}`,
      goal: goal || `围绕${objects[0].name}完成业务操作`,
      objects: [objects[0].name],
      rules: [],
      preconditions: [],
      exceptions: [],
      endpoints: endpoints.map((item) => item.name)
    });
  }
  return capabilities.slice(0, 6);
}

function buildUnknowns(text, { ruleSentences, objects, references = [], hasContextRules = false } = {}) {
  const unknowns = [];
  const explicit = sentences(text).filter((item) => /(待确认|未确认|未知|TBD|\?|？)/.test(item));
  for (const item of explicit.slice(0, 2)) {
    unknowns.push(makeUnknown(
      `请确认：${summarize(item, 80)}`,
      '材料显式标记为未确认，会影响业务口径',
      true
    ));
  }
  if (/(重复|再次)/.test(text) && !/(\d+\s*(秒|分钟|小时|天))/.test(text)) {
    unknowns.push(makeUnknown(
      '重复操作的允许时间窗口是多少？超过窗口后系统应如何反馈？',
      '时间窗口会直接决定规则是否成立，材料未给出具体值',
      true
    ));
  }
  const stateful = objects.filter((item) => ['订单', '账户', '库存', '账单', '结算', '审批', '任务'].includes(item.name));
  if (stateful.length > 0 && !/状态/.test(text) && ruleSentences.length > 0) {
    unknowns.push(makeUnknown(
      `${stateful.map((item) => item.name).join('、')}的业务状态是否会因本次操作改变？`,
      '动作与状态是否联动会改变业务含义和验收口径',
      true
    ));
  }
  if (references.length > 0 && !/(事实|参考|当前口径)/.test(text)) {
    unknowns.push(makeUnknown(
      '参考资料中哪些内容属于本项目事实，哪些只能作为参考？',
      '来源状态决定候选知识能否进入现行基线',
      false
    ));
  }
  if (unknowns.length === 0 && ruleSentences.length === 0 && !hasContextRules) {
    unknowns.push(makeUnknown(
      '本次变更必须遵守哪些业务约束？',
      '缺少可判断的业务规则，无法形成可用于生成的需求基线',
      true
    ));
  }
  return unknowns.slice(0, 4);
}

function buildImpact(endpoints, requirementText, product) {
  const actual = endpoints.map((endpoint) => (
    `更新「${endpoint.name}」中与“${summarize(requirementText, 24)}”相关的操作入口、状态反馈与说明`
  ));
  const verify = [
    '核对配置端规则与消费端展示是否使用同一版本',
    '核对历史数据、快照与已有交付是否受本次规则变化影响'
  ];
  const keep = (product.constraints || []).length > 0
    ? product.constraints
    : ['不改变未涉及对象、角色与端的既有行为'];
  return { actual, verify, keep };
}

function buildAcceptance(ruleSentences, unknowns) {
  const items = ruleSentences.slice(0, 4).map((rule) => (
    `规则“${summarize(rule, 60)}”在主要路径生效，并在界面或反馈中可被验证`
  ));
  items.push('空数据、异常与无权限场景有明确反馈，不出现无说明的中断');
  items.push('需求文档、交互规格与原型引用同一规则版本');
  if (unknowns.some((item) => item.blocking)) {
    items.push('所有阻塞性未知项已得到业务确认');
  }
  return items;
}

function detectConflicts(ruleSentences, existingRules) {
  const conflicts = [];
  const proposals = [];
  const usedExisting = new Set();
  for (const sentence of ruleSentences) {
    const candidates = existingRules.map((rule) => {
      const score = overlapScore(`${rule.topic || ''} ${rule.statement}`, sentence);
      const topicMatch = rule.topic && sentence.includes(rule.topic);
      const effective = topicMatch ? Math.max(score, 5) : score;
      return {
        rule,
        score: effective,
        contradiction: effective >= 5 ? contradicts(rule.statement, sentence) : null
      };
    }).filter((item) => item.score >= 5);
    candidates.sort((a, b) => {
      if (Boolean(a.contradiction) !== Boolean(b.contradiction)) return a.contradiction ? -1 : 1;
      return b.score - a.score;
    });
    const best = candidates[0] || null;
    const matched = best?.rule || null;
    const topic = matched?.topic || sentenceTopic(sentence);
    const contradiction = best?.contradiction || null;
    if (matched) {
      usedExisting.add(matched.id);
      proposals.push({
        kind: 'rule.revise',
        rule_id: matched.id,
        from_revision: matched.revision,
        topic,
        statement: sentence.replace(/^[，,。\s]+/, ''),
        scope: matched.scope || '',
        constraints: [],
        evidence_refs: matched.evidence_refs || [],
        reason: contradiction
          ? '需求与现行规则存在业务口径差异，需要裁决'
          : '需求对现行规则做出补充或细化'
      });
    } else {
      proposals.push({
        kind: 'rule.create',
        rule_id: null,
        topic,
        statement: sentence.replace(/^[，,。\s]+/, ''),
        scope: '',
        constraints: [],
        evidence_refs: [],
        reason: '需求提出新的业务约束'
      });
    }
    if (matched && contradiction) {
      conflicts.push({
        id: `CONFLICT-${hashCode(`${matched.id}-${sentence}`).toString(36).replace('-', 'x')}`,
        topic,
        heuristic: true,
        existing_rules: [{
          id: matched.id,
          revision: matched.revision,
          statement: matched.statement,
          scope: matched.scope,
          evidence_refs: matched.evidence_refs || []
        }],
        proposed_statement: sentence,
        why: contradiction,
        options: [
          { id: 'adopt', label: '采用新口径', description: '新规则进入计划基线，现行基线暂不切换' },
          { id: 'keep', label: '保留现行规则', description: '按现行基线继续，需求范围需要调整' },
          { id: 'conditional', label: '附加条件后采用', description: '在生效条件中限定适用范围' }
        ]
      });
    }
  }
  return { conflicts, proposals, usedExisting };
}

function buildCoreFlows(requirement, endpoints, objects) {
  const target = objects[0]?.name || '业务对象';
  const endpoint = endpoints[0]?.name || '业务端';
  return [
    `在「${endpoint}」发起与${target}相关的操作`,
    '系统读取当前基线中的适用规则并判断是否允许继续',
    '按判断结果完成操作或给出明确阻断原因',
    '保存本次操作结果与业务状态，供后续查询与核对'
  ];
}

function localProductAnalysis(input) {
  const { product, references = [] } = input;
  const text = [
    product.name, product.goal, product.audience,
    ...(product.constraints || []),
    ...references.map((item) => item.text || '')
  ].join('\n');
  const endpoints = pickEndpoints(product, text);
  const objects = buildObjects(text, references);
  const roles = buildRoles(text, endpoints);
  const ruleText = [
    ...(product.constraints || []),
    ...references.map((item) => item.text || '')
  ].join('\n');
  const ruleSentences = ruleLikeSentences(ruleText).slice(0, 8);
  const capabilities = buildCapabilities(ruleSentences, objects, endpoints, product.goal);
  const candidateRules = ruleSentences.map((statement) => ({
    topic: sentenceTopic(statement),
    statement,
    scope: endpoints.map((item) => item.name).join('、'),
    evidence_refs: [],
    confidence: 'candidate',
    source: 'local-heuristic'
  }));
  const unknowns = buildUnknowns(text, { ruleSentences, objects, references });
  return {
    source: 'local-heuristic',
    summary: `从产品目标、约束与${references.length}份参考材料中识别到 ${objects.length} 个对象、${roles.length} 个角色、${candidateRules.length} 条候选规则。`,
    objects,
    roles,
    endpoints,
    capabilities,
    candidate_rules: candidateRules,
    unknowns,
    proposal_reason: '产品初始化需要确认候选规则与关键未知项',
    warnings: [
      '本地规则分析只从输入文本提取，不理解行业默认值；候选规则需人工确认。'
    ]
  };
}

function localRequirementAnalysis(input) {
  const { product, requirement, context = {} } = input;
  const text = [requirement.title, requirement.goal, requirement.raw_input, ...(product.constraints || [])].join('\n');
  const endpoints = pickEndpoints(product, text);
  const objects = buildObjects(text);
  const roles = buildRoles(text, endpoints);
  const rawRuleSentences = ruleLikeSentences(requirement.raw_input || '');
  const ruleSentences = (rawRuleSentences.length > 0
    ? rawRuleSentences
    : ruleLikeSentences(requirement.goal || '')).slice(0, 6);
  const existingRules = context.rules || [];
  const { conflicts: rawConflicts, proposals: rawProposals } = detectConflicts(ruleSentences, existingRules);
  const conflicts = [];
  const conflictKeys = new Set();
  for (const item of rawConflicts) {
    const key = `${item.existing_rules.map((rule) => rule.id).join(',')}|${item.proposed_statement.replace(/\s+/g, '')}`;
    if (conflictKeys.has(key)) continue;
    conflictKeys.add(key);
    conflicts.push(item);
  }
  const proposals = [];
  const proposalKeys = new Set();
  for (const item of rawProposals) {
    const key = `${item.rule_id || item.statement.replace(/\s+/g, '')}`;
    if (proposalKeys.has(key)) continue;
    proposalKeys.add(key);
    proposals.push(item);
  }
  const unknowns = buildUnknowns(text, { ruleSentences, objects, hasContextRules: existingRules.length > 0 });
  const impact = buildImpact(endpoints, text, product);
  const acceptance = buildAcceptance(ruleSentences, unknowns);
  const scope = {
    in_scope: [
      requirement.title,
      ...objects.slice(0, 3).map((item) => `${item.name}相关规则与操作`)
    ],
    out_of_scope: ['不改变未涉及对象、角色与端的既有行为']
  };
  return {
    source: 'local-heuristic',
    summary: `识别到 ${objects.length} 个对象、${ruleSentences.length} 条规则候选、${conflicts.length} 处潜在冲突。分析来自本地规则引擎，不代表真实模型判断。`,
    objects,
    roles,
    endpoints,
    core_flows: buildCoreFlows(requirement, endpoints, objects),
    scope,
    impact,
    acceptance,
    unknowns,
    rule_proposals: proposals,
    conflicts,
    evidence_refs: [],
    proposal_reason: conflicts.length > 0
      ? '需求与现行规则存在冲突，需先完成业务裁决'
      : '需求提出新的业务约束，需要确认后进入计划基线',
    interaction_hints: {
      primary_page_name: requirement.title,
      states: ['默认', '空数据', '异常/无权限']
    }
  };
}

export function createLocalAdapter() {
  return {
    id: 'local-heuristic',
    label: '本地规则分析',
    describe() {
      return {
        kind: 'local-heuristic',
        model: null,
        configured: true,
        label: this.label,
        note: '不调用模型；只从输入和来源文本提取候选知识。'
      };
    },
    async analyzeProduct(input) {
      return localProductAnalysis(input);
    },
    async analyzeRequirement(input) {
      return localRequirementAnalysis(input);
    },
    async proposeKnowledge({ text }) {
      return ruleLikeSentences(text).map((statement) => ({
        kind: 'rule.create',
        topic: sentenceTopic(statement),
        statement,
        scope: '',
        constraints: [],
        evidence_refs: [],
        reason: '从材料中提取的候选规则',
        source: 'local-heuristic'
      }));
    },
    async generateInteractionSpec() {
      return null;
    }
  };
}

export { localProductAnalysis, localRequirementAnalysis, buildUnknowns, RULE_MARKERS };
