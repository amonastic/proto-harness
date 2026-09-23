#!/usr/bin/env node
'use strict';

/**
 * 规则频率审计（确定性脚本，无 AI 介入）
 * - 读取 .harness-runtime/rule-usage/*.jsonl 的规则引用自报数据
 * - 统计每个规则章节（文件#小节名）本周与近 4 周引用次数
 * - 排除白名单（与 harness/cold-storage.md 白名单同步维护）
 * - 数据不足 4 周标「观察中」
 * - 输出候选清单报告 doc/平台治理/规则频率审计/audit-YYYY-Www.md（进 git 可追溯）
 * - 原始 jsonl 数据留在 .harness-runtime/rule-usage/（gitignore）
 * - 跑完弹 macOS 系统通知
 * 只产出候选供人工裁决；不修改任何规则文件、不执行移出。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOST_ROOT = path.resolve(__dirname, '..');
const USAGE_DIR = path.join(HOST_ROOT, '.harness-runtime', 'rule-usage');
const REPORT_DIR = path.join(HOST_ROOT, 'doc', '平台治理', '规则频率审计');

// 白名单：与 harness/cold-storage.md「白名单」章节保持同步；此处为文件级前缀
const WHITELIST_PREFIXES = [
  'harness/00-执行总入口.md',
  'harness/01-强制闸门.md',
  'harness/02-纠偏与接力.md',
  'AGENTS.md',
];

// ISO 8601 周编号（与 scripts/harness/lib/shadow/logger.js 同算法）
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week: String(week).padStart(2, '0') };
}
function weekLabel(d) { const { year, week } = isoWeek(d); return `${year}-W${week}`; }

// 解析 "2026-W35" → 可比较整数
function weekKey(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

function notify(title, message) {
  try {
    const esc = (s) => s.replace(/"/g, '\\"');
    execSync(
      `osascript -e 'display notification "${esc(message)}" with title "${esc(title)}" sound name "default"'`,
      { stdio: 'ignore' }
    );
  } catch (e) {
    // 非 macOS 或通知失败时不影响审计结果
  }
}

function main() {
  const now = new Date();
  const curLabel = weekLabel(now);
  const curKey = weekKey(curLabel);

  // 1) 读取全部 jsonl
  const stats = new Map(); // key: 章节锚点 → { weekCounts: Map(weekKey→n), lastTask }
  let totalEntries = 0;
  let oldestWeekKey = curKey;

  if (fs.existsSync(USAGE_DIR)) {
    const files = fs.readdirSync(USAGE_DIR).filter((f) => f.endsWith('.jsonl')).sort();
    for (const f of files) {
      const weekK = weekKey(f.replace(/\.jsonl$/, ''));
      if (weekK !== null) oldestWeekKey = Math.min(oldestWeekKey, weekK);
      const lines = fs.readFileSync(path.join(USAGE_DIR, f), 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch (e) { continue; }
        if (!Array.isArray(entry.rules)) continue;
        totalEntries++;
        for (const r of entry.rules) {
          if (typeof r !== 'string' || !r.trim()) continue;
          if (!stats.has(r)) stats.set(r, { weekCounts: new Map(), lastTask: '' });
          const s = stats.get(r);
          s.weekCounts.set(weekK, (s.weekCounts.get(weekK) || 0) + 1);
          s.lastTask = entry.task || s.lastTask;
        }
      }
    }
  }

  const weeksOfData = curKey - oldestWeekKey + 1;
  const lines = [];
  lines.push(`# 规则频率审计报告 · ${curLabel}`);
  lines.push('');
  lines.push(`- 生成时间：${now.toISOString()}`);
  lines.push(`- 数据周数：${weeksOfData} 周（当前 ${curLabel}）`);
  lines.push(`- 自报记录：${totalEntries} 条`);
  lines.push('');

  if (totalEntries === 0) {
    lines.push('## 本周无规则引用数据');
    lines.push('');
    lines.push('尚未产生自报数据或 `.harness-runtime/rule-usage/` 为空，不产出候选。');
    lines.push('');
    const report = lines.join('\n');
    const out = path.join(REPORT_DIR, `audit-${curLabel}.md`);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(out, report);
    notify('规则频率审计', `本周无规则引用数据，报告已写入 doc/平台治理/规则频率审计/`);
    console.log(report);
    return;
  }

  // 2) 汇总：近4周（weekKey ∈ [curKey-3, curKey]），本周单独
  const rows = [];
  for (const [rule, s] of stats) {
    if (WHITELIST_PREFIXES.some((p) => rule === p || rule.startsWith(p + '#'))) continue;
    let recent = 0, thisWeek = 0;
    for (const [wk, n] of s.weekCounts) {
      if (wk > curKey - 4 && wk <= curKey) recent += n;
      if (wk === curKey) thisWeek += n;
    }
    rows.push({ rule, thisWeek, recent, lastTask: s.lastTask });
  }
  rows.sort((a, b) => a.recent - b.recent || a.thisWeek - b.thisWeek);

  const observing = weeksOfData < 4;

  // 3) 输出报告
  lines.push(`## 候选清单（按近 4 周引用升序；引用越少越冷）`);
  lines.push('');
  lines.push('| 规则章节 | 本周 | 近4周 | 最近任务 | 建议 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const suggestion = observing ? '观察中（数据不足 4 周）' : (r.recent === 0 ? '冷宫候选' : '保留');
    const task = (r.lastTask || '').slice(0, 20).replace(/\|/g, '/');
    lines.push(`| ${r.rule} | ${r.thisWeek} | ${r.recent} | ${task} | ${suggestion} |`);
  }
  lines.push('');
  if (observing) {
    lines.push(`> 统计周期仅 ${weeksOfData} 周，全部条目标注「观察中」；满 4 周后自动产出移出建议。`);
  }
  lines.push('');
  lines.push('> 白名单（harness/00、01、02、AGENTS.md）已排除。');
  lines.push('> 本报告只产出候选供人工裁决；移出与释放须用户批准（见 harness/04 规则冷宫治理）。');
  lines.push('');

  const report = lines.join('\n');
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, `audit-${curLabel}.md`);
  fs.writeFileSync(out, report);

  const candidates = observing ? 0 : rows.filter((r) => r.recent === 0).length;
  notify(
    '规则频率审计完成',
    observing
      ? `数据不足4周（${weeksOfData}周），全部观察中；报告见 doc/平台治理/规则频率审计/`
      : `${rows.length} 个章节，${candidates} 个冷宫候选；报告见 doc/平台治理/规则频率审计/`
  );
  console.log(report);
}

main();
