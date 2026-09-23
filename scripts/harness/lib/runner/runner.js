'use strict';

// H02：Runner 核心（最小可重放链路）。
// 职责边界：只生成 Trace/Result/Checkpoint，不对业务正确性下判断（语义判断留给 JudgeProvider，
// H02 阶段为合成占位）。失败/中断/敏感/权限/非法输入全部走确定性分支，不伪造 SUCCEEDED。
//
// 主流程：
//   1. 权限预检（fixture.permission vs adapter 声明的 capabilities/max_risk）→ 不满足即拒绝
//   2. run_id 去重（trace 产物已存在 → 拒绝，不覆盖）
//   3. 事件循环：逐 step 构造统一 request → executionProvider.call → 按 outcome 记录事件
//      - 每步完成后写 checkpoint（input_digest 为真实输入 hash）
//      - 敏感检测：step 输入或工具输出含敏感字段 → 记录拒绝事件，不把敏感值写入 trace
//   4. 中断/超时：outcome TIMEOUT → 保留最后完整事件，Result INCOMPLETE
//   5. 收尾：trace 结构自检 → result 生成（真实状态）→ 写盘（原子写）

const fs = require('fs');
const path = require('path');
const { stableJson } = require('../trace/schema-check');
const { buildTrace, assertValidTrace, serializeTrace, newTraceId, newRunId } = require('../trace/builder');
const { makeToolEvent, makeStateTransitionEvent, makeErrorEvent } = require('../trace/events');
const { hasSensitiveFields } = require('./sensitive');
const { buildResult, assertValidResult, newResultId } = require('./result');
const {
  buildCheckpoint, assertValidCheckpoint, writeCheckpoint, readCheckpoint, supersedeCheckpoint,
  inputDigestOf, newCheckpointId
} = require('./checkpoint');

const HOST_ROOT = path.resolve(__dirname, '../../../..');
const DEFAULT_OUT_DIR = '.harness-runtime/runner';
const SCOPE = 'harness-engineering';
const SOURCE_REFS = ['A-HARNESS-ENGINEERING-PRINCIPLES', 'urn:h01:trace.schema.json', 'urn:h01:result.schema.json', 'urn:h01:checkpoint.schema.json', 'urn:h01:provider.schema.json'];

// outcome.code → event 映射
const OUTCOME_RESULT_CODES = Object.freeze({
  OK: 'OK',
  TOOL_ERROR: 'TOOL_ERROR',
  TIMEOUT: 'TIMEOUT',
  SENSITIVE_REJECTED: 'SENSITIVE_REJECTED',
  BLOCKED: 'BLOCKED',
  PLACEHOLDER: 'PLACEHOLDER'
});

function artifactPath(outDir, runId, kind) {
  // 双重防护：runId 与 outDir 均不得逃逸项目根（run_id 无 schema pattern，CLI 层与写盘层都收紧）
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(runId)) {
    throw new Error(`H02_RUNNER invalid run_id: ${runId}`);
  }
  const dir = path.resolve(HOST_ROOT, outDir);
  const relative = path.relative(HOST_ROOT, dir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`H02_RUNNER outDir escapes project root: ${outDir}`);
  }
  return path.join(dir, `${runId}.${kind}.json`);
}

// 权限预检：fixture.permission 必须被 adapter 声明的能力覆盖且风险不超限。
function assertPermissionGranted(fixture, provider) {
  const permission = fixture.permission || {};
  const capability = permission.capability || 'run-synthetic-tool';
  const risk = permission.risk || 'low';
  if (!provider.capabilities || !provider.capabilities.includes(capability)) {
    const error = new Error(`H02_PERMISSION capability not granted: ${capability}`);
    error.code = 'H02_PERMISSION_DENIED';
    throw error;
  }
  const riskRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const allowedRank = riskRank[provider.max_risk] ?? 0;
  const requiredRank = riskRank[risk] ?? 0;
  if (requiredRank > allowedRank) {
    const error = new Error(`H02_PERMISSION risk not granted: ${risk} > ${provider.max_risk}`);
    error.code = 'H02_PERMISSION_DENIED';
    throw error;
  }
}

// run_id 去重：trace 产物已存在 → 拒绝（不覆盖既有运行记录）。
function assertRunIdAvailable(runId, outDir) {
  if (fs.existsSync(artifactPath(outDir, runId, 'trace'))) {
    const error = new Error(`H02_RUN_ID_EXISTS run_id already has a trace artifact: ${runId}`);
    error.code = 'H02_RUN_ID_EXISTS';
    throw error;
  }
}

