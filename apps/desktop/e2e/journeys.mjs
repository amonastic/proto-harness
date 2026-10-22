import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_DIR, '../..');
const SAMPLE_DIR = path.join(REPO_ROOT, 'examples', 'existing-project');
const EVIDENCE_DIR = process.env.PHA_E2E_EVIDENCE
  ? path.resolve(process.env.PHA_E2E_EVIDENCE)
  : path.join(APP_DIR, 'e2e', 'evidence');
const PACKAGED_BINARY = process.env.PHA_E2E_BINARY || '';
const RUN_LABEL = process.env.PHA_E2E_LABEL || (PACKAGED_BINARY ? 'packaged' : 'dev');

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function freshRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pha-e2e-${name}-`));
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashTree(root) {
  const out = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out[path.relative(root, full)] = sha256File(full);
    }
  }
  walk(root);
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function launch({ userData, projects }) {
  const env = {
    ...process.env,
    PHA_USER_DATA: path.join(userData, 'user'),
    PHA_PROJECTS_ROOT: projects,
    PHA_E2E: '1'
  };
  const options = {
    args: PACKAGED_BINARY ? [] : ['.'],
    cwd: APP_DIR,
    env,
    timeout: 45000
  };
  if (PACKAGED_BINARY) options.executablePath = PACKAGED_BINARY;
  const app = await electron.launch(options);
  const page = await app.firstWindow({ timeout: 45000 });
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  const logs = [];
  page.on('pageerror', (error) => {
    const line = `PAGEERROR ${error.message}`;
    logs.push(line);
    errors.push(line);
  });
  page.on('console', (message) => {
    const line = `CONSOLE[${message.type()}] ${message.text()}`;
    logs.push(line);
    if (message.type() === 'error') errors.push(line);
  });
  return { app, page, errors, logs };
}

async function dumpFailure(page, journey, error, logs = []) {
  try {
    const dir = path.join(EVIDENCE_DIR, journey);
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      journey,
      at: new Date().toISOString(),
      message: error.message,
      stack: error.stack || '',
      url: null,
      title: null,
      body_excerpt: null,
      screenshot: null,
      screenshot_error: null,
      console: logs.slice(-200)
    };
    try { record.url = page.url(); } catch (captureError) { record.url_error = captureError.message; }
    try { record.title = await page.title(); } catch (captureError) { record.title_error = captureError.message; }
    try {
      const body = await page.locator('body').innerText({ timeout: 5000 });
      record.body_excerpt = body.slice(0, 20000);
    } catch (captureError) {
      record.body_error = captureError.message;
    }
    try {
      await page.screenshot({
        path: path.join(dir, 'failure.png'),
        animations: 'disabled',
        timeout: 20000
      });
      record.screenshot = 'failure.png';
    } catch (captureError) {
      record.screenshot_error = captureError.message;
    }
    fs.writeFileSync(
      path.join(dir, 'failure-diagnostics.json'),
      `${JSON.stringify(record, null, 2)}\n`
    );
  } catch (diagnosticError) {
    console.error(`[${journey}] 失败诊断写入失败：${diagnosticError.message}`);
  }
}

async function shot(page, journey, name) {
  await page.waitForTimeout(500);
  const dir = path.join(EVIDENCE_DIR, journey);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled', timeout: 60000 });
}

async function waitForRendered(page, selector, { timeout = 30000, label = selector } = {}) {
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (error) {
    const present = await page.evaluate(
      (target) => Boolean(document.querySelector(target)),
      selector
    ).catch(() => false);
    if (!present) throw error;
    console.warn(`[e2e] ${label} 等待超时但 DOM 已存在，交由后续交互校验可见性`);
  }
}

async function fillStable(page, selector, value, label = selector) {
  const input = page.locator(selector);
  await input.waitFor({ state: 'visible' });
  await input.fill(value);
  if ((await input.inputValue()) !== value) {
    console.warn(`[e2e] ${label} 首次输入不完整，重填一次`);
    await input.fill(value);
  }
  assert.equal(await input.inputValue(), value, `${label} 输入值不完整`);
}

async function fillNewProduct(page) {
  await page.waitForSelector('[data-testid="home-new-product"]');
  await page.click('[data-testid="home-new-product"]');
  await fillStable(page, '[data-testid="np-name"]', '社区驿站取件', '产品名称');
  await fillStable(page, '[data-testid="np-goal"]', '让门店店员在 2 分钟内可重复开柜，同时不改变订单签收状态', '产品目标');
  await fillStable(page, '[data-testid="np-audience"]', '门店店员、取件人', '服务对象');
  await fillStable(page, '[data-testid="np-constraints"]', '每个取件码仅可开柜一次\n重复开柜不得改变订单签收状态，不得触发新的物流推送', '产品约束');
  await fillStable(page, '[data-testid="np-endpoints"]', '作业端 App | 门店店员 | App\n管理后台 | 产品运营 | Web', '端与角色');
  await page.click('[data-testid="np-analyze"]');
  await page.waitForSelector('[data-testid="np-rule-checkbox"]', { timeout: 20000 });
  const candidates = await page.locator('[data-testid="np-rule-checkbox"]').count();
  assert.equal(candidates, 2);
  await page.click('[data-testid="np-create"]');
  await page.waitForSelector('[data-testid="top-new-requirement"]', { timeout: 30000 });
}

async function createRequirement(page, { title, goal, raw }) {
  await page.click('[data-testid="top-new-requirement"]');
  await page.waitForSelector('[data-testid="nr-title"]');
  await fillStable(page, '[data-testid="nr-title"]', title, '需求标题');
  await fillStable(page, '[data-testid="nr-goal"]', goal, '需求目标');
  await fillStable(page, '[data-testid="nr-raw"]', raw, '需求原始输入');
  await page.click('[data-testid="nr-create"]');
}

async function decideAdopt(page, reason) {
  await page.waitForSelector('[data-testid="decision-submit"]', { timeout: 35000 });
  await page.click('[data-testid="decision-adopt"]');
  await fillStable(page, '[data-testid="decision-reason"]', reason, '裁决理由');
  assert.equal(await page.locator('[data-testid="decision-submit"]').isDisabled(), false);
  await page.click('[data-testid="decision-submit"]');
  await page.waitForSelector('[data-testid="req-generate"]', { timeout: 25000 });
}

async function generateAndInspect(page, journey, { prefix = '', headingPattern = /重复开柜/ } = {}) {
  await page.click('[data-testid="req-generate"]');
  await page.waitForSelector('[data-testid="artifact-preview"]', { timeout: 30000 });
  await page.locator('[data-testid="artifact-preview"]').scrollIntoViewIfNeeded();
  await shot(page, journey, `${prefix}artifacts`);
  const frame = page.frames().find((item) => item.url().startsWith('pha-preview://'));
  assert.ok(frame, '原型预览 frame 未加载');
  await frame.waitForSelector('h1', { timeout: 10000 });
  const heading = await frame.locator('h1').first().innerText();
  assert.match(heading, headingPattern);
  const bodyText = await frame.locator('body').innerText();
  assert.match(bodyText, /业务依据/);
  assert.match(bodyText, /交互原型 · 演示数据/);
  await page.click('[data-testid="artifact-tab-css"]');
  await page.waitForSelector('.swatch-card');
  const swatches = await page.locator('.swatch-card').count();
  assert.ok(swatches >= 5, `CSS 色块数量不足：${swatches}`);
  assert.match(await page.locator('#artifact-content').innerText(), /声明值|模板默认/);
  await shot(page, journey, `${prefix}css-spec`);
  return heading;
}

async function reviewAndDeliver(page, journey, { prefix = '' } = {}) {
  await page.click('[data-testid="req-review"]');
  await page.waitForSelector('.modal [data-confirm]');
  await shot(page, journey, `${prefix}review`);
  await page.click('.modal [data-confirm]');
  await page.waitForSelector('[data-testid="req-deliver"]', { timeout: 25000 });
  await page.click('[data-testid="req-deliver"]');
  await page.waitForSelector('[data-testid="req-open-delivery"]', { timeout: 40000 });
  await shot(page, journey, `${prefix}delivered`);
}

function copyFileInto(projectDir, rel, destDir) {
  const source = path.join(projectDir, rel);
  if (!fs.existsSync(source)) return;
  const target = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.statSync(source).isDirectory()) return;
  fs.copyFileSync(source, target);
}

function archiveJourney(projectDir, journey, requirementId, deliveryId) {
  const dest = path.join(EVIDENCE_DIR, journey, 'project-snapshot');
  rmrf(dest);
  copyFileInto(projectDir, 'project.json', dest);
  const files = [
    `requirements/${requirementId}/requirement.json`,
    `requirements/${requirementId}/proposal.json`,
    `requirements/${requirementId}/analysis.json`,
    `requirements/${requirementId}/analysis-resolved.json`,
    `requirements/${requirementId}/interaction-spec.json`,
    `requirements/${requirementId}/artifacts/spec-generation.json`,
    `requirements/${requirementId}/requirement.md`,
    `requirements/${requirementId}/artifacts/prototype.html`,
    `requirements/${requirementId}/artifacts/css-spec.json`,
    `requirements/${requirementId}/artifacts/mapping.json`,
    `deliveries/${deliveryId}/delivery.json`,
    `deliveries/${deliveryId}/manifest.json`,
    `deliveries/${deliveryId}/export/index.html`
  ];
  for (const file of files) copyFileInto(projectDir, file, dest);
  for (const dir of ['brain/baselines', 'brain/decisions']) {
    const source = path.join(projectDir, dir);
    if (!fs.existsSync(source)) continue;
    for (const file of fs.readdirSync(source)) {
      copyFileInto(projectDir, `${dir}/${file}`, dest);
    }
  }
  const delivery = readJson(path.join(projectDir, 'deliveries', deliveryId, 'delivery.json'));
  for (const item of delivery.manifest || []) {
    if (item.frozen_path) {
      copyFileInto(projectDir, `deliveries/${deliveryId}/${item.frozen_path}`, dest);
    }
  }
}

function findRequirementId(projectDir, title) {
  const base = path.join(projectDir, 'requirements');
  for (const id of fs.readdirSync(base)) {
    const file = path.join(base, id, 'requirement.json');
    if (!fs.existsSync(file)) continue;
    if (readJson(file).title === title) return id;
  }
  throw new Error(`未找到需求：${title}`);
}

function archiveVariant(projectDir, requirementIds, deliveryIds) {
  const dest = path.join(EVIDENCE_DIR, 'journey-3', 'project-snapshot');
  rmrf(dest);
  copyFileInto(projectDir, 'project.json', dest);
  copyFileInto(projectDir, 'README.md', dest);
  for (const requirementId of requirementIds) {
    for (const file of [
      'requirement.json', 'proposal.json', 'analysis.json', 'analysis-resolved.json',
      'interaction-spec.json', 'requirement.md', 'artifacts/spec-generation.json',
      'artifacts/prototype.html', 'artifacts/css-spec.json', 'artifacts/mapping.json'
    ]) {
      copyFileInto(projectDir, `requirements/${requirementId}/${file}`, dest);
    }
  }
  for (const deliveryId of deliveryIds) {
    for (const file of ['delivery.json', 'manifest.json', 'export/index.html']) {
      copyFileInto(projectDir, `deliveries/${deliveryId}/${file}`, dest);
    }
    const delivery = readJson(path.join(projectDir, 'deliveries', deliveryId, 'delivery.json'));
    for (const item of delivery.manifest || []) {
      if (item.frozen_path) {
        copyFileInto(projectDir, `deliveries/${deliveryId}/${item.frozen_path}`, dest);
      }
    }
  }
}

function assertNoSecrets(dir) {
  const bad = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(html|json|md|txt|css)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (/sk-[A-Za-z0-9_-]{16,}/.test(text) || /Authorization:\s*Bearer/i.test(text) || /apiKeyEnc/.test(text)) {
        bad.push(full);
      }
    }
  }
  walk(dir);
  assert.deepEqual(bad, []);
}

async function journeyOne() {
  const root = freshRoot('j1');
  const projects = path.join(root, 'projects');
  const userData = path.join(root, 'user');
  const { app, page, errors, logs } = await launch({ userData, projects });
  let activePage = page;
  let activeLogs = logs;
  let projectDir;
  let requirementId;
  let deliveryId;
  try {
    await page.waitForSelector('[data-testid="home-new-product"]', { timeout: 30000 });
    await shot(page, 'journey-1', '01-home');
    await fillNewProduct(page);
    await shot(page, 'journey-1', '02-workbench');

    const name = '支持同一取件码 2 分钟内重复开柜';
    await createRequirement(page, {
      title: name,
      goal: '同一取件码在 2 分钟内可重复打开原柜原格，不改变订单状态',
      raw: '同一取件码在 2 分钟内可重复开柜，不改变订单状态。重复开柜不得触发新的物流推送。'
    });
    await page.waitForSelector('[data-testid="decision-submit"]', { timeout: 35000 });
    await shot(page, 'journey-1', '03-decision');
    const conflictText = await page.locator('.conflict-card').innerText();
    assert.match(conflictText, /每个取件码仅可开柜一次/);
    assert.match(conflictText, /新需求允许重复操作/);

    projectDir = path.join(projects, '社区驿站取件');
    const currentBefore = readJson(path.join(projectDir, 'project.json')).current_baseline_id;
    await decideAdopt(page, '业务确认允许 2 分钟内重复开柜，但不改变订单签收状态');
    const currentAfter = readJson(path.join(projectDir, 'project.json')).current_baseline_id;
    assert.equal(currentAfter, currentBefore, '采纳裁决不得自动切换当前基线');
    const baselines = fs.readdirSync(path.join(projectDir, 'brain', 'baselines')).map((file) => readJson(path.join(projectDir, 'brain', 'baselines', file)));
    assert.ok(baselines.some((item) => item.status === 'planned'), '缺少计划基线');
    assert.ok(baselines.some((item) => item.status === 'current' && item.id === currentAfter), '缺少当前基线');
    const requirements = fs.readdirSync(path.join(projectDir, 'requirements'));
    assert.equal(requirements.length, 1);
    requirementId = requirements[0];
    const requirement = readJson(path.join(projectDir, 'requirements', requirementId, 'requirement.json'));
    assert.notEqual(requirement.baseline_id, currentAfter, '需求应使用计划基线');

    await generateAndInspect(page, 'journey-1');
    await reviewAndDeliver(page, 'journey-1');
    const deliveryDirs = fs.readdirSync(path.join(projectDir, 'deliveries'));
    assert.equal(deliveryDirs.length, 1);
    deliveryId = deliveryDirs[0];
    const deliveryDir = path.join(projectDir, 'deliveries', deliveryId);
    assert.ok(fs.existsSync(path.join(deliveryDir, 'export', 'index.html')));
    assert.ok(fs.existsSync(path.join(deliveryDir, 'export', 'requirements', requirementId, 'artifacts', 'prototype.html')));
    const delivery = readJson(path.join(deliveryDir, 'delivery.json'));
    assert.equal(delivery.status, 'exported');
    assert.ok(delivery.manifest.length === 5);
    assert.ok(delivery.warnings.some((item) => /planned 基线/.test(item)));
    assertNoSecrets(path.join(deliveryDir, 'export'));
    archiveJourney(projectDir, 'journey-1', requirementId, deliveryId);

    // Git：初始化、提交、推送到本地 bare 远端
    await page.click('[data-testid="nav-deliveries"]');
    await page.waitForSelector('[data-testid="git-init"]');
    await page.click('[data-testid="git-init"]');
    await page.waitForSelector('[data-testid="git-commit"]', { timeout: 20000 });
    await fillStable(page, '[data-testid="git-commit-message"]', 'feat: 新增取件码重复开柜需求与交付', '提交信息');
    await page.click('[data-testid="git-commit"]');
    await page.waitForTimeout(1200);
    const bare = path.join(root, 'remote.git');
    execFileSync('git', ['init', '--bare', bare]);
    execFileSync('git', ['-C', projectDir, 'remote', 'add', 'origin', bare]);
    await page.click('#delivery-refresh');
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-testid="git-push"]');
      return button && !button.disabled;
    }, { timeout: 20000 });
    assert.equal(await page.locator('[data-testid="git-push"]').isDisabled(), false);
    await page.click('[data-testid="git-push"]');
    await page.waitForSelector('.modal [data-confirm]');
    await page.click('.modal [data-confirm]');
    await page.waitForSelector('.toast', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const refs = execFileSync('git', ['--git-dir', bare, 'show-ref']).toString();
    assert.match(refs, /refs\/heads\/main/);
    const log = execFileSync('git', ['-C', projectDir, 'log', '--oneline', '-1']).toString();
    assert.match(log, /重复开柜/);
    await shot(page, 'journey-1', '04-git-sync');

    // 第二工作副本：从已推送的远端克隆并恢复同一需求
    const cloneDir = path.join(projects, '社区驿站取件-第二工作副本');
    execFileSync('git', ['clone', bare, cloneDir]);
    await page.click('#switch-product');
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 20000 });
    const cards = page.locator('[data-testid="project-card"]');
    const cloneIndex = await cards.evaluateAll((elements, target) => (
      elements.findIndex((element) => element.getAttribute('data-root') === target)
    ), cloneDir);
    assert.ok(cloneIndex >= 0, '第二工作副本未出现在产品列表');
    await cards.nth(cloneIndex).click();
    await page.waitForSelector('[data-testid="nav-requirements"]', { timeout: 20000 });
    await page.click('[data-testid="nav-requirements"]');
    await page.waitForSelector('[data-testid="requirement-row"]', { timeout: 20000 });
    await page.locator('[data-testid="requirement-row"]').first().click();
    await page.waitForSelector('[data-testid="req-open-delivery"]', { timeout: 20000 });
    assert.match(await page.locator('body').innerText(), /已交付/);
    await shot(page, 'journey-1', '05-second-copy');

    // 设置页：本地分析器测试
    await page.click('[data-testid="sidebar-settings"]');
    await waitForRendered(page, '[data-testid="settings-save"]', { label: '设置页' });
    await shot(page, 'journey-1', '06-settings');
    await page.click('[data-testid="settings-test"]');
    await page.waitForSelector('#settings-message .info-box', { timeout: 15000 });
    assert.match(await page.locator('#settings-message').innerText(), /连接测试通过/);
    assert.deepEqual(errors, [], `控制台错误：${errors.join('\n')}`);

    // 重启恢复
    await app.close();
    const second = await launch({ userData, projects });
    activePage = second.page;
    activeLogs = second.logs;
    try {
      await second.page.waitForSelector('[data-testid="project-card"]', { timeout: 20000 });
      await second.page.locator('[data-testid="project-card"]').first().click();
      await second.page.waitForSelector('[data-testid="nav-requirements"]', { timeout: 20000 });
      await second.page.click('[data-testid="nav-requirements"]');
      await second.page.waitForSelector('[data-testid="requirement-row"]', { timeout: 20000 });
      await second.page.locator('[data-testid="requirement-row"]').first().click();
      await second.page.waitForSelector('[data-testid="req-open-delivery"]', { timeout: 20000 });
      assert.match(await second.page.locator('.page-title').first().innerText(), /重复开柜/);
      assert.match(await second.page.locator('body').innerText(), /已交付/);
      assert.match(await second.page.locator('body').innerText(), /业务裁决/);
      await shot(second.page, 'journey-1', '07-resumed');
      assert.deepEqual(second.errors, [], `重启后控制台错误：${second.errors.join('\n')}`);
    } finally {
      await second.app.close();
    }
    return { projectDir, requirementId, deliveryId, errors };
  } catch (error) {
    await dumpFailure(activePage, 'journey-1', error, activeLogs);
    error.message = `[journey-1] ${error.message}`;
    throw error;
  } finally {
    await app.close().catch(() => {});
  }
}

async function journeyTwo() {
  const root = freshRoot('j2');
  const projects = path.join(root, 'projects');
  const userData = path.join(root, 'user');
  const before = hashTree(SAMPLE_DIR);
  const { app, page, errors, logs } = await launch({ userData, projects });
  let projectDir;
  let requirementId;
  let deliveryId;
  try {
    await page.waitForSelector('[data-testid="home-import-project"]');
    await page.click('[data-testid="home-import-project"]');
    await fillStable(page, '[data-testid="ip-source"]', SAMPLE_DIR, '已有项目目录');
    await page.click('[data-testid="ip-scan"]');
    await page.waitForSelector('[data-testid="ip-create"]', { timeout: 25000 });
    await shot(page, 'journey-2', '01-import-scan');
    assert.equal(await page.locator('.conflict-box').count(), 1);
    assert.equal(await page.locator('#ip-name').inputValue(), '社区驿站取件');
    await fillStable(page, '[data-testid="ip-conflict-reason"]', '以当前已评审口径为准，历史方案保留为已替代，不进入当前基线', '导入裁决理由');
    await page.click('[data-testid="ip-create"]');
    await page.waitForSelector('[data-testid="top-new-requirement"]', { timeout: 30000 });
    projectDir = path.join(projects, '社区驿站取件');
    assert.ok(fs.existsSync(path.join(projectDir, 'brain', 'import-report.json')));
    const importedRules = fs.readdirSync(path.join(projectDir, 'brain', 'rules'));
    assert.ok(importedRules.some((item) => item.includes('-HIST-')), '缺少历史口径规则');
    const importReport = readJson(path.join(projectDir, 'brain', 'import-report.json'));
    assert.equal(importReport.conflicts.length, 1);
    assert.match(importReport.conflicts[0].reason, /当前已评审口径/);
    await shot(page, 'journey-2', '02-workbench');

    await page.click('[data-testid="nav-brain"]');
    await page.waitForSelector('[data-testid="brain-tab-rules"]');
    await page.click('[data-testid="brain-tab-rules"]');
    await page.waitForSelector('[data-testid="rule-row"]', { timeout: 15000 });
    assert.ok(await page.locator('[data-testid="rule-row"]').count() >= 5);
    await shot(page, 'journey-2', '03-brain-rules');
    await page.locator('[data-testid="rule-row"]').first().click();
    await page.waitForSelector('.drawer');
    assert.match(await page.locator('.drawer').innerText(), /修订 r1/);
    await page.click('.drawer-close');

    await page.click('[data-testid="top-new-requirement"]');
    await page.waitForSelector('[data-testid="nr-title"]');
    await fillStable(page, '[data-testid="nr-title"]', '支持同一取件码 2 分钟内重复开柜', '需求标题');
    await fillStable(page, '[data-testid="nr-goal"]', '同一取件码在 2 分钟内可重复打开原柜原格，不改变订单状态', '需求目标');
    await fillStable(page, '[data-testid="nr-raw"]', '同一取件码在 2 分钟内可重复开柜，不改变订单状态。重复开柜不得触发新的物流推送。', '需求原始输入');
    await page.click('[data-testid="nr-create"]');
    await page.waitForSelector('[data-testid="decision-submit"]', { timeout: 35000 });
    assert.match(await page.locator('.conflict-card').innerText(), /RULE-PICKUP-REOPEN/);
    await shot(page, 'journey-2', '04-decision');
    const currentBefore = readJson(path.join(projectDir, 'project.json')).current_baseline_id;
    await decideAdopt(page, '业务确认允许 2 分钟内重复开柜，订单状态与物流推送保持不变');
    assert.equal(readJson(path.join(projectDir, 'project.json')).current_baseline_id, currentBefore);
    const requirements = fs.readdirSync(path.join(projectDir, 'requirements'));
    assert.equal(requirements.length, 1);
    requirementId = requirements[0];
    const requirement = readJson(path.join(projectDir, 'requirements', requirementId, 'requirement.json'));
    assert.notEqual(requirement.baseline_id, currentBefore);

    await generateAndInspect(page, 'journey-2');
    await reviewAndDeliver(page, 'journey-2');
    const deliveryDirs = fs.readdirSync(path.join(projectDir, 'deliveries'));
    assert.equal(deliveryDirs.length, 1);
    deliveryId = deliveryDirs[0];
    const deliveryDir = path.join(projectDir, 'deliveries', deliveryId);
    const delivery = readJson(path.join(deliveryDir, 'delivery.json'));
    assert.equal(delivery.status, 'exported');
    assert.ok(delivery.warnings.some((item) => /planned 基线/.test(item)));
    assertNoSecrets(path.join(deliveryDir, 'export'));
    archiveJourney(projectDir, 'journey-2', requirementId, deliveryId);
    assert.deepEqual(hashTree(SAMPLE_DIR), before, '导入过程修改了来源目录');
    assert.deepEqual(errors, [], `控制台错误：${errors.join('\n')}`);
    return { projectDir, requirementId, deliveryId, errors };
  } catch (error) {
    await dumpFailure(page, 'journey-2', error, logs);
    error.message = `[journey-2] ${error.message}`;
    throw error;
  } finally {
    await app.close().catch(() => {});
  }
}


async function journeyThree() {
  const root = freshRoot('j3');
  const projects = path.join(root, 'projects');
  const userData = path.join(root, 'user');
  const { app, page, errors, logs } = await launch({ userData, projects });
  let projectDir;
  let reqAId;
  let reqBId;
  let deliveryA;
  let deliveryB;
  try {
    await page.waitForSelector('[data-testid="home-new-product"]', { timeout: 30000 });
    await page.click('[data-testid="home-new-product"]');
    await fillStable(page, '[data-testid="np-name"]', '运营活动台', '产品名称');
    await fillStable(page, '[data-testid="np-goal"]', '让员工提交活动报名，管理员查看和管理报名记录', '产品目标');
    await fillStable(page, '[data-testid="np-audience"]', '员工、管理员', '服务对象');
    await fillStable(page, '[data-testid="np-constraints"]', '报名提交后仅可查看，不得修改\n报名记录必须记录提交时间', '产品约束');
    await fillStable(page, '[data-testid="np-endpoints"]', '员工端 | 员工 | Web\n管理后台 | 管理员 | Web', '端与角色');
    await page.click('[data-testid="np-analyze"]');
    await page.waitForSelector('[data-testid="np-rule-checkbox"]', { timeout: 20000 });
    await page.click('[data-testid="np-create"]');
    await page.waitForSelector('[data-testid="top-new-requirement"]', { timeout: 30000 });
    projectDir = path.join(projects, '运营活动台');

    // A：与取件码无关的真实需求，要求表单 + 管理列表
    await page.click('[data-testid="top-new-requirement"]');
    await page.waitForSelector('[data-testid="nr-title"]');
    await fillStable(page, '[data-testid="nr-title"]', '员工提交活动报名并查看管理列表', '需求标题');
    await fillStable(page, '[data-testid="nr-goal"]', '员工填写报名信息，管理员查看报名列表', '需求目标');
    await fillStable(page, '[data-testid="nr-raw"]', '员工填写姓名、部门、联系方式并提交报名；管理员查看报名列表。', '需求原始输入');
    await page.click('[data-testid="nr-create"]');
    await page.waitForSelector('[data-testid="req-generate"]', { timeout: 35000 });
    reqAId = findRequirementId(projectDir, '员工提交活动报名并查看管理列表');
    await page.click('[data-testid="req-generate"]');
    await page.waitForSelector('[data-testid="artifact-preview"]', { timeout: 30000 });
    await page.locator('[data-testid="artifact-preview"]').scrollIntoViewIfNeeded();
    await shot(page, 'journey-3', '01-a-form-list');
    const frameA = page.frames().find((item) => item.url().startsWith('pha-preview://'));
    assert.ok(frameA, '活动报名原型未加载');
    await frameA.waitForSelector('[data-page-tab]');
    assert.equal(await frameA.locator('[data-page-tab]').count(), 2);
    assert.ok(await frameA.locator('input.proto-input').count() >= 3);
    await frameA.locator('[data-page-tab]').nth(1).click();
    await page.waitForTimeout(250);
    assert.equal(await frameA.locator('[data-page-panel="PAGE-LIST-2"]').isVisible(), true);
    assert.match(await frameA.locator('[data-page-panel="PAGE-LIST-2"]').innerText(), /报名/);
    await shot(page, 'journey-3', '02-a-management');
    const specA = readJson(path.join(projectDir, 'requirements', reqAId, 'interaction-spec.json'));
    assert.equal(specA.pages.length, 2);
    assert.deepEqual(specA.pages.map((item) => item.type), ['form', 'list']);
    assert.ok(specA.pages[0].fields.some((field) => field.name === '姓名'));
    await reviewAndDeliver(page, 'journey-3', { prefix: '03-a-' });
    deliveryA = fs.readdirSync(path.join(projectDir, 'deliveries'))[0];

    // 冻结验证：修改活产物后重新导出，历史交付不变
    const exportedProto = path.join(
      projectDir, 'deliveries', deliveryA, 'export', 'requirements', reqAId, 'artifacts', 'prototype.html'
    );
    const frozenHash = sha256File(exportedProto);
    fs.appendFileSync(
      path.join(projectDir, 'requirements', reqAId, 'artifacts', 'prototype.html'),
      '\n<!-- live modification after delivery -->\n'
    );
    await page.click('[data-testid="nav-deliveries"]');
    await page.waitForSelector(`[data-export-delivery="${deliveryA}"]`, { timeout: 20000 });
    await page.click(`[data-export-delivery="${deliveryA}"]`);
    await page.waitForTimeout(1500);
    assert.equal(sha256File(exportedProto), frozenHash, '重新导出改写了历史交付内容');
    await shot(page, 'journey-3', '04-a-frozen-reexport');

    // B：冲突 + 阻塞补答 + 保留现行规则
    await page.click('[data-testid="top-new-requirement"]');
    await page.waitForSelector('[data-testid="nr-title"]');
    await fillStable(page, '[data-testid="nr-title"]', '报名提交后允许再次修改', '需求标题');
    await fillStable(page, '[data-testid="nr-goal"]', '员工可以在报名提交后再次修改报名信息', '需求目标');
    await fillStable(page, '[data-testid="nr-raw"]', '报名提交后可以再次修改报名信息。', '需求原始输入');
    await page.click('[data-testid="nr-create"]');
    await page.waitForSelector('[data-testid="unknown-answer-0"]', { timeout: 35000 });
    await shot(page, 'journey-3', '05-b-blocked');
    for (let index = 0; index < 3; index += 1) {
      const input = page.locator('[data-testid="unknown-answer-0"]');
      if ((await input.count()) === 0) break;
      await input.fill('2 分钟，超时后拒绝');
      await page.click('[data-testid="unknown-save-0"]');
      await page.waitForTimeout(600);
    }
    await page.waitForSelector('[data-testid="decision-submit"]', { timeout: 30000 });
    await shot(page, 'journey-3', '06-b-keep-decision');
    await page.click('[data-testid="decision-keep"]');
    await fillStable(page, '[data-testid="decision-reason"]', '保持报名提交后不可修改的现行规则', '裁决理由');
    await page.click('[data-testid="decision-submit"]');
    await page.waitForSelector('[data-testid="req-generate"]', { timeout: 30000 });
    await page.click('[data-testid="req-generate"]');
    await page.waitForSelector('[data-testid="artifact-preview"]', { timeout: 30000 });
    reqBId = findRequirementId(projectDir, '报名提交后允许再次修改');
    const specB = readJson(path.join(projectDir, 'requirements', reqBId, 'interaction-spec.json'));
    assert.equal(specB.decision.action, 'keep');
    assert.equal(specB.effective_title, '按现行规则处理');
    assert.doesNotMatch(JSON.stringify(specB.pages), /再次修改/);
    assert.ok(specB.rules.every((rule) => rule.effective_state === 'current'));
    const docB = fs.readFileSync(path.join(projectDir, 'requirements', reqBId, 'requirement.md'), 'utf8');
    assert.match(docB, /保留现行规则/);
    assert.match(docB, /被否决口径/);
    await shot(page, 'journey-3', '07-b-keep-artifacts');
    await reviewAndDeliver(page, 'journey-3', { prefix: '08-b-' });
    const deliveries = fs.readdirSync(path.join(projectDir, 'deliveries'));
    deliveryB = deliveries.find((id) => id !== deliveryA);
    assert.ok(deliveryB);

    // Git 二次提交：提交后再次修改首个文件
    await page.click('[data-testid="nav-deliveries"]');
    await page.waitForSelector('[data-testid="git-init"]', { timeout: 20000 });
    await page.click('[data-testid="git-init"]');
    await page.waitForSelector('[data-testid="git-commit"]', { timeout: 20000 });
    await fillStable(page, '[data-testid="git-commit-message"]', 'feat: 活动报名首版与保留现行规则', '提交信息');
    await page.click('[data-testid="git-commit"]');
    await page.waitForTimeout(1500);
    fs.appendFileSync(path.join(projectDir, 'README.md'), '\n\n## 二次提交测试\n');
    await page.click('#delivery-refresh');
    await page.waitForSelector('[data-testid="git-commit"]', { timeout: 20000 });
    await fillStable(page, '[data-testid="git-commit-message"]', 'fix: 二次提交', '提交信息');
    await page.click('[data-testid="git-commit"]');
    await page.waitForTimeout(1500);
    const log = execFileSync('git', ['-C', projectDir, 'log', '--oneline']).toString().trim().split('\n');
    assert.ok(log.length >= 2, `提交数量不足：${log.join(' | ')}`);
    assert.match(log[0], /二次提交/);
    await shot(page, 'journey-3', '09-git-recommit');

    archiveVariant(projectDir, [reqAId, reqBId], [deliveryA, deliveryB]);
    assert.deepEqual(errors, [], `控制台错误：${errors.join('\n')}`);
    return { projectDir, requirementIds: [reqAId, reqBId], deliveryIds: [deliveryA, deliveryB], errors };
  } catch (error) {
    await dumpFailure(page, 'journey-3', error, logs);
    error.message = `[journey-3] ${error.message}`;
    throw error;
  } finally {
    await app.close().catch(() => {});
  }
}

async function main() {

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const journey of ['journey-1', 'journey-2', 'journey-3']) rmrf(path.join(EVIDENCE_DIR, journey));
  rmrf(path.join(EVIDENCE_DIR, 'summary.json'));
  console.log(`Proto Harness Agent E2E · ${RUN_LABEL} · electron ${PACKAGED_BINARY || 'dev'}`);
  const started = Date.now();
  const journey1 = await journeyOne();
  const journey2 = await journeyTwo();
  const journey3 = await journeyThree();
  const summary = {
    label: RUN_LABEL,
    packaged_binary: PACKAGED_BINARY || null,
    started_at: new Date(started).toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    journeys: {
      new_product: journey1,
      existing_project: journey2,
      distinct_requirement: journey3
    },
    checks: {
      conflict_bound_decision: true,
      planned_current_separated: true,
      artifacts_generated: true,
      delivery_exported: true,
      restart_resumed: true,
      git_commit_and_push: true,
      second_copy_resumed: true,
      import_source_untouched: true,
      no_secrets_in_export: true,
      distinct_requirement_multipage: true,
      unknown_answer_rebased: true,
      keep_decision_respected: true,
      delivery_frozen_on_reexport: true,
      git_second_commit: true
    }
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log('E2E PASS');
  console.log(JSON.stringify(summary.checks, null, 2));
}

main().catch((error) => {
  console.error('E2E FAILED');
  console.error(error.stack || error);
  process.exit(1);
});
