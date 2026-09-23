'use strict';

// H02：Runner/Trace 最小可重放链路强制测试矩阵（R00-01..R00-10）。
// 全部通过真实执行验证（execute() 真实写盘 + adapter 真实调用），
// 禁止 mock 断言、字符串包含匹配或跳过真实 Runner 调用来伪造通过。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const FIXTURES_DIR = path.join(HOST_ROOT, 'tests/harness/fixtures/synthetic');

const { execute } = require('../../../scripts/harness/lib/runner/runner');
const { assertValidTrace, buildTrace, newTraceId, newRunId } = require('../../../scripts/harness/lib/trace/builder');
const { makeToolEvent, makeErrorEvent } = require('../../../scripts/harness/lib/trace/events');
const { validateTrace, validateResult, validateCheckpoint, validateProvider, stableJson } = require('../../../scripts/harness/lib/trace/schema-check');
const { hasSensitiveFields } = require('../../../scripts/harness/lib/runner/sensitive');
const { createExecutionProvider } = require('../../../scripts/harness/providers/execution-provider');
const { createJudgeProvider } = require('../../../scripts/harness/providers/judge-provider');
const { createLocalFixtureAdapter, createPlaceholderJudge } = require('../../../scripts/harness/adapters/local-fixture');
const { assertProviderMessageShape, sameShape } = require('../../../scripts/harness/lib/runner/protocol');

const SENSITIVE_VALUE = 'sk-test-0123456789abcdef';

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

function outDir(name) {
  return `.harness-runtime/runner-test/${name}-${process.pid}`;
}

// 运行产物关键字段（排除 trace_id/run_id）序列化比较用。
function keyFields(trace) {
  return stableJson({
    task_id: trace.task_id,
    ruleset_id: trace.ruleset_id,
    epoch_id: trace.epoch_id,
    fixture_suite_ref: trace.fixture_suite_ref,
    oracle_ref: trace.oracle_ref,
    adapter_ref: trace.adapter_ref,
    events: trace.events,
    terminal_state: trace.terminal_state,
    status: trace.status,
    scope: trace.scope,
    source_refs: trace.source_refs
  });
}

test('R00-01 identical fixture/ruleset/epoch/seed produces byte-identical key trace fields', () => {
  const fixture = loadFixture('r00-01-replayable.json');
  const dir = outDir('r00-01');
  const first = execute({ fixture, seed: 42, outDir: dir });
  const second = execute({ fixture, seed: 42, outDir: dir, forceRunId: true });
  assert.equal(first.result.status, 'SUCCEEDED');
  assert.equal(second.result.status, 'SUCCEEDED');
  // trace_id/run_id 允许不同（确定性派生时也可能相同），关键字段必须逐字节一致
  assert.equal(keyFields(first.trace), keyFields(second.trace), 'events sequence and other key fields must be byte-identical');
  // 磁盘产物同样一致
  const diskA = JSON.parse(fs.readFileSync(first.traceFile, 'utf8'));
  const diskB = JSON.parse(fs.readFileSync(second.traceFile, 'utf8'));
  assert.equal(keyFields(diskA), keyFields(diskB));
});

test('R00-02 successful tool call records real tool_result and SUCCEEDED result', () => {
  const fixture = loadFixture('r00-02-success.json');
  const dir = outDir('r00-02');
  const outcome = execute({ fixture, seed: 7, outDir: dir });
  assert.equal(outcome.result.status, 'SUCCEEDED');
  assert.equal(outcome.trace.status, 'completed');
  assert.equal(outcome.trace.terminal_state, 'COMPLETED');
  assert.equal(outcome.trace.events.length, 2);
  for (const event of outcome.trace.events) {
    assert.equal(event.event_type, 'tool');
    assert.equal(event.result_code, 'OK');
    assert.match(event.tool_result.summary, /^tool=synth-echo exit_code=0$/);
  }
  assert.deepEqual(validateTrace(outcome.trace).errors, []);
  assert.deepEqual(validateResult(outcome.result).errors, []);
});

