import fs from 'node:fs';
import path from 'node:path';
import {
  ensureDir, atomicWriteJson, atomicWriteText, readJson, readJsonIfExists,
  nowIso, fail, safeResolve, relativeTo, sha256File, exists
} from './util.js';
import {
  SCHEMA, createBaseline, createProject, validateRuleRevision
} from './models.js';

const DIRS = [
  'brain/evidence',
  'brain/objects',
  'brain/capabilities',
  'brain/rules',
  'brain/baselines',
  'brain/decisions',
  'requirements',
  'artifacts',
  'deliveries',
  'design',
  '.runtime'
];

function assertSafeId(id, label = 'id') {
  if (!id || /[\\/]|\.\./.test(String(id))) {
    throw fail('INVALID_INPUT', `${label} 非法：${id}`);
  }
}

export class ProjectStore {
  constructor(root, project) {
    this.root = path.resolve(root);
    this.project = project;
  }

  static create({
    root, name, goal, audience, constraints = [], endpoints = [], evidence = [],
    objects = [], capabilities = [], rules = [], baselineName = '初始基线',
    sourceRoots = [], openQuestions = [], formedBy = 'user', projectId = null
  }) {
    const resolved = path.resolve(root);
    if (exists(path.join(resolved, 'project.json'))) {
      throw fail('INVALID_INPUT', `目录已包含 Proto Harness 项目：${resolved}`);
    }
    ensureDir(resolved);
    for (const dir of DIRS) ensureDir(path.join(resolved, dir));

    const project = createProject({
      name, goal, audience, constraints, endpoints, sourceRoots, openQuestions
    });
    if (projectId) project.id = projectId;
    const store = new ProjectStore(resolved, project);

    for (const item of evidence) {
      store.saveEvidence({ ...item, id: item.id, created_at: item.created_at || nowIso() });
    }
    for (const item of objects) store.saveObject(item);
    for (const item of capabilities) store.saveCapability(item);

    const baselineId = createBaseline({
      productId: project.id,
      name: baselineName,
      status: 'current',
      ruleRefs: rules.map((rule) => ({ id: rule.id, revision: rule.revision })),
      capabilityRefs: capabilities.map((cap) => ({ id: cap.id, revision: 1 })),
      formedBy,
      activatedAt: nowIso()
    }).id;

    for (const rule of rules) {
      const record = {
        ...rule,
        product_id: project.id,
        baseline_id: baselineId
      };
      validateRuleRevision(record);
      store.saveRuleRevision(record);
    }

    const baseline = createBaseline({
      productId: project.id,
      name: baselineName,
      status: 'current',
      ruleRefs: rules.map((rule) => ({ id: rule.id, revision: rule.revision })),
      capabilityRefs: capabilities.map((cap) => ({ id: cap.id, revision: 1 })),
      formedBy,
      activatedAt: nowIso()
    });
    baseline.id = baselineId;
    store.saveBaseline(baseline);
    project.current_baseline_id = baselineId;
    store.saveProject();

    atomicWriteText(path.join(resolved, '.gitignore'), '.runtime/\nrelease/\n.DS_Store\n');
    atomicWriteText(path.join(resolved, 'README.md'), [
      `# ${project.name}`,
      '',
      project.goal,
      '',
      '## 项目结构',
      '',
      '- `project.json`：产品、端与当前基线指针',
      '- `brain/`：证据、对象、能力、规则版本、基线与裁决',
      '- `requirements/`：需求任务与产物',
      '- `deliveries/`：固定交付版本',
      '- `.runtime/`：可重建索引与运行日志，不进入 Git',
      '',
      '本目录由 Proto Harness Agent 创建。业务记录是权威数据；请勿手工删除裁决与历史版本。',
      ''
    ].join('\n'));
    store.activity({ type: 'project.created', summary: `创建产品 ${project.name}` });
    store.rebuildIndex();
    return store;
  }

  static open(root) {
    const resolved = path.resolve(root);
    const projectPath = path.join(resolved, 'project.json');
    if (!exists(projectPath)) {
      throw fail('NOT_FOUND', `不是 Proto Harness 项目目录：${resolved}`);
    }
    const project = readJson(projectPath);
    if (project.schema_version !== SCHEMA.project) {
      throw fail('INVALID_INPUT', `不支持的项目格式：${project.schema_version}`);
    }
    const store = new ProjectStore(resolved, project);
    for (const dir of DIRS) ensureDir(path.join(resolved, dir));
    return store;
  }

