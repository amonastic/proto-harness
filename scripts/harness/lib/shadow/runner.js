'use strict';

// P6/H10A：影子观察核心逻辑。
// 档位策略（任务包 §5.1 + §12 用户裁决 2026-08-19）：
//   L0 拒绝观察（错误退出）；L1 只读观察（日志）；L2 受限观察（日志 + diff，用户手工 review）；
//   L3 保守写入（日志 + diff + 临时分支 harness-shadow/<provider>-<family>-<timestamp> 提交，不合并主线）；
//   L4 真实写入（日志 + diff + 本地 commit 标注 [harness-shadow]，不 push——用户裁决"2我没有协作者…"）。
// 安全边界（§6）：L3/L4 写入前检查 git status，工作区 dirty → WARNING + 跳过写入（只产出日志/diff）。
// 复用 P5（§8.2）：buildPrompt / parseVerdictOutput / classifyFailure；干预连续失败阈值扩展为 N=3。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const { qualificationPath } = require('./runtime-root');
const DEFAULT_CORPUS = 'tests/harness/fixtures/corpus/corpus.json';

const { buildPrompt, parseVerdictOutput, classifyFailure, loadCorpus } = require('../qualification/runner');
const { writeShadowLog, mergeIfDue, isoWeekLabel } = require('./logger');
const { writeDiffFile, extractDiff, diffPath } = require('./differ');
const { detectInterventionSignals, hasCritical } = require('./intervention');

// ---- 准入矩阵读取（P5 harness:qualify 产物）----

function loadQualificationResult(matrixPath = qualificationPath('deepseek')) {
  const resolved = path.resolve(HOST_ROOT, matrixPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('H10A_SHADOW matrix escapes project root: ' + matrixPath);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    const message = error && error.code === 'ENOENT'
      ? '准入矩阵未产出，请先运行 harness:qualify（.harness-runtime/qualification/deepseek.json 缺失）'
      : `准入矩阵解析失败: ${matrixPath}: ${error.message}`;
    throw new Error('H10A_SHADOW_MATRIX ' + message);
  }
  if (!Array.isArray(parsed.families)) {
    throw new Error('H10A_SHADOW_MATRIX 准入矩阵格式非法（缺少 families 数组），请重新运行 harness:qualify');
  }
  return parsed;
}

function decidedTierOf(matrix, family) {
  const entry = matrix.families.find((item) => item.family === family);
  return entry ? entry.decided_tier : null;
}

// ---- fixture 选取（任务包 §5.4）----

