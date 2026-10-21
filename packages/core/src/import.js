import fs from 'node:fs';
import path from 'node:path';
import {
  atomicWriteJson, ensureDir, fail, makeId, nowIso, parseFrontmatter,
  sha256File, shortHash, slugify, stripMarkdown, toPosix, uniqueBy
} from './util.js';
import {
  createCapability, createDecision, createEvidence, createObject,
  createRuleRevision
} from './models.js';
import { ProjectStore } from './store.js';

const SUPPORTED = new Set(['.md', '.markdown', '.txt', '.json', '.html', '.htm', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.runtime', '.next', 'coverage', 'release']);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 4000;
const MAX_RAW_EXCERPT = 1800;
const RULE_MARKER = /(必须|不得|不能|禁止|仅|只允许|只能|需要|要求|支持|允许|可在|可再次|可重复|可重新|可以|无需|不应)/;

function listFiles(root, state = { count: 0, skipped: [], warnings: [] }, depth = 0) {
  if (depth > 8 || state.count >= MAX_FILES) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    state.warnings.push(`目录不可读：${root}（${error.code || error.message}）`);
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (state.count >= MAX_FILES) {
      state.warnings.push(`文件数达到上限 ${MAX_FILES}，其余未扫描`);
      break;
    }
    if (entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      state.skipped.push({ path: full, reason: '符号链接未跟随' });
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        state.skipped.push({ path: full, reason: '跳过目录' });
        continue;
      }
      files.push(...listFiles(full, state, depth + 1));
      continue;
    }
    if (!entry.isFile()) continue;
    state.count += 1;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED.has(ext)) {
      state.skipped.push({ path: full, reason: `不支持 ${ext || '无扩展名'}` });
      continue;
    }
    const stat = fs.statSync(full);
    if (stat.size > MAX_FILE_BYTES) {
      state.skipped.push({ path: full, reason: `超过 ${MAX_FILE_BYTES / 1024 / 1024} MB` });
      continue;
    }
    files.push({ path: full, ext, size: stat.size, mtime: stat.mtime.toISOString() });
  }
  return files;
}

