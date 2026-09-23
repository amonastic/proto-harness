'use strict';

// P5/H09：任务族 × 档位矩阵读取与产物生成。
// 依据：P5 任务包 §5.2（从 qualification-matrix.json 读取任务族与预期档位基准）、
//      §6（matrix 缺失时从 corpus scenario_type 去重生成，预期档位初始全部 L2——用户 2026-08-19 裁决方案 A）。

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const DEFAULT_MATRIX = 'tests/harness/epochs/qualification-matrix.json';
const RESULT_SCHEMA_VERSION = 'h09-qualification-result-v1';
const MATRIX_SCHEMA_VERSION = 'h09-qualification-matrix-v1';
const DEFAULT_TIER = 'L2';
const VALID_TIERS = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);

// 从 corpus fixtures 按 scenario_type 去重生成任务族列表（matrix 缺失/为空时使用）
function taskFamiliesFromCorpus(fixtures) {
  const seen = new Set();
  const families = [];
  for (const fixture of fixtures) {
    const family = fixture.scenario_type;
    if (!family || seen.has(family)) continue;
    seen.add(family);
    families.push({ family, expected_tier: DEFAULT_TIER });
  }
  return families;
}

// 读取 qualification-matrix.json；文件不存在（ENOENT）或 task_families 为空 → 回退 corpus 派生（初始全 L2，任务包 §6 方案 A）；
// JSON 语法错误等其他解析失败 → 抛错（不静默回退）
function loadQualificationMatrix(matrixPath, fixtures) {
  let parsed = null;
  if (matrixPath) {
    const resolved = path.resolve(HOST_ROOT, matrixPath);
    const relative = path.relative(HOST_ROOT, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('H09_QUALIFY matrix escapes project root: ' + matrixPath);
    }
    let raw = null;
    try {
      raw = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`H09_QUALIFY matrix read failed: ${matrixPath}: ${error.message}`);
    }
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`H09_QUALIFY matrix parse failed: ${matrixPath}: ${error.message}`);
      }
    }
  }
  const families = parsed && Array.isArray(parsed.task_families) && parsed.task_families.length > 0
    ? parsed.task_families
    : taskFamiliesFromCorpus(fixtures);
  const normalized = families.map((entry) => ({
    family: entry.family,
    expected_tier: VALID_TIERS.has(entry.expected_tier) ? entry.expected_tier : DEFAULT_TIER
  }));
  return {
    matrix_id: parsed && parsed.matrix_id ? parsed.matrix_id : 'QMATRIX-DERIVED',
    schema_version: parsed && parsed.schema_version ? parsed.schema_version : MATRIX_SCHEMA_VERSION,
    provider: parsed && parsed.provider ? parsed.provider : null,
    task_families: normalized
  };
}

// 汇总各档位分布
function tierCounts(families) {
  const counts = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const family of families) {
    if (family.decided_tier && counts[family.decided_tier] !== undefined) counts[family.decided_tier] += 1;
  }
  return counts;
}

// 生成结果矩阵（写盘由 runner 完成）
function buildResultMatrix({ provider, matrixId, dryRun, generatedAt, families, warnings, skipped }) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    provider,
    matrix_id: matrixId,
    dry_run: dryRun === true,
    generated_at: generatedAt,
    summary: {
      families_evaluated: families.length,
      families_skipped: skipped.length,
      total_runs: families.reduce((sum, family) => sum + (family.total_runs || 0), 0),
      tier_counts: tierCounts(families)
    },
    warnings,
    skipped,
    families
  };
}

module.exports = {
  RESULT_SCHEMA_VERSION,
  MATRIX_SCHEMA_VERSION,
  DEFAULT_TIER,
  VALID_TIERS,
  taskFamiliesFromCorpus,
  loadQualificationMatrix,
  tierCounts,
  buildResultMatrix
};