test('R00-03 non-zero tool exit records real code and FAILED result, never SUCCEEDED', () => {
  const fixture = loadFixture('r00-03-tool-error.json');
  const dir = outDir('r00-03');
  const outcome = execute({ fixture, seed: 7, outDir: dir });
  assert.equal(outcome.result.status, 'FAILED');
  assert.notEqual(outcome.result.status, 'SUCCEEDED');
  assert.equal(outcome.trace.status, 'failed');
  assert.equal(outcome.trace.terminal_state, 'FAILED');
  const errorEvent = outcome.trace.events[1];
  assert.equal(errorEvent.result_code, 'TOOL_ERROR:7', 'real exit code must be recorded');
  assert.match(errorEvent.tool_result.summary, /exit_code=7/);
});

test('R00-04 interrupted execution keeps last complete event and yields INCOMPLETE', () => {
  const fixture = loadFixture('r00-04-interrupt.json');
  const dir = outDir('r00-04');
  const outcome = execute({ fixture, seed: 7, outDir: dir });
  assert.equal(outcome.result.status, 'INCOMPLETE');
  assert.equal(outcome.trace.status, 'aborted');
  assert.equal(outcome.trace.terminal_state, 'ABORTED');
  assert.equal(outcome.trace.events.length, 2, 'last complete event kept');
  assert.equal(outcome.trace.events[0].result_code, 'OK');
  assert.equal(outcome.trace.events[1].result_code, 'TIMEOUT');
});

test('R00-05 sensitive artifact rejected before write with rejection event, no plaintext on disk', () => {
  const fixture = loadFixture('r00-05-sensitive.json');
  const dir = outDir('r00-05');
  const outcome = execute({ fixture, seed: 7, outDir: dir });
  assert.equal(outcome.result.status, 'BLOCKED');
  assert.equal(outcome.result.blocking_reason, 'sensitive field rejected before write');
  const lastEvent = outcome.trace.events[outcome.trace.events.length - 1];
  assert.equal(lastEvent.event_type, 'error');
  assert.equal(lastEvent.result_code, 'SENSITIVE_REJECTED');
  assert.match(lastEvent.tool_result.summary, /api_key/);
  // 落盘产物不得含敏感明文
  for (const file of [outcome.traceFile, outcome.resultFile, outcome.checkpointFile]) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!content.includes(SENSITIVE_VALUE), `${file} must not contain sensitive plaintext`);
  }
  // 目录递归扫描：无任何文件含敏感值
  const walk = (rel) => {
    const full = path.join(HOST_ROOT, dir);
    for (const entry of fs.readdirSync(full)) {
      const target = path.join(full, entry);
      if (fs.lstatSync(target).isDirectory()) walk(entry);
      else assert.ok(!fs.readFileSync(target, 'utf8').includes(SENSITIVE_VALUE), `${target} leaks sensitive value`);
    }
  };
  walk(dir);
});

test('R00-06 invalid trace (missing required fields) never yields completed result', () => {
  // 缺 ruleset_id/epoch_id/events 的 fixture → Runner 拒绝（H02_INVALID_FIXTURE），不产生完成态
  const invalidFixture = { ...loadFixture('r00-02-success.json'), ruleset_id: undefined };
  delete invalidFixture.ruleset_id;
  const dir = outDir('r00-06');
  assert.throws(() => execute({ fixture: invalidFixture, seed: 1, outDir: dir }), (error) => error.code === 'H02_INVALID_FIXTURE', 'invalid fixture must be rejected by code');
  assert.ok(!fs.existsSync(path.join(HOST_ROOT, dir)), 'no artifacts may be written for invalid fixture');
  // 非法 Trace 对象 → assertValidTrace 拒绝
  const badTrace = buildTrace({
    traceId: newTraceId('t1'),
    runId: newRunId('r1'),
    taskId: 'TASK-H02-SYNTH-V1',
    rulesetId: 'RULESET-H02-SYNTH-V1',
    epochId: 'EPOCH-H02-SYNTH-V1',
    fixtureSuiteRef: 'FS-SYNTHETIC-H02-V1',
    oracleRef: 'ORACLE-SYNTHETIC-H02-V1',
    adapterRef: 'ADAPTER-LOCAL-FIXTURE-H02-V1',
    events: [makeToolEvent(1, 'IDLE', 'COMPLETED', 'synth-echo', 'OK', 'tool=synth-echo exit_code=0')],
    terminalState: 'COMPLETED',
    status: 'completed',
    scope: 'harness-engineering',
    sourceRefs: ['A-HARNESS-ENGINEERING-PRINCIPLES']
  });
  assert.throws(() => assertValidTrace({ ...badTrace, ruleset_id: undefined }), /H02_TRACE_SCHEMA/);
  assert.throws(() => assertValidTrace({ ...badTrace, events: [] }), /H02_TRACE_SCHEMA/);
});