function headingSections(markdown) {
  const lines = String(markdown || '').split('\n');
  const sections = [];
  let current = { heading: '', level: 0, lines: [], start: 1 };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(#{1,4})\s+(.*)$/);
    if (match) {
      if (current.heading || current.lines.length > 0) sections.push(current);
      current = {
        heading: match[2].trim(),
        level: match[1].length,
        lines: [],
        start: index + 2
      };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading || current.lines.length > 0) sections.push(current);
  return sections;
}

function cleanRuleLine(line) {
  return line.replace(/^([-*•]|\d+\.)\s+/, '').replace(/[。；;，,\s]+$/, '').trim();
}

function ruleLines(lines, { requireMarker = false } = {}) {
  return lines
    .map((line) => line.trim())
    .filter((line) => /^([-*•]|\d+\.)\s+/.test(line) || RULE_MARKER.test(line))
    .filter((line) => !requireMarker || RULE_MARKER.test(line))
    .map(cleanRuleLine)
    .filter((line) => line.length >= 4 && line.length <= 300);
}

function parseMarkdown(file, relative) {
  const text = fs.readFileSync(file.path, 'utf8');
  const { data, body } = parseFrontmatter(text);
  const sections = headingSections(body);
  const title = data.title || sections.find((item) => item.heading)?.heading || path.basename(file.path, file.ext);
  const candidates = [];
  const allRuleLines = ruleLines(body.split('\n'), { requireMarker: true });
  const summary = body.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 12 && !/^#/.test(line) && !/^[-*•]/.test(line) && !/^\d+\./.test(line)) || '';
  const ruleKey = data.rule_key || data.ruleKey || '';
  const status = data.status || (/(历史|旧方案|废弃)/.test(`${title}${relative}`) ? 'historical' : 'current');
  if (ruleKey) {
    candidates.push({
      id: `CAND-${shortHash(`${relative}-${ruleKey}`, 8)}`,
      rule_key: ruleKey,
      topic: title,
      statement: (allRuleLines.length > 0 ? allRuleLines : [stripMarkdown(body).slice(0, 240)]).join('；'),
      scope: sections.find((item) => /范围|适用/.test(item.heading))?.lines.join(' ').trim() || '',
      status,
      date: data.date || '',
      source_ref: relative,
      locator: data.date ? `frontmatter / ${data.date}` : '正文',
      heuristic: false,
      evidence_excerpt: stripMarkdown(body).slice(0, MAX_RAW_EXCERPT)
    });
  } else {
    for (const section of sections) {
      const lines = ruleLines(section.lines);
      if (lines.length === 0) continue;
      if (!/(规则|口径|约束|权限|字段|流程|边界|禁止|必须|例外)/.test(section.heading)) continue;
      candidates.push({
        id: `CAND-${shortHash(`${relative}-${section.heading}`, 8)}`,
        rule_key: '',
        topic: section.heading,
        statement: lines.join('；'),
        scope: '',
        status: /(历史|旧|废弃)/.test(section.heading) ? 'historical' : status,
        date: data.date || '',
        source_ref: relative,
        locator: section.heading,
        heuristic: true,
        evidence_excerpt: stripMarkdown(section.lines.join('\n')).slice(0, MAX_RAW_EXCERPT)
      });
    }
    if (candidates.length === 0 && allRuleLines.length > 0) {
      candidates.push({
        id: `CAND-${shortHash(relative, 8)}`,
        rule_key: '',
        topic: title,
        statement: allRuleLines.slice(0, 8).join('；'),
        scope: '',
        status,
        date: data.date || '',
        source_ref: relative,
        locator: '正文',
        heuristic: true,
        evidence_excerpt: stripMarkdown(body).slice(0, MAX_RAW_EXCERPT)
      });
    }
  }
  return {
    title,
    summary,
    text: stripMarkdown(body).slice(0, 20000),
    candidates,
    pages: [],
    tokens: [],
    headings: sections.map((item) => item.heading).filter(Boolean)
  };
}

function parseHtml(file, relative) {
  const html = fs.readFileSync(file.path, 'utf8');
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || path.basename(file.path, file.ext)).replace(/<[^>]+>/g, '').trim();
  const headings = [...html.matchAll(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => match[2].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidates = [];
  for (const heading of headings) {
    if (!/(规则|口径|约束|权限|字段|流程|边界)/.test(heading)) continue;
    const index = bodyText.indexOf(heading);
    const excerpt = bodyText.slice(Math.max(0, index + heading.length), Math.max(0, index + heading.length) + 500);
    const rules = excerpt.split(/[。；;]/).map(cleanRuleLine).filter((item) => RULE_MARKER.test(item)).slice(0, 6);
    if (rules.length === 0) continue;
    candidates.push({
      id: `CAND-${shortHash(`${relative}-${heading}`, 8)}`,
      rule_key: '',
      topic: heading,
      statement: rules.join('；'),
      scope: '',
      status: 'current',
      date: '',
      source_ref: relative,
      locator: `标题：${heading}`,
      heuristic: true,
      evidence_excerpt: excerpt.slice(0, MAX_RAW_EXCERPT)
    });
  }
  const tokens = [];
  const styleText = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join('\n');
  const colorRegex = /(#[0-9a-fA-F]{3,8})\b/g;
  let colorMatch;
  while ((colorMatch = colorRegex.exec(styleText)) !== null) {
    tokens.push({
      kind: 'color', value: colorMatch[1], usage: '页面内联样式',
      source_ref: relative, name: 'inline-color'
    });
  }
  return {
    title,
    text: bodyText.slice(0, 20000),
    candidates,
    pages: [{ path: relative, title, headings }],
    tokens: uniqueBy(tokens, (item) => `${item.kind}|${item.value}`).slice(0, 40),
    headings
  };
}

function parseJson(file, relative) {
  const text = fs.readFileSync(file.path, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      title: path.basename(file.path, file.ext), text: text.slice(0, 4000),
      candidates: [], pages: [], tokens: [],
      headings: [], warning: 'JSON 解析失败，按纯文本证据保存'
    };
  }
  const candidates = [];
  const rules = Array.isArray(data) ? data : (data.rules || data.businessRules || []);
  for (const [index, rule] of rules.entries()) {
    const statement = typeof rule === 'string' ? rule : (rule.statement || rule.content || rule.rule || '');
    if (!statement || !RULE_MARKER.test(statement)) continue;
    candidates.push({
      id: `CAND-${shortHash(`${relative}-${index}-${statement}`, 8)}`,
      rule_key: typeof rule === 'object' ? (rule.rule_key || rule.key || '') : '',
      topic: typeof rule === 'object' ? (rule.topic || rule.title || `规则 ${index + 1}`) : `规则 ${index + 1}`,
      statement: String(statement),
      scope: typeof rule === 'object' ? (rule.scope || '') : '',
      status: typeof rule === 'object' ? (rule.status || 'current') : 'current',
      date: typeof rule === 'object' ? (rule.date || '') : '',
      source_ref: relative,
      locator: `rules[${index}]`,
      heuristic: false,
      evidence_excerpt: JSON.stringify(rule).slice(0, MAX_RAW_EXCERPT)
    });
  }
  const tokens = [];
  const colors = data.tokens?.colors || data.colors || [];
  for (const item of colors) {
    const value = typeof item === 'string' ? item : item.value;
    if (/^#[0-9a-fA-F]{3,8}$/.test(String(value))) {
      tokens.push({
        kind: 'color', value: String(value),
        usage: (typeof item === 'object' && (item.usage || item.name)) || '声明颜色',
        source_ref: relative, name: (typeof item === 'object' && item.name) || 'color'
      });
    }
  }
  return {
    title: data.title || data.name || path.basename(file.path, file.ext),
    text: JSON.stringify(data, null, 2).slice(0, 20000),
    candidates,
    pages: [],
    tokens,
    headings: []
  };
}

function parseCss(file, relative) {
  const css = fs.readFileSync(file.path, 'utf8');
  const tokens = [];
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].replace(/\s+/g, ' ').trim().slice(0, 80);
    const declarations = match[2];
    const colors = declarations.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    for (const value of colors) {
      tokens.push({ kind: 'color', value, usage: selector, source_ref: relative, name: 'css-color', selector });
    }
    const radius = declarations.match(/border-radius\s*:\s*([^;]+)/i);
    if (radius) tokens.push({ kind: 'radius', value: radius[1].trim(), usage: selector, source_ref: relative, name: 'css-radius', selector });
    const font = declarations.match(/font-family\s*:\s*([^;]+)/i);
    if (font) tokens.push({ kind: 'font', value: font[1].trim(), usage: selector, source_ref: relative, name: 'css-font', selector });
  }
  return {
    title: path.basename(file.path, file.ext),
    text: css.slice(0, 20000),
    candidates: [],
    pages: [],
    tokens: uniqueBy(tokens, (item) => `${item.kind}|${item.value}|${item.usage}`).slice(0, 80),
    headings: []
  };
}

