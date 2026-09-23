#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 'h01-contract-validate-v1';
const SCHEMA_DIR = 'harness/engineering/schema';
const OWNER_REGISTRY_PATH = 'harness/engineering/owner-registry.json';
const SOURCE_MANIFEST_PATH = 'tests/harness/baselines/source-manifest.json';
const FIXTURES_MANIFEST = 'manifest.json';
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'minLength',
  'minItems', 'uniqueItems', 'required', 'properties', 'items', 'additionalProperties',
  'anyOf', 'oneOf', 'allOf', 'not'
]);
const EVIDENCE_KIND_PREFIX = {
  'A': 'authoritative-fact',
  'D': 'decision',
  'O': 'observation',
  'C': 'claimant-statement',
  'R': 'active-rule',
  'Q': 'question',
  'V': 'verification-result',
  'X': 'external-reference'
};
const SENSITIVE_PATTERNS = [
  /token/i, /api[_-]?key/i, /secret/i, /password/i, /passwd/i, /cookie/i,
  /authorization/i, /credential/i, /bearer\s+/i, /chain[_-]?of[_-]?thought/i,
  /hidden[_-]?thinking/i, /raw[_-]?chat/i, /access[_-]?token/i
];
const PRIMARY_ID_FIELDS = {
  evidence: 'evidence_id',
  task: 'task_id',
  capability: 'capability_id',
  permission: 'permission_id',
  trace: 'trace_id',
  result: 'result_id',
  checkpoint: 'checkpoint_id',
  ruleset: 'ruleset_id',
  epoch: 'epoch_id',
  'external-reference': 'reference_id',
  provider: 'provider_id'
};

function sha256String(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parseSingleValueCli(argv, requiredName) {
  let value;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== requiredName) throw new Error(`unknown argument: ${token}`);
    if (value !== undefined) throw new Error(`${requiredName} must be provided exactly once`);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${requiredName} requires a value`);
    value = next;
    index += 1;
  }
  if (value === undefined) throw new Error(`${requiredName} is required`);
  return value;
}

function projectRoot(cwd = process.cwd()) {
  return path.resolve(cwd);
}

function assertSafeFixturesDir(root, supplied) {
  if (path.isAbsolute(supplied)) throw new Error(`--fixtures must be a project-relative directory: ${supplied}`);
  const resolved = path.resolve(root, supplied);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`--fixtures escapes project root: ${supplied}`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`--fixtures must be a real directory: ${supplied}`);
  const realRoot = fs.realpathSync(root);
  const realFixtures = fs.realpathSync(resolved);
  const realRelative = path.relative(realRoot, realFixtures);
  if (realRelative === '' || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`--fixtures resolves outside project root via symlink: ${supplied}`);
  }
  return resolved;
}

// 读取 manifest/input 前必须通过：普通文件、非 symlink、非 hardlink（nlink===1）、realpath 位于 base 内。
function assertRegularFileWithin(baseRoot, filePath, label) {
  const relative = path.relative(baseRoot, filePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside fixtures root: ${filePath}`);
  }
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} must exist: ${filePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
  }
  if (stat.nlink !== 1) {
    throw new Error(`${label} must not be a hard link (nlink=1): ${filePath} (nlink=${stat.nlink})`);
  }
  const realBase = fs.realpathSync(baseRoot);
  const realFile = fs.realpathSync(filePath);
  const realRelative = path.relative(realBase, realFile);
  if (realRelative === '' || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`${label} resolves outside fixtures root via symlink: ${filePath}`);
  }
}

function collectSchemaKeywords(node, found, pathName) {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaKeywords(item, found, pathName);
    return;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key === 'properties') {
        for (const [propertyName, subSchema] of Object.entries(node.properties)) {
          collectSchemaKeywords(subSchema, found, `${pathName}.properties.${propertyName}`);
        }
        continue;
      }
      if (!SUPPORTED_KEYWORDS.has(key)) found.push(`${pathName}.${key}`);
      collectSchemaKeywords(node[key], found, `${pathName}.${key}`);
    }
  }
}

function loadSchemas(root) {
  const schemaDir = path.join(root, SCHEMA_DIR);
  const files = fs.readdirSync(schemaDir).filter((file) => file.endsWith('.schema.json')).sort();
  const schemas = [];
  const seenIds = new Set();
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
    } catch (error) {
      throw new Error(`SCHEMA_PARSE ${file}: ${error.message}`);
    }
    if (!parsed.$id) throw new Error(`SCHEMA_PARSE ${file}: missing $id`);
    if (seenIds.has(parsed.$id)) throw new Error(`SCHEMA_PARSE ${file}: duplicate $id ${parsed.$id}`);
    seenIds.add(parsed.$id);
    const unsupported = [];
    collectSchemaKeywords(parsed, unsupported, file);
    if (unsupported.length) {
      throw new Error(`SCHEMA_UNSUPPORTED_KEYWORD ${file}: ${unsupported.join(', ')}`);
    }
    schemas.push({ file, $id: parsed.$id, schema: parsed });
  }
  if (schemas.length !== 11) throw new Error(`SCHEMA_PARSE expected 11 schema files, found ${schemas.length}`);
  return schemas;
}