function selectFixturesForShadow(fixtures, family, { fixtureRef = null, count = 1, all = false } = {}) {
  const familyFixtures = fixtures.filter((fixture) => fixture.scenario_type === family);
  if (familyFixtures.length === 0) {
    throw new Error(`H10A_SHADOW 任务族 ${family} 在 corpus 中无 fixture`);
  }
  if (fixtureRef) {
    const match = familyFixtures.find((fixture) => fixture.corpus_id === fixtureRef);
    if (!match) throw new Error(`H10A_SHADOW fixture ${fixtureRef} 不属于任务族 ${family}`);
    return [match];
  }
  if (all) return familyFixtures;
  const limit = Math.max(1, count);
  const shuffled = [...familyFixtures].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

// ---- git 状态检查（L3/L4 写入前置）----

function gitStatusIsDirty() {
  const result = spawnSync('git', ['status', '--short'], { cwd: HOST_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) return true; // git 不可用时保守视为 dirty
  return result.stdout.trim().length > 0;
}

// diff 涉及的目标路径（+++ b/<path>，排除 /dev/null）
function diffTargetPaths(diffText) {
  const paths = [];
  for (const line of String(diffText || '').split('\n')) {
    const match = line.match(/^\+\+\+\s+b\/(.+)$/);
    if (match && match[1] !== '/dev/null') paths.push(match[1].trim());
  }
  return [...new Set(paths)];
}

// L3：创建临时分支并提交（同名追加 unix 时间戳；不合并主线）
function createTempBranchAndCommit(provider, family, diffText, runId, timestamp) {
  const base = `harness-shadow/${provider}-${family}-${timestamp}`;
  const list = spawnSync('git', ['branch', '--list', base], { cwd: HOST_ROOT, encoding: 'utf8' });
  const branch = list.status === 0 && list.stdout.trim() ? `${base}-${Date.now()}` : base;
  const checkout = spawnSync('git', ['checkout', '-b', branch], { cwd: HOST_ROOT, encoding: 'utf8' });
  if (checkout.status !== 0) {
    throw new Error(`H10A_SHADOW 临时分支创建失败: ${branch}: ${checkout.stderr}`);
  }
  const paths = diffTargetPaths(diffText);
  if (paths.length === 0) return { branch, commit: null, reason: 'diff 无目标路径，未提交' };
  const add = spawnSync('git', ['add', ...paths], { cwd: HOST_ROOT, encoding: 'utf8' });
  if (add.status !== 0) throw new Error(`H10A_SHADOW git add 失败: ${add.stderr}`);
  const commit = spawnSync('git', ['commit', '-m', `[harness-shadow] ${family}: shadow observation ${runId}`], { cwd: HOST_ROOT, encoding: 'utf8' });
  return { branch, commit: commit.status === 0 ? String(commit.stdout).match(/\[[a-f0-9]{7,}\]/)?.[0] || null : null, commit_status: commit.status };
}

// L4：直接写入仓库（显式路径 add + commit 标注 [harness-shadow]；不 push——用户裁决）
function applyAndCommitToRepo(family, diffText, runId) {
  const check = spawnSync('git', ['apply', '--check', '-'], { cwd: HOST_ROOT, input: diffText, encoding: 'utf8' });
  if (check.status !== 0) {
    return { applied: false, commit: null, reason: `diff 无法干净应用: ${String(check.stderr).slice(0, 200)}` };
  }
  const apply = spawnSync('git', ['apply', '-'], { cwd: HOST_ROOT, input: diffText, encoding: 'utf8' });
  if (apply.status !== 0) return { applied: false, commit: null, reason: 'git apply 失败' };
  const paths = diffTargetPaths(diffText);
  if (paths.length === 0) return { applied: true, commit: null, reason: 'diff 无目标路径，未提交' };
  const add = spawnSync('git', ['add', ...paths], { cwd: HOST_ROOT, encoding: 'utf8' });
  if (add.status !== 0) return { applied: true, commit: null, reason: 'git add 失败（暂存区未变更）' };
  const commit = spawnSync('git', ['commit', '-m', `[harness-shadow] ${family}: ${runId}`], { cwd: HOST_ROOT, encoding: 'utf8' });
  return { applied: true, commit: commit.status === 0 ? String(commit.stdout).match(/\[[a-f0-9]{7,}\]/)?.[0] || null : null, commit_status: commit.status };
}

// ---- 观察执行 ----

async function runShadowObservation({
  provider,
  providerName = 'deepseek',
  family,
  tier,
  matrixPath = qualificationPath('deepseek'),
  corpusPath = DEFAULT_CORPUS,
  fixtureRef = null,
  count = 1,
  all = false,
  dryRun = false,
  stopOnCritical = false,
  verbose = false,
  now = new Date()
}) {
  // 1. 准入矩阵与档位
  const matrix = loadQualificationResult(matrixPath);
  const resolvedTier = tier || decidedTierOf(matrix, family);
  if (!resolvedTier) {
    throw new Error(`H10A_SHADOW 任务族 ${family} 不在准入矩阵中（矩阵缺失或未评估该族），请先运行 harness:qualify`);
  }
  if (resolvedTier === 'L0') {
    throw new Error('H10A_SHADOW_L0 该任务族被准入矩阵明确拒绝（L0），不执行影子观察');
  }

  // 2. fixture 选取
  const fixtures = loadCorpus(corpusPath);
  const selected = selectFixturesForShadow(fixtures, family, { fixtureRef, count, all });

  // 3. 日志合并（用户裁决 C3：每 7 天自动合并，shadow 启动时检查）
  const mergeResult = mergeIfDue({ provider: providerName, family, now });

  // 4. dirty 检查（L3/L4 写入前置）
  const dirty = gitStatusIsDirty();
  const dirtyWarnings = [];
  if (dirty && (resolvedTier === 'L3' || resolvedTier === 'L4')) {
    dirtyWarnings.push(`工作区存在未提交改动（git status 非空），L${resolvedTier.slice(1)} 写入已跳过，仅产出日志与 diff（任务包 §6）`);
  }

  // 5. 逐 fixture 观察
  const logs = [];
  const stats = { consecutiveFailures: 0, apiErrors: 0, formatErrors: 0, totalRuns: 0, byPriority: { P0: [], P1: [], P2: [] } };
  const runIdBase = `shadow-${family}-${now.getTime()}`;
  let stoppedByCritical = false;

  for (let index = 0; index < selected.length; index += 1) {
    const fixture = selected[index];
    const runId = `${runIdBase}-${index + 1}`;
    const prompt = buildPrompt(fixture);
    let response;
    let category = null;
    let passed = false;
    try {
      const result = await provider.call({ runId, taskId: fixture.task_id || 'TASK-H10A-SHADOW', prompt });
      const outcome = result && result.outcome ? result.outcome : {};
      if (outcome.code !== 'OK') {
        category = classifyFailure(outcome, null);
        response = { summary: outcome.summary || `outcome ${outcome.code}`, verdict: null, category };
      } else {
        const verdict = parseVerdictOutput(outcome.summary || '');
        if (verdict === null) {
          category = 'format_error';
          response = { summary: outcome.summary, verdict: null, category };
        } else {
          const expected = fixture.expected && fixture.expected.verdict;
          passed = verdict === expected;
          category = passed ? null : 'semantic_failure';
          response = { summary: outcome.summary, verdict, category };
        }
      }
    } catch (error) {
      category = classifyFailure(null, error);
      response = { summary: error.message, verdict: null, category };
    }

    // 统计（干预信号输入）
    stats.totalRuns += 1;
    const priority = fixture.priority || 'P1';
    if (passed) {
      stats.consecutiveFailures = 0;
    } else {
      stats.consecutiveFailures += 1;
      if (category === 'api_failure') stats.apiErrors += 1;
      if (category === 'format_error') stats.formatErrors += 1;
      if (stats.byPriority[priority] !== undefined) stats.byPriority[priority].push(false);
    }
    if (passed && stats.byPriority[priority] !== undefined) stats.byPriority[priority].push(true);

    // 档位产物
    const output = { diff_path: null, branch: null, commit: null };
    let diffText = null;
    if (resolvedTier !== 'L1') {
      diffText = extractDiff(response.summary || '');
      if (diffText) output.diff_path = writeDiffFile({ provider: providerName, family, runId, diffText });
    }
    if (resolvedTier === 'L3' && !dirty) {
      const branchResult = createTempBranchAndCommit(providerName, family, diffText || '', runId, now.getTime());
      output.branch = branchResult.branch;
      output.commit = branchResult.commit;
    } else if (resolvedTier === 'L4' && !dirty) {
      const writeResult = applyAndCommitToRepo(family, diffText || '', runId);
      output.commit = writeResult.commit;
      output.applied = writeResult.applied;
    }

    const entry = {
      run_id: runId,
      family,
      tier: resolvedTier,
      timestamp: now.toISOString(),
      fixture: {
        corpus_id: fixture.corpus_id,
        scenario_type: fixture.scenario_type,
        source_page: fixture.source_page
      },
      prompt,
      response,
      intervention_signals: [],
      output
    };
    logs.push(entry);

    // 干预信号（逐 fixture 后累计检测；--stop-on-critical 时停止后续）
    const signals = detectInterventionSignals({
      consecutiveFailures: stats.consecutiveFailures,
      failuresByPriority: stats.byPriority,
      apiErrors: stats.apiErrors,
      formatErrors: stats.formatErrors,
      totalRuns: stats.totalRuns
    });
    entry.intervention_signals = signals;
    for (const signal of signals) {
      const prefix = signal.severity === 'critical' ? 'CRITICAL' : 'WARNING';
      if (verbose || signal.severity === 'critical') process.stderr.write(`[harness-shadow] ${prefix} ${signal.type}: ${signal.reason}\n`);
    }
    if (stopOnCritical && hasCritical(signals)) {
      stoppedByCritical = true;
      break;
    }
  }

  // 6. 日志落盘
  const logFiles = [];
  for (const entry of logs) {
    logFiles.push(writeShadowLog({ provider: providerName, family, runId: entry.run_id, entry }));
  }

  const allSignals = logs.flatMap((log) => log.intervention_signals);
  return {
    run_id: runIdBase,
    provider: providerName,
    family,
    tier: resolvedTier,
    dry_run: dryRun === true,
    timestamp: now.toISOString(),
    week: isoWeekLabel(now),
    dirty_write_skipped: dirty && (resolvedTier === 'L3' || resolvedTier === 'L4'),
    warnings: dirtyWarnings,
    stopped_by_critical: stoppedByCritical,
    fixture_count: logs.length,
    log_files: logFiles.map((file) => path.relative(HOST_ROOT, file)),
    signals: allSignals,
    merged_weeks: mergeResult.merged_weeks,
    output: logs.map((log) => ({ run_id: log.run_id, diff_path: log.output.diff_path, branch: log.output.branch, commit: log.output.commit }))
  };
}

// dry-run 合成 provider：回显 expected verdict（同 P5），并在 summary 中附带合成 unified diff 块
function createShadowDryRunProvider() {
  return {
    provider_id: 'P-DEEPSEEK-SHADOW-DRY-RUN',
    async call({ runId, taskId, prompt }) {
      let verdict = 'pass';
      let sourcePage = 'index.html';
      const expectedMatch = String(prompt || '').match(/expected_json:\s*(\{[\s\S]*?\})/);
      if (expectedMatch) {
        try {
          const expected = JSON.parse(expectedMatch[1]);
          if (expected && (expected.verdict === 'pass' || expected.verdict === 'fail')) verdict = expected.verdict;
        } catch {
          // 保持默认
        }
      }
      const pageMatch = String(prompt || '').match(/source_page: (.+)/);
      if (pageMatch) sourcePage = pageMatch[1].trim();
      const summary = [
        `deepseek-v4-flash echoed: {"verdict":"${verdict}","reason":"dry-run synthetic"}`,
        '```diff',
        `--- a/${sourcePage}`,
        `+++ b/${sourcePage}`,
        '@@ -0,0 +1,1 @@',
        '+<!-- harness-shadow dry-run: synthetic observation entry, not a real change -->',
        '```'
      ].join('\n');
      return {
        schema_version: 'h02-provider-result-v1',
        provider_id: 'P-DEEPSEEK-SHADOW-DRY-RUN',
        role: 'execution',
        request_id: `dry-${runId}-${Date.now()}`,
        outcome: {
          code: 'OK',
          summary,
          exit_code: 0,
          tool_result: { tool: 'deepseek-shadow-dry-run', summary: `{"verdict":"${verdict}"}` }
        }
      };
    }
  };
}

module.exports = {
  loadQualificationResult,
  decidedTierOf,
  selectFixturesForShadow,
  gitStatusIsDirty,
  diffTargetPaths,
  createTempBranchAndCommit,
  applyAndCommitToRepo,
  runShadowObservation,
  createShadowDryRunProvider,
  diffPath
};