// 事件循环单步：返回 { event, stateTo, checkpoint }。
function runStep({ sequence, stateFrom, step, fixture, seed, runId, taskId, executionProvider }) {
  const result = executionProvider.call({ runId, taskId, fixture, step, seed });
  const code = (result.outcome && result.outcome.code) || 'BLOCKED';
  const summary = (result.outcome && result.outcome.summary) || `tool=${step.tool || 'synth-tool'} no outcome summary`;
  const tool = typeof step.tool === 'string' && step.tool.length > 0 ? step.tool : 'synth-tool';
  let event;
  let stateTo;
  switch (code) {
    case 'OK':
      stateTo = 'COMPLETED';
      event = makeToolEvent(sequence, stateFrom, stateTo, tool, 'OK', summary);
      break;
    case 'TOOL_ERROR': {
      const exitCode = Number.isInteger(result.outcome.exit_code) ? result.outcome.exit_code : 1;
      stateTo = 'FAILED';
      event = makeToolEvent(sequence, stateFrom, stateTo, tool, `TOOL_ERROR:${exitCode}`, summary);
      break;
    }
    case 'TIMEOUT':
      stateTo = 'ABORTED';
      event = makeToolEvent(sequence, stateFrom, stateTo, tool, 'TIMEOUT', summary);
      break;
    case 'SENSITIVE_REJECTED':
      stateTo = 'FAILED';
      event = makeErrorEvent(sequence, stateFrom, stateTo, tool, 'SENSITIVE_REJECTED', summary);
      break;
    default:
      stateTo = 'FAILED';
      event = makeErrorEvent(sequence, stateFrom, stateTo, tool, code, summary);
      break;
  }
  return { event, stateTo };
}

// 敏感检测：step 输入（args/payload）或产出内容（tool_result/summary）含敏感字段时，拒绝写入。
function detectSensitive(value) {
  return hasSensitiveFields(value);
}

