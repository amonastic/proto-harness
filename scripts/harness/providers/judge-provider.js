'use strict';

// H02：JudgeProvider（本地合成占位角色）。H02 阶段不承担语义判断，
// 仅返回合成占位结果（outcome.code=PLACEHOLDER）；统一协议结构与 ExecutionProvider 完全一致。
// 真实 judge 语义由 H02A 启用（selected-pending-smoke → callable-confirmed 前不触碰）。

const { createPlaceholderJudge } = require('../adapters/local-fixture');
const { buildProviderRequest } = require('../lib/runner/protocol');

function createJudgeProvider() {
  const adapter = createPlaceholderJudge();
  return {
    provider_id: adapter.provider_id,
    adapter_ref: adapter.adapter_ref,
    role: 'judge',
    status: adapter.status,
    capabilities: adapter.capabilities,
    max_risk: adapter.max_risk,
    source_refs: adapter.source_refs,

    // Provider 描述对象：满足 provider.schema.json（role/status 为 local-fixture/callable-confirmed）
    describe() {
      return adapter.describe();
    },

    call({ runId, taskId, fixture, step, seed }) {
      const request = buildProviderRequest({
        providerId: this.provider_id,
        role: 'judge',
        runId,
        taskId,
        fixture,
        step,
        seed
      });
      return adapter.call(request);
    }
  };
}

module.exports = { createJudgeProvider };
