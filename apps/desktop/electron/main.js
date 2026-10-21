import {
  app, BrowserWindow, Menu, dialog, ipcMain, protocol, safeStorage, session, shell
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

function debugLog(message) {
  if (!process.env.PHA_DEBUG_LOG) return;
  try {
    fs.appendFileSync(process.env.PHA_DEBUG_LOG, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // 调试日志失败不影响启动
  }
}
debugLog('main: module start');

if (process.env.PHA_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.PHA_USER_DATA));
}
app.setName('Proto Harness Agent');

protocol.registerSchemesAsPrivileged([{
  scheme: 'pha-preview',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
}]);

async function loadModule(candidates) {
  for (const candidate of candidates) {
    const abs = path.resolve(HERE, candidate);
    if (fs.existsSync(abs)) return import(pathToFileURL(abs).href);
  }
  throw new Error(`无法加载模块：${candidates.join(' / ')}`);
}

let core;
let runtime;
let createSettingsStore;

const openedStores = new Map();
const previewRoots = new Map();
let settings;
let mainWindow = null;

function publicKey(root) {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12);
}

function previewUrl(root, relPath) {
  const key = publicKey(root);
  const encoded = String(relPath).split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `pha-preview://artifact/${key}/${encoded}`;
}

function registerStore(store) {
  openedStores.set(store.root, store);
  previewRoots.set(publicKey(store.root), store.root);
  return store;
}

function allowedProjectPath(root) {
  if (!root) return false;
  const resolved = path.resolve(root);
  const projectsRoot = path.resolve(settings.projectsRoot());
  if (core.isInside(projectsRoot, resolved)) return true;
  return settings.recentProjects().some((item) => path.resolve(item) === resolved);
}

function ensureStore(root) {
  if (!root) throw core.fail('INVALID_INPUT', '缺少项目路径');
  const resolved = path.resolve(root);
  if (openedStores.has(resolved)) return openedStores.get(resolved);
  if (!allowedProjectPath(resolved)) {
    throw core.fail('PATH_OUTSIDE_PROJECT', '项目不在已授权的工作目录或最近项目中');
  }
  return registerStore(core.ProjectStore.open(resolved));
}

function uniqueTargetRoot(name) {
  const projectsRoot = path.resolve(settings.projectsRoot());
  fs.mkdirSync(projectsRoot, { recursive: true });
  const base = core.slugify(name, 'product', 48);
  let candidate = path.join(projectsRoot, base);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(projectsRoot, `${base}-${index}`);
    index += 1;
  }
  return candidate;
}

function adapterFromSettings() {
  return runtime.createAdapter(settings.modelConfig());
}

function stripRaw(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const { raw_model_output: ignored, ...rest } = analysis;
  return rest;
}

function readOptional(store, requirementId, file) {
  try {
    return store.readRequirementFile(requirementId, file);
  } catch {
    return null;
  }
}

async function requirementDetail(root, requirementId) {
  const store = ensureStore(root);
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw core.fail('NOT_FOUND', '需求不存在');
  const proposal = store.getRequirementProposal(requirementId);
  const artifacts = (requirement.artifact_refs || []).map((id) => store.getArtifact(id)).filter(Boolean)
    .map((artifact) => ({
      ...artifact,
      exists: fs.existsSync(store.resolve(artifact.path)),
      preview_url: artifact.type === 'prototype' ? previewUrl(store.root, artifact.path) : null
    }));
  const analysisRaw = readOptional(store, requirementId, 'analysis.json');
  const analysis = analysisRaw ? JSON.parse(analysisRaw).analysis : null;
  const cssSpecRaw = readOptional(store, requirementId, 'artifacts/css-spec.json');
  const specRaw = readOptional(store, requirementId, 'interaction-spec.json');
  const mappingRaw = readOptional(store, requirementId, 'artifacts/mapping.json');
  const doc = readOptional(store, requirementId, 'requirement.md');
  const context = core.resolveContext(store, { requirementId });
  const baseline = store.getBaseline(requirement.baseline_id);
  const decision = proposal?.decision_id
    ? store.getDecision(proposal.decision_id)
    : store.listDecisions().find((item) => item.requirement_id === requirementId) || null;
  return {
    requirement,
    proposal,
    decision,
    artifacts,
    analysis: stripRaw(analysis),
    cssSpec: cssSpecRaw ? JSON.parse(cssSpecRaw) : null,
    spec: specRaw ? JSON.parse(specRaw) : null,
    mapping: mappingRaw ? JSON.parse(mappingRaw) : null,
    document: doc,
    baseline,
    rules: context.rules,
    history: context.history,
    evidence: context.evidence,
    deliverables: store.listDeliveries().filter((item) => item.requirement_id === requirementId),
    preview_url: previewUrl(store.root, `requirements/${requirementId}/artifacts/prototype.html`)
  };
}

