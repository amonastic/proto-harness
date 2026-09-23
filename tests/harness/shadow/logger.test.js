'use strict';

// P6/H10A：观察日志与周合并测试。
// 合并策略（2026-08-19 用户裁决 C3）：每 7 天自动合并（旧周日志 → weekly-<YYYY-Www>.json，删除原始文件）；
// 本周日志保留；diff 文件不合并；ISO 周格式校验。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '..', '..', '..');
const { isoWeek, isoWeekLabel, writeShadowLog, mergeIfDue, shadowDir } = require('../../../scripts/harness/lib/shadow/logger');

const TEST_FAMILY = `logger-test-${Date.now()}`;
const TEST_PROVIDER = 'deepseek';

function cleanup() {
  fs.rmSync(shadowDir(TEST_PROVIDER, TEST_FAMILY), { recursive: true, force: true });
}

test('H10A-LG-01 ISO week calculation matches known dates', () => {
  // 2026-08-19 是周三 → ISO 周 2026-W34（8 月 17 日周一所在周）
  assert.equal(isoWeekLabel(new Date('2026-08-19T12:00:00Z')), '2026-W34');
  assert.equal(isoWeekLabel(new Date('2026-08-17T00:00:00Z')), '2026-W34');
  assert.equal(isoWeekLabel(new Date('2026-08-16T23:59:59Z')), '2026-W33');
  const { year, week } = isoWeek(new Date('2026-08-19T12:00:00Z'));
  assert.equal(year, 2026);
  assert.equal(week, '34');
});

test('H10A-LG-02 weekly merge combines old-week logs, deletes originals, keeps current week', () => {
  cleanup();
  try {
    // 上周（2026-W33）两条 + 本周（2026-W34）一条
    writeShadowLog({ provider: TEST_PROVIDER, family: TEST_FAMILY, runId: 'SH-OLD-1', entry: { timestamp: '2026-08-12T08:00:00.000Z', tier: 'L1', fixture: { corpus_id: 'C-1' }, prompt: 'p', response: { summary: 's' }, intervention_signals: [], output: {} } });
    writeShadowLog({ provider: TEST_PROVIDER, family: TEST_FAMILY, runId: 'SH-OLD-2', entry: { timestamp: '2026-08-13T09:00:00.000Z', tier: 'L1', fixture: { corpus_id: 'C-2' }, prompt: 'p', response: { summary: 's' }, intervention_signals: [], output: {} } });
    writeShadowLog({ provider: TEST_PROVIDER, family: TEST_FAMILY, runId: 'SH-NEW-1', entry: { timestamp: '2026-08-19T10:00:00.000Z', tier: 'L1', fixture: { corpus_id: 'C-3' }, prompt: 'p', response: { summary: 's' }, intervention_signals: [], output: {} } });

    const result = mergeIfDue({ provider: TEST_PROVIDER, family: TEST_FAMILY, now: new Date('2026-08-19T12:00:00Z') });
    assert.equal(result.merged_weeks.length, 1);
    assert.equal(result.merged_weeks[0].week, '2026-W33');
    assert.equal(result.merged_weeks[0].logs, 2, 'weekly file must contain both old logs');
    assert.equal(result.deleted, 2, 'original old logs must be deleted');
    assert.equal(result.kept, 1, 'current-week log must be kept');

    const weeklyFile = path.join(shadowDir(TEST_PROVIDER, TEST_FAMILY), 'weekly-2026-W33.json');
    assert.ok(fs.existsSync(weeklyFile), 'weekly file must exist');
    const weekly = JSON.parse(fs.readFileSync(weeklyFile, 'utf8'));
    assert.equal(weekly.schema_version, 'h10a-shadow-weekly-v1');
    assert.equal(weekly.week, '2026-W33');
    assert.equal(weekly.family, TEST_FAMILY);
    assert.equal(weekly.logs.length, 2);
    assert.ok(fs.existsSync(path.join(shadowDir(TEST_PROVIDER, TEST_FAMILY), 'SH-NEW-1.json')), 'current-week log untouched');
    assert.ok(!fs.existsSync(path.join(shadowDir(TEST_PROVIDER, TEST_FAMILY), 'SH-OLD-1.json')), 'old log deleted');
    assert.ok(!fs.existsSync(path.join(shadowDir(TEST_PROVIDER, TEST_FAMILY), 'SH-OLD-2.json')), 'old log deleted');
  } finally {
    cleanup();
  }
});

test('H10A-LG-03 merge is idempotent and no-op when no old logs exist', () => {
  cleanup();
  try {
    writeShadowLog({ provider: TEST_PROVIDER, family: TEST_FAMILY, runId: 'SH-NOW', entry: { timestamp: '2026-08-19T10:00:00.000Z', tier: 'L1', fixture: { corpus_id: 'C' }, prompt: 'p', response: { summary: 's' }, intervention_signals: [], output: {} } });
    const first = mergeIfDue({ provider: TEST_PROVIDER, family: TEST_FAMILY, now: new Date('2026-08-19T12:00:00Z') });
    assert.equal(first.merged_weeks.length, 0);
    assert.equal(first.deleted, 0);
    const second = mergeIfDue({ provider: TEST_PROVIDER, family: TEST_FAMILY, now: new Date('2026-08-19T12:00:00Z') });
    assert.equal(second.merged_weeks.length, 0, 'idempotent: no duplicate weekly');
    assert.ok(fs.existsSync(path.join(shadowDir(TEST_PROVIDER, TEST_FAMILY), 'SH-NOW.json')));
    assert.equal(fs.readdirSync(shadowDir(TEST_PROVIDER, TEST_FAMILY)).filter((name) => name.endsWith('.json')).length, 1);
  } finally {
    cleanup();
  }
});

test('H10A-LG-04 existing weekly file is appended (logs merged across runs)', () => {
  cleanup();
  try {
    // 先制造一个已存在的 weekly（直接写入）
    const dir = shadowDir(TEST_PROVIDER, TEST_FAMILY);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'weekly-2026-W32.json'), JSON.stringify({ schema_version: 'h10a-shadow-weekly-v1', week: '2026-W32', family: TEST_FAMILY, logs: [{ run_id: 'PREV' }] }, null, 2) + '\n');
    // 上周新日志一条 → 合并到 W33（新 weekly）；W32 保持不变
    writeShadowLog({ provider: TEST_PROVIDER, family: TEST_FAMILY, runId: 'SH-W33-1', entry: { timestamp: '2026-08-10T08:00:00.000Z', tier: 'L2', fixture: { corpus_id: 'C' }, prompt: 'p', response: { summary: 's' }, intervention_signals: [], output: {} } });
    const result = mergeIfDue({ provider: TEST_PROVIDER, family: TEST_FAMILY, now: new Date('2026-08-19T12:00:00Z') });
    assert.deepEqual(result.merged_weeks.map((w) => w.week), ['2026-W33']);
    const w32 = JSON.parse(fs.readFileSync(path.join(dir, 'weekly-2026-W32.json'), 'utf8'));
    assert.equal(w32.logs.length, 1, 'existing weekly must not be touched');
    assert.ok(fs.existsSync(path.join(dir, 'weekly-2026-W33.json')));
  } finally {
    cleanup();
  }
});
