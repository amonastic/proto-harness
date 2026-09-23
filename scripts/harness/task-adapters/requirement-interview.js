'use strict';

// P8.3（2026-08-21）：requirement-interview task adapter。
//
// 职责（任务包 P8.3）：
//   1. 构造需求聚焦 Prompt（业务外脑 + 用户输入 + 需求 schema）
//   2. 调用 DeepSeek API（复用 P1 execution-runtime.js，扩展 maxTokens）
//   3. 验证输出符合 requirement-baseline-schema.json（轻量校验，见 lib/schema-validate.js）
//   4. 写入 .harness-runtime/tasks/{task-id}.json
//
// 模式：
//   - 真实模式（provider=deepseek）：需要 DEEPSEEK_API_KEY，调用官方 chat/completions。
//   - dry-run 模式（dryRun=true）：本地合成符合 schema 的需求基线，产物标记 dry_run: true，
//     用于链路验证（2026-08-21 用户裁决：真实调用待 key 提供后补跑）。
//
// 错误映射（对齐 P5 deepseek adapter 四类错误语义）：
//   - api_failure  → 调用层失败，retry（MAX_RETRIES）
//   - format_error → 输出 JSON 解析失败 / schema 校验失败，retry
//   - semantic_failure → 解析成功但缺关键字段（如 platforms 缺失），retry
//
// 任务包风险表缓解：DeepSeek 输出格式不稳定 → retry 机制 + 提取 JSON 兼容前缀。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadBusinessBrain, matchCapabilityCards } = require('../lib/business-brain-loader');
const { createExecutionRuntime } = require('../providers/execution-runtime');
const { validateSchema } = require('../lib/schema-validate');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = path.join(HOST_ROOT, 'standards', 'requirement-baseline-schema.json');
const DEFAULT_OUT_DIR = path.join(HOST_ROOT, '.harness-runtime', 'tasks');
const MAX_OUTPUT_TOKENS = 2048; // 需求基线 JSON 长输出（P5 execution-runtime 默认 16 只够 verdict）
const MAX_RETRIES = 2; // 任务包风险表：格式不稳定 → retry 2 次
const BRAIN_CARD_SNIPPET_LIMIT = 600; // 每张能力卡注入 Prompt 的正文上限

