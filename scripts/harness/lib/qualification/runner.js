'use strict';

// P5/H09：准入矩阵生成核心（DeepSeek 任务级准入）。
// 流程（P5 任务包 §5.2/5.3/5.4 + 2026-08-19 用户裁决）：
//   1. 从 qualification-matrix.json 读取任务族与预期档位（缺失/为空时从 corpus scenario_type 派生，初始全 L2）
//   2. 每族按 priority 选取 fixture：P0 最多 5 / P1 最多 3 / P2 最多 3
//   3. 每 fixture 运行 required_runs 次（P0=5 / P1=3 / P2=3），模型输出 verdict 与 fixture.expected.verdict 比对
//   4. 同一 fixture 连续失败 N=2（用户裁决）→ 该族立即 L0，停止后续 fixture
//   5. decideTier 判定 L0-L4；无 P2 fixture 的族保守停 L2（用户裁决）
//   6. 产出结果矩阵 JSON
//
// 错误映射（P5 §5.1）：api_failure / model_refusal / format_error / semantic_failure 四类。
// provider 注入：真实模式 = scripts/harness/providers/execution-runtime.js（P1 已验证 DeepSeek provider）；
//   dry-run 模式 = 内置合成 provider（不读 key，产物标 dry_run: true）；测试注入自定义 fake provider。

const fs = require('fs');
const path = require('path');
const { decideTier } = require('./tiers');
const { loadQualificationMatrix, buildResultMatrix } = require('./matrix');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_CORPUS = 'tests/harness/fixtures/corpus/corpus.json';
const RUNS_BY_PRIORITY = Object.freeze({ P0: 5, P1: 3, P2: 3 });
const MAX_FIXTURES_BY_PRIORITY = Object.freeze({ P0: 5, P1: 3, P2: 3 });
// 2026-08-19 用户裁决：P0 重复失败阈值 N=2
const P0_CONSECUTIVE_FAILURE_LIMIT = 2;

// ---- 纯函数：verdict 提取与失败分类 ----

// 从任意文本提取 verdict（兼容 execution-runtime summary 前缀 "deepseek-v4-flash echoed: ..." 与裸 JSON）
function parseVerdictOutput(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/"verdict"\s*:\s*"(pass|fail)"/i);
  return match ? match[1].toLowerCase() : null;
}

// 失败分类（P5 §5.1 四类）：api_failure / model_refusal / format_error / semantic_failure
function classifyFailure(outcome, error) {
  const message = String((error && error.message) || (outcome && outcome.summary) || '');
  if (/API_KEY_MISSING|HTTP 401|HTTP 429|HTTP 5\d\d|CALL_FAILED|timeout|TIMEOUT/i.test(message)) return 'api_failure';
  if (/empty completion|policy|refusal|zero choices/i.test(message)) return 'model_refusal';
  if (/parse|format/i.test(message)) return 'format_error';
  return 'api_failure';
}

// 构造模型 prompt：fixture 摘要 + 预期 + verdict JSON 输出指令
// expected_json 行供 dry-run provider 回显（机器可读单层 JSON）
function buildPrompt(fixture) {
  const payloadPreview = JSON.stringify(fixture.payload || {}).slice(0, 2000);
  return [
    '任务：判断以下设计稿仓库 fixture 是否满足预期（只输出 JSON，不输出其他内容）。',
    `scenario_type: ${fixture.scenario_type}`,
    `source_page: ${fixture.source_page}`,
    `payload: ${payloadPreview}`,
    `expected_json: ${JSON.stringify(fixture.expected || {})}`,
    '输出格式：{"verdict": "pass" 或 "fail", "reason": "一句话理由"}。verdict 必须与 expected.verdict 一致时输出 "pass"，否则输出 "fail"。'
  ].join('\n');
}

// ---- corpus 读取（项目内路径防逃逸，仿 oracle.js）----