async function projectOpenPayload(root) {
  const store = ensureStore(root);
  settings.addRecent(store.root);
  return {
    root: store.root,
    summary: store.summary(),
    dashboard: core.dashboard(store),
    git: await core.gitStatus(store.root),
    endpoints: store.project.endpoints,
    current_baseline: store.getCurrentBaseline()
  };
}

async function appInfo() {
  let gitVersion = null;
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 5000 });
    gitVersion = stdout.trim();
  } catch {
    gitVersion = null;
  }
  const which = async (binary) => {
    try {
      const { stdout } = await execFileAsync('which', [binary], { timeout: 3000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };
  const penPath = ['/Applications/Pen.app', path.join(app.getPath('home'), 'Applications/Pen.app')]
    .find((item) => fs.existsSync(item)) || null;
  const adapter = adapterFromSettings();
  return {
    app: {
      name: 'Proto Harness Agent',
      version: app.getVersion(),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome
    },
    storage: {
      userData: app.getPath('userData'),
      projectsRoot: settings.projectsRoot(),
      safeStorage: safeStorage.isEncryptionAvailable(),
      settingsFile: settings.settingsFile()
    },
    tools: {
      git: gitVersion,
      pen: penPath || await which('pen'),
      opencode: await which('opencode')
    },
    model: adapter.describe ? adapter.describe() : null
  };
}

function registerIpc() {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return { ok: true, data: await fn(payload) };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: error.code || 'INTERNAL',
            message: error.message || String(error),
            details: error.details || null
          }
        };
      }
    });
  };

  handle('settings:get', async () => settings.publicSettings());
  handle('settings:update', async (payload) => settings.update(payload));
  handle('settings:test-model', async () => {
    const adapter = adapterFromSettings();
    if (adapter.describe().kind === 'local-heuristic') {
      return { ok: true, note: '本地规则分析器可用；不会调用任何模型服务。' };
    }
    if (!adapter.describe().configured) {
      throw core.fail('RUNTIME_NOT_CONFIGURED', '请先填写模型服务地址、模型 ID 与 API Key');
    }
    const raw = await adapter.testConnection();
    return { ok: true, note: '模型服务连接成功', raw };
  });

  handle('app:info', async () => appInfo());
  handle('app:open-guide', async () => {
    const guidePath = app.isPackaged
      ? path.join(process.resourcesPath, 'user-guide.md')
      : path.join(APP_ROOT, 'docs', 'user-guide.md');
    if (!fs.existsSync(guidePath)) throw core.fail('MISSING_RESOURCE', '用户手册未随安装包提供');
    const error = await shell.openPath(guidePath);
    if (error) throw core.fail('INTERNAL', error);
    return { path: guidePath };
  });

  handle('projects:list', async () => {
    const projectsRoot = settings.projectsRoot();
    fs.mkdirSync(projectsRoot, { recursive: true });
    const list = core.ProjectStore.list(projectsRoot);
    const seen = new Set(list.map((item) => path.resolve(item.path)));
    for (const recent of settings.recentProjects()) {
      const resolved = path.resolve(recent);
      if (seen.has(resolved)) continue;
      try {
        const store = core.ProjectStore.open(resolved);
        list.push({ ...store.summary(), path: resolved, external: true });
        seen.add(resolved);
      } catch {
        // 最近项目已移动或删除；保留不报错
      }
    }
    return list;
  });

  handle('projects:create', async (payload) => {
    if (!payload.analysis) throw core.fail('INVALID_INPUT', '缺少产品分析结果');
    const targetRoot = uniqueTargetRoot(payload.name);
    const store = core.createProductFromAnalysis({
      targetRoot,
      name: payload.name,
      goal: payload.goal,
      audience: payload.audience,
      constraints: payload.constraints || [],
      endpoints: payload.endpoints || [],
      references: payload.references || [],
      analysis: payload.analysis,
      selectedStatements: payload.selectedStatements,
      unknownAnswers: payload.unknownAnswers || {},
      baselineName: payload.baselineName || '初始基线'
    });
    registerStore(store);
    settings.addRecent(store.root);
    store.activity({ type: 'app.project_created', summary: '客户端完成新建产品' });
    return { root: store.root, summary: store.summary() };
  });

  handle('projects:import-scan', async (payload) => {
    if (!payload.sourceRoot) throw core.fail('INVALID_INPUT', '请选择要接入的项目目录');
    const scan = core.scanProjectDirectory(payload.sourceRoot);
    return scan;
  });

  handle('projects:import-apply', async (payload) => {
    if (!payload.sourceRoot) throw core.fail('INVALID_INPUT', '缺少来源目录');
    const scan = core.scanProjectDirectory(payload.sourceRoot);
    const targetRoot = uniqueTargetRoot(payload.name || scan.product_guess);
    const applied = core.applyImport({
      targetRoot,
      scan,
      name: payload.name || scan.product_guess,
      goal: payload.goal || scan.goal_guess,
      endpoints: payload.endpoints || scan.endpoints_guess,
      selectedCandidateIds: payload.selectedCandidateIds || [],
      conflictResolutions: payload.conflictResolutions || {},
      sourceRoot: payload.sourceRoot
    });
    registerStore(applied.store);
    settings.addRecent(applied.store.root);
    applied.store.activity({ type: 'app.project_imported', summary: '客户端完成已有项目接入' });
    return {
      root: applied.store.root,
      summary: applied.store.summary(),
      report: applied.report
    };
  });

  handle('projects:open', async (payload) => projectOpenPayload(payload.root));
  handle('projects:forget', async (payload) => {
    settings.forget(payload.root);
    return settings.publicSettings();
  });

  handle('analysis:product', async (payload) => {
    const adapter = adapterFromSettings();
    const analysis = await adapter.analyzeProduct({
      product: payload.product,
      references: payload.references || []
    });
    return analysis;
  });

  handle('brain:list', async (payload) => {
    const store = ensureStore(payload.root);
    const rules = store.listRules().map((rule) => {
      const index = store.getRuleIndex(rule.id);
      return { ...rule, revision_count: index?.revisions?.length || 1 };
    });
    const importReport = (() => {
      try {
        return JSON.parse(fs.readFileSync(store.resolve('brain/import-report.json'), 'utf8'));
      } catch {
        return null;
      }
    })();
    return {
      root: store.root,
      project: store.project,
      endpoints: store.project.endpoints,
      summary: store.summary(),
      current_baseline: store.getCurrentBaseline(),
      baselines: store.listBaselines(),
      rules,
      objects: store.listObjects(),
      capabilities: store.listCapabilities(),
      evidence: store.listEvidence().map((item) => ({
        ...item, raw_excerpt: String(item.raw_excerpt || '').slice(0, 900)
      })),
      decisions: store.listDecisions(),
      import_report: importReport
    };
  });

  handle('brain:rule', async (payload) => {
    const store = ensureStore(payload.root);
    const index = store.getRuleIndex(payload.ruleId);
    if (!index) throw core.fail('NOT_FOUND', '规则不存在');
    const revisions = index.revisions.map((revision) => store.getRule(payload.ruleId, revision)).filter(Boolean);
    const baselines = store.listBaselines().filter((baseline) => (
      baseline.rule_refs || []
    ).some((ref) => ref.id === payload.ruleId));
    const evidenceIds = [...new Set(revisions.flatMap((rule) => rule.evidence_refs || []))];
    const evidence = evidenceIds.map((id) => store.getEvidence(id)).filter(Boolean)
      .map((item) => ({ ...item, raw_excerpt: String(item.raw_excerpt || '').slice(0, 900) }));
    const decisionIds = [...new Set(revisions.map((rule) => rule.decision_ref).filter(Boolean))];
    const decisions = decisionIds.map((id) => store.getDecision(id)).filter(Boolean);
    return { rule_id: payload.ruleId, revisions, baselines, evidence, decisions };
  });

  handle('brain:decide', async (payload) => {
    const store = ensureStore(payload.root);
    const decision = core.recordDecision(store, {
      requirementId: payload.requirementId,
      proposalHash: payload.proposalHash,
      baseRevision: payload.baseRevision,
      action: payload.action,
      reason: payload.reason,
      condition: payload.condition || ''
    });
    const result = core.applyDecision(store, decision.id);
    return {
      decision: store.getDecision(decision.id),
      result,
      requirement: store.getRequirement(payload.requirementId)
    };
  });

  handle('brain:activate-baseline', async (payload) => {
    const store = ensureStore(payload.root);
    const baseline = core.activateBaseline(store, payload.baselineId, {
      reason: payload.reason || '', confirmedBy: 'user'
    });
    return { baseline, project: store.project };
  });

  handle('requirements:list', async (payload) => {
    const store = ensureStore(payload.root);
    return store.listRequirements();
  });

  handle('requirements:get', async (payload) => requirementDetail(payload.root, payload.requirementId));

  handle('requirements:create', async (payload) => {
    const store = ensureStore(payload.root);
    return core.createRequirement(store, {
      title: payload.title,
      goal: payload.goal,
      rawInput: payload.rawInput || '',
      baselineId: payload.baselineId || null,
      endpointIds: payload.endpointIds || []
    });
  });

  handle('requirements:analyze', async (payload) => {
    const store = ensureStore(payload.root);
    const result = await core.analyzeRequirement(store, {
      requirementId: payload.requirementId,
      adapter: adapterFromSettings()
    });
    return {
      requirement: result.requirement,
      proposal: result.proposal,
      analysis: stripRaw(result.analysis)
    };
  });

  handle('requirements:answer-unknown', async (payload) => {
    const store = ensureStore(payload.root);
    return core.answerUnknown(store, payload);
  });

  handle('requirements:generate', async (payload) => {
    const store = ensureStore(payload.root);
    const result = await core.buildArtifactsForRequirement(store, payload.requirementId, {
      adapter: adapterFromSettings()
    });
    return {
      requirement: result.requirement,
      artifacts: result.artifacts,
      spec: result.spec,
      cssSpec: result.cssSpec
    };
  });

  handle('requirements:review', async (payload) => {
    const store = ensureStore(payload.root);
    return core.reviewRequirement(store, payload);
  });

  handle('deliveries:list', async (payload) => {
    const store = ensureStore(payload.root);
    return {
      deliveries: store.listDeliveries().map((delivery) => {
        const requirement = store.getRequirement(delivery.requirement_id);
        const exportDir = path.join(store.deliveryDir(delivery.id), 'export');
        const snapshot = delivery.display_snapshot || null;
        return {
          ...delivery,
          requirement_title: snapshot?.requirement?.title || requirement?.title || delivery.requirement_id,
          product_name: snapshot?.product?.name || null,
          baseline_name: snapshot?.baseline?.name || null,
          baseline_status: snapshot?.baseline?.status || null,
          export_exists: fs.existsSync(path.join(exportDir, 'index.html')),
          export_dir: exportDir
        };
      }),
      requirements: store.listRequirements().filter((item) => item.status === 'reviewed')
    };
  });

  handle('deliveries:create', async (payload) => {
    const store = ensureStore(payload.root);
    const sourceCommit = await core.gitHead(store.root);
    return core.createDeliveryRecord(store, {
      requirementId: payload.requirementId,
      sourceCommit
    });
  });

  handle('deliveries:export', async (payload) => {
    const store = ensureStore(payload.root);
    const result = core.exportDelivery(store, payload.deliveryId);
    return { ...result, export_dir: result.export_path };
  });

  handle('deliveries:open', async (payload) => {
    const store = ensureStore(payload.root);
    const delivery = store.getDelivery(payload.deliveryId);
    if (!delivery) throw core.fail('NOT_FOUND', '交付版本不存在');
    const exportDir = path.join(store.deliveryDir(delivery.id), 'export');
    if (!fs.existsSync(exportDir)) throw core.fail('MISSING_RESOURCE', '交付尚未导出');
    const error = await shell.openPath(exportDir);
    if (error) throw core.fail('INTERNAL', error);
    return { path: exportDir };
  });

  handle('git:status', async (payload) => core.gitStatus(ensureStore(payload.root).root));
  handle('git:init', async (payload) => core.gitInit(ensureStore(payload.root).root));
  handle('git:commit', async (payload) => core.gitCommit(ensureStore(payload.root).root, {
    paths: payload.paths, message: payload.message
  }));
  handle('git:push', async (payload) => core.gitPush(ensureStore(payload.root).root));

  handle('dialog:pick-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择目录'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  handle('dialog:pick-reference-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: '选择参考资料',
      filters: [{ name: '文本资料', extensions: ['md', 'markdown', 'txt', 'json', 'html', 'css'] }]
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => {
      const stat = fs.statSync(filePath);
      if (stat.size > 2 * 1024 * 1024) {
        return { path: filePath, title: path.basename(filePath), text: '', note: '文件超过 2 MB，未提取文本' };
      }
      return {
        path: filePath,
        title: path.basename(filePath),
        text: fs.readFileSync(filePath, 'utf8'),
        size: stat.size,
        note: ''
      };
    });
  });

  handle('shell:open-path', async (payload) => {
    const store = ensureStore(payload.root);
    const target = path.resolve(payload.path);
    if (!core.isInside(store.root, target)) throw core.fail('PATH_OUTSIDE_PROJECT', '只能打开项目内路径');
    if (!fs.existsSync(target)) throw core.fail('MISSING_RESOURCE', '路径不存在');
    const error = await shell.openPath(target);
    if (error) throw core.fail('INTERNAL', error);
    return { path: target };
  });

  handle('shell:show-item', async (payload) => {
    const store = ensureStore(payload.root);
    const target = path.resolve(payload.path);
    if (!core.isInside(store.root, target)) throw core.fail('PATH_OUTSIDE_PROJECT', '只能定位项目内路径');
    shell.showItemInFolder(target);
    return { path: target };
  });

  handle('shell:open-external', async (payload) => {
    if (!/^https?:\/\//i.test(payload.url || '')) throw core.fail('INVALID_INPUT', '只允许打开 http(s) 链接');
    await shell.openExternal(payload.url);
    return { url: payload.url };
  });
}