// ---- 工具 ----

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(input, fallback) {
  const cleaned = String(input || '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

// 从输入生成稳定 taskId（可复现；中文输入 fallback 到 hash）
function buildTaskId(input) {
  const slug = slugify(input, '');
  if (slug.length >= 4) {
    const upper = slug.toUpperCase();
    return upper.length > 32 ? `REQ-${upper.slice(0, 32)}` : `REQ-${upper}`;
  }
  const hash = crypto.createHash('sha1').update(String(input || '')).digest('hex').slice(0, 12);
  return `REQ-${hash.toUpperCase()}`;
}

// 从响应文本提取 JSON 对象（容忍 ```json 围栏与前后缀文本）
function extractJson(text) {
  const cleaned = String(text || '').trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : cleaned;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function writeOutAtomic(outPath, content) {
  const dir = path.dirname(outPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${outPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`);
  fs.renameSync(tmp, outPath);
}

function resolveOutPath(outPath) {
  const resolved = path.resolve(HOST_ROOT, outPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`REQ_INTERVIEW --out escapes project root: ${outPath}`);
  }
  return resolved;
}

// ---- Prompt 构造 ----

function buildBusinessContext(userInput) {
  const { entry, scope, warnings } = loadBusinessBrain();
  const cards = matchCapabilityCards(String(userInput || ''));
  const cardLines = cards.length > 0
    ? cards.map((card) => {
        const body = loadCardBody(card.file);
        return `- ${card.name}（命中：${card.matched.join('、')}）\n${body.slice(0, BRAIN_CARD_SNIPPET_LIMIT)}`;
      })
    : ['- 无命中能力卡'];
  const context = [
    '--- 入口要点 ---',
    entry.slice(0, 1500),
    '--- 范围判断框架要点 ---',
    scope.slice(0, 1500),
    '--- 命中业务能力卡 ---',
    ...cardLines
  ].join('\n');
  return { context, warnings };
}

function loadCardBody(file) {
  const { loadAllCapabilityCards } = require('../lib/business-brain-loader');
  const card = loadAllCapabilityCards().find((item) => item.file === file);
  return card ? card.text : '';
}

function buildPrompt({ businessContext, userInput, schemaText }) {
  return [
    '你是需求聚焦者，按第一性原理把模糊需求收敛为需求基线。',
    '',
    '业务外脑已读取：',
    businessContext,
    '',
    '用户需求：',
    userInput,
    '',
    '任务：',
    '1. 判断业务域、角色、端范围（前端/后端影响）',
    '2. 识别核心流程与数据权限',
    '3. 列出验收标准、范围边界、风险',
    '4. 区分已确认、推断、待确认',
    '',
    '输出纯 JSON（不输出其他内容），必须严格遵守以下 schema：',
    schemaText
  ].join('\n');
}

// ---- dry-run 合成 provider ----

// 本地合成需求基线（仅链路验证）。内容为中性通用结构，不含真实业务分支；
// 产物标记 dry_run: true，真实调用待 DEEPSEEK_API_KEY 提供后补跑。
function synthesizeBaseline(input) {
  const s = String(input || '').trim() || '未命名需求';
  const title = s.replace(/\s+/g, ' ').slice(0, 15) || '未命名需求';
  return {
    title,
    target: s,
    roles_and_platforms: {
      roles: ['配置管理员'],
      platforms: ['管理后台'],
      frontend_impact: '配置入口与生效状态展示',
      backend_impact: '配置存储与下发'
    },
    core_flows: [
      '配置管理员在配置端维护规则',
      '规则保存后下发至消费端',
      '消费端按规则生效并给出反馈'
    ],
    data_and_permission: {
      data_source: '配置端 → 消费端',
      permission_control: '仅授权角色可维护配置'
    },
    acceptance_criteria: [
      '配置端可完成规则的新增与移除',
      '消费端按已保存配置生效'
    ],
    scope: {
      in_scope: ['配置维护', '生效链路'],
      out_of_scope: ['跨组织的批量设置']
    },
    risks_and_boundaries: [
      '配置生效延迟',
      '多端状态一致性'
    ],
    confirmed_facts: [],
    inferred_assumptions: ['dry-run 合成产物，仅用于链路验证，非真实业务分析'],
    key_decisions: []
  };
}

function createRequirementDryRunProvider() {
  return {
    provider_id: 'P-REQ-INTERVIEW-DRY-RUN',
    async call({ runId, taskId, prompt }) {
      const baseline = synthesizeBaseline(String(prompt || '').match(/用户需求：\s*([\s\S]*?)\n\n任务：/)?.[1] || '');
      const summary = `synthetic baseline: ${baseline.title}`;
      return {
        schema_version: 'h02-provider-result-v1',
        provider_id: 'P-REQ-INTERVIEW-DRY-RUN',
        role: 'execution',
        request_id: `dry-${runId}-${Date.now()}`,
        outcome: {
          code: 'OK',
          summary,
          exit_code: 0,
          tool_result: { tool: 'requirement-interview-dry-run', summary, baseline }
        }
      };
    }
  };
}

// ---- 主入口 ----

// 返回：
//   { ok, outPath, taskId, dryRun, title, task, warnings, attempts, error }
async function runRequirementInterview({ input, provider = 'deepseek', dryRun = false, out = null, verbose = false }) {
  const warnings = [];
  const userInput = String(input || '').trim();
  if (!userInput) {
    return { ok: false, error: { message: 'REQ_INTERVIEW --input 不能为空', phase: 'input' }, warnings };
  }

  // 1. schema + 业务外脑
  let schema = null;
  try {
    schema = readJsonFile(SCHEMA_PATH);
  } catch (error) {
    return { ok: false, error: { message: `REQ_INTERVIEW schema 读取失败: ${error.message}`, phase: 'schema' }, warnings };
  }
  const { context: businessContext, warnings: brainWarnings } = buildBusinessContext(userInput);
  warnings.push(...brainWarnings);

  // 2. taskId 与 out
  const taskId = buildTaskId(userInput);
  const outPath = out ? resolveOutPath(out) : path.join(DEFAULT_OUT_DIR, `${taskId}.json`);

  // 3. provider
  let runtime;
  if (dryRun) {
    runtime = createRequirementDryRunProvider();
  } else {
    runtime = createExecutionRuntime();
  }

  // 4. 执行（retry 循环：api/format/semantic 失败重试）
  const prompt = buildPrompt({ businessContext, userInput, schemaText: JSON.stringify(schema, null, 2) });
  const runId = taskId;
  let baseline = null;
  let attempts = 0;
  let lastError = null;

  for (attempts = 1; attempts <= MAX_RETRIES + 1; attempts += 1) {
    try {
      const result = await runtime.call({ runId, taskId, prompt, maxTokens: MAX_OUTPUT_TOKENS });
      const raw = result && result.outcome && result.outcome.tool_result
        ? result.outcome.tool_result.baseline || result.outcome.tool_result.summary || ''
        : '';
      let parsed = null;
      if (result.outcome.tool_result && result.outcome.tool_result.baseline) {
        parsed = result.outcome.tool_result.baseline; // dry-run 直接给出对象
      } else {
        parsed = extractJson(raw || result.outcome.summary || '');
      }
      if (parsed === null) {
        lastError = { message: '输出无法解析为 JSON', phase: 'format_error' };
        if (verbose) warnings.push(`第 ${attempts} 次尝试：format_error`);
        continue;
      }
      const validation = validateSchema(parsed, schema);
      if (!validation.valid) {
        lastError = { message: `schema 校验失败：${validation.errors.join('；')}`, phase: 'format_error' };
        if (verbose) warnings.push(`第 ${attempts} 次尝试：${lastError.message}`);
        continue;
      }
      baseline = parsed;
      break;
    } catch (error) {
      lastError = { message: `调用失败：${error.message}`, phase: 'api_failure' };
      if (verbose) warnings.push(`第 ${attempts} 次尝试：api_failure`);
      // api 层失败也进入 retry（P5 deepseek adapter 语义：api_failure 按 --retry 重试）
    }
  }

  if (baseline === null) {
    return {
      ok: false,
      outPath,
      taskId,
      dryRun,
      warnings,
      attempts,
      error: lastError || { message: '未知错误', phase: 'unknown' }
    };
  }

  // 5. 落盘（产物带执行元信息）
  const artifact = {
    schema_version: schema.schema_version || 'requirement-baseline-v1',
    task_id: taskId,
    task: 'requirement-interview',
    provider,
    dry_run: dryRun || undefined,
    created_at: new Date().toISOString(),
    input: userInput,
    baseline
  };
  writeOutAtomic(outPath, artifact);

  const title = baseline.title || '';
  if (verbose) {
    warnings.push(`out: ${path.relative(HOST_ROOT, outPath)}`);
    warnings.push(`title: ${title}`);
  }
  return { ok: true, outPath, taskId, dryRun, title, task: baseline, warnings, attempts };
}

module.exports = {
  HOST_ROOT,
  SCHEMA_PATH,
  MAX_OUTPUT_TOKENS,
  MAX_RETRIES,
  buildTaskId,
  extractJson,
  buildPrompt,
  synthesizeBaseline,
  createRequirementDryRunProvider,
  runRequirementInterview
};
