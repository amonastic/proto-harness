'use strict';

// P5/H09：L0-L4 档位分配逻辑。
// 依据：主任务包第 20 章（P0 每 fixture 5 次全通过，P1/P2 各 3 次；L0-L4 权限语义）
//      + P5 任务包 §5.3 档位表 + §9.2 边界保守判定
//      + 2026-08-19 用户裁决（无 P2 fixture 的族保守停在 L2）
//      + 执行者决策（§9.1 自主决策，对称扩展）：P0/P1 样本缺失时的保守上界
//        （族内仅 P0 语料 → 上界 L2；族内仅 P1 语料 → 上界 L1；族内无任何 fixture → 调用方跳过）

const TIER_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 });

// 输入：
//   p0 / p1 / p2 —— 各优先级运行结果数组（元素为 { passed: boolean, corpus_id, reason } 或 boolean），
//                   空数组表示该优先级在族内无 fixture 样本。
// 返回 { tier, notes: string[] }
function decideTier({ p0 = [], p1 = [], p2 = [] } = {}) {
  const notes = [];
  const failed = (runs) => runs.some((run) => (typeof run === 'object' ? run.passed === false : run === false));

  // P0：任一失败 → L0（明确拒绝该任务族）
  if (failed(p0)) return { tier: 'L0', notes: ['P0 存在失败，明确拒绝该任务族（L0）'] };

  // P0 样本缺失：无法验证 P0 → 档位上界压到 L1（只读观察），不给予写入档位
  if (p0.length === 0) {
    notes.push('族内无 P0 fixture，无法验证 P0，档位上界 L1（执行者决策，对称于用户 2026-08-19 裁决）');
    if (failed(p1)) return { tier: 'L0', notes: [...notes, 'P1 存在失败'] };
    if (p1.length === 0) {
      notes.push('族内无 P1 fixture，且 P0 无样本，无法判定，保守 L0');
      return { tier: 'L0', notes };
    }
    if (p2.length > 0 && !failed(p2)) {
      // P1 全过且 P2 有样本：仍受 P0 缺失上界约束 → 保守 L1
      notes.push('P1/P2 无失败，但 P0 样本缺失，保守 L1');
      return { tier: 'L1', notes };
    }
    if (failed(p2)) notes.push('P2 存在失败');
    return { tier: 'L1', notes: [...notes, 'P0 样本缺失下保守 L1'] };
  }

  // P0 全过；P1 任一失败 → L1
  if (failed(p1)) return { tier: 'L1', notes: ['P0 全通过，P1 存在失败（L1 只读观察）'] };

  // P1 样本缺失：P0 已验证，但 P1 未验证 → 上界 L2（受限写入需人工审阅）
  if (p1.length === 0) {
    notes.push('族内无 P1 fixture，P1 未验证，档位上界 L2');
    if (p2.length > 0 && !failed(p2)) {
      notes.push('P2 无失败但 P1 样本缺失，保守 L2');
      return { tier: 'L2', notes };
    }
    if (p2.length > 0 && failed(p2)) notes.push('P2 存在失败');
    return { tier: 'L2', notes: [...notes, '保守停 L2'] };
  }

  // P0+P1 全过；P2 样本缺失 → 保守停 L2（2026-08-19 用户裁决）
  if (p2.length === 0) {
    return { tier: 'L2', notes: ['无 P2 fixture，保守停 L2（2026-08-19 用户裁决）'] };
  }

  // P2 判定：全过 → L4；2/3 → L3；1/3 或更少 → L2（§9.2 边界保守判定）
  const p2Passed = p2.filter((run) => (typeof run === 'object' ? run.passed === true : run === true)).length;
  if (p2Passed === p2.length) return { tier: 'L4', notes: ['P0+P1+P2 全通过（L4 repo-write）'] };
  if (p2Passed >= p2.length - 1) return { tier: 'L3', notes: [`P2 ${p2Passed}/${p2.length} 通过（L3 保守推断档位）`] };
  return { tier: 'L2', notes: [`P2 ${p2Passed}/${p2.length} 通过，处于边界，保守 L2（§9.2）`] };
}

module.exports = { TIER_RANK, decideTier };
