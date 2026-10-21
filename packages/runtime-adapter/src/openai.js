import { fail } from '../../core/src/util.js';
import {
  extractJson, normalizeProductAnalysis, normalizeRequirementAnalysis, normalizeInteractionSpec
} from './parse.js';

const DEFAULT_TIMEOUT_MS = 90000;

function endpointFor(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!trimmed) throw fail('RUNTIME_NOT_CONFIGURED', '未配置模型服务地址');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

function promptProduct(input) {
  const { product, references = [] } = input;
  const referenceText = references.length > 0
    ? references.map((item, index) => `### 材料 ${index + 1}：${item.title || item.source_ref || ''}\n${String(item.text || '').slice(0, 6000)}`).join('\n\n')
    : '无';
  return [
    '你是产品知识分析器。请只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    '任务：从产品目标、约束与参考材料中提取业务对象、角色、端、能力卡、候选规则和必须由业务负责人确认的未知项。',
    '要求：',
    '1. 不得编造材料中没有的阈值、额度、时效或行业默认值；缺失的写进 unknowns。',
    '2. 候选规则必须能在材料中找到依据，状态是 candidate，不能写成已生效。',
    '3. 区分事实、推断与未知；推断放入 reason，未知放入 unknowns。',
    '4. 只使用简体中文。',
    '',
    '产品：',
    JSON.stringify({
      name: product.name,
      goal: product.goal,
      audience: product.audience,
      constraints: product.constraints,
      endpoints: product.endpoints
    }, null, 2),
    '',
    '参考材料：',
    referenceText,
    '',
    '输出结构：',
    JSON.stringify({
      summary: '一段摘要',
      objects: [{ name: '业务对象', key_fields: ['字段'], relations: [], reason: '依据', evidence_refs: [] }],
      roles: [{ name: '角色', endpoint: '端', reason: '依据' }],
      endpoints: [{ name: '端', role: '角色', platform: 'Web|App|MiniProgram' }],
      capabilities: [{ name: '能力', goal: '目标', objects: ['对象'], rules: ['候选规则'], preconditions: [], exceptions: [], endpoints: ['端'] }],
      candidate_rules: [{ topic: '主题', statement: '规则正文', scope: '适用范围', evidence_refs: [], confidence: 'candidate' }],
      unknowns: [{ question: '问题', why_blocking: '影响', blocking: true, owner: '业务负责人' }],
      warnings: []
    }, null, 2)
  ].join('\n');
}

function promptRequirement(input) {
  const { product, requirement, contextText = '', context = {} } = input;
  const existingRules = (context.rules || []).map((rule) => ({
    id: rule.id, revision: rule.revision, statement: rule.statement,
    scope: rule.scope, knowledge_status: rule.knowledge_status, effective_state: rule.effective_state
  }));
  return [
    '你是需求分析器。请只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    '任务：基于产品业务大脑与当前基线，分析本次需求的目标、影响、规则变更、冲突与未知项。',
    '要求：',
    '1. 只有与现有规则主题相关时才提出 rule.revise，并在 rule_id 中使用给定的规则 ID；新规则 rule_id 为 null。',
    '2. 只有同一业务主题存在真实口径差异时才输出 conflicts，必须引用给定规则 ID；不要为了形式而制造冲突。',
    '3. 影响分析分为 actual（实际修改）、verify（需要核对）、keep（保持既有行为），并覆盖配置端、消费端、展示端与历史记录。',
    '4. 不得编造业务阈值；缺失值放入 unknowns 并标 blocking。',
    '5. 规则变更默认进入 planned 基线，不得声称已生效。',
    '',
    '产品：',
    JSON.stringify({
      name: product.name,
      goal: product.goal,
      constraints: product.constraints,
      endpoints: product.endpoints
    }, null, 2),
    '',
    '当前基线：',
    contextText,
    '',
    '现有规则清单（只能引用这些 ID）：',
    JSON.stringify(existingRules, null, 2),
    '',
    '本次需求：',
    JSON.stringify({
      title: requirement.title,
      goal: requirement.goal,
      raw_input: requirement.raw_input,
      scope: requirement.scope
    }, null, 2),
    '',
    '输出结构：',
    JSON.stringify({
      summary: '摘要',
      objects: ['对象'],
      roles: ['角色'],
      endpoints: ['端'],
      core_flows: ['流程步骤'],
      scope: { in_scope: ['范围内'], out_of_scope: ['明确不做'] },
      impact: { actual: ['实际修改'], verify: ['需要核对'], keep: ['保持既有行为'] },
      acceptance: ['可验证的验收条件'],
      unknowns: [{ question: '问题', why_blocking: '影响', blocking: true, owner: '业务负责人' }],
      rule_proposals: [{
        kind: 'rule.create|rule.revise',
        rule_id: null,
        from_revision: null,
        topic: '主题',
        statement: '规则正文',
        scope: '范围',
        constraints: [],
        evidence_refs: [],
        reason: '依据'
      }],
      conflicts: [{
        topic: '主题',
        existing_rule_refs: ['RULE-ID'],
        proposed_statement: '新口径',
        why: '冲突原因',
        options: [
          { id: 'adopt', label: '采用新口径', description: '影响' },
          { id: 'keep', label: '保留现行规则', description: '影响' },
          { id: 'conditional', label: '附加条件后采用', description: '影响' }
        ]
      }],
      proposal_reason: '为什么需要裁决',
      interaction_hints: { primary_page_name: '页面名', states: ['默认', '空数据', '异常'] },
      warnings: []
    }, null, 2)
  ].join('\n');
}

