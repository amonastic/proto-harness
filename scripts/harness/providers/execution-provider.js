'use strict';

// H02：ExecutionProvider（本地合成角色）。统一通过 lib/runner/protocol.js 的
// request/result 结构调用 local-fixture adapter；Runner 不直接接触 adapter 细节。
// 不产生任何真实模型调用（H02A 才启用真实 LongCat/Codex）。

const { createLocalFixtureAdapter } = require('../adapters/local-fixture');
const { buildProviderRequest } = require('../lib/runner/protocol');

function createExecutionProvider() {
  const adapter = createLocalFixtureAdapter();
  return {
    provider_id: adapter.provider_id,
    adapter_ref: adapter.adapter_ref,
    role: 'execution',
    status: adapter.status,
    capabilities: adapter.capabilities,
    max_risk: adapter.max_risk,
    source_refs: adapter.source_refs,

    // Provider 描述对象：满足 provider.schema.json（role/status 为 local-fixture/callable-confirmed）
    describe() {
      return adapter.describe();
    },

    // Runner 调用入口：构造统一 request 并交给 adapter。
    call({ runId, taskId, fixture, step, seed }) {
      const request = buildProviderRequest({
        providerId: this.provider_id,
        role: 'execution',
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

module.exports = { createExecutionProvider };