  static list(projectsRoot) {
    const root = path.resolve(projectsRoot);
    if (!exists(root)) return [];
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(root, entry.name, 'project.json');
      if (!exists(projectPath)) continue;
      try {
        const project = readJson(projectPath);
        const store = new ProjectStore(path.join(root, entry.name), project);
        result.push({ ...store.summary(), path: store.root });
      } catch (error) {
        result.push({
          id: entry.name, name: entry.name, path: path.join(root, entry.name),
          error: error.message, goal: '', current_baseline_id: null, counts: {}, pending: 0
        });
      }
    }
    return result.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  get projectFile() {
    return path.join(this.root, 'project.json');
  }

  saveProject(patch = {}) {
    const nextRevision = Number.isInteger(patch.revision)
      ? patch.revision
      : Number(this.project.revision || 1) + 1;
    this.project = {
      ...this.project,
      ...patch,
      updated_at: nowIso(),
      revision: nextRevision
    };
    atomicWriteJson(this.projectFile, this.project);
    return this.project;
  }

  getProduct() {
    return this.project;
  }

  endpointById(id) {
    return (this.project.endpoints || []).find((item) => item.id === id) || null;
  }

  updateProject(patch) {
    return this.saveProject(patch);
  }

  resolve(relPath) {
    return safeResolve(this.root, relPath);
  }

  rel(absPath) {
    return relativeTo(this.root, absPath);
  }

  // --- evidence / objects / capabilities ---

  saveEvidence(evidence) {
    assertSafeId(evidence.id, 'evidence.id');
    const record = { ...evidence, product_id: evidence.product_id || this.project.id };
    atomicWriteJson(this.resolve(`brain/evidence/${record.id}.json`), record);
    return record;
  }

  getEvidence(id) {
    assertSafeId(id, 'evidence.id');
    return readJsonIfExists(this.resolve(`brain/evidence/${id}.json`));
  }

  listEvidence() {
    return this.readDirJson('brain/evidence');
  }

  saveObject(object) {
    assertSafeId(object.id, 'object.id');
    const record = { ...object, product_id: object.product_id || this.project.id, updated_at: nowIso() };
    atomicWriteJson(this.resolve(`brain/objects/${record.id}.json`), record);
    return record;
  }

  listObjects() {
    return this.readDirJson('brain/objects');
  }

  saveCapability(capability) {
    assertSafeId(capability.id, 'capability.id');
    const record = { ...capability, product_id: capability.product_id || this.project.id, updated_at: nowIso() };
    atomicWriteJson(this.resolve(`brain/capabilities/${record.id}.json`), record);
    return record;
  }

  listCapabilities() {
    return this.readDirJson('brain/capabilities');
  }

  // --- rules ---

  ruleDir(ruleId) {
    assertSafeId(ruleId, 'rule.id');
    return this.resolve(`brain/rules/${ruleId}`);
  }

  saveRuleRevision(rule) {
    validateRuleRevision(rule);
    const dir = this.ruleDir(rule.id);
    ensureDir(dir);
    atomicWriteJson(path.join(dir, `r-${rule.revision}.json`), rule);
    const index = this.getRuleIndex(rule.id) || { id: rule.id, revisions: [] };
    if (!index.revisions.includes(rule.revision)) index.revisions.push(rule.revision);
    index.revisions.sort((a, b) => a - b);
    index.latest_revision = index.revisions[index.revisions.length - 1];
    index.topic = rule.topic || index.topic || '';
    index.updated_at = nowIso();
    atomicWriteJson(path.join(dir, 'index.json'), index);
    return rule;
  }

  getRuleIndex(ruleId) {
    return readJsonIfExists(path.join(this.ruleDir(ruleId), 'index.json'));
  }

  getRule(ruleId, revision) {
    const index = this.getRuleIndex(ruleId);
    if (!index) return null;
    const target = revision == null ? index.latest_revision : Number(revision);
    return readJsonIfExists(path.join(this.ruleDir(ruleId), `r-${target}.json`));
  }