function validateAgainstSchema(value, schema, instancePath, errors, options = {}) {
  if (schema.type) {
    const typeMatches = (() => {
      switch (schema.type) {
        case 'string': return typeof value === 'string';
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'number': return typeof value === 'number';
        case 'boolean': return typeof value === 'boolean';
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'array': return Array.isArray(value);
        case 'null': return value === null;
        default: return true;
      }
    })();
    if (!typeMatches) {
      errors.push(`${instancePath}: type violation expected ${schema.type}`);
      return;
    }
  }
  if (schema.const !== undefined) {
    if (stableJson(value) !== stableJson(schema.const)) errors.push(`${instancePath}: const mismatch expected ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum) {
    if (!schema.enum.some((item) => stableJson(item) === stableJson(value))) errors.push(`${instancePath}: enum violation`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${instancePath}: pattern violation ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${instancePath}: minLength ${schema.minLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${instancePath}: minimum violation`);
  if (schema.type === 'object' || (value && typeof value === 'object' && !Array.isArray(value))) {
    const actual = value || {};
    if (schema.required) {
      for (const required of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(actual, required)) errors.push(`${instancePath}: missing required field ${required}`);
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(actual, key)) validateAgainstSchema(actual[key], subSchema, `${instancePath}.${key}`, errors, options);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(actual)) {
        if (!allowed.has(key)) errors.push(`${instancePath}: unknown field ${key}`);
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${instancePath}: minItems ${schema.minItems}`);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = stableJson(item);
        if (seen.has(key)) errors.push(`${instancePath}: uniqueItems violation`);
        seen.add(key);
      }
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) validateAgainstSchema(item, schema.items, `${instancePath}[${index}]`, errors, options);
    }
  }
  if (schema.anyOf) {
    if (!schema.anyOf.some((sub) => { const subErrors = []; validateAgainstSchema(value, sub, instancePath, subErrors, options); return subErrors.length === 0; })) {
      errors.push(`${instancePath}: anyOf violation`);
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => { const subErrors = []; validateAgainstSchema(value, sub, instancePath, subErrors, options); return subErrors.length === 0; });
    if (matches.length !== 1) errors.push(`${instancePath}: oneOf violation (${matches.length} matches)`);
  }
  if (schema.allOf) {
    for (const sub of schema.allOf) validateAgainstSchema(value, sub, instancePath, errors, options);
  }
  if (schema.not) {
    const subErrors = [];
    validateAgainstSchema(value, schema.not, instancePath, subErrors, options);
    if (subErrors.length === 0) errors.push(`${instancePath}: not violation`);
  }
}

function findSensitiveFields(value, pathName, findings) {
  if (typeof value === 'string') {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) findings.push(pathName);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) findSensitiveFields(item, `${pathName}[${index}]`, findings);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      findSensitiveFields(value[key], `${pathName}.${key}`, findings);
    }
  }
}

const OWNER_KINDS = new Set(['project-governance', 'user-decision', 'tooling', 'evidence', 'external-reference']);
const OWNER_STATUSES = new Set(['active', 'superseded']);
const REGISTRY_TOP_LEVEL_FIELDS = ['schema_version', 'registry_id', 'source_refs', 'owners', 'topics'];
const OWNER_REQUIRED_FIELDS = ['owner_id', 'topic', 'owner_kind', 'status', 'source_refs'];
const TOPIC_REQUIRED_FIELDS = ['topic_id', 'active_owner_id', 'status'];

function registryError({ topicId = '', ownerIds = [], ownerSourceRefs = [], path = '', expected = '', actual = '' }) {
  return {
    code: 'OWNER_CONFLICT',
    topic_id: topicId,
    owner_ids: [...ownerIds].sort(),
    owner_source_refs: [...ownerSourceRefs].sort(),
    path,
    expected,
    actual
  };
}

function loadSourceReferenceBasis(root) {
  const errors = [];
  const allowedSourceIds = new Set();
  const manifestPath = path.join(root, SOURCE_MANIFEST_PATH);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: SOURCE_MANIFEST_PATH, expected: 'readable JSON', actual: error.message });
    return { allowedSourceIds, errors };
  }
  if (!Array.isArray(manifest.sources)) {
    errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: `${SOURCE_MANIFEST_PATH}.sources`, expected: 'array', actual: String(typeof manifest.sources) });
  } else {
    const seenIds = new Set();
    for (const [index, source] of manifest.sources.entries()) {
      const sourcePath = `${SOURCE_MANIFEST_PATH}.sources[${index}]`;
      if (!source || typeof source.id !== 'string' || source.id.length === 0) {
        errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: `${sourcePath}.id`, expected: 'non-empty string', actual: String(source && source.id) });
        continue;
      }
      if (seenIds.has(source.id)) {
        errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: `${sourcePath}.id`, expected: 'unique source id', actual: source.id });
        continue;
      }
      seenIds.add(source.id);
      allowedSourceIds.add(source.id);
    }
  }
  const schemaDir = path.join(root, SCHEMA_DIR);
  let schemaFiles;
  try {
    schemaFiles = fs.readdirSync(schemaDir).filter((file) => file.endsWith('.schema.json')).sort();
  } catch (error) {
    errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: SCHEMA_DIR, expected: 'readable schema dir', actual: error.message });
    return { allowedSourceIds, errors };
  }
  for (const file of schemaFiles) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
    } catch (error) {
      errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: `${SCHEMA_DIR}/${file}`, expected: 'readable JSON schema', actual: error.message });
      continue;
    }
    if (typeof parsed.$id !== 'string' || parsed.$id.length === 0) {
      errors.push({ code: 'SOURCE_REFERENCE_BASIS', path: `${SCHEMA_DIR}/${file}.$id`, expected: 'non-empty $id', actual: String(parsed.$id) });
      continue;
    }
    if (/^urn:h01:[a-z-]+\.schema\.json$/.test(parsed.$id)) {
      allowedSourceIds.add(parsed.$id);
    }
  }
  return { allowedSourceIds, errors };
}

function validateRegistry(root, injectedRegistry, injectedBasis) {
  const registry = injectedRegistry || JSON.parse(fs.readFileSync(path.join(root, OWNER_REGISTRY_PATH), 'utf8'));
  const basis = injectedBasis || loadSourceReferenceBasis(root);
  const allowedSourceIds = basis.allowedSourceIds;
  const basisErrors = basis.errors || [];
  const errors = [];
  for (const basisError of basisErrors) {
    errors.push({ ...registryError({ path: basisError.path, expected: basisError.expected, actual: basisError.actual }), code: basisError.code });
  }
  const validateSourceRefList = (refs, refsPath, ownerIdsForDiag) => {
    if (!Array.isArray(refs) || refs.length === 0) {
      errors.push(registryError({ ownerIds: ownerIdsForDiag, path: refsPath, expected: 'non-empty string array', actual: JSON.stringify(refs) }));
      return;
    }
    const seen = new Set();
    for (const [refIndex, ref] of refs.entries()) {
      const refPath = `${refsPath}[${refIndex}]`;
      if (typeof ref !== 'string' || ref.length === 0) {
        errors.push(registryError({ ownerIds: ownerIdsForDiag, path: refPath, expected: 'non-empty string', actual: String(ref) }));
        continue;
      }
      if (seen.has(ref)) {
        errors.push(registryError({ ownerIds: ownerIdsForDiag, path: refPath, expected: 'unique source ref', actual: 'duplicate' }));
      }
      seen.add(ref);
      if (!allowedSourceIds.has(ref)) {
        errors.push(registryError({ ownerIds: ownerIdsForDiag, path: refPath, expected: 'H00A source manifest ID or actual H01 schema $id', actual: ref }));
      }
    }
  };
  for (const field of REGISTRY_TOP_LEVEL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(registry, field)) {
      errors.push(registryError({ path: field, expected: 'present top-level field', actual: 'missing' }));
    }
  }
  if (registry.schema_version !== 'h01-owner-registry-v1') {
    errors.push(registryError({ path: 'schema_version', expected: 'h01-owner-registry-v1', actual: String(registry.schema_version) }));
  }
  if (!Array.isArray(registry.owners)) {
    errors.push(registryError({ path: 'owners', expected: 'array', actual: String(typeof registry.owners) }));
  }
  if (!Array.isArray(registry.topics)) {
    errors.push(registryError({ path: 'topics', expected: 'array', actual: String(typeof registry.topics) }));
  }
  if (Array.isArray(registry.source_refs)) {
    validateSourceRefList(registry.source_refs, 'source_refs', []);
  } else {
    errors.push(registryError({ path: 'source_refs', expected: 'non-empty string array', actual: String(typeof registry.source_refs) }));
  }
  const ownerIds = new Set();
  const topicIds = new Set();
  const ownersByTopic = new Map();
  const ownersById = new Map();
  for (const [index, owner] of (registry.owners || []).entries()) {
    const ownerPath = `owners[${index}]`;
    if (!owner || typeof owner !== 'object') {
      errors.push(registryError({ path: ownerPath, expected: 'owner object', actual: String(owner) }));
      continue;
    }
    for (const field of OWNER_REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(owner, field)) {
        errors.push(registryError({ path: `${ownerPath}.${field}`, expected: `present field`, actual: 'missing' }));
      }
    }
    const ownerId = owner.owner_id;
    if (typeof ownerId === 'string' && ownerId.length > 0) {
      if (ownerIds.has(ownerId)) {
        errors.push(registryError({ ownerIds: [ownerId], path: `${ownerPath}.owner_id`, expected: 'globally unique owner_id', actual: 'duplicate' }));
      }
      ownerIds.add(ownerId);
      ownersById.set(ownerId, owner);
    }
    if (!OWNER_KINDS.has(owner.owner_kind)) {
      errors.push(registryError({ ownerIds: [ownerId], path: `${ownerPath}.owner_kind`, expected: `one of ${[...OWNER_KINDS].sort().join('|')}`, actual: String(owner.owner_kind) }));
    }
    if (!OWNER_STATUSES.has(owner.status)) {
      errors.push(registryError({ ownerIds: [ownerId], path: `${ownerPath}.status`, expected: `one of ${[...OWNER_STATUSES].sort().join('|')}`, actual: String(owner.status) }));
    }
    if (typeof owner.topic === 'string' && owner.topic.length > 0) {
      const list = ownersByTopic.get(owner.topic) || [];
      list.push(owner);
      ownersByTopic.set(owner.topic, list);
    }
    validateSourceRefList(owner.source_refs, `${ownerPath}.source_refs`, ownerId ? [ownerId] : []);
  }
  for (const [index, topic] of (registry.topics || []).entries()) {
    const topicPath = `topics[${index}]`;
    if (!topic || typeof topic !== 'object') {
      errors.push(registryError({ path: topicPath, expected: 'topic object', actual: String(topic) }));
      continue;
    }
    for (const field of TOPIC_REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(topic, field)) {
        errors.push(registryError({ path: `${topicPath}.${field}`, expected: 'present field', actual: 'missing' }));
      }
    }
    const topicId = topic.topic_id;
    if (typeof topicId === 'string' && topicId.length > 0) {
      if (topicIds.has(topicId)) {
        errors.push(registryError({ topicId, path: `${topicPath}.topic_id`, expected: 'globally unique topic_id', actual: 'duplicate' }));
      }
      topicIds.add(topicId);
    }
    if (!OWNER_STATUSES.has(topic.status)) {
      errors.push(registryError({ topicId, path: `${topicPath}.status`, expected: `one of ${[...OWNER_STATUSES].sort().join('|')}`, actual: String(topic.status) }));
    }
    if (topic.status === 'active' && typeof topic.active_owner_id === 'string') {
      const owner = ownersById.get(topic.active_owner_id);
      if (!owner) {
        errors.push(registryError({ topicId, path: `${topicPath}.active_owner_id`, expected: 'owner in owners', actual: String(topic.active_owner_id) }));
        continue;
      }
      if (owner.status !== 'active') {
        errors.push(registryError({ topicId, ownerIds: [owner.owner_id], ownerSourceRefs: owner.source_refs || [], path: `${topicPath}.active_owner_id`, expected: 'owner active', actual: String(owner.status) }));
      }
      if (owner.topic !== topicId) {
        errors.push(registryError({ topicId, ownerIds: [owner.owner_id], ownerSourceRefs: owner.source_refs || [], path: `${topicPath}.active_owner_id`, expected: `owner.topic === ${topicId}`, actual: String(owner.topic) }));
      }
    }
  }
  for (const [topicId, ownerList] of ownersByTopic) {
    const activeOwners = ownerList.filter((owner) => owner.status === 'active');
    if (activeOwners.length > 1) {
      errors.push(registryError({
        topicId,
        ownerIds: activeOwners.map((owner) => owner.owner_id),
        ownerSourceRefs: activeOwners.flatMap((owner) => owner.source_refs || []),
        path: `ownersByTopic[${topicId}]`,
        expected: 'exactly one active owner',
        actual: `${activeOwners.length} active owners`
      }));
    }
    const topic = (registry.topics || []).find((item) => item && item.topic_id === topicId);
    if (topic && topic.status === 'active') {
      if (activeOwners.length === 0) {
        errors.push(registryError({ topicId, path: `ownersByTopic[${topicId}]`, expected: 'at least one active owner for active topic', actual: 'no active owner' }));
      }
    } else if (!topic && activeOwners.length > 0) {
      errors.push(registryError({ topicId, ownerIds: activeOwners.map((owner) => owner.owner_id), ownerSourceRefs: activeOwners.flatMap((owner) => owner.source_refs || []), path: `ownersByTopic[${topicId}]`, expected: 'active owner maps to an active topic', actual: 'no such topic' }));
    }
    const topicOwnerIds = new Set();
    for (const owner of ownerList) {
      if (owner.topic !== topicId) continue;
      if (topicOwnerIds.has(owner.owner_id)) {
        errors.push(registryError({ topicId, ownerIds: [owner.owner_id], path: `ownersByTopic[${topicId}]`, expected: 'unique owner per topic', actual: 'duplicate owner' }));
      }
      topicOwnerIds.add(owner.owner_id);
    }
  }
  return { registry, errors, sha256: sha256String(stableJson(registry)) };
}

function detectSupersedesCycle(objects, idField, supersedesField) {
  const byId = new Map(objects.map((item) => [item[idField], item]));
  const visited = new Set();
  const stack = new Set();
  function visit(id, chain) {
    if (stack.has(id)) return { cycle: [...chain, id].slice(chain.indexOf(id)), id };
    if (visited.has(id)) return null;
    visited.add(id);
    stack.add(id);
    const item = byId.get(id);
    if (item && item[supersedesField]) {
      for (const ref of item[supersedesField]) {
        const found = visit(ref, [...chain, id]);
        if (found) return found;
      }
    }
    stack.delete(id);
    return null;
  }
  return visit(objects[0]?.[idField], []);
}

function semanticChecks(contract, value, fixtureId, errors, context) {
  const push = (code, pathName, expected, actual) => {
    errors.push({ code, fixture_id: fixtureId, path: pathName, expected, actual });
  };
  if (contract === 'evidence') {
    const id = typeof value.evidence_id === 'string' ? value.evidence_id : '';
    const prefix = id.split('-')[0];
    const expectedKind = EVIDENCE_KIND_PREFIX[prefix];
    if (expectedKind && value.kind !== expectedKind) {
      push('EVIDENCE_ROLE', 'kind', expectedKind, value.kind);
    }
    if (['O', 'C'].includes(prefix)) {
      if (!['observation', 'claimant'].includes(value.authority)) {
        push('EVIDENCE_ROLE', 'authority', 'observation or claimant', value.authority);
      }
    } else if (['A', 'D', 'R', 'V'].includes(prefix)) {
      if (!Array.isArray(value.source_refs) || value.source_refs.length === 0) {
        push('EVIDENCE_ROLE', 'source_refs', 'at least one source ref', JSON.stringify(value.source_refs));
      }
    }
    const status = value.status;
    const supersedes = value.supersedes;
    if (status === 'superseded') {
      if (!Array.isArray(supersedes) || supersedes.length === 0) {
        push('SCHEMA_VIOLATION', 'supersedes', 'non-empty unique array when status=superseded', JSON.stringify(supersedes));
      } else if (new Set(supersedes).size !== supersedes.length) {
        push('SCHEMA_VIOLATION', 'supersedes', 'unique ids', JSON.stringify(supersedes));
      } else {
        for (const ref of supersedes) {
          if (typeof ref !== 'string' || !/^(A|D|O|C|R|Q|V|X)-[A-Z0-9][A-Z0-9-]*$/.test(ref)) {
            push('SCHEMA_VIOLATION', 'supersedes', 'evidence ID format', String(ref));
          }
          if (ref === id) {
            push('SUPERSEDES_CYCLE', 'supersedes', 'no self reference', ref);
          }
        }
      }
    }
    if (Array.isArray(supersedes) && supersedes.length > 0) {
      const cycle = detectSupersedesCycle([value, ...context.evidences.filter((item) => item.evidence_id !== id)], 'evidence_id', 'supersedes');
      if (cycle && cycle.cycle.length >= 2) push('SUPERSEDES_CYCLE', 'supersedes', 'no cycle', cycle.cycle.join(' -> '));
    }
  }
  if (contract === 'permission') {
    if (value.status === 'AUTHORIZED') {
      const checks = [
        ['authorization_quote', typeof value.authorization_quote === 'string' && value.authorization_quote.length > 0],
        ['object', typeof value.object === 'string' && value.object.length > 0],
        ['actions', Array.isArray(value.actions) && value.actions.length > 0],
        ['valid_from', typeof value.valid_from === 'string' && value.valid_from.length > 0],
        ['valid_until', typeof value.valid_until === 'string' && value.valid_until.length > 0],
        ['forbidden_scopes', Array.isArray(value.forbidden_scopes)],
        ['issuer', typeof value.issuer === 'string' && value.issuer.length > 0],
        ['source_refs', Array.isArray(value.source_refs) && value.source_refs.length > 0]
      ];
      for (const [field, ok] of checks) {
        if (!ok) push('AUTHORIZED_INCOMPLETE', field, 'required for AUTHORIZED', JSON.stringify(value[field]));
      }
      if (value.valid_from && value.valid_until && value.valid_until <= value.valid_from) {
        push('AUTHORIZED_INCOMPLETE', 'valid_until', 'later than valid_from', value.valid_until);
      }
    }
  }
  if (contract === 'trace') {
    const missing = [];
    for (const field of ['ruleset_id', 'epoch_id', 'fixture_suite_ref', 'oracle_ref', 'adapter_ref']) {
      if (!value[field]) missing.push(field);
    }
    if (value.status === 'completed') {
      if (missing.length) push('TRACE_INCOMPLETE', missing[0], 'required for completed trace', 'missing');
      if (value.terminal_state !== 'COMPLETED') push('TRACE_INCOMPLETE', 'terminal_state', 'COMPLETED', value.terminal_state);
      const hasToolEvent = (value.events || []).some((event) => event.event_type === 'tool' || event.event_type === 'verification');
      if (!hasToolEvent) push('TRACE_INCOMPLETE', 'events', 'at least one tool or verification event', 'none');
    }
    const sequences = (value.events || []).map((event) => event.sequence);
    for (let index = 0; index < sequences.length; index += 1) {
      if (sequences[index] !== index + 1) push('TRACE_INCOMPLETE', `events[${index}].sequence`, index + 1, sequences[index]);
    }
    for (const [index, event] of (value.events || []).entries()) {
      if ((event.event_type === 'tool' || event.event_type === 'verification') && !event.tool_result) {
        push('TRACE_INCOMPLETE', `events[${index}].tool_result`, 'structured tool_result', 'missing');
      }
    }
  }
  if (contract === 'result') {
    if (value.status === 'SUCCEEDED') {
      if (!Array.isArray(value.completion_evidence_refs) || value.completion_evidence_refs.length === 0) {
        push('RESULT_WITHOUT_TRACE', 'completion_evidence_refs', 'non-empty for SUCCEEDED', JSON.stringify(value.completion_evidence_refs));
      } else {
        const trace = context.tracesByRun.get(value.trace_id);
        if (!trace) {
          push('RESULT_WITHOUT_TRACE', 'trace_id', 'trace must exist', value.trace_id);
        } else if (trace.status !== 'completed' || trace.terminal_state !== 'COMPLETED') {
          push('RESULT_WITHOUT_TRACE', 'trace_id', 'completed trace required', `${trace.status}/${trace.terminal_state}`);
        }
      }
    } else {
      if (!value.failure_code && !value.blocking_reason) {
        push('SCHEMA_VIOLATION', 'failure_code', 'failure_code or blocking_reason required', 'missing');
      }
    }
  }
  if (contract === 'ruleset') {
    const cycle = detectSupersedesCycle([value, ...context.rulesets.filter((item) => item.ruleset_id !== value.ruleset_id)], 'ruleset_id', 'supersedes');
    if (cycle) push('SUPERSEDES_CYCLE', 'supersedes', 'no cycle', cycle.cycle.join(' -> '));
  }
  if (contract === 'external-reference') {
    const id = typeof value.reference_id === 'string' ? value.reference_id : '';
    if (!id.startsWith('X-')) push('EXTERNAL_REFERENCE_FORMAT', 'reference_id', 'X- prefix', id);
    if (!value.locator) push('EXTERNAL_REFERENCE_FORMAT', 'locator', 'non-empty locator', JSON.stringify(value.locator));
    if (!value.reference_kind) push('EXTERNAL_REFERENCE_FORMAT', 'reference_kind', 'reference_kind required', 'missing');
  }
  if (contract === 'provider' || contract === 'epoch') {
    if (value.status === 'callable-confirmed') {
      push('SCHEMA_VIOLATION', 'status', 'selected-pending-smoke in H01', value.status);
    }
  }
  if (contract === 'provider') {
    const providerId = typeof value.provider_id === 'string' ? value.provider_id : '';
    if (providerId.startsWith('P-') && value.role === 'judge-selected') {
      push('EVIDENCE_ROLE', 'role', 'P-* must not use judge-selected', value.role);
    }
    if (providerId.startsWith('J-') && value.role === 'execution-selected') {
      push('EVIDENCE_ROLE', 'role', 'J-* must not use execution-selected', value.role);
    }
  }
  if (contract === 'epoch') {
    const providerRef = value.provider_ref;
    const judgeRef = value.judge_ref;
    const provider = typeof providerRef === 'string' ? context.providers.get(providerRef) : undefined;
    const judge = typeof judgeRef === 'string' ? context.providers.get(judgeRef) : undefined;
    if (!provider) {
      push('SCHEMA_VIOLATION', 'provider_ref', 'provider_ref must resolve to an execution provider', String(providerRef));
    } else {
      if (provider.role !== 'execution-selected') push('SCHEMA_VIOLATION', 'provider_ref', 'execution-selected provider', `${provider.role}`);
      if (provider.status !== 'selected-pending-smoke') push('SCHEMA_VIOLATION', 'provider_ref', 'selected-pending-smoke provider', String(provider.status));
    }
    if (!judge) {
      push('SCHEMA_VIOLATION', 'judge_ref', 'judge_ref must resolve to an independent judge provider', String(judgeRef));
    } else {
      if (judge.role !== 'judge-selected') push('SCHEMA_VIOLATION', 'judge_ref', 'judge-selected provider', `${judge.role}`);
      if (judge.status !== 'selected-pending-smoke') push('SCHEMA_VIOLATION', 'judge_ref', 'selected-pending-smoke judge', String(judge.status));
    }
    if (providerRef && judgeRef && providerRef === judgeRef) {
      push('SCHEMA_VIOLATION', 'judge_ref', 'provider and judge must differ', judgeRef);
    }
  }
  if (contract === 'checkpoint') {
    const checkpointId = value.checkpoint_id;
    const traceId = value.trace_id;
    const sequence = value.last_event_sequence;
    const trace = typeof traceId === 'string' ? context.tracesByRun.get(traceId) : undefined;
    const withCkpt = (pathName, expected, actual) => {
      push('TRACE_INCOMPLETE', pathName, `checkpoint_id=${checkpointId}; ${expected}`, actual);
    };
    if (value.resumable === true || value.resumable === false) {
      if (!trace) {
        withCkpt('trace_id', 'checkpoint must reference an existing trace', `trace_id=${traceId}`);
      } else {
        if (!Number.isInteger(sequence) || sequence < 1) {
          withCkpt('last_event_sequence', 'positive integer', `last_event_sequence=${sequence}`);
        } else {
          const events = trace.events || [];
          const event = events.find((item) => item.sequence === sequence);
          if (!event) {
            withCkpt('last_event_sequence', `existing event sequence in ${traceId}`, `last_event_sequence=${sequence}`);
          } else {
            const expectedState = event.state_to;
            if (value.state !== expectedState) {
              withCkpt('state', `state_to of event ${sequence} in ${traceId}`, `state=${value.state}; actual event state_to=${expectedState}`);
            }
          }
        }
      }
    } else {
      withCkpt('resumable', 'boolean', `resumable=${value.resumable}`);
    }
  }
  const sensitive = [];
  findSensitiveFields(value, '', sensitive);
  if (sensitive.length) {
    const reported = sensitive.find((field) => field !== '') || 'value';
    push('SENSITIVE_FIELD', reported, 'no sensitive field', 'found');
  }
}

function main(argv = process.argv.slice(2)) {
  let fixturesDir;
  try {
    fixturesDir = parseSingleValueCli(argv, '--fixtures');
  } catch (error) {
    console.error(JSON.stringify({ code: 'CLI_ARGUMENT', message: error.message }, null, 2));
    process.exitCode = 1;
    return;
  }
  const root = projectRoot();
  let fixturesRoot;
  try {
    fixturesRoot = assertSafeFixturesDir(root, fixturesDir);
  } catch (error) {
    console.error(JSON.stringify({ code: 'CLI_ARGUMENT', message: error.message }, null, 2));
    process.exitCode = 1;
    return;
  }
  const allErrors = [];
  let schemaCount = 0;
  let fixtureCount = 0;
  let passed = 0;
  let failed = 0;
  try {
    const schemas = loadSchemas(root);
    schemaCount = schemas.length;
    const sourceBasis = loadSourceReferenceBasis(root);
    const { registry, errors: registryErrors, sha256: ownerRegistrySha256 } = validateRegistry(root, undefined, sourceBasis);
    for (const registryErrorItem of registryErrors) {
      allErrors.push({ ...registryErrorItem, fixture_id: 'owner-registry' });
      failed += 1;
    }
    const manifestPath = path.join(fixturesRoot, FIXTURES_MANIFEST);
    try {
      assertRegularFileWithin(fixturesRoot, manifestPath, 'manifest');
    } catch (error) {
      allErrors.push({ code: 'CLI_ARGUMENT', fixture_id: '<manifest>', path: FIXTURES_MANIFEST, expected: 'regular non-symlink non-hardlink file inside fixtures root', actual: error.message });
      failed += 1;
      const result = {
        schema_version: SCHEMA_VERSION,
        status: 'failed',
        schema_count: schemaCount,
        fixture_count: 0,
        passed: 0,
        failed,
        errors: allErrors,
        owner_registry_sha256: ownerRegistrySha256
      };
      console.error(JSON.stringify({ status: 'failed', errors: allErrors }, null, 2));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schema_version !== 'h01-contract-fixtures-v1') throw new Error(`SCHEMA_PARSE fixtures manifest schema_version must be h01-contract-fixtures-v1`);
    const cases = manifest.cases || [];
    const seenFixtureIds = new Set();
    const knownErrorCodes = new Set(['SCHEMA_VIOLATION', 'EVIDENCE_ROLE', 'SENSITIVE_FIELD', 'AUTHORIZED_INCOMPLETE', 'TRACE_INCOMPLETE', 'RESULT_WITHOUT_TRACE', 'SUPERSEDES_CYCLE', 'EXTERNAL_REFERENCE_FORMAT', 'DUPLICATE_ID', 'OWNER_CONFLICT', 'DETERMINISM_MISMATCH', 'SOURCE_REFERENCE_BASIS']);
    for (const [index, fixture] of cases.entries()) {
      if (!fixture.expected_error_codes) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id || `<case ${index}>`, path: 'expected_error_codes', expected: 'array', actual: 'missing' });
        failed += 1;
        continue;
      }
      if (!Array.isArray(fixture.expected_error_codes)) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id || `<case ${index}>`, path: 'expected_error_codes', expected: 'array', actual: String(typeof fixture.expected_error_codes) });
        failed += 1;
        continue;
      }
      if (fixture.expected === 'valid' && fixture.expected_error_codes.length !== 0) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id, path: 'expected_error_codes', expected: 'empty for valid case', actual: fixture.expected_error_codes.join(',') });
        failed += 1;
        continue;
      }
      if (fixture.expected === 'invalid' && fixture.expected_error_codes.length === 0) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id, path: 'expected_error_codes', expected: 'at least one concrete code for invalid case', actual: '[]' });
        failed += 1;
        continue;
      }
      if (new Set(fixture.expected_error_codes).size !== fixture.expected_error_codes.length) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id, path: 'expected_error_codes', expected: 'unique codes', actual: fixture.expected_error_codes.join(',') });
        failed += 1;
        continue;
      }
      for (const code of fixture.expected_error_codes) {
        if (!knownErrorCodes.has(code)) {
          allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id, path: 'expected_error_codes', expected: 'known error code', actual: String(code) });
          failed += 1;
          break;
        }
      }
    }
    const validCountByContract = new Map();
    const invalidCountByContract = new Map();
    for (const fixture of cases) {
      if (fixture.expected === 'valid') validCountByContract.set(fixture.contract, (validCountByContract.get(fixture.contract) || 0) + 1);
      if (fixture.expected === 'invalid') invalidCountByContract.set(fixture.contract, (invalidCountByContract.get(fixture.contract) || 0) + 1);
    }
    const allContracts = ['evidence', 'task', 'capability', 'permission', 'trace', 'result', 'checkpoint', 'ruleset', 'epoch', 'external-reference', 'provider'];
    for (const contract of allContracts) {
      if ((validCountByContract.get(contract) || 0) < 1) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: '<manifest>', path: `cases[${contract}]`, expected: 'at least one valid case', actual: String(validCountByContract.get(contract) || 0) });
        failed += 1;
      }
      if ((invalidCountByContract.get(contract) || 0) < 2) {
        allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: '<manifest>', path: `cases[${contract}]`, expected: 'at least two invalid cases', actual: String(invalidCountByContract.get(contract) || 0) });
        failed += 1;
      }
    }
    const schemaByContract = new Map(schemas.map((item) => [item.schema.contract || item.file.replace('.schema.json', ''), item.schema]));
    const context = { tracesByRun: new Map(), rulesets: [], primaryIds: new Map(), evidences: [], providers: new Map() };
    const prepared = [];
    let previousFixtureId = '';
    for (const fixture of cases) {
      fixtureCount += 1;
      if (fixture.fixture_id === undefined || fixture.fixture_id === null || fixture.fixture_id === '') {
        allErrors.push({ code: 'SCHEMA_PARSE', fixture_id: '<empty>', path: 'manifest.cases', expected: 'non-empty fixture_id', actual: 'missing' });
        failed += 1;
        continue;
      }
      if (seenFixtureIds.has(fixture.fixture_id)) {
        allErrors.push({ code: 'DUPLICATE_ID', fixture_id: fixture.fixture_id, path: 'manifest.cases', expected: 'unique fixture_id', actual: 'duplicate' });
        failed += 1;
        continue;
      }
      seenFixtureIds.add(fixture.fixture_id);
      if (previousFixtureId && fixture.fixture_id < previousFixtureId) {
        allErrors.push({ code: 'SCHEMA_PARSE', fixture_id: fixture.fixture_id, path: 'manifest.cases', expected: `fixture_id sorted after ${previousFixtureId}`, actual: 'out of order' });
        failed += 1;
        continue;
      }
      previousFixtureId = fixture.fixture_id;
      if (!fixture.input || !fixture.contract || !fixture.expected) {
        allErrors.push({ code: 'SCHEMA_PARSE', fixture_id: fixture.fixture_id, path: 'manifest.cases', expected: 'input/contract/expected', actual: 'missing field' });
        failed += 1;
        continue;
      }
      if (fixture.expected !== 'valid' && fixture.expected !== 'invalid') {
        allErrors.push({ code: 'SCHEMA_PARSE', fixture_id: fixture.fixture_id, path: 'expected', expected: 'valid or invalid', actual: fixture.expected });
        failed += 1;
        continue;
      }
      const inputPath = path.join(fixturesRoot, fixture.input);
      const inputRelative = path.relative(fixturesRoot, inputPath);
      if (inputRelative.startsWith('..') || path.isAbsolute(inputRelative)) {
        allErrors.push({ code: 'CLI_ARGUMENT', fixture_id: fixture.fixture_id, path: 'input', expected: 'inside fixtures dir', actual: fixture.input });
        failed += 1;
        continue;
      }
      if (!fixture.input.endsWith('.json')) {
        allErrors.push({ code: 'CLI_ARGUMENT', fixture_id: fixture.fixture_id, path: 'input', expected: '.json', actual: fixture.input });
        failed += 1;
        continue;
      }
      try {
        assertRegularFileWithin(fixturesRoot, inputPath, `input ${fixture.input}`);
      } catch (error) {
        allErrors.push({ code: 'CLI_ARGUMENT', fixture_id: fixture.fixture_id, path: fixture.input, expected: 'regular non-symlink non-hardlink file inside fixtures root', actual: error.message });
        failed += 1;
        continue;
      }
      let value;
      try {
        value = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      } catch (error) {
        allErrors.push({ code: 'SCHEMA_PARSE', fixture_id: fixture.fixture_id, path: fixture.input, expected: 'valid JSON', actual: error.message });
        failed += 1;
        continue;
      }
      const schema = schemaByContract.get(fixture.contract);
      if (!schema) {
        allErrors.push({ code: 'SCHEMA_PARSE', fixture_id: fixture.fixture_id, path: 'contract', expected: 'known contract', actual: fixture.contract });
        failed += 1;
        continue;
      }
      const schemaErrors = [];
      validateAgainstSchema(value, schema, fixture.input, schemaErrors);
      const duplicateIdErrors = [];
      const primaryIdField = PRIMARY_ID_FIELDS[fixture.contract];
      if (primaryIdField && typeof value[primaryIdField] === 'string') {
        const primaryId = value[primaryIdField];
        const seenBefore = context.primaryIds.get(primaryId);
        if (seenBefore) {
          duplicateIdErrors.push({ code: 'DUPLICATE_ID', fixture_id: fixture.fixture_id, path: primaryIdField, expected: 'unique primary id', actual: `duplicate of ${seenBefore}` });
        } else {
          context.primaryIds.set(primaryId, fixture.fixture_id);
        }
      }
      if (fixture.contract === 'trace') context.tracesByRun.set(value.trace_id, value);
      if (fixture.contract === 'ruleset') context.rulesets.push(value);
      if (fixture.contract === 'evidence') context.evidences.push(value);
      if (fixture.contract === 'provider') context.providers.set(value.provider_id, value);
      prepared.push({ fixture, value, schemaErrors, duplicateIdErrors });
    }
    for (const entry of prepared) {
      const { fixture, value, schemaErrors, duplicateIdErrors } = entry;
      const semanticErrors = [];
      semanticChecks(fixture.contract, value, fixture.fixture_id, semanticErrors, context);
      const codes = [...schemaErrors.map(() => 'SCHEMA_VIOLATION'), ...duplicateIdErrors.map((error) => error.code), ...semanticErrors.map((error) => error.code)];
      const uniqueCodes = [...new Set(codes)];
      const ok = fixture.expected === 'valid' ? schemaErrors.length === 0 && duplicateIdErrors.length === 0 && semanticErrors.length === 0 : uniqueCodes.length > 0;
      if (ok && fixture.expected === 'invalid') {
        const missingExpected = (fixture.expected_error_codes || []).filter((code) => !uniqueCodes.includes(code));
        if (missingExpected.length) {
          allErrors.push({ code: 'DETERMINISM_MISMATCH', fixture_id: fixture.fixture_id, path: 'expected_error_codes', expected: missingExpected.join(','), actual: uniqueCodes.join(',') });
          failed += 1;
          continue;
        }
        passed += 1;
        continue;
      }
      if (ok) {
        passed += 1;
        continue;
      }
      failed += 1;
      const failure = semanticErrors[0] || duplicateIdErrors[0] || { code: 'SCHEMA_VIOLATION', path: fixture.input, expected: 'schema compliant', actual: 'violation' };
      allErrors.push({ code: failure.code, fixture_id: fixture.fixture_id, path: failure.path || fixture.input, expected: failure.expected || 'valid', actual: failure.actual || schemaErrors[0] || 'violation' });
    }
    const result = {
      schema_version: SCHEMA_VERSION,
      status: failed === 0 ? 'passed' : 'failed',
      schema_count: schemaCount,
      fixture_count: fixtureCount,
      passed,
      failed,
      errors: allErrors,
      owner_registry_sha256: ownerRegistrySha256
    };
    if (failed > 0) {
      console.error(JSON.stringify({ status: 'failed', errors: allErrors }, null, 2));
    }
    console.log(JSON.stringify(result, null, 2));
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ code: 'SCHEMA_PARSE', message: error.message }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { assertSafeFixturesDir, loadSchemas, loadSourceReferenceBasis, main, parseSingleValueCli, semanticChecks, stableJson, validateAgainstSchema, validateRegistry };
