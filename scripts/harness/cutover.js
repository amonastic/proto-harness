#!/usr/bin/env node
'use strict';

// P11.1（2026-08-21）：harness:cutover 切换/回退脚本。
//
// 用法：
//   npm run harness:cutover -- --plan       # 输出切换计划（不写文件）
//   npm run harness:cutover -- --enable     # 写入切换状态文件 + 输出 AGENTS.md diff 计划（不落盘 AGENTS.md）
//   npm run harness:cutover -- --rollback   # 恢复切换状态
//
// 2026-08-21 用户裁决（AGENTS.md 修改冲突）：
//   - --enable 只写切换状态文件（.harness-runtime/cutover/state.json）并输出 AGENTS.md 的
//     精确 diff 计划，不直接修改 AGENTS.md；
//   - AGENTS.md deprecated 标记在 P12 观察期结束后由用户单独授权应用（任务包 P11.1/P12.3）。
//
// 退出码：0 成功；2 参数错误或依赖检查失败；3 内部错误。

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(HOST_ROOT, '.harness-runtime', 'cutover');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

const CUTOVER_VERSION = 'P11-v1.0';

// ---- 依赖检查清单（切换前置）----

function dependencyCheck() {
  const checks = [];
  const exists = (rel) => fs.existsSync(path.join(HOST_ROOT, rel));
  const add = (name, rel, required) => {
    const ok = exists(rel);
    checks.push({ name, path: rel, ok, required });
  };

  add('任务入口 CLI（run-task.js）', 'scripts/harness/run-task.js', true);
  add('requirement-interview adapter', 'scripts/harness/task-adapters/requirement-interview.js', true);
  add('ui-spec adapter', 'scripts/harness/task-adapters/ui-spec-generation.js', true);
  add('page-generation adapter', 'scripts/harness/task-adapters/page-generation.js', true);
  add('index-registration adapter', 'scripts/harness/task-adapters/index-registration.js', true);
  add('workflow runner', 'scripts/harness/lib/workflow/runner.js', true);
  add('workflow 定义 new-page', 'scripts/harness/lib/workflow/definitions/new-page.json', true);
  add('需求基线 schema', 'standards/requirement-baseline-schema.json', true);
  add('workflow schema', 'standards/workflow-definition-schema.json', true);
  add('需求模板（P10）', 'standards/requirement-template.json', true);
  add('corpus（含 P8.5 三新族）', 'tests/harness/fixtures/corpus/corpus.json', true);
  add('qualification-matrix（含三新族）', 'tests/harness/epochs/qualification-matrix.json', true);
  add('smoke 测试（P11.2）', 'tests/harness/smoke/cutover-smoke.test.js', true);
  add('业务外脑加载器（P8.2）', 'scripts/harness/lib/business-brain-loader.js', true);
  add('schema 校验器（P8.3）', 'scripts/harness/lib/schema-validate.js', true);

  const failed = checks.filter((c) => c.required && !c.ok);
  return { checks, ok: failed.length === 0, failed };
}

// ---- AGENTS.md diff 计划（P11.1 输出用，不落盘）----

function buildAgentsDiffPlan() {
  // AGENTS.md 按任务分流读取节（2026-08-21 实测 274-275 行）
  return [
    {
      file: 'AGENTS.md',
      section: '按任务分流读取',
      change: '在「规则与项目资料 harness」与「Harness 最小执行入口」条目前新增新 harness 任务执行入口',
      add_lines: [
        '- 新 harness 任务执行入口：`npm run harness:run -- --task requirement-interview --input "<需求>" --provider deepseek`（真实任务执行，P8）',
        '- 新 harness 工作流入口：`npm run harness:run -- --workflow new-page --input "<需求>" --provider deepseek`（需求访谈→UI 规格→页面生成→索引更新，P9）',
        '- 新 harness 准入入口：`npm run harness:qualify -- --provider deepseek --matrix tests/harness/epochs/qualification-matrix.json`（H09 任务级准入，P5）'
      ],
      mark_deprecated: [
        '老 harness 入口（`harness/00-执行总入口.md`、`harness/01-强制闸门.md`）在观察期结束、用户授权后标记 deprecated 并归档 `harness/archive/`（任务包 P12.3）'
      ],
      note: '本计划由 cutover --enable 输出，不直接修改 AGENTS.md（2026-08-21 用户裁决）'
    }
  ];
}

// ---- 状态读写 ----

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { enabled: false, history: [] };
  }
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function pushHistory(state, action, note) {
  state.history = state.history || [];
  state.history.push({ action, at: new Date().toISOString(), note });
  if (state.history.length > 20) state.history = state.history.slice(-20);
}

