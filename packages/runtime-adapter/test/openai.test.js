import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createOpenAICompatibleAdapter, extractJson } from '../src/index.js';

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}/v1` };
}

function completion(content) {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

test('OpenAI 兼容适配器发送鉴权与模型参数，并规范化产品分析', async (t) => {
  let captured;
  const { server, baseUrl } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      captured = { auth: req.headers.authorization, body: JSON.parse(body) };
      const content = JSON.stringify({
        summary: '模型分析摘要',
        objects: [{ name: '取件码', key_fields: ['code'] }],
        roles: [{ name: '门店店员', endpoint: '作业端 App' }],
        endpoints: [{ name: '作业端 App', role: '门店店员', platform: 'App' }],
        capabilities: [{ name: '开柜', goal: '核销取件', objects: ['取件码'] }],
        candidate_rules: [{ topic: '取件码', statement: '每个取件码仅可开柜一次。' }],
        unknowns: [{ question: '重复开柜的时间窗口？', why_blocking: '影响规则', blocking: true }]
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(completion(content));
    });
  });
  t.after(() => server.close());
  const adapter = createOpenAICompatibleAdapter({
    baseUrl, apiKey: 'test-key-not-real', model: 'test-model'
  });
  const result = await adapter.analyzeProduct({
    product: { name: '驿站', goal: '取件', audience: '店员', constraints: [], endpoints: [] },
    references: []
  });
  assert.equal(captured.auth, 'Bearer test-key-not-real');
  assert.equal(captured.body.model, 'test-model');
  assert.equal(result.source, 'model:test-model');
  assert.equal(result.objects[0].name, '取件码');
  assert.equal(result.candidate_rules.length, 1);
  assert.equal(result.unknowns[0].blocking, true);
  assert.ok(result.raw_model_output);
});

test('需求分析只允许引用已有规则 ID', async (t) => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const content = JSON.stringify({
        summary: '识别到冲突',
        impact: { actual: ['作业端'], verify: ['历史记录'], keep: ['订单状态'] },
        acceptance: ['两分钟内可重复'],
        rule_proposals: [
          { rule_id: 'RULE-EXISTING', statement: '两分钟内可重复开柜' },
          { rule_id: 'RULE-HALLUCINATED', statement: '不得重复开柜' }
        ],
        conflicts: [{
          existing_rule_refs: ['RULE-EXISTING'],
          proposed_statement: '两分钟内可重复开柜',
          why: '与现行一次限制冲突'
        }]
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(completion(content));
    });
  });
  t.after(() => server.close());
  const adapter = createOpenAICompatibleAdapter({ baseUrl, apiKey: 'k', model: 'm' });
  const result = await adapter.analyzeRequirement({
    product: { name: '驿站', endpoints: [] },
    requirement: { id: 'REQ-1', title: '重复开柜', goal: 'g', raw_input: 'x' },
    context: {
      rules: [{
        id: 'RULE-EXISTING', revision: 1, statement: '每个取件码仅可开柜一次',
        topic: '取件码', knowledge_status: 'confirmed', effective_state: 'current'
      }]
    }
  });
  assert.equal(result.rule_proposals.length, 1);
  assert.equal(result.rule_proposals[0].rule_id, 'RULE-EXISTING');
  assert.equal(result.rule_proposals[0].kind, 'rule.revise');
  assert.equal(result.conflicts.length, 1);
});

test('无效 JSON 与未配置均返回明确错误码', async (t) => {
  const { server, baseUrl } = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(completion('这不是 JSON'));
    });
  });
  t.after(() => server.close());
  const adapter = createOpenAICompatibleAdapter({ baseUrl, apiKey: 'k', model: 'm' });
  await assert.rejects(() => adapter.analyzeProduct({
    product: { name: 'x', goal: 'y', constraints: [], endpoints: [] }
  }), (error) => error.code === 'RUNTIME_FAILED');
  const unconfigured = createOpenAICompatibleAdapter({ baseUrl: '', apiKey: '', model: '' });
  await assert.rejects(() => unconfigured.analyzeProduct({ product: {} }), (error) => error.code === 'RUNTIME_NOT_CONFIGURED');
});

test('extractJson 容忍代码围栏与前后文本', () => {
  assert.deepEqual(extractJson('说明\n```json\n{"a":1}\n```\n结束'), { a: 1 });
  assert.equal(extractJson('not json'), null);
});