// 执行一次运行。options：
//   fixture, runId?, seed?, outDir?, resumeCheckpointId?, forceRunId?, interruptAfter?（模拟进程中断：执行到该步后停止，仅保留 checkpoint）
// 返回 { trace, result, checkpoint, outDir, runId, traceFile, resultFile, checkpointFile, resumedFrom, interrupted }。
function execute({ fixture, runId, seed = 1, outDir = DEFAULT_OUT_DIR, resumeCheckpointId = null, forceRunId = false, interruptAfter = undefined }) {
  const steps = Array.isArray(fixture.steps) ? fixture.steps : [];
  if (steps.length === 0) throw new Error('H02_RUNNER fixture.steps must be non-empty');

  const rulesetId = fixture.ruleset_id || '';
  const epochId = fixture.epoch_id || '';
  const taskId = fixture.task_id || '';
  if (!rulesetId || !epochId || !taskId) {
    const error = new Error('H02_RUNNER fixture must declare task_id/ruleset_id/epoch_id (real references required)');
    error.code = 'H02_INVALID_FIXTURE';
    throw error;
  }

  // 权限预检（R00-09）
  const executionProvider = require('../../providers/execution-provider').createExecutionProvider();
  assertPermissionGranted(fixture, executionProvider);

  // run_id：显式或派生；去重检查（R00-07）——resume 同一 run 除外（input_digest 已由恢复路径校验）
  const finalRunId = runId || newRunId(`run:${stableJson({ fixture, seed })}`);
  if (!forceRunId && !resumeCheckpointId) assertRunIdAvailable(finalRunId, outDir);

  const traceId = newTraceId(`trace:${stableJson({ fixture, seed })}`);
  const inputDigest = inputDigestOf(fixture, rulesetId, epochId, seed);

  // 恢复：从 checkpoint 的 last_event_sequence 继续（R00-08）
  let resumedFrom = null;
  let startIndex = 0;
  let state = 'IDLE';
  const events = [];
  if (resumeCheckpointId) {
    const ckpt = readCheckpoint(resumeCheckpointId, outDir);
    if (!ckpt) throw new Error(`H02_CHECKPOINT not found: ${resumeCheckpointId}`);
    if (!ckpt.resumable) throw new Error(`H02_CHECKPOINT not resumable: ${resumeCheckpointId}`);
    if (ckpt.status === 'superseded') throw new Error(`H02_CHECKPOINT superseded: ${resumeCheckpointId}`);
    if (ckpt.input_digest !== inputDigest) throw new Error('H02_CHECKPOINT input_digest mismatch with current fixture/seed');
    if (ckpt.trace_id !== traceId) throw new Error('H02_CHECKPOINT trace_id mismatch with current fixture/seed');
    startIndex = ckpt.last_event_sequence;
    resumedFrom = ckpt.checkpoint_id;
    // 重放已确认事件：state 链与正常路径一致（state_from = 前一步 state_to）
    for (let i = 0; i < startIndex; i += 1) {
      const step = steps[i];
      const code = outcomeCodeFor(step);
      const nextState = stateFor(code);
      events.push(makeToolEvent(i + 1, state, nextState, stepTool(step), code, summaryFor(step)));
      state = nextState;
    }
  }

  // 事件循环
  let interrupted = false;
  let interruptionCode = null;
  let checkpoint = null;
  let sensitiveRejected = false;

  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index];
    const sequence = index + 1;

    // 敏感检测（R00-05）：step 输入含敏感字段 → 拒绝该步并记录拒绝事件，不落盘敏感值
    const sensitiveFindings = detectSensitive(step);
    if (sensitiveFindings.length > 0) {
      sensitiveRejected = true;
      const fromState = events.length ? events[events.length - 1].state_to : state;
      events.push(makeErrorEvent(sequence, fromState, 'ABORTED', stepTool(step), 'SENSITIVE_REJECTED', `sensitive field rejected before write: ${sensitiveFindings.join(',')}`));
      const rejectedCkpt = buildCheckpoint({
        checkpointId: newCheckpointId(`ckpt:${traceId}:${sequence}`),
        traceId,
        lastEventSequence: sequence,
        state: 'ABORTED',
        snapshotRef: artifactPath(outDir, finalRunId, 'checkpoint'),
        inputDigest,
        resumable: false,
        status: 'active',
        scope: SCOPE,
        sourceRefs: SOURCE_REFS
      });
      writeCheckpoint(rejectedCkpt, outDir);
      checkpoint = rejectedCkpt;
      break;
    }

    const { event, stateTo } = runStep({ sequence, stateFrom: state, step, fixture, seed, runId: finalRunId, taskId, executionProvider });
    // 输出侧敏感检测（R00-05）：provider 产出（tool_result/summary）含敏感字段同样拒绝落盘
    const outputSensitive = detectSensitive(event.tool_result || {});
    if (outputSensitive.length > 0) {
      sensitiveRejected = true;
      const fromState = events.length ? events[events.length - 1].state_to : state;
      events.push(makeErrorEvent(sequence, fromState, 'ABORTED', stepTool(step), 'SENSITIVE_REJECTED', `sensitive output rejected before write: ${outputSensitive.join(',')}`));
      const rejectedOutCkpt = buildCheckpoint({
        checkpointId: newCheckpointId(`ckpt:${traceId}:${sequence}`),
        traceId,
        lastEventSequence: sequence,
        state: 'ABORTED',
        snapshotRef: artifactPath(outDir, finalRunId, 'checkpoint'),
        inputDigest,
        resumable: false,
        status: 'active',
        scope: SCOPE,
        sourceRefs: SOURCE_REFS
      });
      writeCheckpoint(rejectedOutCkpt, outDir);
      checkpoint = rejectedOutCkpt;
      break;
    }
    events.push(event);
    state = stateTo;
    const isFailure = ['TOOL_ERROR', 'TIMEOUT', 'SENSITIVE_REJECTED'].some((prefix) => event.result_code.startsWith(prefix)) || event.event_type === 'error';
    if (isFailure) {
      interrupted = true;
      interruptionCode = event.result_code;
    }

    // 每步后写 checkpoint（可恢复：仅 OK 步骤可恢复；TIMEOUT/工具错误/敏感拒绝/BLOCKED 不可恢复，进程级中断后可恢复最后成功步）
    const simulatedKill = interruptAfter !== undefined && sequence >= interruptAfter;
    const resumable = event.result_code === 'OK';
    const stepCkpt = buildCheckpoint({
      checkpointId: newCheckpointId(`ckpt:${traceId}:${sequence}`),
      traceId,
      lastEventSequence: sequence,
      state,
      snapshotRef: artifactPath(outDir, finalRunId, 'checkpoint'),
      inputDigest,
      resumable,
      status: 'active',
      scope: SCOPE,
      sourceRefs: SOURCE_REFS
    });
    writeCheckpoint(stepCkpt, outDir);
    checkpoint = stepCkpt;

    if (interrupted) break;
    if (simulatedKill) {
      interrupted = true;
      interruptionCode = 'PROCESS_KILLED';
      break;
    }
  }

  // 终止状态：真实反映执行结果，不伪造 SUCCEEDED
  const allStepsDone = events.length === steps.length && !interrupted && !sensitiveRejected;
  const anyError = events.some((event) => event.result_code.startsWith('TOOL_ERROR') || event.result_code === 'SENSITIVE_REJECTED' || event.result_code === 'TIMEOUT' || event.event_type === 'error');
  let terminalState;
  let traceStatus;
  if (sensitiveRejected) {
    terminalState = 'ABORTED';
    traceStatus = 'aborted';
  } else if (allStepsDone && !anyError) {
    terminalState = 'COMPLETED';
    traceStatus = 'completed';
  } else if (interrupted && (interruptionCode === 'TIMEOUT' || interruptionCode === 'PROCESS_KILLED')) {
    terminalState = 'ABORTED';
    traceStatus = 'aborted';
  } else if (anyError) {
    terminalState = 'FAILED';
    traceStatus = 'failed';
  } else {
    terminalState = 'ABORTED';
    traceStatus = 'aborted';
  }

  const trace = buildTrace({
    traceId,
    runId: finalRunId,
    taskId,
    rulesetId,
    epochId,
    fixtureSuiteRef: fixture.fixture_suite_ref || '',
    oracleRef: fixture.oracle_ref || '',
    adapterRef: fixture.adapter_ref || '',
    events,
    terminalState,
    status: traceStatus,
    scope: SCOPE,
    sourceRefs: SOURCE_REFS
  });
  if (!fixture.fixture_suite_ref || !fixture.oracle_ref || !fixture.adapter_ref) {
    throw new Error('H02_RUNNER fixture must declare fixture_suite_ref/oracle_ref/adapter_ref');
  }
  // 写盘前结构自检（R00-06 非法 Trace 在此拒绝）
  assertValidTrace(trace);

  // Result：真实状态（TIMEOUT/PROCESS_KILLED → INCOMPLETE；敏感拒绝 → BLOCKED；工具错误 → FAILED）
  const resultStatus = allStepsDone && !anyError ? 'SUCCEEDED' : (interruptionCode === 'TIMEOUT' || interruptionCode === 'PROCESS_KILLED' ? 'INCOMPLETE' : (sensitiveRejected ? 'BLOCKED' : 'FAILED'));
  const evidenceRefs = [artifactPath(outDir, finalRunId, 'trace')];
  const result = buildResult({
    resultId: newResultId(`result:${traceId}`),
    traceId,
    status: resultStatus,
    summary: `runner executed ${events.length}/${steps.length} steps; terminal_state=${terminalState}`,
    completionEvidenceRefs: evidenceRefs,
    createdBy: 'runner-local-fixture-h02',
    scope: SCOPE,
    sourceRefs: SOURCE_REFS,
    failureCode: anyError && !sensitiveRejected ? (interruptionCode || 'TOOL_ERROR') : undefined,
    blockingReason: sensitiveRejected ? 'sensitive field rejected before write' : undefined
  });
  assertValidResult(result);
  assertValidCheckpoint(checkpoint);

  // 写盘（原子写）
  const traceFile = artifactPath(outDir, finalRunId, 'trace');
  const resultFile = artifactPath(outDir, finalRunId, 'result');
  const checkpointFile = artifactPath(outDir, finalRunId, 'checkpoint');
  fs.mkdirSync(path.dirname(traceFile), { recursive: true });
  fs.writeFileSync(`${traceFile}.tmp`, serializeTrace(trace));
  fs.renameSync(`${traceFile}.tmp`, traceFile);
  fs.writeFileSync(`${resultFile}.tmp`, `${stableJson(result)}\n`);
  fs.renameSync(`${resultFile}.tmp`, resultFile);
  fs.writeFileSync(`${checkpointFile}.tmp`, `${stableJson(checkpoint)}\n`);
  fs.renameSync(`${checkpointFile}.tmp`, checkpointFile);

  // resume 成功后：被恢复的 checkpoint 置 superseded（旧恢复点失效）
  if (resumedFrom) {
    supersedeCheckpoint(resumedFrom, outDir);
  }

  return {
    trace,
    result,
    checkpoint,
    runId: finalRunId,
    traceFile,
    resultFile,
    checkpointFile,
    resumedFrom,
    interrupted,
    outDir
  };
}

