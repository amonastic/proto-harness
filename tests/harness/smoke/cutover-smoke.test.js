'use strict';

// P11.2（2026-08-21）：cutover smoke 测试。
//
// 职责（任务包 P11.2）：切换后运行"终端使用权限"任务，验证产出符合预期。
// 本测试以 dry-run 模式覆盖完整链路（2026-08-21 用户裁决），并验证 cutover
// 依赖检查与 AGENTS.md diff 计划生成逻辑。

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const {
  dependencyCheck,
  buildAgentsDiffPlan,
  smokeCommands
} = require(path.join(HOST_ROOT, 'scripts', 'harness', 'cutover.js'));
const { runRequirementInterview } = require(path.join(HOST_ROOT, 'scripts', 'harness', 'task-adapters', 'requirement-interview'));
const { runWorkflow } = require(path.join(HOST_ROOT, 'scripts', 'harness', 'lib', 'workflow', 'runner'));

const INPUT = '终端使用权限支持添加禁止部分操作员功能';

test('P11.2 cutover 依赖检查全通过（新 harness 链路文件齐备）', () => {
  const dep = dependencyCheck();
  assert.ok(dep.ok, `依赖缺失：${dep.failed.map((c) => c.name).join(', ')}`);
  assert.ok(dep.checks.length >= 15, '依赖检查清单不完整');
});

test('P11.2 cutover --plan 产出 AGENTS.md diff 计划与 smoke 命令', () => {
  const plan = buildAgentsDiffPlan();
  assert.ok(Array.isArray(plan) && plan.length >= 1, '缺少 AGENTS.md diff 计划');
  assert.ok(plan[0].add_lines.length >= 2, 'diff 计划缺少新增入口行');
  assert.ok(plan[0].mark_deprecated.length >= 1, 'diff 计划缺少 deprecated 标记说明');
  const commands = smokeCommands();
  assert.ok(commands.length >= 4, 'smoke 命令清单不完整');
});

test('P11.2 切换后任务可用：requirement-interview dry-run 产出通过 schema 校验', async () => {
  const result = await runRequirementInterview({
    input: INPUT,
    provider: 'deepseek',
    dryRun: true,
    out: '.harness-runtime/tasks/REQ-SMOKE.json',
    verbose: false
  });
  assert.ok(result.ok, `任务失败：${result.error && result.error.message}`);
  assert.ok(result.task, '未产出需求基线');
  const b = result.task;
  assert.ok(Array.isArray(b.roles_and_platforms.platforms) && b.roles_and_platforms.platforms.length >= 1, '缺少端解析结果');
  assert.ok(typeof (b.data_and_permission || {}).permission_control === 'string' && b.data_and_permission.permission_control.length > 0, '缺少权限控制口径');
});

test('P11.2 切换后 workflow new-page 4 步全部成功', async () => {
  const summary = await runWorkflow({
    workflowId: 'new-page',
    input: INPUT,
    provider: 'deepseek',
    dryRun: true,
    verbose: false
  });
  assert.ok(summary.ok, `workflow 失败：${JSON.stringify(summary.failedSteps)}`);
  assert.strictEqual(summary.steps_total, 4, 'workflow 步骤数应为 4');
  assert.strictEqual(summary.steps_ok, 4, 'workflow 应有 4 步成功');
  // 页面产物为模块页模板（中性示例合成器产出）
  const pageArtifact = summary.artifacts.find((a) => a.step === 'page-generation');
  assert.ok(pageArtifact && pageArtifact.out, '缺少页面生成产物');
  const pagePath = path.join(HOST_ROOT, pageArtifact.out);
  const pageHtml = fs.readFileSync(pagePath, 'utf8');
  assert.ok(pageHtml.includes('module-page'), '页面 HTML 缺少模块页模板标记');
});
