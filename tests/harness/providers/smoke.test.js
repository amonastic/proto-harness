'use strict';

// H02A（P1）：配置可达性 doctor + 真实调用 smoke。
// 按任务包 5.3 契约：
//   doctor —— 检查 DEEPSEEK_API_KEY 与 JUDGE_MODEL_ID/BASE_URL/AUTH_METHOD，不真实调用，输出清单与结论
//   smoke  —— 对 DeepSeek 和 judge 各发起一次最小 prompt 调用；失败不阻断交付，输出修复建议并 skip
// 通过 --test-name-pattern 区分：npm run harness:provider:doctor（doctor 组）/ harness:provider:smoke（smoke 组）

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createExecutionRuntime } = require('../../../scripts/harness/providers/execution-runtime');
const { createJudgeRuntime } = require('../../../scripts/harness/providers/judge-runtime');

// ---- doctor：配置可达性检查（不真实调用）----

test('doctor: DeepSeek configuration checklist', (t) => {
  const config = createExecutionRuntime().config();
  t.diagnostic(`[doctor] provider=${config.provider_id} model_id=${config.model_id} base_url=${config.base_url} api_key_present=${config.api_key_present}`);
  if (config.api_key_present) {
    t.diagnostic('[doctor] DeepSeek: DEEPSEEK_API_KEY 已配置，可达性结论：可发起 smoke');
  } else {
    t.diagnostic('[doctor] DeepSeek: DEEPSEEK_API_KEY 缺失（错误级别）——smoke 将失败，H02A 真实任务运行前必须配置');
  }
  // doctor 只检查并报告，不断言 key 存在（doctor 本身成功 = 检查完成）
  assert.ok(true, 'doctor checklist completed');
});

test('doctor: Judge configuration checklist', (t) => {
  const config = createJudgeRuntime().config();
  t.diagnostic(`[doctor] provider=${config.provider_id} model_id=${config.model_id} base_url=${config.base_url} auth_method=${config.auth_method} using_fallback=${config.using_fallback}`);
  if (config.using_fallback) {
    t.diagnostic('[doctor] Judge: 未配置 JUDGE_MODEL_ID/BASE_URL/AUTH_METHOD，使用 fallback（Claude Sonnet 4.6 + Anthropic 官方）——warning 级别');
  } else {
    t.diagnostic('[doctor] Judge: 配置已注入，可达性结论：可发起 smoke');
  }
  assert.ok(true, 'doctor checklist completed');
});

// ---- smoke：真实调用（可选，失败不阻断交付）----

test('smoke: DeepSeek minimal call "Echo: test"', async (t) => {
  const runtime = createExecutionRuntime();
  const config = runtime.config();
  if (!config.api_key_present) {
    t.diagnostic('[smoke] DEEPSEEK_API_KEY 缺失：跳过真实调用（doctor 已报错）');
    t.skip('DEEPSEEK_API_KEY 缺失，真实调用不可用');
    return;
  }
  try {
    const result = await runtime.call({ runId: 'RUN-H02A-SMOKE', taskId: 'TASK-H02A-SMOKE', prompt: 'Echo: test' });
    assert.equal(result.outcome.code, 'OK');
    t.diagnostic(`[smoke] DeepSeek OK: ${result.outcome.summary}`);
  } catch (error) {
    t.diagnostic(`[smoke] DeepSeek 调用失败（不阻断 P1 交付，标记"配置待用户本地验证"）：${error.message}`);
    t.diagnostic('[smoke] 配置修复建议：1) 确认 DEEPSEEK_API_KEY 有效；2) 确认 DEEPSEEK_BASE_URL 可达（默认 https://api.deepseek.com）；3) 网络/代理可达性');
    t.skip('DeepSeek smoke 失败，配置待用户本地验证');
  }
});

test('smoke: Judge minimal call "Echo: test"', async (t) => {
  const runtime = createJudgeRuntime();
  const config = runtime.config();
  const apiKey = process.env.JUDGE_API_KEY || '';
  if (apiKey.length === 0) {
    t.diagnostic('[smoke] JUDGE_API_KEY 缺失：跳过真实调用（与 runtime 一致，只使用 judge 自有密钥，不以 DEEPSEEK_API_KEY 兜底）');
    t.skip('JUDGE_API_KEY 缺失，真实调用不可用');
    return;
  }
  try {
    const result = await runtime.call({ runId: 'RUN-H02A-SMOKE', taskId: 'TASK-H02A-SMOKE', prompt: 'Echo: test' });
    assert.equal(result.outcome.code, 'OK');
    t.diagnostic(`[smoke] Judge OK: ${result.outcome.summary}`);
  } catch (error) {
    t.diagnostic(`[smoke] Judge 调用失败（不阻断 P1 交付，标记"配置待用户本地验证"）：${error.message}`);
    t.diagnostic(`[smoke] 配置修复建议：1) 确认 JUDGE_MODEL_ID=${config.model_id} 可用；2) 确认 JUDGE_BASE_URL=${config.base_url} 可达；3) 确认 JUDGE_AUTH_METHOD=${config.auth_method} 对应密钥已配置`);
    t.skip('Judge smoke 失败，配置待用户本地验证');
  }
});