// ---- smoke 命令清单 ----

function smokeCommands() {
  return [
    'npm run harness:run -- --task requirement-interview --input "测试" --provider deepseek --dry-run',
    'npm run harness:run -- --workflow new-page --input "示例需求：新增一个名单配置页" --provider deepseek --dry-run',
    'node --test tests/harness/memory/migration-validation.test.js',
    'node --test tests/harness/smoke/cutover-smoke.test.js'
  ];
}

function formatPlan() {
  const dep = dependencyCheck();
  const lines = [];
  lines.push(`# harness cutover 计划（${CUTOVER_VERSION}）`);
  lines.push('');
  lines.push('## 1. 依赖检查');
  dep.checks.forEach((c) => lines.push(`  [${c.ok ? 'OK' : (c.required ? 'MISSING' : 'optional')}] ${c.name} (${c.path})`));
  lines.push(dep.ok ? '  结论：依赖齐备，可切换' : '  结论：存在缺失，禁止切换');
  lines.push('');
  lines.push('## 2. 入口变更');
  lines.push('  - package.json `harness:run` → `scripts/harness/run-task.js`（统一分发：--task/--workflow 新链路，--fixture 转发 H02）');
  lines.push('  - 新增 `harness:cutover` → `scripts/harness/cutover.js`');
  lines.push('  - 新增 `harness:run:h02` → `scripts/harness/run.js`（保留 H02 直接入口）');
  lines.push('');
  lines.push('## 3. AGENTS.md diff 计划（不落盘，观察期后用户授权应用）');
  buildAgentsDiffPlan().forEach((item) => {
    lines.push(`  - ${item.file}#${item.section}`);
    item.add_lines.forEach((l) => lines.push(`    + ${l}`));
    item.mark_deprecated.forEach((l) => lines.push(`    ~ ${l}`));
  });
  lines.push('');
  lines.push('## 4. smoke 测试命令');
  smokeCommands().forEach((c) => lines.push(`  $ ${c}`));
  lines.push('');
  lines.push('## 5. 回退方式');
  lines.push('  - `npm run harness:cutover -- --rollback` 恢复切换状态');
  lines.push('  - 切换前建议提交当前工作区本轮改动（git commit 后记录 hash，回退用 git reset）');
  return { text: lines.join('\n'), depOk: dep.ok };
}

function main(argv) {
  const mode = argv[0];
  if (!mode || !['--plan', '--enable', '--rollback'].includes(mode)) {
    throw new Error('HARNESS_CUTOVER 用法：--plan | --enable | --rollback');
  }

  if (mode === '--plan') {
    const plan = formatPlan();
    console.log(plan.text);
    return plan.depOk ? 0 : 2;
  }

  if (mode === '--enable') {
    const dep = dependencyCheck();
    if (!dep.ok) {
      console.error('HARNESS_CUTOVER 依赖检查失败，禁止切换：');
      dep.failed.forEach((c) => console.error(`  - ${c.name} (${c.path})`));
      return 2;
    }
    const state = readState();
    state.enabled = true;
    state.version = CUTOVER_VERSION;
    state.agents_diff_plan = buildAgentsDiffPlan();
    pushHistory(state, 'enable', '新 harness 切换（P11.1）：harness:run 已指向 run-task.js，状态文件记录切换');
    writeState(state);
    const plan = formatPlan();
    console.log(plan.text);
    console.log('');
    console.log(`HARNESS_CUTOVER 已写入切换状态：${path.relative(HOST_ROOT, STATE_FILE)}`);
    console.log('注意：AGENTS.md 未修改（用户裁决：diff 计划见上，观察期后单独授权应用）。');
    return 0;
  }

  // --rollback
  const state = readState();
  state.enabled = false;
  pushHistory(state, 'rollback', '回退切换状态（P11.1）；AGENTS.md 未被修改，无需恢复');
  writeState(state);
  console.log(`HARNESS_CUTOVER 已回退切换状态：${path.relative(HOST_ROOT, STATE_FILE)}`);
  console.log('说明：--enable 未修改 AGENTS.md，回退无需还原文件；老 harness 入口（H02 run.js）始终可用（harness:run:h02）。');
  return 0;
}

module.exports = {
  CUTOVER_VERSION,
  STATE_FILE,
  dependencyCheck,
  buildAgentsDiffPlan,
  smokeCommands,
  formatPlan,
  main
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 3;
  }
}
