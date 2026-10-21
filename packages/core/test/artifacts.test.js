import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildInteractionSpec, completeInteractionSpec, renderPrototypeHtml, defaultTokens
} from '../src/artifacts.js';
import {
  buildArtifactsForRequirement, createRequirement
} from '../src/index.js';
import { localRequirementAnalysis } from '../../runtime-adapter/src/local.js';
import { tempRoot, onboard } from './helpers.js';

function variant(product, requirement) {
  const analysis = localRequirementAnalysis({ product, requirement, context: { rules: [] } });
  const spec = buildInteractionSpec({ product, requirement, analysis, rules: [], tokens: defaultTokens() });
  const complete = completeInteractionSpec(spec, { product, requirement, analysis, rules: [] });
  return { analysis, spec: complete, html: renderPrototypeHtml({ product, requirement, spec: complete, tokens: defaultTokens() }) };
}

const product = {
  name: '运营工作台',
  goal: '支撑活动报名与工单处理',
  constraints: [],
  endpoints: [
    { id: 'e1', name: '员工端', role: '员工', platform: 'Web' },
    { id: 'e2', name: '管理后台', role: '管理员', platform: 'Web' }
  ]
};

test('报名需求生成表单 + 管理列表，而不是固定表格页', () => {
  const requirement = {
    id: 'REQ-SIGNUP', title: '活动报名', goal: '员工提交活动报名，管理员查看报名列表',
    raw_input: '员工填写姓名、部门、联系方式并提交报名；管理员查看报名列表。',
    endpoint_refs: ['e1', 'e2'], baseline_id: 'B1', acceptance: [], unknowns: []
  };
  const result = variant(product, requirement);
  assert.equal(result.spec.pages.length, 2);
  assert.deepEqual(result.spec.pages.map((page) => page.type), ['form', 'list']);
  assert.ok(result.spec.pages[0].fields.some((field) => field.name === '姓名'));
  assert.ok(result.spec.pages[0].fields.some((field) => field.name === '联系方式'));
  assert.match(result.html, /data-page-type="form"/);
  assert.match(result.html, /data-page-type="list"/);
  assert.match(result.html, /<input class="proto-input"/);
  assert.match(result.html, /data-page-panel="PAGE-FORM-1"/);
  assert.match(result.html, /data-page-panel="PAGE-LIST-2"/);
});

test('工单需求生成看板列与卡片，不落成单页表格', () => {
  const requirement = {
    id: 'REQ-BOARD', title: '工单看板', goal: '客服创建工单并在看板中推进状态',
    raw_input: '客服创建工单，工单在看板中按待处理、处理中、已完成流转；管理员查看工单。',
    endpoint_refs: ['e2'], baseline_id: 'B1', acceptance: [], unknowns: []
  };
  const result = variant(product, requirement);
  assert.equal(result.spec.pages.length, 1);
  assert.equal(result.spec.pages[0].type, 'board');
  assert.match(result.html, /data-page-type="board"/);
  assert.match(result.html, /data-board-column="待处理"/);
  assert.match(result.html, /board-card/);
  assert.match(result.html, /新建工单/);
});

test('打印设置需求生成设置分组与开关，不生成列表', () => {
  const requirement = {
    id: 'REQ-PRINT', title: '打印设置', goal: '管理员配置打印参数',
    raw_input: '管理员配置打印份数、纸张大小、是否双面，并保存设置。',
    endpoint_refs: ['e2'], baseline_id: 'B1', acceptance: [], unknowns: []
  };
  const result = variant(product, requirement);
  assert.equal(result.spec.pages.length, 1);
  assert.equal(result.spec.pages[0].type, 'settings');
  assert.ok(result.spec.pages[0].fields.some((field) => field.name === '打印份数'));
  assert.ok(result.spec.pages[0].fields.some((field) => field.type === 'switch'));
  assert.match(result.html, /settings-group/);
  assert.match(result.html, /setting-row/);
  assert.match(result.html, /保存设置/);
});