// ---- 恢复用辅助（重放已确认事件，保持与正常路径一致的确定性）----
function stepTool(step) {
  return typeof step.tool === 'string' && step.tool.length > 0 ? step.tool : 'synth-tool';
}
function outcomeCodeFor(step) {
  switch (step.behavior) {
    case 'error': return `TOOL_ERROR:${Number.isInteger(step.exit_code) ? step.exit_code : 1}`;
    case 'timeout': return 'TIMEOUT';
    case 'sensitive': return 'SENSITIVE_REJECTED';
    default: return 'OK';
  }
}
function summaryFor(step) {
  const tool = stepTool(step);
  if (step.behavior === 'error') return `tool=${tool} exit_code=${Number.isInteger(step.exit_code) ? step.exit_code : 1}`;
  if (step.behavior === 'timeout') return `tool=${tool} exceeded adapter time limit`;
  if (step.behavior === 'sensitive') return 'adapter refused to emit sensitive field content';
  return `tool=${tool} exit_code=0`;
}
function stateFor(code) {
  if (code === 'OK') return 'COMPLETED';
  if (code === 'TIMEOUT') return 'ABORTED';
  return 'FAILED';
}

module.exports = {
  DEFAULT_OUT_DIR,
  OUTCOME_RESULT_CODES,
  assertPermissionGranted,
  assertRunIdAvailable,
  detectSensitive,
  execute,
  artifactPath
};
