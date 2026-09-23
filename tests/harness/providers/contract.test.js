'use strict';

// H02A（P1）：ProviderAdapter 契约测试。
// 覆盖任务包 5.2/5.3 契约：context_id 格式与独立性、配置解析与 fallback、
// 缺失 key 错误路径、describe() 满足 provider.schema.json、统一 provider result 结构。
// 契约测试不发起真实网络调用（call 成功路径使用注入的 fake fetch）。

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createExecutionRuntime, buildContextId: buildExecContextId } = require('../../../scripts/harness/providers/execution-runtime');
const { createJudgeRuntime, buildContextId: buildJudgeContextId, FALLBACK_MODEL_ID, FALLBACK_BASE_URL, FALLBACK_AUTH_METHOD, AUTH_METHODS } = require('../../../scripts/harness/providers/judge-runtime');
const { validateProvider } = require('../../../scripts/harness/lib/trace/schema-check');

// fake fetch：返回合成 DeepSeek/Anthropic 兼容响应
function fakeFetchOk(payloadFactory) {
  return async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify(payloadFactory()); },
    async json() { return payloadFactory(); }
  });
}

// 跨端点 key 兜底回归防护：judge 调用只允许发送 JUDGE_API_KEY，绝不允许 DeepSeek key 混入
test('H02A-11 judge call must not send DEEPSEEK_API_KEY (cross-endpoint key fallback regression)', async () => {
  const savedJudge = process.env.JUDGE_API_KEY;
  const savedDeepseek = process.env.DEEPSEEK_API_KEY;
  const savedAuth = process.env.JUDGE_AUTH_METHOD;
  const savedOauth = process.env.JUDGE_OAUTH_TOKEN;
  process.env.JUDGE_API_KEY = 'judge-key-1';
  process.env.DEEPSEEK_API_KEY = 'deepseek-key-1';
  process.env.JUDGE_AUTH_METHOD = 'api-key'; // 固定 authMethod，避免 CI 设 oauth2 时断言误失败
  delete process.env.JUDGE_OAUTH_TOKEN;
  try {
    const calls = [];
    const capturingFetch = async (url, options) => {
      calls.push({ url, authorization: (options.headers || {}).Authorization || '' });
      return { ok: true, status: 200, async json() { return { content: [{ text: 'ok' }] }; } };
    };
    const runtime = createJudgeRuntime({ fetchImpl: capturingFetch });
    await runtime.call({ runId: 'RUN-2', taskId: 'TASK-2', prompt: 'Echo: test' });
    assert.equal(calls.length, 1, 'exactly one judge call expected');
    assert.ok(!calls[0].authorization.includes('deepseek-key-1'), 'judge call must not carry DeepSeek key');
    assert.ok(calls[0].authorization.includes('judge-key-1'), 'judge call must carry JUDGE_API_KEY');
  } finally {
    if (savedJudge !== undefined) process.env.JUDGE_API_KEY = savedJudge; else delete process.env.JUDGE_API_KEY;
    if (savedDeepseek !== undefined) process.env.DEEPSEEK_API_KEY = savedDeepseek; else delete process.env.DEEPSEEK_API_KEY;
    if (savedAuth !== undefined) process.env.JUDGE_AUTH_METHOD = savedAuth; else delete process.env.JUDGE_AUTH_METHOD;
    if (savedOauth !== undefined) process.env.JUDGE_OAUTH_TOKEN = savedOauth; else delete process.env.JUDGE_OAUTH_TOKEN;
  }
});

test('H02A-01 context_id format: exec-<runId>-<taskId>-<timestamp>', () => {
  const id = buildExecContextId('RUN-ABC', 'TASK-1');
  assert.match(id, /^exec-RUN-ABC-TASK-1-\d{10,}$/, 'exec context_id must match exec-<runId>-<taskId>-<timestamp>');
});

test('H02A-02 context_id format: judge-<runId>-<taskId>-<timestamp>', () => {
  const id = buildJudgeContextId('RUN-ABC', 'TASK-1');
  assert.match(id, /^judge-RUN-ABC-TASK-1-\d{10,}$/, 'judge context_id must match judge-<runId>-<taskId>-<timestamp>');
});

test('H02A-03 execution and judge context_ids are independent (never equal)', () => {
  const execId = buildExecContextId('RUN-SAME', 'TASK-SAME');
  const judgeId = buildJudgeContextId('RUN-SAME', 'TASK-SAME');
  assert.notEqual(execId, judgeId, 'exec and judge context_ids must differ');
  assert.ok(!execId.startsWith('judge-') && judgeId.startsWith('judge-'), 'prefix must enforce separation');
});

test('H02A-04 judge fallback config: Claude Sonnet 4.6 + Anthropic when unset', () => {
  const saved = { model: process.env.JUDGE_MODEL_ID, url: process.env.JUDGE_BASE_URL, auth: process.env.JUDGE_AUTH_METHOD };
  delete process.env.JUDGE_MODEL_ID;
  delete process.env.JUDGE_BASE_URL;
  delete process.env.JUDGE_AUTH_METHOD;
  try {
    const runtime = createJudgeRuntime();
    const config = runtime.config();
    assert.equal(config.model_id, FALLBACK_MODEL_ID);
    assert.equal(config.base_url, FALLBACK_BASE_URL);
    assert.equal(config.auth_method, FALLBACK_AUTH_METHOD);
    assert.equal(config.using_fallback, true);
    assert.ok(AUTH_METHODS.includes(FALLBACK_AUTH_METHOD));
  } finally {
    if (saved.model !== undefined) process.env.JUDGE_MODEL_ID = saved.model;
    if (saved.url !== undefined) process.env.JUDGE_BASE_URL = saved.url;
    if (saved.auth !== undefined) process.env.JUDGE_AUTH_METHOD = saved.auth;
  }
});