test('模型返回的两页交互规格进入产物生成，第二页不丢失', async () => {
  const root = tempRoot();
  const { store } = onboard(root);
  const requirement = createRequirement(store, {
    title: '活动报名',
    goal: '员工提交报名，管理员查看列表',
    rawInput: '员工填写姓名、部门并提交；管理员查看报名列表。'
  });
  store.saveRequirement({
    ...requirement,
    status: 'analyzed',
    unknowns: [],
    analysis_source: 'local-heuristic'
  });
  store.saveRequirementFile(requirement.id, 'analysis.json', {
    analysis: {
      source: 'local-heuristic',
      summary: '两页规格测试',
      core_flows: ['员工填写报名', '管理员查看列表'],
      roles: [{ name: '员工' }, { name: '管理员' }],
      endpoints: [{ name: '员工端' }, { name: '管理后台' }],
      scope: { in_scope: ['活动报名'], out_of_scope: [] },
      impact: { actual: [], verify: [], keep: [] },
      acceptance: ['报名成功后可在管理后台查看'],
      objects: [{ name: '报名记录' }],
      rule_proposals: [],
      conflicts: []
    }
  });
  const fakeAdapter = {
    describe: () => ({ kind: 'openai-compatible', model: 'fake-model', configured: true }),
    async generateInteractionSpec() {
      return {
        source: 'model:fake-model',
        pages: [
          {
            id: 'PAGE-APPLY',
            type: 'form',
            name: '填写报名',
            responsibility: '员工填写报名信息',
            fields: [
              { name: '姓名', type: 'text', required: true },
              { name: '部门', type: 'select', options: ['运营部', '客服部'] },
              { name: '联系方式', type: 'tel' }
            ],
            states: [{ name: '填写', behavior: '提交前填写' }, { name: '提交成功', behavior: '提交成功' }]
          },
          {
            id: 'PAGE-ADMIN',
            type: 'list',
            name: '报名管理',
            responsibility: '管理员查看报名记录',
            columns: [{ name: '姓名', type: 'text' }, { name: '部门', type: 'select' }, { name: '状态', type: 'select' }],
            demo_rows: [
              { 姓名: '林晓', 部门: '运营部', 状态: '已报名' },
              { 姓名: '周然', 部门: '客服部', 状态: '待审核' }
            ],
            states: [{ name: '默认', behavior: '展示报名列表' }, { name: '空数据', behavior: '暂无报名' }]
          }
        ]
      };
    }
  };
  const generated = await buildArtifactsForRequirement(store, requirement.id, { adapter: fakeAdapter });
  assert.equal(generated.spec.pages.length, 2);
  assert.equal(generated.spec.source, 'model:fake-model');
  assert.equal(generated.requirement.spec_generation.page_count, 2);
  assert.match(generated.prototypeHtml, /填写报名/);
  assert.match(generated.prototypeHtml, /报名管理/);
  assert.match(generated.prototypeHtml, /data-page-panel="PAGE-APPLY"/);
  assert.match(generated.prototypeHtml, /data-page-panel="PAGE-ADMIN"/);
  assert.match(generated.prototypeHtml, /<input class="proto-input"/);
  assert.match(generated.prototypeHtml, /林晓/);
  assert.equal(path.basename(generated.artifacts.find((item) => item.type === 'interaction-spec').path), 'interaction-spec.json');
});

test('保留模型显式必填与设置默认值', () => {
  const requirement = {
    id: 'REQ-FIDELITY', title: '活动报名配置', goal: '报名与打印设置',
    raw_input: '员工填写报名信息。', endpoint_refs: [], baseline_id: 'B1', acceptance: [], unknowns: []
  };
  const modelSpec = {
    source: 'model:fake',
    pages: [
      {
        id: 'PAGE-FORM', type: 'form', name: '报名表单',
        fields: [
          { name: '姓名', type: 'text', required: true },
          { name: '手机号', type: 'tel', required: true },
          { name: '身份证号', type: 'text', required: true }
        ],
        states: [{ name: '填写', behavior: '填写' }]
      },
      {
        id: 'PAGE-SETTINGS', type: 'settings', name: '打印设置',
        groups: [{
          title: '打印设置',
          items: [
            { name: '双面打印', type: 'switch', value: false },
            { name: '纸张', type: 'select', value: 'A5', options: ['A4', 'A5'] }
          ]
        }],
        states: [{ name: '默认', behavior: '配置' }]
      }
    ]
  };
  const analysis = { source: 'local-heuristic', objects: [], roles: [], core_flows: [] };
  const complete = completeInteractionSpec(modelSpec, { product, requirement, analysis, rules: [] });
  const form = complete.pages.find((page) => page.type === 'form');
  assert.ok(form.fields.every((field) => field.required === true));
  const html = renderPrototypeHtml({ product, requirement, spec: complete, tokens: defaultTokens() });
  assert.match(html, /<span>关闭<\/span>/);
  assert.doesNotMatch(html, /type="checkbox" checked/);
  assert.match(html, /<option selected>A5<\/option>/);
});

test('保留现行规则时过滤被否决字段并保留允许字段', () => {
  const requirement = {
    id: 'REQ-KEEP-FIELDS', title: '报名字段调整', goal: '允许收集身份证号',
    raw_input: '员工填写姓名、手机号、身份证号。', endpoint_refs: [], baseline_id: 'B1', acceptance: [], unknowns: []
  };
  const analysis = {
    source: 'local-heuristic',
    decision: { action: 'keep', reason: '保留现行字段范围' },
    effective_title: '按现行规则处理',
    effective_goal: '保留现行规则',
    core_flows: ['按现行规则收集报名信息'],
    scope: { in_scope: ['按现行规则处理'], out_of_scope: ['不采纳：增加身份证号'] },
    acceptance: ['现行规则：只收姓名、手机号，禁止收身份证号'],
    final_rules: [{ id: 'RULE-FIELDS', revision: 1, statement: '只收姓名、手机号，禁止收身份证号', constraints: [], effective_state: 'current' }],
    rejected_changes: [{ statement: '增加身份证号' }],
    objects: [{ name: '报名' }],
    roles: [],
    endpoints: []
  };
  const spec = buildInteractionSpec({ product, requirement, analysis, rules: [], decision: analysis.decision });
  assert.doesNotMatch(JSON.stringify(spec.pages), /身份证号/);
  const modelSpec = {
    pages: [{
      type: 'form', name: '报名表单',
      fields: [
        { name: '姓名', type: 'text', required: true },
        { name: '手机号', type: 'tel', required: true },
        { name: '身份证号', type: 'text', required: true }
      ],
      states: [{ name: '填写', behavior: '填写' }]
    }]
  };
  const complete = completeInteractionSpec(modelSpec, { product, requirement, analysis, rules: [] });
  const names = complete.pages[0].fields.map((field) => field.name);
  assert.deepEqual(names, ['姓名', '手机号']);
  assert.ok(complete.pages[0].fields.every((field) => field.required === true));
});