function registerPreviewProtocol() {
  protocol.handle('pha-preview', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'artifact') return new Response('Not found', { status: 404 });
      const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
      const key = segments.shift();
      const rel = segments.join('/');
      const root = previewRoots.get(key);
      if (!root) return new Response('Not found', { status: 404 });
      const store = openedStores.get(root);
      if (!store) return new Response('Not found', { status: 404 });
      if (!rel.startsWith('requirements/') || !rel.includes('/artifacts/')) {
        return new Response('Forbidden', { status: 403 });
      }
      const target = store.resolve(rel);
      if (!fs.existsSync(target)) return new Response('Not found', { status: 404 });
      const ext = path.extname(target).toLowerCase();
      const type = ext === '.html' ? 'text/html; charset=utf-8'
        : ext === '.css' ? 'text/css; charset=utf-8'
          : ext === '.json' ? 'application/json; charset=utf-8'
            : ext === '.js' ? 'text/javascript; charset=utf-8'
              : 'application/octet-stream';
      const headers = {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'"
      };
      return new Response(fs.readFileSync(target), { status: 200, headers });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1060,
    minHeight: 700,
    backgroundColor: '#F6F5F1',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    show: false,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  mainWindow.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') || !url.includes('/renderer/index.html')) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const sendRoute = (hash) => {
    if (mainWindow) mainWindow.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)};`);
  };
  const template = [
    {
      label: 'Proto Harness Agent',
      submenu: [
        { role: 'about', label: '关于 Proto Harness Agent' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: () => sendRoute('#/settings') },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    { role: 'editMenu', label: '编辑' },
    { role: 'viewMenu', label: '视图' },
    { role: 'windowMenu', label: '窗口' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  debugLog('main: loading core');
  core = await loadModule([
    '../packages/core/src/index.js',
    '../../../packages/core/src/index.js'
  ]);
  debugLog('main: loading runtime');
  runtime = await loadModule([
    '../packages/runtime-adapter/src/index.js',
    '../../../packages/runtime-adapter/src/index.js'
  ]);
  debugLog('main: loading settings');
  ({ createSettingsStore } = await import(pathToFileURL(path.join(HERE, 'settings.js')).href));
  debugLog('main: imports ready');

  debugLog('main: waiting for app ready');
  await app.whenReady();
  debugLog('main: app ready');
  settings = createSettingsStore(app);
  debugLog('main: settings ready');
  registerPreviewProtocol();
  debugLog('main: protocol ready');
  registerIpc();
  debugLog('main: ipc ready');
  buildMenu();
  app.setAboutPanelOptions({
    applicationName: 'Proto Harness Agent',
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    copyright: 'MIT · 本地优先的产品 Agent 客户端'
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  debugLog('main: creating window');
  createWindow();
  debugLog('main: window created');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

bootstrap().catch((error) => {
  debugLog(`main: bootstrap failed ${error?.stack || error}`);
  dialog.showErrorBox('Proto Harness Agent 启动失败', String(error?.stack || error));
  app.quit();
});
