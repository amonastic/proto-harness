#!/usr/bin/env node
'use strict';

// P8.4 / P9.3（2026-08-21）：harness:run 统一任务入口。
//
// 2026-08-21 用户裁决（harness:run 命令冲突）：run-task.js 作为统一分发入口，
//   --task / --workflow 走 P8-P9 新 task adapter 与 workflow runner；
//   --fixture 兼容转发到 P1/H02 既有 scripts/harness/run.js（原 harness:run 行为不破）。
// package.json 的 harness:run 指向本文件。
//
// 用法：
//   npm run harness:run -- --task requirement-interview --input "..." --provider deepseek [--out ...] [--dry-run] [--verbose]
//   npm run harness:run -- --workflow new-page --input "..." --provider deepseek [--dry-run] [--verbose]
//   npm run harness:run -- --fixture <path> [--seed N] [--run-id ID] [--out-dir DIR]   # 转发 H02
//
// 退出码：0 成功；2 拒绝（非法参数 / 未实现任务或 workflow）；3 内部错误。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOST_ROOT = path.resolve(__dirname, '..', '..');
const H02_RUN_JS = path.join(__dirname, 'run.js');

const KNOWN_TASKS = Object.freeze(['requirement-interview']);
const KNOWN_WORKFLOWS = Object.freeze(['new-page']);

function parseCli(argv) {
  const options = {
    task: null,
    workflow: null,
    input: null,
    provider: null,
    out: null,
    dryRun: false,
    verbose: false,
    fixtureArgs: null // 转发 H02 时保留原始参数
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`HARNESS_RUN ${token} requires a value`);
      index += 1;
      return value;
    };
    switch (token) {
      case '--task': options.task = next(); break;
      case '--workflow': options.workflow = next(); break;
      case '--input': options.input = next(); break;
      case '--provider': options.provider = next(); break;
      case '--out': options.out = next(); break;
      case '--dry-run': options.dryRun = true; break;
      case '--verbose': options.verbose = true; break;
      case '--fixture': {
        // 从 --fixture 起全部参数透传给 H02 run.js
        options.fixtureArgs = argv.slice(index);
        index = argv.length;
        break;
      }
      default:
        throw new Error(`HARNESS_RUN unknown argument: ${token}`);
    }
  }
  return options;
}

// 转发 H02 runner：node run.js <fixtureArgs...>，原样透传退出码
function forwardToH02(fixtureArgs) {
  const result = spawnSync(process.execPath, [H02_RUN_JS, ...fixtureArgs], {
    cwd: HOST_ROOT,
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(`HARNESS_RUN 转发 H02 失败：${result.error.message}`);
    return 3;
  }
  return result.status === null ? 3 : result.status;
}

async function main(argv) {
  const options = parseCli(argv);

  // 转发路径：--fixture → H02
  if (options.fixtureArgs) {
    return forwardToH02(options.fixtureArgs);
  }

  // 任务路径
  if (options.task && options.workflow) {
    throw new Error('HARNESS_RUN --task 与 --workflow 不能同时使用');
  }
  if (!options.task && !options.workflow) {
    throw new Error('HARNESS_RUN 需要 --task <name> 或 --workflow <name> 之一');
  }
  if (!options.input) {
    throw new Error('HARNESS_RUN --input 必填');
  }

  const provider = options.provider || 'deepseek';

  if (options.task) {
    if (!KNOWN_TASKS.includes(options.task)) {
      throw new Error(`HARNESS_RUN task "${options.task}" 未实现（当前支持：${KNOWN_TASKS.join(', ')}）`);
    }
    if (provider !== 'deepseek') {
      // P8-P12 只用 DeepSeek（任务包 §10 明确不做：不实现其他模型 adapter）
      throw new Error(`HARNESS_RUN provider "${provider}" 未实现：P8-P12 只用 deepseek`);
    }
    const { runRequirementInterview } = require('./task-adapters/requirement-interview');
    const result = await runRequirementInterview({
      input: options.input,
      provider,
      dryRun: options.dryRun,
      out: options.out,
      verbose: options.verbose
    });
    if (!result.ok) {
      console.error(`HARNESS_RUN 任务失败（${result.error.phase}）：${result.error.message}`);
      console.error(`attempts: ${result.attempts}`);
      return 2;
    }
    console.log(JSON.stringify({
      task: options.task,
      out: path.relative(HOST_ROOT, result.outPath),
      title: result.title,
      dry_run: result.dryRun || undefined,
      warnings: result.warnings.length > 0 ? result.warnings : undefined
    }, null, 2));
    return 0;
  }

  // workflow 路径
  if (!KNOWN_WORKFLOWS.includes(options.workflow)) {
    throw new Error(`HARNESS_RUN workflow "${options.workflow}" 未实现（当前支持：${KNOWN_WORKFLOWS.join(', ')}）`);
  }
  const { runWorkflow } = require('./lib/workflow/runner');
  const summary = await runWorkflow({
    workflowId: options.workflow,
    input: options.input,
    provider,
    dryRun: options.dryRun,
    verbose: options.verbose
  });
  if (!summary.ok) {
    console.error(`HARNESS_RUN workflow 执行失败，失败步骤：${summary.failedSteps.map((s) => s.stepId).join(', ')}`);
    return 2;
  }
  console.log(JSON.stringify(summary, null, 2));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message || String(error));
    process.exitCode = 3;
  }
);
