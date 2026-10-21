import fs from 'node:fs';
import path from 'node:path';
import {
  atomicWriteJson, ensureDir, escapeHtml, fail, formatBytes, nowIso, sha256File
} from './util.js';
import { createDelivery } from './models.js';
import { htmlDocument, markdownToHtml } from './artifacts.js';

function assertArtifactsReady(store, requirement) {
  const artifacts = (requirement.artifact_refs || []).map((id) => store.getArtifact(id)).filter(Boolean);
  if (artifacts.length === 0) throw fail('DELIVERY_INCOMPLETE', '需求没有可交付产物');
  const missing = [];
  for (const artifact of artifacts) {
    const abs = store.resolve(artifact.path);
    if (!fs.existsSync(abs)) missing.push(artifact.path);
    if (artifact.state === 'stale') {
      throw fail('DELIVERY_INCOMPLETE', `产物已失效，需要重新生成：${artifact.path}`, { artifact_id: artifact.id });
    }
  }
  if (missing.length > 0) {
    throw fail('DELIVERY_INCOMPLETE', '交付清单存在缺失文件', { missing });
  }
  return artifacts;
}

export function buildManifest(store, requirement, artifacts, { deliveryId = null } = {}) {
  const deliveryDir = deliveryId ? store.deliveryDir(deliveryId) : null;
  return artifacts.map((artifact) => {
    const source = store.resolve(artifact.path);
    let target = source;
    let frozenPath = null;
    if (deliveryDir) {
      target = path.join(deliveryDir, 'frozen', artifact.path);
      ensureDir(path.dirname(target));
      fs.copyFileSync(source, target);
      frozenPath = path.posix.join('frozen', artifact.path.split(path.sep).join('/'));
    }
    const stat = fs.statSync(target);
    return {
      artifact_id: artifact.id,
      type: artifact.type,
      path: artifact.path,
      frozen_path: frozenPath,
      sha256: sha256File(target),
      size: stat.size,
      size_label: formatBytes(stat.size),
      state: artifact.state
    };
  });
}

