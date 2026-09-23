'use strict';

// P5/H09：DeepSeek adapter 单元测试。
// 覆盖：adapter 契约完整性、四类错误映射、P1 provider 复用（fetchImpl 注入）、
//       verdict 提取、缺 key 拒绝。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');

const adapterContract = require('../../../harness/engineering/adapters/deepseek.json');
const { createExecutionRuntime, readConfig } = require('../../../scripts/harness/providers/execution-runtime');
const { classifyFailure, parseVerdictOutput } = require('../../../scripts/harness/lib/qualification/runner');

test('H09-AD-01 adapter contract is parseable and carries key fields', () => {
  assert.equal(adapterContract.schema_version, 'h09-adapter-v1');
  assert.equal(adapterContract.adapter_id, 'ADAPTER-DEEPSEEK-H09-V1');
  assert.equal(adapterContract.provider_ref, 'P-DEEPSEEK-V4-FLASH');
  assert.ok(typeof adapterContract.model_id === 'string' && adapterContract.model_id.length > 0, 'model_id required');
  assert.ok(typeof adapterContract.base_url === 'string' && adapterContract.base_url.length > 0, 'base_url required');
  assert.ok(typeof adapterContract.context_window === 'number' && adapterContract.context_window > 0, 'context_window required');
  assert.ok(Array.isArray(adapterContract.reuses) && adapterContract.reuses.length >= 2, 'reuses P1 provider files');
  assert.ok(Array.isArray(adapterContract.interface_contract) && adapterContract.interface_contract.some((entry) => entry.startsWith('call(')), 'interface contract must include call()');
  assert.deepEqual(adapterContract.roles, ['execution']);
  assert.ok(adapterContract.env_required.includes('DEEPSEEK_API_KEY'), 'DEEPSEEK_API_KEY must be declared required');
});

test('H09-AD-02 error mapping covers exactly four failure classes', () => {
  const mapping = adapterContract.error_mapping;
  for (const category of ['api_failure', 'model_refusal', 'format_error', 'semantic_failure']) {
    assert.ok(mapping[category], `missing error class ${category}`);
    assert.ok(typeof mapping[category].description === 'string' && mapping[category].description.length > 0);
    assert.ok(Array.isArray(mapping[category].signals) && mapping[category].signals.length > 0);
  }
  assert.deepEqual(Object.keys(mapping).sort(), ['api_failure', 'format_error', 'model_refusal', 'semantic_failure']);
});

test('H09-AD-03 P1 provider reuse: fake fetch OK produces unified provider result', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key-not-used-by-fake-fetch';
  try {
    const runtime = createExecutionRuntime({
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"verdict":"pass","reason":"ok"}' } }] })
      })
    });
    const result = await runtime.call({ runId: 'TEST-RUN', taskId: 'TASK-AD-03', prompt: 'test' });
    assert.equal(result.schema_version, 'h02-provider-result-v1');
    assert.equal(result.provider_id, 'P-DEEPSEEK-V4-FLASH');
    assert.equal(result.role, 'execution');
    assert.equal(result.outcome.code, 'OK');
    assert.ok(result.outcome.summary.includes('verdict'), 'summary must carry model content');
    assert.equal(result.outcome.exit_code, 0);
  } finally {
    if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous;
    else delete process.env.DEEPSEEK_API_KEY;
  }
});

test('H09-AD-04 missing DEEPSEEK_API_KEY raises explicit error (no silent skip)', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const config = readConfig();
    assert.equal(config.apiKey, '');
    const runtime = createExecutionRuntime({ fetchImpl: async () => { throw new Error('should not be called'); } });
    await assert.rejects(
      () => runtime.call({ runId: 'TEST-RUN', taskId: 'TASK-AD-04', prompt: 'x' }),
      (error) => error.code === 'H02A_EXECUTION_API_KEY_MISSING'
    );
  } finally {
    if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous;
  }
});

test('H09-AD-05 classifyFailure maps the four failure classes', () => {
  assert.equal(classifyFailure(null, Object.assign(new Error('DEEPSEEK_API_KEY 缺失'), { code: 'H02A_EXECUTION_API_KEY_MISSING' })), 'api_failure');
  assert.equal(classifyFailure(null, new Error('DeepSeek API HTTP 429')), 'api_failure');
  assert.equal(classifyFailure(null, new Error('H02A_EXECUTION_CALL_FAILED fetch timeout')), 'api_failure');
  assert.equal(classifyFailure({ summary: 'deepseek returned empty completion' }, null), 'model_refusal');
  assert.equal(classifyFailure({ summary: 'content policy refusal' }, null), 'model_refusal');
  assert.equal(classifyFailure({ summary: 'verdict JSON parse failure' }, null), 'format_error');
  assert.equal(classifyFailure({ summary: 'verdict mismatch with fixture.expected' }, null), 'api_failure', 'semantic mismatch is decided in runOnce, not classifyFailure');
});

test('H09-AD-06 parseVerdictOutput extracts verdict from prefixed summaries', () => {
  assert.equal(parseVerdictOutput('deepseek-v4-flash echoed: {"verdict":"pass","reason":"ok"}'), 'pass');
  assert.equal(parseVerdictOutput('{"verdict": "fail", "reason": "x"}'), 'fail');
  assert.equal(parseVerdictOutput('no verdict here'), null);
  assert.equal(parseVerdictOutput('{"verdict":"maybe"}'), null);
  assert.equal(parseVerdictOutput(null), null);
});
