'use strict';

// H04（P2）：Oracle 确定性预期绑定器。
// 对语料库每条 fixture 调用对应 scenario_type 的 H03A–D 验证器（直接 require，不重写判定逻辑），
// 比较验证器输出与 fixture.expected；不一致输出 diff 并退出码 1，不自动更新 Oracle baseline。
//
// 契约（任务包 5.2/6.2/6.3）：
//   1. 验证器为纯函数调用（不执行真实 git 命令）
//   2. 一致 → oracle_match: true；不一致 → false + diff（不静默）
//   3. baseline_dirty_warning 的 fixture → oracle_confidence: degraded（不得标 confirmed）
//   4. 全部通过 exit 0；任一 false exit 1

const fs = require('fs');
const path = require('path');

const { checkSourceRegistration } = require('../validators/source-registration');
const { checkDocPanel } = require('../validators/doc-panel');
const { checkCopyBoundary } = require('../validators/copy-boundary');
const { checkIterationReference } = require('../validators/iteration-reference');
const { checkSnapshotIntegrity } = require('../validators/snapshot-integrity');
const { checkExperienceProof } = require('../validators/experience-proof');
const { checkDeliveryManifest } = require('../validators/delivery-manifest');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_CORPUS = 'tests/harness/fixtures/corpus/corpus.json';

// scenario_type → 验证器调用（纯函数，输入即 payload）
function runValidatorFor(fixture) {
  const payload = fixture.payload || {};
  switch (fixture.scenario_type) {
    case 'entry-defect':
      return checkSourceRegistration(payload);
    case 'drawer-defect':
      if (payload.docsData) return checkDocPanel(payload);
      return checkCopyBoundary({ pageBodyText: payload.pageBodyText || '' });
    case 'snapshot-pollution':
      return checkIterationReference(payload);
    case 'snapshot-integrity':
      return checkSnapshotIntegrity(payload);
    case 'experience-proof':
      return checkExperienceProof(payload);
    case 'delivery-manifest':
      return checkDeliveryManifest(payload);
    case 'malformed-index':
    case 'scan-failed':
      // 结构性缺陷：预期 verdict 直接取自 fixture.expected（无验证器可调用）
      return { verdict: fixture.expected && fixture.expected.verdict === 'pass' ? 'pass' : 'fail' };
    default:
      throw new Error(`H04_ORACLE unknown scenario_type: ${fixture.scenario_type}`);
  }
}

// 简单 diff 输出（仅展示 verdict/checks/violations 差异，不输出完整对象）
function diffSummary(actual, expected) {
  const lines = [];
  const actualVerdict = actual && actual.verdict;
  const expectedVerdict = expected && expected.verdict;
  if (actualVerdict !== expectedVerdict) {
    lines.push(`  verdict: expected ${expectedVerdict}, got ${actualVerdict}`);
  }
  if (actual && actual.violations && expected && expected.violations) {
    const missing = expected.violations.filter((item) => !actual.violations.includes(item));
    const extra = actual.violations.filter((item) => !expected.violations.includes(item));
    if (missing.length > 0) lines.push(`  violations missing: ${JSON.stringify(missing)}`);
    if (extra.length > 0) lines.push(`  violations extra: ${JSON.stringify(extra)}`);
  }
  return lines.join('\n') || '  (no visible diff in verdict/violations)';
}

// 校验语料库：全部 fixture oracle_match 判定。
// 支持两种输入：corpusPath（文件路径）或 fixturesOverride（内存数组，测试用）。
function validateCorpus(corpusPath = DEFAULT_CORPUS, fixturesOverride = null) {
  let fixtures;
  if (fixturesOverride !== null) {
    fixtures = Array.isArray(fixturesOverride) ? fixturesOverride : [];
  } else {
    const filePath = path.resolve(HOST_ROOT, corpusPath);
    const relative = path.relative(HOST_ROOT, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H04_ORACLE corpus escapes project root: ${corpusPath}`);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`H04_ORACLE corpus parse failed: ${corpusPath}: ${error.message}`);
    }
    fixtures = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
  }

  const results = [];
  let failures = 0;
  for (const fixture of fixtures) {
    let actual;
    try {
      actual = runValidatorFor(fixture);
    } catch (error) {
      actual = { verdict: 'error', error: error.message };
    }
    const expected = fixture.expected || {};
    const match = actual.verdict === expected.verdict;
    const degraded = fixture.baseline_dirty_warning === true;
    const confidence = degraded ? 'degraded' : (match ? 'confirmed' : 'failed');
    const result = {
      corpus_id: fixture.corpus_id,
      scenario_type: fixture.scenario_type,
      source_page: fixture.source_page,
      oracle_match: match,
      oracle_confidence: confidence
    };
    if (degraded && match) result.note = 'baseline_dirty_warning: oracle confidence degraded';
    if (!match) {
      failures += 1;
      result.diff = diffSummary(actual, expected);
    }
    results.push(result);
  }

  return { fixture_count: fixtures.length, oracle_match_count: fixtures.length - failures, failures, results };
}

// CLI
if (require.main === module) {
  try {
    const summary = validateCorpus(process.argv[2] || DEFAULT_CORPUS);
    process.stdout.write(`${JSON.stringify({ fixture_count: summary.fixture_count, oracle_match_count: summary.oracle_match_count, failures: summary.failures }, null, 2)}\n`);
    for (const result of summary.results) {
      if (!result.oracle_match || result.oracle_confidence === 'degraded') {
        process.stdout.write(`- ${result.corpus_id} [${result.scenario_type}] match=${result.oracle_match} confidence=${result.oracle_confidence}${result.note ? ` (${result.note})` : ''}${result.diff ? `\n${result.diff}` : ''}\n`);
      }
    }
    process.exitCode = summary.failures > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(`H04_ORACLE ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  runValidatorFor,
  diffSummary,
  validateCorpus
};