export function createDeliveryRecord(store, { requirementId, sourceCommit = null }) {
  const requirement = store.getRequirement(requirementId);
  if (!requirement) throw fail('NOT_FOUND', '需求不存在');
  if (!['reviewed', 'delivered'].includes(requirement.status)) {
    throw fail('INVALID_INPUT', '只有已评审需求可以创建交付版本');
  }
  const artifacts = assertArtifactsReady(store, requirement);
  const ruleRefs = requirement.rule_refs || [];
  for (const ref of ruleRefs) {
    if (!store.getRule(ref.id, ref.revision)) {
      throw fail('DELIVERY_INCOMPLETE', `交付引用的规则缺失：${ref.id} r${ref.revision}`);
    }
  }
  const delivery = createDelivery({
    productId: store.project.id,
    requirementId,
    requirementRevision: requirement.revision,
    baselineId: requirement.baseline_id,
    ruleRefs,
    artifactRefs: artifacts.map((artifact) => artifact.id),
    manifest: [],
    sourceCommit,
    title: requirement.title
  });
  const dir = store.deliveryDir(delivery.id);
  ensureDir(dir);
  let manifest;
  try {
    manifest = buildManifest(store, requirement, artifacts, { deliveryId: delivery.id });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const saved = store.saveDelivery({ ...delivery, manifest });
  atomicWriteJson(path.join(dir, 'manifest.json'), {
    delivery_id: saved.id,
    requirement_id: requirement.id,
    baseline_id: requirement.baseline_id,
    rule_refs: ruleRefs,
    created_at: saved.created_at,
    files: manifest
  });
  store.activity({
    type: 'delivery.created',
    summary: `创建交付版本并冻结 ${manifest.length} 个文件：${requirement.title}`,
    ref: saved.id
  });
  return saved;
}

function cssSpecHtml(cssSpec) {
  const colors = cssSpec.entries.filter((item) => item.kind === 'color');
  const others = cssSpec.entries.filter((item) => item.kind !== 'color');
  const swatches = colors.map((item) => `
    <div class="swatch">
      <span class="chip" style="background:${escapeHtml(item.value)}"></span>
      <div><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.usage)}</span><em>${escapeHtml(item.origin)}${item.extraction ? ` / ${escapeHtml(item.extraction)}` : ''}</em></div>
    </div>`).join('');
  const rows = others.map((item) => `
    <tr><td>${escapeHtml(item.kind)}</td><td><code>${escapeHtml(item.value)}</code></td><td>${escapeHtml(item.usage)}</td><td>${escapeHtml(item.origin)}${item.extraction ? ` / ${escapeHtml(item.extraction)}` : ''}</td></tr>`).join('');
  return `<h2>CSS 规范</h2>
  <p>颜色按声明来源展示，不把静态扫描结果冒充浏览器计算值。</p>
  <div class="swatches">${swatches || '<p>没有颜色规范条目。</p>'}</div>
  <h3>其他规范</h3>
  <table><thead><tr><th>类型</th><th>值</th><th>用途</th><th>来源</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function deliveryIndexHtml({ store, delivery, requirement, baseline, rules, artifacts, cssSpec, warnings, requirementDocMarkdown = '' }) {
  const artifactRows = delivery.manifest.map((item) => `
    <tr><td>${escapeHtml(item.type)}</td><td><code>${escapeHtml(item.path)}</code></td><td>${escapeHtml(item.size_label)}</td><td><code>${escapeHtml(item.sha256.slice(0, 12))}</code></td></tr>`).join('');
  const ruleRows = rules.map((rule) => `
    <tr><td><code>${escapeHtml(rule.id)}</code></td><td>r${rule.revision}</td><td>${escapeHtml(rule.knowledge_status)}/${escapeHtml(rule.effective_state)}</td><td>${escapeHtml(rule.statement)}</td></tr>`).join('');
  const requirementHtml = markdownToHtml(requirementDocMarkdown);
  const body = `
    <div class="eyebrow">固定交付版本</div>
    <h1>${escapeHtml(requirement.title)}</h1>
    <p class="meta">产品：${escapeHtml(store.project.name)} · 基线：${escapeHtml(baseline?.name || delivery.baseline_id)}（${escapeHtml(baseline?.status || 'unknown')}） · 生成：${escapeHtml(delivery.created_at.slice(0, 19).replace('T', ' '))}</p>
    <div class="grid">
      <section><h2>交付内容</h2><table><thead><tr><th>类型</th><th>路径</th><th>大小</th><th>摘要</th></tr></thead><tbody>${artifactRows}</tbody></table></section>
      <section><h2>规则版本</h2><table><thead><tr><th>规则</th><th>修订</th><th>状态</th><th>正文</th></tr></thead><tbody>${ruleRows || '<tr><td colspan="4">本交付未引用规则版本。</td></tr>'}</tbody></table></section>
      <section>${cssSpecHtml(cssSpec)}</section>
      <section><h2>需求文档</h2><article class="doc">${requirementHtml}</article></section>
      <section><h2>未完成项与风险</h2>${warnings.length > 0 ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>本次导出未记录额外风险。</p>'}</section>
    </div>
    <p class="nav"><a href="requirements/${requirement.id}/artifacts/prototype.html">打开交互原型</a> · <a href="requirements/${requirement.id}/interaction-spec.json">交互规格 JSON</a> · <a href="requirements/${requirement.id}/requirement.md">需求文档 Markdown</a></p>`;
  return htmlDocument(`${requirement.title} · 交付`, body, `
    .eyebrow { color:var(--accent); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    .meta { color:var(--muted); font-size:13px; }
    .grid { display:grid; gap:28px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    th { text-align:left; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; border-bottom:1px solid var(--border); padding:8px; }
    td { border-bottom:1px solid #EFEDE6; padding:9px 8px; vertical-align:top; }
    .swatches { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:10px; }
    .swatch { display:flex; gap:10px; align-items:flex-start; border:1px solid var(--border); border-radius:10px; padding:10px; background:#fff; }
    .chip { width:34px; height:34px; border-radius:8px; border:1px solid rgba(0,0,0,.08); flex:none; }
    .swatch strong { display:block; font-family:ui-monospace,Menlo,monospace; font-size:12px; }
    .swatch span { display:block; font-size:12px; color:var(--muted); }
    .swatch em { display:block; font-size:10px; color:var(--accent); font-style:normal; margin-top:3px; }
    .doc { border-top:1px solid var(--border); padding-top:8px; }
    .nav { margin-top:28px; }
  `);
}

function scanForSecrets(text) {
  const patterns = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i,
    /authorization\s*:\s*bearer\s+[A-Za-z0-9._-]{10,}/i
  ];
  return patterns.some((pattern) => pattern.test(text));
}

export function exportDelivery(store, deliveryId, { warnings = [] } = {}) {
  const delivery = store.getDelivery(deliveryId);
  if (!delivery) throw fail('NOT_FOUND', '交付版本不存在');
  const requirement = store.getRequirement(delivery.requirement_id);
  if (!requirement) throw fail('NOT_FOUND', '交付关联需求不存在');
  const dir = store.deliveryDir(deliveryId);
  const exportDir = path.join(dir, 'export');
  fs.rmSync(exportDir, { recursive: true, force: true });
  ensureDir(exportDir);

  const missing = [];
  const tampered = [];
  for (const item of delivery.manifest) {
    if (!item.frozen_path) {
      throw fail('DELIVERY_INCOMPLETE', '该交付版本没有冻结内容，历史版本不可漂移，请重新创建交付', {
        delivery_id: deliveryId
      });
    }
    const source = path.join(dir, item.frozen_path);
    if (!fs.existsSync(source)) {
      missing.push(item.frozen_path);
      continue;
    }
    if (sha256File(source) !== item.sha256) {
      tampered.push(item.frozen_path);
      continue;
    }
    const target = path.join(exportDir, item.path);
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
  }
  if (missing.length > 0 || tampered.length > 0) {
    store.saveDelivery({
      ...delivery,
      status: 'failed',
      error: { code: 'DELIVERY_INCOMPLETE', missing, tampered }
    });
    throw fail('DELIVERY_INCOMPLETE', '交付冻结内容缺失或被修改', { missing, tampered });
  }

  const requirementDocEntry = delivery.manifest.find((item) => item.type === 'requirement-doc');
  const requirementDocMarkdown = requirementDocEntry?.frozen_path
    ? fs.readFileSync(path.join(dir, requirementDocEntry.frozen_path), 'utf8')
    : '';
  const cssSpec = JSON.parse(fs.readFileSync(path.join(exportDir, 'requirements', requirement.id, 'artifacts', 'css-spec.json'), 'utf8'));
  const baseline = store.getBaseline(delivery.baseline_id);
  const rules = (delivery.rule_refs || []).map((ref) => store.getRule(ref.id, ref.revision)).filter(Boolean);
  const artifactTypes = new Set(delivery.manifest.map((item) => item.type));
  const exportWarnings = [...warnings];
  if (!artifactTypes.has('prototype')) exportWarnings.push('本次交付没有 HTML 原型。');
  if (baseline?.status === 'planned') {
    exportWarnings.push('本次交付使用 planned 基线：规则已确认但尚未切换为当前生效；接收者需知晓生效状态。');
  }
  if (!delivery.source_commit) exportWarnings.push('交付未绑定 Git 提交；如需追溯请先提交项目文件。');
  const indexHtml = deliveryIndexHtml({
    store, delivery, requirement, baseline, rules, artifacts: delivery.manifest, cssSpec,
    warnings: exportWarnings, requirementDocMarkdown
  });
  if (scanForSecrets(indexHtml)) {
    store.saveDelivery({ ...delivery, status: 'failed', error: { code: 'DELIVERY_INCOMPLETE', message: '导出内容疑似包含密钥' } });
    throw fail('DELIVERY_INCOMPLETE', '导出内容疑似包含密钥，已停止');
  }
  fs.writeFileSync(path.join(exportDir, 'index.html'), indexHtml, 'utf8');
  const manifest = {
    delivery_id: delivery.id,
    requirement_id: requirement.id,
    requirement_revision: delivery.requirement_revision,
    baseline_id: delivery.baseline_id,
    baseline_status: baseline?.status || null,
    rule_refs: delivery.rule_refs,
    created_at: delivery.created_at,
    exported_at: nowIso(),
    files: delivery.manifest,
    warnings: exportWarnings
  };
  atomicWriteJson(path.join(exportDir, 'manifest.json'), manifest);

  const indexText = fs.readFileSync(path.join(exportDir, 'index.html'), 'utf8');
  const links = [...indexText.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1])
    .filter((link) => !/^(https?:|#|data:)/.test(link));
  const brokenLinks = links.filter((link) => !fs.existsSync(path.join(exportDir, link)));
  if (brokenLinks.length > 0) {
    store.saveDelivery({ ...delivery, status: 'failed', error: { code: 'MISSING_RESOURCE', brokenLinks } });
    throw fail('DELIVERY_INCOMPLETE', '静态交付存在断链', { brokenLinks });
  }
  const exported = store.saveDelivery({
    ...delivery,
    status: 'exported',
    exported_at: nowIso(),
    export_path: store.rel(exportDir),
    warnings: exportWarnings
  });
  const updatedRequirement = {
    ...requirement,
    status: 'delivered',
    next_step: '交付已导出，可继续创建新需求',
    delivery_refs: [...new Set([...(requirement.delivery_refs || []), deliveryId])],
    revision: requirement.revision + 1,
    updated_at: nowIso(),
    checkpoints: [...(requirement.checkpoints || []), {
      at: nowIso(), from: requirement.status, to: 'delivered',
      summary: `导出交付版本 ${deliveryId}`
    }]
  };
  store.saveRequirement(updatedRequirement);
  store.activity({
    type: 'delivery.exported',
    summary: `导出静态交付：${requirement.title}`,
    ref: deliveryId
  });
  store.rebuildIndex();
  return {
    delivery: exported,
    export_path: exportDir,
    warnings: exportWarnings,
    broken_links: []
  };
}

export function deliveryCheck(store, deliveryId) {
  const delivery = store.getDelivery(deliveryId);
  if (!delivery) throw fail('NOT_FOUND', '交付版本不存在');
  const dir = store.deliveryDir(deliveryId);
  const missing = [];
  const tampered = [];
  for (const item of delivery.manifest || []) {
    if (!item.frozen_path) {
      missing.push(`${item.path}（无冻结内容）`);
      continue;
    }
    const target = path.join(dir, item.frozen_path);
    if (!fs.existsSync(target)) {
      missing.push(item.frozen_path);
      continue;
    }
    if (sha256File(target) !== item.sha256) tampered.push(item.frozen_path);
  }
  return { ok: missing.length === 0 && tampered.length === 0, missing, tampered };
}