function detectConflicts(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = candidate.rule_key
      ? `key:${candidate.rule_key.toUpperCase()}`
      : `topic:${slugify(candidate.topic, 'topic', 48).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  const conflicts = [];
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    const normalized = new Set(items.map((item) => item.statement.replace(/\s+/g, '').replace(/[，。；;]/g, '')));
    if (normalized.size < 2) continue;
    const current = items.filter((item) => item.status === 'current');
    const historical = items.filter((item) => item.status !== 'current');
    const why = historical.length > 0 && current.length > 0
      ? `同一主题同时存在 ${current.length} 条当前口径与 ${historical.length} 条历史口径，材料日期不能代替业务裁决`
      : `同一主题存在 ${items.length} 条不同表述，需要确认当前口径`;
    const topicSource = current[0] || items[0];
    conflicts.push({
      id: `ICONFLICT-${shortHash(key, 8)}`,
      key,
      topic: topicSource.topic || topicSource.rule_key,
      heuristic: !items.some((item) => item.rule_key),
      candidates: items.map((item) => item.id),
      current_candidates: current.map((item) => item.id),
      historical_candidates: historical.map((item) => item.id),
      why,
      recommendation: current[0]?.id || items[0].id
    });
  }
  return conflicts;
}

export function scanProjectDirectory(sourceRoot) {
  const root = path.resolve(sourceRoot);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    throw fail('NOT_FOUND', `目录不存在：${root}`);
  }
  if (!stat.isDirectory()) throw fail('INVALID_INPUT', '导入来源必须是目录');
  const files = listFiles(root);
  const inventory = [];
  const evidence = [];
  const candidates = [];
  const pages = [];
  const tokens = [];
  const headings = [];
  const warnings = [];
  const skipped = [];
  let readmeText = '';
  let readmeTitle = '';
  let readmeSummary = '';
  for (const file of files) {
    const relative = toPosix(path.relative(root, file.path));
    let parsed;
    try {
      if (['.md', '.markdown', '.txt'].includes(file.ext)) parsed = parseMarkdown(file, relative);
      else if (['.html', '.htm'].includes(file.ext)) parsed = parseHtml(file, relative);
      else if (file.ext === '.json') parsed = parseJson(file, relative);
      else if (file.ext === '.css') parsed = parseCss(file, relative);
      else continue;
    } catch (error) {
      skipped.push({ path: relative, reason: `解析失败：${error.message}` });
      continue;
    }
    if (parsed.warning) warnings.push(`${relative}：${parsed.warning}`);
    if (/readme/i.test(relative)) {
      parsed.candidates = (parsed.candidates || []).filter((candidate) => candidate.rule_key);
    }
    const evidenceId = makeId('EVID', parsed.title || relative);
    const sourceType = file.ext === '.html' || file.ext === '.htm' ? 'html'
      : file.ext === '.json' ? 'structured'
        : file.ext === '.css' ? 'style' : 'markdown';
    inventory.push({
      path: relative, ext: file.ext, size: file.size, mtime: file.mtime,
      title: parsed.title, evidence_id: evidenceId
    });
    evidence.push(createEvidence({
      id: evidenceId,
      productId: null,
      title: parsed.title,
      sourceType,
      sourceRef: relative,
      portable: false,
      locator: parsed.headings?.slice(0, 3).join(' / ') || '文件',
      contentHash: sha256File(file.path).slice(0, 32),
      rawExcerpt: parsed.text.slice(0, MAX_RAW_EXCERPT),
      usage: /readme/i.test(relative) ? 'reference' : 'fact',
      sourceAbs: file.path
    }));
    for (const candidate of parsed.candidates) {
      candidates.push({
        ...candidate,
        evidence_id: evidenceId,
        evidence_refs: [evidenceId]
      });
    }
    pages.push(...parsed.pages);
    for (const token of parsed.tokens) tokens.push({ ...token, evidence_id: evidenceId });
    headings.push(...(parsed.headings || []));
    if (/readme/i.test(relative) && !readmeText) {
      readmeText = parsed.text;
      readmeTitle = parsed.title || '';
      readmeSummary = parsed.summary || '';
    }
  }
  const conflicts = detectConflicts(candidates);
  const productGuess = readmeTitle
    ? readmeTitle.slice(0, 60)
    : path.basename(root).replace(/[-_]/g, ' ');
  const endpointText = `${readmeText}\n${inventory.map((item) => item.path).join('\n')}`;
  const endpointGuesses = [];
  const endpointRules = [
    { test: /后台|管理端|配置端/, name: '管理后台', role: '产品运营', platform: 'Web' },
    { test: /APP|App|app|作业端|骑手|司机/, name: '作业端 App', role: '一线作业人员', platform: 'App' },
    { test: /小程序/, name: '小程序', role: '终端用户', platform: 'MiniProgram' },
    { test: /用户端|客户端/, name: '用户端', role: '终端用户', platform: 'App' }
  ];
  for (const item of endpointRules) {
    if (item.test.test(endpointText)) endpointGuesses.push({ name: item.name, role: item.role, platform: item.platform });
  }
  if (endpointGuesses.length === 0) endpointGuesses.push({ name: '管理后台', role: '产品运营', platform: 'Web' });
  if (candidates.length === 0) {
    warnings.push('没有从支持格式中提取到候选规则；仍可导入证据并手工补充业务规则。');
  }
  if (conflicts.length > 0) {
    warnings.push(`识别到 ${conflicts.length} 组待裁决口径，确认前不会进入当前基线。`);
  }
  return {
    source_root: root,
    scanned_at: nowIso(),
    limits: { max_files: MAX_FILES, max_file_bytes: MAX_FILE_BYTES, supported: [...SUPPORTED] },
    stats: {
      files_scanned: inventory.length,
      skipped: skipped.length,
      candidates: candidates.length,
      conflicts: conflicts.length,
      evidence: evidence.length
    },
    product_guess: productGuess,
    goal_guess: (readmeSummary || readmeText.split(/[。\n]/).filter((line) => line.trim().length > 12).slice(0, 2).join('；')).slice(0, 260),
    endpoints_guess: endpointGuesses,
    inventory,
    evidence,
    candidates,
    conflicts,
    pages,
    tokens: uniqueBy(tokens, (item) => `${item.kind}|${item.value}|${item.usage}`).slice(0, 100),
    headings: uniqueBy(headings, (item) => item).slice(0, 80),
    skipped,
    warnings
  };
}

function candidateToRule(candidate, { productId, baselineId, evidenceRefs, status }) {
  const baseId = candidate.rule_key
    ? `RULE-${slugify(candidate.rule_key, 'import', 30).toUpperCase()}-${shortHash(candidate.statement, 4).toUpperCase()}`
    : makeId('RULE', candidate.topic);
  return createRuleRevision({
    productId,
    ruleId: baseId,
    revision: 1,
    statement: candidate.statement,
    scope: candidate.scope,
    knowledgeStatus: status === 'current' ? 'confirmed' : 'superseded',
    effectiveState: status === 'current' ? 'current' : 'retired',
    baselineId: status === 'current' ? baselineId : null,
    constraints: [],
    evidenceRefs: evidenceRefs || candidate.evidence_refs || [],
    decisionRef: null,
    topic: candidate.topic,
    source: 'import'
  });
}

export function applyImport({
  targetRoot, scan, name, goal, endpoints, selectedCandidateIds = [],
  conflictResolutions = {}, sourceRoot = scan.source_root
}) {
  const selected = new Set(selectedCandidateIds);
  const currentCandidates = [];
  const historicalCandidates = [];
  const conflictDecisions = [];
  const resolutionByCandidate = new Map();

  for (const conflict of scan.conflicts || []) {
    const resolution = conflictResolutions[conflict.id];
    if (!resolution || !resolution.chosenCandidateId) {
      throw fail('INVALID_INPUT', `冲突「${conflict.topic}」尚未完成裁决`);
    }
    if (!String(resolution.reason || '').trim()) {
      throw fail('INVALID_INPUT', `冲突「${conflict.topic}」必须填写裁决理由`);
    }
    const groupCandidates = (scan.candidates || []).filter((item) => conflict.candidates.includes(item.id));
    const chosen = groupCandidates.find((item) => item.id === resolution.chosenCandidateId);
    if (!chosen) throw fail('INVALID_INPUT', '裁决选择不在冲突组内');
    currentCandidates.push(chosen);
    for (const candidate of groupCandidates) {
      if (candidate.id !== chosen.id) {
        historicalCandidates.push(candidate);
        resolutionByCandidate.set(candidate.id, chosen.id);
      }
    }
    conflictDecisions.push({ conflict, chosen, rejected: groupCandidates.filter((item) => item.id !== chosen.id), reason: resolution.reason });
  }

  for (const candidate of scan.candidates || []) {
    if ((scan.conflicts || []).some((conflict) => conflict.candidates.includes(candidate.id))) continue;
    if (!selected.has(candidate.id)) continue;
    if (candidate.status === 'historical') historicalCandidates.push(candidate);
    else currentCandidates.push(candidate);
  }

  const currentRules = [];
  const historicalRules = [];
  const currentByKey = new Map();
  for (const candidate of uniqueBy(currentCandidates, (item) => item.id)) {
    const rule = candidateToRule(candidate, {
      productId: null, baselineId: null, evidenceRefs: candidate.evidence_refs, status: 'current'
    });
    currentByKey.set(candidate.id, rule);
    currentRules.push(rule);
  }
  for (const candidate of uniqueBy(historicalCandidates, (item) => item.id)) {
    const winner = conflictDecisions.find((item) => item.rejected.some((rejected) => rejected.id === candidate.id));
    const rule = candidateToRule(candidate, {
      productId: null, baselineId: null, evidenceRefs: candidate.evidence_refs, status: 'historical'
    });
    rule.id = `${rule.id}-HIST-${shortHash(candidate.statement, 3).toUpperCase()}`;
    rule.topic = `${candidate.topic}（历史口径）`;
    rule.decision_ref = null;
    rule.history_note = winner ? `被「${winner.chosen.statement.slice(0, 60)}」替代` : '导入时标记为历史口径';
    historicalRules.push(rule);
  }

  const objects = uniqueBy(
    (scan.candidates || []).flatMap((candidate) => {
      const terms = candidate.topic.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
      return terms.filter((term) => /(订单|取件码|包裹|柜格|柜机|账单|客户|账户|库存|设备|车辆|工单|审批|合同|发票|员工|门店|站点|仓库)/.test(term));
    }),
    (item) => item
  ).slice(0, 8).map((name) => createObject({ productId: null, name }));

  const capabilities = uniqueBy(currentRules, (rule) => rule.topic || rule.id).slice(0, 6).map((rule) => (
    createCapability({
      productId: null,
      name: `已导入能力：${rule.topic || rule.id}`,
      goal: '承接已有项目规则，作为后续需求分析依据',
      objectRefs: [],
      ruleRefs: [{ id: rule.id, revision: rule.revision }],
      endpointRefs: [],
      evidenceRefs: rule.evidence_refs || []
    })
  ));

  const store = ProjectStore.create({
    root: targetRoot,
    name,
    goal: goal || scan.goal_guess || `接入 ${path.basename(sourceRoot)} 的业务资产`,
    audience: '',
    constraints: ['导入过程不修改原始项目目录'],
    endpoints,
    evidence: scan.evidence,
    objects,
    capabilities,
    rules: currentRules,
    baselineName: '导入基线',
    formedBy: 'import',
    sourceRoots: [{ path: sourceRoot, label: '导入来源', portable: false, imported_at: nowIso() }],
    openQuestions: (scan.conflicts || []).length > 0
      ? scan.conflicts.map((item) => ({ question: item.why, resolved: true, resolution: conflictResolutions[item.id]?.reason || '' }))
      : []
  });

  for (const rule of historicalRules) {
    store.saveRuleRevision({
      ...rule,
      product_id: store.project.id,
      baseline_id: null
    });
  }

  const currentByStatement = new Map(currentRules.map((rule) => [rule.statement, rule]));
  const historicalByStatement = new Map(historicalRules.map((rule) => [rule.statement, rule]));
  for (const item of conflictDecisions) {
    const chosenRule = currentByStatement.get(item.chosen.statement);
    const rejected = item.rejected
      .map((candidate) => historicalByStatement.get(candidate.statement))
      .filter(Boolean);
    const decision = createDecision({
      productId: store.project.id,
      requirementId: null,
      proposalHash: shortHash(JSON.stringify({
        conflict: item.conflict.id,
        chosen: item.chosen.id,
        rejected: item.rejected.map((candidate) => candidate.id)
      }), 32),
      baseRevision: 0,
      chosen: { action: 'adopt', condition: '' },
      reason: item.reason,
      confirmedBy: 'user',
      conflictContext: {
        kind: 'import-conflict',
        topic: item.conflict.topic,
        chosen_candidate: item.chosen.id,
        rejected_candidates: item.rejected.map((candidate) => ({ id: candidate.id, statement: candidate.statement }))
      }
    });
    store.saveDecision({
      ...decision,
      applied_at: nowIso(),
      result: {
        action: 'import-conflict-resolved',
        baseline_id: store.project.current_baseline_id,
        rule_refs: chosenRule ? [{ id: chosenRule.id, revision: chosenRule.revision }] : [],
        superseded_rule_refs: rejected.map((rule) => ({ id: rule.id, revision: rule.revision }))
      }
    });
    if (chosenRule) {
      const saved = store.getRule(chosenRule.id);
      store.saveRuleRevision({
        ...saved,
        decision_ref: decision.id,
        supersedes: rejected[0] ? { id: rejected[0].id, revision: rejected[0].revision } : saved.supersedes
      });
    }
    for (const rejectedRule of rejected) {
      const saved = store.getRule(rejectedRule.id);
      store.saveRuleRevision({
        ...saved,
        decision_ref: decision.id,
        history_note: `被「${String(chosenRule?.statement || item.chosen.statement).slice(0, 80)}」替代`
      });
    }
  }

  const report = {
    source_root: sourceRoot,
    imported_at: nowIso(),
    stats: scan.stats,
    selected_candidate_ids: [...selected],
    conflicts: (scan.conflicts || []).map((conflict) => ({
      id: conflict.id,
      topic: conflict.topic,
      why: conflict.why,
      chosen: conflictResolutions[conflict.id].chosenCandidateId,
      reason: conflictResolutions[conflict.id].reason
    })),
    current_rule_ids: currentRules.map((rule) => rule.id),
    historical_rule_ids: historicalRules.map((rule) => rule.id),
    warnings: scan.warnings,
    skipped: scan.skipped
  };
  atomicWriteJson(store.resolve('brain/import-report.json'), report);
  atomicWriteJson(store.resolve('design/source-css-spec.json'), {
    source_root: sourceRoot,
    imported_at: nowIso(),
    entries: scan.tokens || [],
    note: '从来源项目静态扫描得到的声明值；不是浏览器计算值。'
  });
  atomicWriteJson(store.resolve('brain/asset-map.json'), {
    source_root: sourceRoot,
    generated_at: nowIso(),
    inventory: scan.inventory || [],
    pages: scan.pages || [],
    token_count: (scan.tokens || []).length,
    skipped: scan.skipped || [],
    note: '来源目录保持原样；本映射只记录引用关系，不复制或改写原始资产。'
  });
  store.activity({
    type: 'project.imported',
    summary: `从 ${sourceRoot} 导入 ${currentRules.length} 条当前规则、${historicalRules.length} 条历史口径`,
    ref: store.project.id
  });
  store.rebuildIndex();
  return { store, report, currentRules, historicalRules };
}

export { SUPPORTED, MAX_FILE_BYTES, MAX_FILES };
