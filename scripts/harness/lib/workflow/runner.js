'use strict';

// P9.2（2026-08-21）：workflow runner。
//
// 职责（任务包 P9.2）：
//   1. 读取 workflow 定义（definitions/{workflowId}.json）
//   2. 按 DAG 顺序执行 steps（当前 new-page 为线性链）
//   3. 步骤间传递上下文（前一步输出 → 下一步输入）
//   4. 失败时中断并记录状态
//
// 上下文契约：
//   - workflow 原始 input 放入 context.input；
//   - 每步 adapter 的 context 参数 = { ...context.req, ...context.ui, ...context.page, input }（合并），
//     adapter 自取所需字段（baseline / taskId / pageId / pageTitle / pageFile / docId）；
//   - 步骤产物按 step.output 键存入 context。

const fs = require('fs');
const path = require('path');
const { validateSchema } = require('../schema-validate');

// 注意：本文件位于 scripts/harness/lib/workflow/，比 scripts/harness/lib/ 深一层，
// 到项目根需要 4 级 ..。
const HOST_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFINITIONS_DIR = path.join(__dirname, 'definitions');
const WORKFLOW_SCHEMA = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'standards', 'workflow-definition-schema.json'), 'utf8'));

// task adapter 注册表（P8-P12 只用 DeepSeek，任务包 §10）
const ADAPTERS = Object.freeze({
  'requirement-interview': {
    module: '../../task-adapters/requirement-interview',
    fn: 'runRequirementInterview'
  },
  'ui-spec-generation': {
    module: '../../task-adapters/ui-spec-generation',
    fn: 'runUiSpecGeneration'
  },
  'page-generation': {
    module: '../../task-adapters/page-generation',
    fn: 'runPageGeneration'
  },
  'index-registration': {
    module: '../../task-adapters/index-registration',
    fn: 'runIndexRegistration'
  }
});

function loadDefinition(workflowId) {
  const defPath = path.join(DEFINITIONS_DIR, `${workflowId}.json`);
  if (!fs.existsSync(defPath)) {
    throw new Error(`WORKFLOW 定义不存在：${workflowId}（${path.relative(HOST_ROOT, defPath)}）`);
  }
  const definition = JSON.parse(fs.readFileSync(defPath, 'utf8'));
  const validation = validateSchema(definition, WORKFLOW_SCHEMA);
  if (!validation.valid) {
    throw new Error(`WORKFLOW 定义不合法（${workflowId}）：${validation.errors.join('；')}`);
  }
  return definition;
}

async function runTaskAdapter(task, { input, provider, dryRun, verbose, context }) {
  const entry = ADAPTERS[task];
  if (!entry) {
    throw new Error(`WORKFLOW task adapter 未实现：${task}`);
  }
  const mod = require(entry.module);
  if (typeof mod[entry.fn] !== 'function') {
    throw new Error(`WORKFLOW adapter 缺少入口函数：${task}.${entry.fn}`);
  }
  return mod[entry.fn]({ input, provider, dryRun, verbose, context });
}

// 返回摘要：
//   { ok, workflowId, steps: [{stepId, task, ok, out}], artifacts, failedSteps, warnings }
async function runWorkflow({ workflowId, input, provider = 'deepseek', dryRun = false, verbose = false }) {
  const definition = loadDefinition(workflowId);
  const context = { input: String(input || '') };
  const artifacts = [];
  const steps = [];
  const warnings = [];

  for (const step of definition.steps) {
    const stepResult = { stepId: step.step_id, task: step.task, ok: false, out: null };
    steps.push(stepResult);
    try {
      // 步骤输入：input_from 指向的上下文对象（无 input_from 时为 workflow 原始 input）
      let stepInput = context.input;
      if (step.input_from) {
        stepInput = context[step.input_from] !== undefined ? context[step.input_from] : context.input;
      }
      const adapterContext = {
        input: context.input,
        ...(context.req || {}),
        ...(context.ui || {}),
        ...(context.page || {})
      };
      const result = await runTaskAdapter(step.task, {
        input: stepInput,
        provider,
        dryRun,
        verbose,
        context: adapterContext
      });
      if (!result.ok) {
        stepResult.error = result.error || { message: 'adapter 返回失败', phase: 'unknown' };
        warnings.push(`步骤 ${step.step_id} 失败：${stepResult.error.message}`);
        break; // 失败中断（任务包 P9.2：失败时中断并记录状态）
      }
      stepResult.ok = true;
      if (result.outPath) stepResult.out = path.relative(HOST_ROOT, result.outPath);
      if (result.pagePath) stepResult.page = path.relative(HOST_ROOT, result.pagePath);
      if (result.patchPath) stepResult.patch = path.relative(HOST_ROOT, result.patchPath);
      if (Array.isArray(result.warnings)) warnings.push(...result.warnings);

      // 上下文装配
      if (step.output === 'req') {
        context.req = { baseline: result.task, taskId: result.taskId, outPath: result.outPath };
      } else if (step.output === 'ui') {
        context.ui = { uiSpecPath: result.outPath, taskId: result.taskId };
      } else if (step.output === 'page') {
        context.page = {
          pageId: result.pageId,
          pageTitle: result.pageTitle,
          pageFile: result.pageFile,
          docId: result.pageId,
          pagePath: result.pagePath,
          docsPath: result.docsPath
        };
      } else if (step.output === 'index') {
        context.index = { patchPath: result.patchPath, previewPath: result.previewPath };
      }

      artifacts.push({ step: step.step_id, task: step.task, out: stepResult.out || stepResult.page || stepResult.patch });
    } catch (error) {
      stepResult.error = { message: error.message, phase: 'exception' };
      warnings.push(`步骤 ${step.step_id} 异常：${error.message}`);
      break;
    }
  }

  const okSteps = steps.filter((s) => s.ok).length;
  const failedSteps = steps.filter((s) => !s.ok);
  const summary = {
    ok: okSteps === steps.length && steps.length > 0,
    workflow_id: workflowId,
    provider,
    dry_run: dryRun || undefined,
    steps_total: steps.length,
    steps_ok: okSteps,
    artifacts,
    failedSteps: failedSteps.map((s) => ({ stepId: s.stepId, error: s.error })),
    warnings: warnings.length > 0 ? warnings : undefined
  };
  if (summary.failedSteps.length === 0) delete summary.failedSteps;
  return summary;
}

module.exports = {
  ADAPTERS,
  loadDefinition,
  runWorkflow
};