  listRules({ latestOnly = true } = {}) {
    const base = this.resolve('brain/rules');
    if (!exists(base)) return [];
    const rules = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (latestOnly) {
        const rule = this.getRule(entry.name);
        if (rule) rules.push(rule);
      } else {
        const index = this.getRuleIndex(entry.name);
        for (const revision of index?.revisions || []) {
          const rule = this.getRule(entry.name, revision);
          if (rule) rules.push(rule);
        }
      }
    }
    return rules.sort((a, b) => String(a.topic || a.id).localeCompare(String(b.topic || b.id), 'zh'));
  }

  // --- baselines ---

  saveBaseline(baseline) {
    assertSafeId(baseline.id, 'baseline.id');
    const record = { ...baseline, updated_at: nowIso() };
    atomicWriteJson(this.resolve(`brain/baselines/${record.id}.json`), record);
    return record;
  }

  getBaseline(id) {
    assertSafeId(id, 'baseline.id');
    return readJsonIfExists(this.resolve(`brain/baselines/${id}.json`));
  }

  listBaselines() {
    return this.readDirJson('brain/baselines')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  getCurrentBaseline() {
    return this.project.current_baseline_id ? this.getBaseline(this.project.current_baseline_id) : null;
  }

  setCurrentBaseline(baselineId, { activatedBy = 'user' } = {}) {
    const baseline = this.getBaseline(baselineId);
    if (!baseline) throw fail('NOT_FOUND', `基线不存在：${baselineId}`);
    const now = nowIso();
    for (const item of this.listBaselines()) {
      if (item.status === 'current' && item.id !== baselineId) {
        this.saveBaseline({ ...item, status: 'retired', retired_at: now });
      }
    }
    this.saveBaseline({
      ...baseline,
      status: 'current',
      activated_at: now,
      activated_by: activatedBy
    });
    this.saveProject({ current_baseline_id: baselineId });
    this.activity({ type: 'baseline.activated', summary: `切换当前基线：${baseline.name}`, ref: baselineId });
    return this.getBaseline(baselineId);
  }

  // --- decisions ---

  saveDecision(decision) {
    assertSafeId(decision.id, 'decision.id');
    const record = { ...decision, product_id: decision.product_id || this.project.id };
    atomicWriteJson(this.resolve(`brain/decisions/${record.id}.json`), record);
    return record;
  }

  getDecision(id) {
    assertSafeId(id, 'decision.id');
    return readJsonIfExists(this.resolve(`brain/decisions/${id}.json`));
  }

  listDecisions() {
    return this.readDirJson('brain/decisions')
      .sort((a, b) => String(b.confirmed_at).localeCompare(String(a.confirmed_at)));
  }

  // --- requirements ---

  requirementDir(requirementId) {
    assertSafeId(requirementId, 'requirement.id');
    return this.resolve(`requirements/${requirementId}`);
  }

  saveRequirement(requirement, { snapshot = true } = {}) {
    assertSafeId(requirement.id, 'requirement.id');
    const dir = this.requirementDir(requirement.id);
    ensureDir(dir);
    ensureDir(path.join(dir, 'history'));
    const record = { ...requirement, updated_at: nowIso() };
    atomicWriteJson(path.join(dir, 'requirement.json'), record);
    if (snapshot) {
      atomicWriteJson(path.join(dir, 'history', `r-${record.revision}.json`), record);
    }
    return record;
  }

  getRequirement(id) {
    assertSafeId(id, 'requirement.id');
    return readJsonIfExists(path.join(this.requirementDir(id), 'requirement.json'));
  }

  listRequirements() {
    const base = this.resolve('requirements');
    if (!exists(base)) return [];
    const out = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const req = this.getRequirement(entry.name);
      if (req) out.push(req);
    }
    return out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  saveRequirementProposal(requirementId, proposal) {
    atomicWriteJson(path.join(this.requirementDir(requirementId), 'proposal.json'), proposal);
    return proposal;
  }

  getRequirementProposal(requirementId) {
    return readJsonIfExists(path.join(this.requirementDir(requirementId), 'proposal.json'));
  }

  saveRequirementFile(requirementId, filename, content) {
    const dir = this.requirementDir(requirementId);
    ensureDir(dir);
    const target = safeResolve(dir, filename);
    if (typeof content === 'string' || Buffer.isBuffer(content)) {
      ensureDir(path.dirname(target));
      atomicWriteText(target, content);
    } else {
      atomicWriteJson(target, content);
    }
    return relativeTo(this.root, target);
  }

  readRequirementFile(requirementId, relativeName) {
    return fs.readFileSync(safeResolve(this.requirementDir(requirementId), relativeName), 'utf8');
  }

  // --- artifacts / deliveries ---

  saveArtifact(artifact) {
    assertSafeId(artifact.id, 'artifact.id');
    atomicWriteJson(this.resolve(`artifacts/${artifact.id}.json`), artifact);
    return artifact;
  }

  getArtifact(id) {
    assertSafeId(id, 'artifact.id');
    return readJsonIfExists(this.resolve(`artifacts/${id}.json`));
  }

  listArtifacts(requirementId = null) {
    const items = this.readDirJson('artifacts');
    return requirementId ? items.filter((item) => item.requirement_id === requirementId) : items;
  }

  deliveryDir(deliveryId) {
    assertSafeId(deliveryId, 'delivery.id');
    return this.resolve(`deliveries/${deliveryId}`);
  }

  saveDelivery(delivery) {
    assertSafeId(delivery.id, 'delivery.id');
    const dir = this.deliveryDir(delivery.id);
    ensureDir(dir);
    const record = { ...delivery, updated_at: nowIso() };
    atomicWriteJson(path.join(dir, 'delivery.json'), record);
    return record;
  }

  getDelivery(id) {
    assertSafeId(id, 'delivery.id');
    return readJsonIfExists(path.join(this.deliveryDir(id), 'delivery.json'));
  }

  listDeliveries() {
    const base = this.resolve('deliveries');
    if (!exists(base)) return [];
    const out = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const item = readJsonIfExists(path.join(base, entry.name, 'delivery.json'));
      if (item) out.push(item);
    }
    return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  // --- runtime ---

  activity(event) {
    const line = JSON.stringify({ at: nowIso(), ...event });
    const file = this.resolve('.runtime/activity.jsonl');
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  }

  readActivity(limit = 30) {
    const file = this.resolve('.runtime/activity.jsonl');
    if (!exists(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map((line) => {
      try { return JSON.parse(line); } catch { return { summary: line }; }
    });
  }

  rebuildIndex() {
    const rules = this.listRules();
    const requirements = this.listRequirements();
    const artifacts = this.listArtifacts();
    const deliveries = this.listDeliveries();
    const index = {
      rebuilt_at: nowIso(),
      product_id: this.project.id,
      current_baseline_id: this.project.current_baseline_id,
      counts: {
        evidence: this.listEvidence().length,
        objects: this.listObjects().length,
        capabilities: this.listCapabilities().length,
        rules: rules.length,
        baselines: this.listBaselines().length,
        decisions: this.listDecisions().length,
        requirements: requirements.length,
        artifacts: artifacts.length,
        deliveries: deliveries.length
      },
      requirements: requirements.map((item) => ({
        id: item.id, title: item.title, status: item.status,
        baseline_id: item.baseline_id, updated_at: item.updated_at
      }))
    };
    atomicWriteJson(this.resolve('.runtime/index.json'), index);
    return index;
  }

  summary() {
    const requirements = this.listRequirements();
    const pending = requirements.filter((item) => item.status === 'awaiting_decision').length;
    const current = this.getCurrentBaseline();
    return {
      id: this.project.id,
      name: this.project.name,
      goal: this.project.goal,
      audience: this.project.audience,
      current_baseline_id: this.project.current_baseline_id,
      current_baseline_name: current?.name || null,
      counts: {
        rules: this.listRules().length,
        objects: this.listObjects().length,
        capabilities: this.listCapabilities().length,
        evidence: this.listEvidence().length,
        requirements: requirements.length,
        deliveries: this.listDeliveries().length
      },
      pending,
      updated_at: this.project.updated_at
    };
  }

  fileDigest(relPath) {
    const abs = this.resolve(relPath);
    return exists(abs) ? sha256File(abs) : null;
  }

  readDirJson(relDir) {
    const dir = this.resolve(relDir);
    if (!exists(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        out.push(readJson(path.join(dir, entry.name)));
      } catch {
        // 损坏文件不影响其余记录；由 rebuildIndex / 诊断显示
      }
    }
    return out;
  }
}

export { assertSafeId, DIRS };