function loadCorpus(corpusPath = DEFAULT_CORPUS) {
  const resolved = path.resolve(HOST_ROOT, corpusPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`H09_QUALIFY corpus escapes project root: ${corpusPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`H09_QUALIFY corpus parse failed: ${corpusPath}: ${error.message}`);
  }
  return Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
}

// ---- fixture 选取（P5 §5.4）：按族 + priority，每族每优先级最多 N 个 ----

function selectFixtures(fixtures, family, priority) {
  const limit = MAX_FIXTURES_BY_PRIORITY[priority];
  const selected = fixtures.filter((fixture) => fixture.scenario_type === family && fixture.priority === priority);
  return selected.slice(0, limit);
}

// ---- 单次运行 ----

async function runOnce({ provider, fixture, runId, taskId, retry }) {
  const prompt = buildPrompt(fixture);
  let lastError = null;
  for (let attempt = 0; attempt <= (Number.isInteger(retry) && retry > 0 ? retry : 0); attempt += 1) {
    try {
      const result = await provider.call({ runId, taskId, prompt });
      const outcome = result && result.outcome ? result.outcome : {};
      if (outcome.code !== 'OK') {
        const category = classifyFailure(outcome, null);
        return { passed: false, category, reason: outcome.summary || `outcome ${outcome.code}` };
      }
      const verdict = parseVerdictOutput(outcome.summary || '');
      if (verdict === null) {
        return { passed: false, category: 'format_error', reason: `verdict JSON parse failure: ${String(outcome.summary).slice(0, 120)}` };
      }
      const expected = fixture.expected && fixture.expected.verdict;
      if (verdict === expected) {
        return { passed: true, category: null, reason: `verdict=${verdict} matches expected=${expected}` };
      }
      return { passed: false, category: 'semantic_failure', reason: `verdict=${verdict} mismatch expected=${expected}` };
    } catch (error) {
      lastError = error;
      const category = classifyFailure(null, error);
      // 仅 api_failure 可重试；模型拒绝/格式/语义失败不重试（避免掩盖模型行为）
      if (category !== 'api_failure') {
        return { passed: false, category, reason: error.message };
      }
    }
  }
  return { passed: false, category: 'api_failure', reason: lastError ? lastError.message : 'api call failed' };
}

// ---- 一族准入 ----

async function runFamily({ provider, fixtures, family, retry, verbose }) {
  const runs = { P0: { status: 'missing', fixtures: [] }, P1: { status: 'missing', fixtures: [] }, P2: { status: 'missing', fixtures: [] } };
  const warnings = [];
  const familyFixtures = fixtures.filter((fixture) => fixture.scenario_type === family);
  if (familyFixtures.length === 0) {
    return { skipped: true, runs, warnings, total_runs: 0, reason: `族内无任何 fixture（scenario_type=${family} 在 corpus 无匹配）` };
  }

  let aborted = null; // P0 连续失败 N=2 → { corpus_id, reason, failures }
  const priorityOrder = ['P0', 'P1', 'P2'];
  let totalRuns = 0;

  for (const priority of priorityOrder) {
    if (aborted) break;
    const selected = selectFixtures(fixtures, family, priority);
    if (selected.length === 0) {
      runs[priority] = { status: 'missing', fixtures: [] };
      continue;
    }
    const requiredRuns = RUNS_BY_PRIORITY[priority];
    const evaluated = [];
    let consecutiveFailures = 0;
    let allPassed = true;
    for (const fixture of selected) {
      const failures = [];
      let passedRuns = 0;
      let abortOnThisFixture = null;
      for (let attempt = 1; attempt <= requiredRuns; attempt += 1) {
        totalRuns += 1;
        const runId = `QUALIFY-${family}-${fixture.corpus_id}-${attempt}`;
        const outcome = await runOnce({ provider, fixture, runId, taskId: fixture.task_id || 'TASK-H09-QUALIFY', retry });
        if (verbose) process.stderr.write(`  [${family}] ${fixture.corpus_id} run ${attempt}/${requiredRuns}: ${outcome.passed ? 'PASS' : `FAIL(${outcome.category}) ${outcome.reason}`}\n`);
        if (outcome.passed) {
          passedRuns += 1;
          consecutiveFailures = 0;
        } else {
          failures.push({ attempt, category: outcome.category, reason: outcome.reason });
          consecutiveFailures += 1;
          if (priority === 'P0' && consecutiveFailures >= P0_CONSECUTIVE_FAILURE_LIMIT) {
            // 用户裁决：P0 同一 fixture 连续失败 2 次 → 立即判定该族 L0，停止后续 fixture
            abortOnThisFixture = { corpus_id: fixture.corpus_id, reason: outcome.reason, failures: consecutiveFailures };
            break;
          }
        }
      }
      if (abortOnThisFixture) {
        aborted = abortOnThisFixture;
        evaluated.push({ corpus_id: fixture.corpus_id, required_runs: requiredRuns, passed_runs: passedRuns, failures });
        break;
      }
      if (passedRuns < requiredRuns) allPassed = false;
      evaluated.push({ corpus_id: fixture.corpus_id, required_runs: requiredRuns, passed_runs: passedRuns, failures });
    }
    runs[priority] = {
      status: aborted ? 'aborted' : 'evaluated',
      passed: allPassed,
      fixture_count: evaluated.length,
      fixtures: evaluated
    };
    if (selected.length < MAX_FIXTURES_BY_PRIORITY[priority]) {
      warnings.push(`[${family}] ${priority} fixture 数量不足（${selected.length}/${MAX_FIXTURES_BY_PRIORITY[priority]}），使用实际数量`);
    }
  }

  return { skipped: false, runs, warnings, total_runs: totalRuns, aborted };
}

// ---- 主入口 ----

async function runQualification({ provider, corpusPath = DEFAULT_CORPUS, matrixPath = null, taskFamilyPattern = null, retry = 0, verbose = false, dryRun = false, generatedAt = null }) {
  const fixtures = loadCorpus(corpusPath);
  const matrix = loadQualificationMatrix(matrixPath, fixtures);
  const warnings = [];
  const skipped = [];
  const families = [];

  let familyList = matrix.task_families;
  if (taskFamilyPattern) {
    familyList = familyList.filter((entry) => entry.family.includes(taskFamilyPattern));
    if (familyList.length === 0) {
      throw new Error(`H09_QUALIFY no task family matches pattern: ${taskFamilyPattern}`);
    }
  }

  for (const entry of familyList) {
    const result = await runFamily({ provider, fixtures, family: entry.family, retry, verbose });
    if (result.skipped) {
      skipped.push({ family: entry.family, expected_tier: entry.expected_tier, reason: result.reason });
      warnings.push(`[${entry.family}] ${result.reason}（不判定档位）`);
      continue;
    }
    warnings.push(...result.warnings);

    const p0 = result.runs.P0.status === 'evaluated' ? result.runs.P0.fixtures.map((item) => item.passed_runs === item.required_runs) : [];
    const p1 = result.runs.P1.status === 'evaluated' ? result.runs.P1.fixtures.map((item) => item.passed_runs === item.required_runs) : [];
    const p2 = result.runs.P2.status === 'evaluated' ? result.runs.P2.fixtures.map((item) => item.passed_runs === item.required_runs) : [];

    let tier;
    let tierNotes = [];
    if (result.aborted) {
      tier = 'L0';
      tierNotes = [`P0 连续失败 ${result.aborted.failures} 次（阈值 N=${P0_CONSECUTIVE_FAILURE_LIMIT}，2026-08-19 用户裁决）：fixture ${result.aborted.corpus_id}，原因 ${result.aborted.reason}`];
    } else {
      const decided = decideTier({ p0, p1, p2 });
      tier = decided.tier;
      tierNotes = decided.notes;
    }
    // P0 评估但全部通过且 P1/P2 缺失时的注记由 decideTier 覆盖；边界情况标注
    if (tier === 'L2' && p2.length > 0 && p2.filter(Boolean).length === 1 && p2.length === 3) {
      tierNotes.push('边界情况：P2 1/3 通过，保守 L2（§9.2）');
    }

    families.push({
      family: entry.family,
      expected_tier: entry.expected_tier,
      decided_tier: tier,
      tier_notes: tierNotes,
      total_runs: result.total_runs,
      runs: result.runs,
      aborted: result.aborted || undefined
    });
  }

  const resultMatrix = buildResultMatrix({
    provider: matrix.provider || (provider ? provider.provider_id : 'unknown'),
    matrixId: matrix.matrix_id,
    dryRun,
    generatedAt: generatedAt || new Date().toISOString(),
    families,
    warnings,
    skipped
  });
  return resultMatrix;
}

// dry-run 合成 provider：回显 prompt 中 expected_json 的 verdict（模拟"模型完全正确"，
// 全链路仍走 verdict 解析与语义判定；不读 key，产物标 dry_run: true）
function createDryRunProvider() {
  return {
    provider_id: 'P-DEEPSEEK-DRY-RUN',
    async call({ runId, taskId, prompt }) {
      let verdict = 'pass';
      const match = String(prompt || '').match(/expected_json:\s*(\{[\s\S]*?\})/);
      if (match) {
        try {
          const expected = JSON.parse(match[1]);
          if (expected && (expected.verdict === 'pass' || expected.verdict === 'fail')) verdict = expected.verdict;
        } catch {
          // 保持默认 pass
        }
      }
      return {
        schema_version: 'h02-provider-result-v1',
        provider_id: 'P-DEEPSEEK-DRY-RUN',
        role: 'execution',
        request_id: `dry-${runId}-${Date.now()}`,
        outcome: {
          code: 'OK',
          summary: `deepseek-v4-flash echoed: {"verdict":"${verdict}","reason":"dry-run synthetic"}`,
          exit_code: 0,
          tool_result: { tool: 'deepseek-dry-run', summary: `{"verdict":"${verdict}"}` }
        }
      };
    }
  };
}

module.exports = {
  DEFAULT_CORPUS,
  RUNS_BY_PRIORITY,
  MAX_FIXTURES_BY_PRIORITY,
  P0_CONSECUTIVE_FAILURE_LIMIT,
  parseVerdictOutput,
  classifyFailure,
  buildPrompt,
  loadCorpus,
  selectFixtures,
  runOnce,
  runFamily,
  runQualification,
  createDryRunProvider
};
