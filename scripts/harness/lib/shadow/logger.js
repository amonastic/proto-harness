'use strict';

// P6/H10A：观察日志记录器。
// 日志格式：h10a-shadow-log-v1（任务包 §5.2），写入 .harness-runtime/shadow/<provider>/<family>/<run-id>.json。
// 合并策略（2026-08-19 用户裁决 C3）：
//   - 每 7 天自动触发合并（shadow 命令启动时检查）
//   - 合并产物：weekly-<YYYY-Www>.json（ISO 周格式，如 weekly-2026-W34.json），按族分别合并
//   - 合并后删除原始单次日志；diff 文件不合并（用户手工清理）
//   - 本周（now 所在 ISO 周）日志不合并，旧周日志合并

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const { shadowRoot, DEFAULT_SHADOW_ROOT: SHADOW_ROOT } = require('./runtime-root');
const LOG_SCHEMA_VERSION = 'h10a-shadow-log-v1';
const WEEKLY_SCHEMA_VERSION = 'h10a-shadow-weekly-v1';

function shadowDir(provider, family) {
  return path.join(HOST_ROOT, shadowRoot(), provider, family);
}

function logPath(provider, family, runId) {
  return path.join(shadowDir(provider, family), `${runId}.json`);
}

// ISO 8601 周编号（标准算法）：返回 { year, week }，week 两位补零
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay(); // 周一=1
  target.setUTCDate(target.getUTCDate() + 4 - dayNum); // 本周周四
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week: String(week).padStart(2, '0') };
}

function isoWeekLabel(date) {
  const { year, week } = isoWeek(date);
  return `${year}-W${week}`;
}

// 原子写入单次观察日志
function writeShadowLog({ provider, family, runId, entry }) {
  if (!provider || !family || !runId) throw new Error('H10A_LOG provider/family/runId required');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(runId)) throw new Error(`H10A_LOG invalid run_id: ${runId}`);
  const dir = shadowDir(provider, family);
  fs.mkdirSync(dir, { recursive: true });
  const target = logPath(provider, family, runId);
  const payload = { schema_version: LOG_SCHEMA_VERSION, run_id: runId, provider, family, ...entry };
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tmp, target);
  return target;
}

function readShadowLog(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// 合并该族"旧周"单次日志（now 所在 ISO 周之前的全部周）。
// 返回 { merged_weeks: [{ week, logs, file }], kept: n, deleted: n }
function mergeIfDue({ provider, family, now = new Date() }) {
  const dir = shadowDir(provider, family);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !name.startsWith('weekly-') && !name.endsWith('.tmp'));
  } catch {
    return { merged_weeks: [], kept: 0, deleted: 0 };
  }
  const currentWeek = isoWeekLabel(now);
  const byWeek = new Map();
  for (const name of files) {
    const full = path.join(dir, name);
    let log;
    try {
      log = readShadowLog(full);
    } catch {
      continue; // 损坏日志跳过（不删除）
    }
    const timestamp = new Date(log.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    const week = isoWeekLabel(timestamp);
    if (week === currentWeek) continue; // 本周保留
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push({ name, log });
  }

  const mergedWeeks = [];
  let deleted = 0;
  for (const [week, entries] of byWeek) {
    const sorted = entries.sort((a, b) => (a.log.timestamp < b.log.timestamp ? -1 : a.log.timestamp > b.log.timestamp ? 1 : 0));
    const weeklyFile = path.join(dir, `weekly-${week}.json`);
    let logs = [];
    if (fs.existsSync(weeklyFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(weeklyFile, 'utf8'));
        if (Array.isArray(existing.logs)) logs = existing.logs;
      } catch {
        // 损坏的 weekly 文件：从空开始（原文件会被覆盖，保留 .bak 防止数据丢失）
        fs.copyFileSync(weeklyFile, `${weeklyFile}.bak`);
      }
    }
    for (const { log } of sorted) logs.push(log);
    const payload = { schema_version: WEEKLY_SCHEMA_VERSION, week, family, logs };
    const tmp = `${weeklyFile}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    fs.renameSync(tmp, weeklyFile);
    for (const { name } of sorted) {
      try {
        fs.rmSync(path.join(dir, name));
        deleted += 1;
      } catch {
        // 删除失败保留原文件（不阻塞）
      }
    }
    mergedWeeks.push({ week, logs: logs.length, file: path.relative(HOST_ROOT, weeklyFile) });
  }
  return { merged_weeks: mergedWeeks, kept: files.length - deleted, deleted };
}

module.exports = {
  SHADOW_ROOT,
  LOG_SCHEMA_VERSION,
  WEEKLY_SCHEMA_VERSION,
  shadowDir,
  logPath,
  isoWeek,
  isoWeekLabel,
  writeShadowLog,
  readShadowLog,
  mergeIfDue
};