test('R00-07 duplicate run_id is rejected and never overwrites existing records', () => {
  const fixture = loadFixture('r00-01-replayable.json');
  const dir = outDir('r00-07');
  const first = execute({ fixture, seed: 1, runId: 'RUN-H02-DUP-001', outDir: dir });
  const firstTraceContent = fs.readFileSync(first.traceFile, 'utf8');
  assert.throws(() => execute({ fixture, seed: 1, runId: 'RUN-H02-DUP-001', outDir: dir }), /H02_RUN_ID_EXISTS/);
  assert.equal(fs.readFileSync(first.traceFile, 'utf8'), firstTraceContent, 'existing trace must be untouched');
  // run_id 注入防护：路径穿越形态与非法字符一律拒绝
  assert.throws(() => execute({ fixture, seed: 1, runId: '../evil', outDir: dir }), /H02_RUNNER invalid run_id/);
  assert.throws(() => execute({ fixture, seed: 1, runId: 'run with space', outDir: dir }), /H02_RUNNER invalid run_id/);
  const { parseCli } = require('../../../scripts/harness/run');
  assert.throws(() => parseCli(['--fixture', 'x.json', '--run-id', '../../../tmp/pwn']), /H02_CLI --run-id/);
});

test('R00-08 checkpoint resume produces event sequence identical to uninterrupted run', () => {
  const fixture = loadFixture('r00-08-resume.json');
  const dir = outDir('r00-08');
  const baseline = execute({ fixture, seed: 3, outDir: dir });
  assert.equal(baseline.result.status, 'SUCCEEDED');
  assert.equal(baseline.trace.events.length, 4);

  // 模拟进程级中断：执行到第 2 步后停止，仅保留可恢复 checkpoint
  const partial = execute({ fixture, seed: 3, outDir: dir, interruptAfter: 2, forceRunId: true });
  assert.equal(partial.result.status, 'INCOMPLETE');
  assert.equal(partial.trace.events.length, 2);
  assert.equal(partial.checkpoint.resumable, true);
  assert.equal(partial.checkpoint.last_event_sequence, 2);

  // 从 checkpoint 恢复继续
  const resumed = execute({ fixture, seed: 3, outDir: dir, resumeCheckpointId: partial.checkpoint.checkpoint_id, forceRunId: true });
  assert.equal(resumed.result.status, 'SUCCEEDED');
  assert.equal(resumed.resumedFrom, partial.checkpoint.checkpoint_id);
  assert.equal(resumed.trace.events.length, 4);
  // 序列与一次性运行一致：连续、无重复、无缺口
  assert.deepEqual(resumed.trace.events, baseline.trace.events);
  assert.deepEqual(resumed.trace.events.map((event) => event.sequence), [1, 2, 3, 4]);
  // 恢复成功后旧 checkpoint 置 superseded
  const { readCheckpoint } = require('../../../scripts/harness/lib/runner/checkpoint');
  assert.equal(readCheckpoint(partial.checkpoint.checkpoint_id, dir).status, 'superseded');
  // 二次 resume 同一恢复点必须被拒（superseded 失效语义）
  assert.throws(() => execute({ fixture, seed: 3, outDir: dir, resumeCheckpointId: partial.checkpoint.checkpoint_id, forceRunId: true }), /H02_CHECKPOINT superseded/);
  // 非 OK 步骤的 checkpoint 不可恢复（resumable=false 拒绝）
  const errorFixture = loadFixture('r00-03-tool-error.json');
  const errorRun = execute({ fixture: errorFixture, seed: 3, outDir: dir });
  assert.equal(errorRun.checkpoint.resumable, false);
  assert.throws(() => execute({ fixture: errorFixture, seed: 3, outDir: dir, resumeCheckpointId: errorRun.checkpoint.checkpoint_id }), /H02_CHECKPOINT not resumable/);
});