test('H02A-05 judge env override takes effect (model_id/base_url/auth_method)', () => {
  const saved = { model: process.env.JUDGE_MODEL_ID, url: process.env.JUDGE_BASE_URL, auth: process.env.JUDGE_AUTH_METHOD };
  process.env.JUDGE_MODEL_ID = 'test-model-x';
  process.env.JUDGE_BASE_URL = 'https://test.example.com';
  process.env.JUDGE_AUTH_METHOD = 'bearer';
  try {
    const config = createJudgeRuntime().config();
    assert.equal(config.model_id, 'test-model-x');
    assert.equal(config.base_url, 'https://test.example.com');
    assert.equal(config.auth_method, 'bearer');
    assert.equal(config.using_fallback, false);
  } finally {
    if (saved.model !== undefined) process.env.JUDGE_MODEL_ID = saved.model; else delete process.env.JUDGE_MODEL_ID;
    if (saved.url !== undefined) process.env.JUDGE_BASE_URL = saved.url; else delete process.env.JUDGE_BASE_URL;
    if (saved.auth !== undefined) process.env.JUDGE_AUTH_METHOD = saved.auth; else delete process.env.JUDGE_AUTH_METHOD;
  }
});

test('H02A-06 missing DEEPSEEK_API_KEY: call rejects with H02A_EXECUTION_API_KEY_MISSING', async () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const runtime = createExecutionRuntime({ fetchImpl: fakeFetchOk(() => ({ choices: [{ message: { content: 'ok' } }] })) });
    await assert.rejects(
      runtime.call({ runId: 'RUN-1', taskId: 'TASK-1', prompt: 'Echo: test' }),
      (error) => error.code === 'H02A_EXECUTION_API_KEY_MISSING'
    );
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

test('H02A-07 execution call success path returns unified provider result (fake fetch)', async () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;
  const savedUrl = process.env.DEEPSEEK_BASE_URL;
  const savedModel = process.env.DEEPSEEK_MODEL_ID;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  process.env.DEEPSEEK_BASE_URL = 'https://deepseek.test';
  process.env.DEEPSEEK_MODEL_ID = 'deepseek-chat';
  try {
    const runtime = createExecutionRuntime({ fetchImpl: fakeFetchOk(() => ({ choices: [{ message: { content: 'pong' } }] })) });
    const result = await runtime.call({ runId: 'RUN-1', taskId: 'TASK-1', prompt: 'Echo: test' });
    assert.equal(result.schema_version, 'h02-provider-result-v1');
    assert.equal(result.provider_id, 'P-DEEPSEEK-V4-FLASH');
    assert.equal(result.role, 'execution');
    assert.equal(result.outcome.code, 'OK');
    assert.equal(result.outcome.exit_code, 0);
    assert.ok(result.outcome.tool_result.summary.includes('pong'), 'tool_result summary must contain echoed content');
    assert.ok(result.request_id.startsWith('exec-'), 'request_id must be the exec context_id');
  } finally {
    if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey; else delete process.env.DEEPSEEK_API_KEY;
    if (savedUrl !== undefined) process.env.DEEPSEEK_BASE_URL = savedUrl; else delete process.env.DEEPSEEK_BASE_URL;
    if (savedModel !== undefined) process.env.DEEPSEEK_MODEL_ID = savedModel; else delete process.env.DEEPSEEK_MODEL_ID;
  }
});

test('H02A-08 judge call success path returns unified provider result (fake fetch)', async () => {
  const runtime = createJudgeRuntime({ fetchImpl: fakeFetchOk(() => ({ content: [{ text: 'judged' }] })) });
  const result = await runtime.call({ runId: 'RUN-1', taskId: 'TASK-1', prompt: 'Echo: test' });
  assert.equal(result.schema_version, 'h02-provider-result-v1');
  assert.equal(result.provider_id, 'J-GENERIC-JUDGE');
  assert.equal(result.role, 'judge');
  assert.equal(result.outcome.code, 'OK');
  assert.ok(result.outcome.tool_result.summary.includes('judged'));
  assert.ok(result.request_id.startsWith('judge-'), 'request_id must be the judge context_id');
});

test('H02A-09 describe() satisfies provider.schema.json for both runtimes', () => {
  for (const runtime of [createExecutionRuntime(), createJudgeRuntime()]) {
    const { errors } = validateProvider(runtime.describe());
    assert.deepEqual(errors, [], `describe() of ${runtime.provider_id} must satisfy provider.schema.json`);
  }
});

test('H02A-10 execution config reports model/base_url/api_key_present without leaking key', () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-visible-only-as-present';
  try {
    const config = createExecutionRuntime().config();
    assert.equal(config.api_key_present, true);
    assert.ok(!JSON.stringify(config).includes('sk-visible-only-as-present'), 'config must not leak the api key value');
  } finally {
    if (savedKey !== undefined) process.env.DEEPSEEK_API_KEY = savedKey; else delete process.env.DEEPSEEK_API_KEY;
  }
});
