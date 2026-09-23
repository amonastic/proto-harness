'use strict';

// P6/H10A：干预信号检测器。
// 阈值（P6 初始值，可调；2026-08-19 用户裁决"1同意"）：
//   - 连续失败触发阈值 N=3（同一任务族）
//   - 失败率触发阈值：P0 任一失败 / P1 >50% / P2 >66%（tier_downgrade，critical）
//   - API 错误率触发阈值：>30%（anomaly，warning）
//   - 格式异常（verdict JSON 解析失败）→ anomaly（warning）
// 干预信号只记录，不阻塞观察流程（除非 --stop-on-critical）。

const THRESHOLDS = Object.freeze({
  // P6 用户裁决 2026-08-19
  CONSECUTIVE_FAILURE_LIMIT: 3,
  TIER_DOWNGRADE_P0: 'any', // P0 任一失败
  TIER_DOWNGRADE_P1_RATE: 0.5, // P1 失败率 >50%
  TIER_DOWNGRADE_P2_RATE: 0.66, // P2 失败率 >66%
  API_ERROR_RATE: 0.3 // API 错误率 >30%
});

// 输入（一次 shadow 观察运行的族级统计）：
//   consecutiveFailures —— 本轮连续失败计数
//   failuresByPriority —— { P0: [bool...], P1: [bool...], P2: [bool...] }（true=通过）或 null（未分优先级）
//   apiErrors / formatErrors / totalRuns —— API 失败数、格式失败数、总运行数
// 返回 signals: [{ type, severity, reason }]
function detectInterventionSignals({ consecutiveFailures = 0, failuresByPriority = null, apiErrors = 0, formatErrors = 0, totalRuns = 0 } = {}) {
  const signals = [];

  // consecutive_failure（warning）：同族连续失败 N=3
  if (consecutiveFailures >= THRESHOLDS.CONSECUTIVE_FAILURE_LIMIT) {
    signals.push({
      type: 'consecutive_failure',
      severity: 'warning',
      reason: `同一任务族连续失败 ${consecutiveFailures} 次（阈值 N=${THRESHOLDS.CONSECUTIVE_FAILURE_LIMIT}，P6 用户裁决 2026-08-19），建议检查该族模型表现`
    });
  }

  // tier_downgrade（critical）：P0 任一失败 / P1 失败率>50% / P2 失败率>66%
  if (failuresByPriority) {
    const failedRate = (runs) => {
      if (!Array.isArray(runs) || runs.length === 0) return null;
      return runs.filter((passed) => passed === false).length / runs.length;
    };
    const p0 = failuresByPriority.P0 || [];
    const p1Rate = failedRate(failuresByPriority.P1);
    const p2Rate = failedRate(failuresByPriority.P2);
    if (p0.some((passed) => passed === false)) {
      signals.push({
        type: 'tier_downgrade',
        severity: 'critical',
        reason: 'P0 存在失败（阈值：P0 任一失败即触发），建议重新运行准入矩阵并考虑降档'
      });
    }
    if (p1Rate !== null && p1Rate > THRESHOLDS.TIER_DOWNGRADE_P1_RATE) {
      signals.push({
        type: 'tier_downgrade',
        severity: 'critical',
        reason: `P1 失败率 ${(p1Rate * 100).toFixed(0)}% > ${THRESHOLDS.TIER_DOWNGRADE_P1_RATE * 100}%，建议重新运行准入矩阵并考虑降档`
      });
    }
    if (p2Rate !== null && p2Rate > THRESHOLDS.TIER_DOWNGRADE_P2_RATE) {
      signals.push({
        type: 'tier_downgrade',
        severity: 'critical',
        reason: `P2 失败率 ${(p2Rate * 100).toFixed(0)}% > ${THRESHOLDS.TIER_DOWNGRADE_P2_RATE * 100}%，建议重新运行准入矩阵并考虑降档`
      });
    }
  }

  // anomaly（warning）：格式异常 或 API 错误率>30%
  if (formatErrors > 0) {
    signals.push({
      type: 'anomaly',
      severity: 'warning',
      reason: `模型输出格式异常 ${formatErrors} 次（verdict JSON 解析失败），建议检查模型输出结构`
    });
  }
  if (totalRuns > 0 && apiErrors / totalRuns > THRESHOLDS.API_ERROR_RATE) {
    signals.push({
      type: 'anomaly',
      severity: 'warning',
      reason: `API 错误率 ${((apiErrors / totalRuns) * 100).toFixed(0)}% > ${THRESHOLDS.API_ERROR_RATE * 100}%，建议检查 API key 或模型状态`
    });
  }

  return signals;
}

function hasCritical(signals) {
  return signals.some((signal) => signal.severity === 'critical');
}

// 跨模型聚合干预信号（P7/H10C）：
// 输入 modelSignals: { providerName: signals[] }；family 用于信号 reason。
// 触发条件（P7 自主决策：阈值=2）：≥2 个模型在同一任务族触发 tier_downgrade/critical。
function detectCrossModelConsensus(modelSignals, family) {
  const models = Object.keys(modelSignals || {}).filter((name) =>
    (modelSignals[name] || []).some((signal) => signal.type === 'tier_downgrade' && signal.severity === 'critical')
  );
  if (models.length < 2) return [];
  return [{
    type: 'cross_model_consensus',
    severity: 'critical',
    reason: `≥2 models (${models.join(', ')}) trigger tier_downgrade on ${family}`,
    models
  }];
}

module.exports = { THRESHOLDS, detectInterventionSignals, hasCritical, detectCrossModelConsensus };