test('R00-08b CLI resume chain: interrupted run resumes via --resume-from to SUCCEEDED', () => {
  const fixture = loadFixture('r00-08-resume.json');
  const dir = outDir('r00-08b');
  const partial = execute({ fixture, seed: 11, outDir: dir, interruptAfter: 2 });
  assert.equal(partial.result.status, 'INCOMPLETE');
  // CLI 恢复：同 seed 派生同 run_id，resume 路径跳过去重（同一 run 续写，非重复运行）
  const { spawnSync } = require('child_process');
  const cli = spawnSync(process.execPath, [
    'scripts/harness/run.js',
    '--fixture', 'tests/harness/fixtures/synthetic/r00-08-resume.json',
    '--seed', '11',
    '--out-dir', dir,
    '--resume-from', partial.checkpoint.checkpoint_id
  ], { cwd: HOST_ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, `CLI resume must exit 0: ${cli.stderr}`);
  const summary = JSON.parse(cli.stdout);
  assert.equal(summary.result_status, 'SUCCEEDED');
  assert.equal(summary.events, 4);
  assert.equal(summary.resumed_from, partial.checkpoint.checkpoint_id);
  // 磁盘 trace 为完整序列（与一次性运行一致）
  const diskTrace = JSON.parse(fs.readFileSync(partial.traceFile, 'utf8'));
  assert.equal(diskTrace.events.length, 4);
  assert.deepEqual(diskTrace.events.map((event) => event.sequence), [1, 2, 3, 4]);
});

test('R00-09 permission not granted rejects execution without silent downgrade', () => {
  const fixture = loadFixture('r00-09-no-permission.json');
  const dir = outDir('r00-09');
  assert.throws(() => execute({ fixture, seed: 1, outDir: dir }), (error) => error.code === 'H02_PERMISSION_DENIED', 'permission denied must be rejected by code');
  assert.ok(!fs.existsSync(path.join(HOST_ROOT, dir)), 'no artifacts may be written when permission is denied');
});

test('R00-10 execution/judge providers share one request/result shape and pass unified schema checks', () => {
  const fixture = loadFixture('r00-10-provider.json');
  const step = fixture.steps[0];
  const execution = createExecutionProvider();
  const judge = createJudgeProvider();

  // 两角色调用同一 adapter 协议
  const execResult = execution.call({ runId: 'RUN-H02-SHAPE-001', taskId: fixture.task_id, fixture, step, seed: 9 });
  const judgeResult = judge.call({ runId: 'RUN-H02-SHAPE-001', taskId: fixture.task_id, fixture, step, seed: 9 });

  const execReq = {
    schema_version: 'h02-provider-request-v1',
    provider_id: execution.provider_id,
    role: 'execution',
    run_id: 'RUN-H02-SHAPE-001',
    task_id: fixture.task_id,
    fixture_ref: fixture.fixture_suite_ref,
    ruleset_id: fixture.ruleset_id,
    epoch_id: fixture.epoch_id,
    step,
    seed: 9
  };
  const judgeReq = { ...execReq, provider_id: judge.provider_id, role: 'judge' };

  assert.deepEqual(assertProviderMessageShape('execution', execReq, execResult).errors, []);
  assert.deepEqual(assertProviderMessageShape('judge', judgeReq, judgeResult).errors, []);
  assert.ok(sameShape(execReq, judgeReq), 'request shapes must match across roles (except role/provider_id)');
  assert.ok(sameShape(execResult, judgeResult), 'result shapes must match across roles (except role/provider_id)');

  // Provider 描述对象满足 provider.schema.json；role/status 恰为 local-fixture/callable-confirmed
  for (const provider of [execution.describe(), judge.describe(), createLocalFixtureAdapter().describe(), createPlaceholderJudge().describe()]) {
    assert.deepEqual(validateProvider(provider).errors, []);
    assert.equal(provider.role, 'local-fixture');
    assert.equal(provider.status, 'callable-confirmed');
    assert.ok(!['execution-selected', 'judge-selected'].includes(provider.role), 'H02 must not use real provider enums');
  }
});

test('R00-SLICE-A trace/result/checkpoint objects satisfy existing H01 schemas end to end', () => {
  const fixture = loadFixture('r00-02-success.json');
  const dir = outDir('r00-slice-a');
  const outcome = execute({ fixture, seed: 5, outDir: dir });
  assert.deepEqual(validateTrace(outcome.trace).errors, [], 'trace must satisfy trace.schema.json');
  assert.deepEqual(validateResult(outcome.result).errors, [], 'result must satisfy result.schema.json');
  assert.deepEqual(validateCheckpoint(outcome.checkpoint).errors, [], 'checkpoint must satisfy checkpoint.schema.json');
  // input_digest 是真实输入 hash（非常量）：同一输入一致、不同 seed 不同
  const { inputDigestOf } = require('../../../scripts/harness/lib/runner/checkpoint');
  assert.match(outcome.checkpoint.input_digest, /^[0-9a-f]{64}$/);
  assert.equal(outcome.checkpoint.input_digest, inputDigestOf(fixture, fixture.ruleset_id, fixture.epoch_id, 5));
  assert.notEqual(outcome.checkpoint.input_digest, inputDigestOf(fixture, fixture.ruleset_id, fixture.epoch_id, 6));
  // completion_evidence_refs 指向真实产物
  for (const ref of outcome.result.completion_evidence_refs) {
    assert.ok(fs.existsSync(ref), `completion evidence must exist: ${ref}`);
  }
  // trace_id/run_id 引用真实存在于 trace
  assert.equal(outcome.result.trace_id, outcome.trace.trace_id);
});

test('R00-SLICE-B adapter covers success/error/timeout/sensitive deterministically', () => {
  const adapter = createLocalFixtureAdapter();
  const judge = createPlaceholderJudge();
  const request = {
    provider_id: adapter.provider_id,
    role: 'execution',
    run_id: 'RUN-H02-ADAPTER-001',
    task_id: 'TASK-H02-SYNTH-V1',
    fixture_ref: 'FS-SYNTHETIC-H02-V1',
    ruleset_id: 'RULESET-H02-SYNTH-V1',
    epoch_id: 'EPOCH-H02-SYNTH-V1',
    seed: 1
  };
  const success = adapter.call({ ...request, step: { tool: 'synth-echo', behavior: 'success', exit_code: 0 } });
  assert.equal(success.outcome.code, 'OK');
  const error = adapter.call({ ...request, step: { tool: 'synth-fail', behavior: 'error', exit_code: 7 } });
  assert.equal(error.outcome.code, 'TOOL_ERROR');
  assert.equal(error.outcome.exit_code, 7);
  const timeout = adapter.call({ ...request, step: { tool: 'synth-hang', behavior: 'timeout' } });
  assert.equal(timeout.outcome.code, 'TIMEOUT');
  const sensitive = adapter.call({ ...request, step: { tool: 'synth-write', behavior: 'sensitive' } });
  assert.equal(sensitive.outcome.code, 'SENSITIVE_REJECTED');
  // judge 占位：合成结果，不承担语义判断
  const placeholder = judge.call({ ...request, role: 'judge', provider_id: judge.provider_id, step: { tool: 'synth-echo', behavior: 'success' } });
  assert.equal(placeholder.outcome.code, 'PLACEHOLDER');
  // 敏感检测独立验证
  assert.deepEqual(hasSensitiveFields({ api_key: 'x' }), ['.api_key']);
  assert.deepEqual(hasSensitiveFields({ value: 'plain' }), []);
  assert.deepEqual(hasSensitiveFields({ args: { payload: { token: 'abc' } } }), ['.args.payload.token']);
});