function promptInteractionSpec(input) {
  const { requirement, analysis, contextText = '' } = input;
  return [
    '你是交互规格生成器。请只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    '任务：根据需求分析与业务依据，生成与具体设计工具无关的交互规格。',
    '要求：页面职责、进入条件、角色、组件、状态、字段、行为、反馈、异常、设计约束和验收引用必须来自需求与业务规则；不得补充未定义的业务规则。',
    '',
    '需求：',
    JSON.stringify({ title: requirement.title, goal: requirement.goal, scope: requirement.scope }, null, 2),
    '',
    '需求分析：',
    JSON.stringify(analysis, null, 2).slice(0, 12000),
    '',
    '业务依据：',
    String(contextText).slice(0, 8000),
    '',
    '输出结构：',
    JSON.stringify({
      pages: [{
        id: 'PAGE-1',
        name: '页面名',
        responsibility: '页面职责',
        entry_conditions: ['进入条件'],
        roles: ['角色'],
        components: ['组件'],
        states: [{ name: '默认', behavior: '行为' }],
        fields: [{ name: '字段', type: '类型', required: true }],
        behaviors: ['行为'],
        feedback: ['反馈'],
        exceptions: ['异常'],
        design_constraints: ['约束'],
        acceptance_refs: ['验收引用']
      }]
    }, null, 2)
  ].join('\n');
}

export function createOpenAICompatibleAdapter({
  baseUrl, apiKey, model, maxTokens = 4096, timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = (...args) => fetch(...args), jsonMode = true, label = '模型服务'
}) {
  const config = {
    baseUrl: String(baseUrl || '').trim(),
    apiKey: String(apiKey || '').trim(),
    model: String(model || '').trim(),
    maxTokens,
    timeoutMs,
    jsonMode
  };

  function configured() {
    return Boolean(config.baseUrl && config.apiKey && config.model);
  }

  async function callJson(prompt, { maxTokensOverride } = {}) {
    if (!configured()) {
      throw fail('RUNTIME_NOT_CONFIGURED', '模型服务未配置完整（baseUrl / model / apiKey）');
    }
    const endpoint = endpointFor(config.baseUrl);
    let lastError = null;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const body = {
          model: config.model,
          messages: [
            { role: 'system', content: '你只输出严格 JSON，不输出解释、Markdown 或代码围栏。' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: maxTokensOverride || config.maxTokens
        };
        if (config.jsonMode) body.response_format = { type: 'json_object' };
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timer);
        const rawBody = await response.text();
        if (!response.ok) {
          if (response.status === 400 && config.jsonMode && /response_format/i.test(rawBody)) {
            config.jsonMode = false;
            continue;
          }
          const error = new Error(`模型服务返回 HTTP ${response.status}`);
          error.code = 'RUNTIME_FAILED';
          error.details = { status: response.status, body: rawBody.slice(0, 800) };
          throw error;
        }
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          throw fail('RUNTIME_FAILED', '模型服务返回不是 JSON 响应', { body: rawBody.slice(0, 800) });
        }
        const content = payload?.choices?.[0]?.message?.content
          ?? payload?.choices?.[0]?.text
          ?? payload?.message?.content
          ?? payload?.response;
        const parsed = extractJson(content);
        if (!parsed) {
          throw fail('RUNTIME_FAILED', '模型输出不是可解析的 JSON 对象', {
            raw: String(content || '').slice(0, 8000)
          });
        }
        return parsed;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (error.code === 'RUNTIME_NOT_CONFIGURED') throw error;
        if (attempt === 0) continue;
      }
    }
    throw fail('RUNTIME_FAILED', '模型调用失败', {
      cause: lastError?.message || 'unknown',
      status: lastError?.details?.status || null
    });
  }

  return {
    id: 'openai-compatible',
    label,
    describe() {
      return {
        kind: 'openai-compatible',
        model: config.model || null,
        configured: configured(),
        label,
        baseUrl: config.baseUrl,
        note: 'OpenAI 兼容 /chat/completions；Key 保存在系统安全存储。'
      };
    },
    async analyzeProduct(input) {
      const raw = await callJson(promptProduct(input));
      const normalized = normalizeProductAnalysis(raw, config.model);
      normalized.raw_model_output = raw;
      return normalized;
    },
    async analyzeRequirement(input) {
      const raw = await callJson(promptRequirement(input));
      const normalized = normalizeRequirementAnalysis(raw, {
        modelId: config.model,
        existingRules: input.context?.rules || []
      });
      normalized.raw_model_output = raw;
      return normalized;
    },
    async proposeKnowledge({ text }) {
      const raw = await callJson([
        '从以下材料中提取候选业务规则。只输出 JSON：{"rules":[{"topic":"","statement":"","scope":"","evidence_refs":[],"reason":""}]}',
        String(text || '').slice(0, 12000)
      ].join('\n'));
      return (Array.isArray(raw.rules) ? raw.rules : []).map((item) => ({
        ...item,
        kind: 'rule.create',
        confidence: 'candidate',
        source: `model:${config.model}`
      }));
    },
    async generateInteractionSpec(input) {
      const raw = await callJson(promptInteractionSpec(input), { maxTokensOverride: config.maxTokens });
      const normalized = normalizeInteractionSpec(raw, input.requirement.id, config.model);
      normalized.raw_model_output = raw;
      return normalized;
    },
    async testConnection() {
      const raw = await callJson('只输出 JSON：{"status":"ok","message":"连接成功"}', { maxTokensOverride: 64 });
      return raw;
    },
    config: () => ({
      baseUrl: config.baseUrl,
      model: config.model,
      configured: configured(),
      api_key_present: Boolean(config.apiKey)
    })
  };
}
