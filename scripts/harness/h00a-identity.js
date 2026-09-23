const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { NORMALIZER_VERSION } = require('./h00a-normalizer');

const CAPTURE_TOOL_PATH = 'scripts/harness/capture-validation-debt.js';
const SNAPSHOT_EXPORTER_PATH = 'scripts/audit-iteration-snapshots.js';
const NORMALIZER_PATH = 'scripts/harness/h00a-normalizer.js';
const VERIFIER_PATHS = Object.freeze({
  validator: 'scripts/harness/validate-h00a.js',
  identity_engine: 'scripts/harness/h00a-identity.js',
  command_contract: 'scripts/harness/h00a-contract.js',
  migration_comparator: 'scripts/harness/compare-validation-debt.js'
});
const CAPTURE_LEDGER_PATH = 'doc/平台治理/harness-engineering/来源清册.md';
const FROZEN_IDENTITY_SCHEMA = 'h00a-frozen-capture-identity-r1';
const SOURCE_SET_IDENTITY_VERSION = 'h00a-source-set-identity-v3';
const SOURCE_SET_IDENTITY_FIELDS = [
  'id', 'type', 'locator_kind', 'path', 'hash_paths', 'external_locator', 'target_commit',
  'hash_excludes', 'owner', 'status', 'scope', 'sha256', 'member_count',
  'historical_commit', 'historical_repo_path', 'historical_tree_member_count'
];

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256String(value) {
  return sha256Buffer(Buffer.from(value, 'utf8'));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function currentHead(root) {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function commitExists(root, commit) {
  try {
    git(root, ['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch (_) {
    return false;
  }
}

function isAncestor(root, ancestor, descendant) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root }).status === 0;
}

function commitTree(root, commit) {
  return git(root, ['rev-parse', `${commit}^{tree}`]).trim();
}

function gitBlob(root, commit, relativePath) {
  return git(root, ['show', `${commit}:${toPosix(relativePath)}`], { encoding: null });
}

function gitFileIdentity(root, commit, relativePath) {
  return { path: relativePath, sha256: sha256Buffer(gitBlob(root, commit, relativePath)) };
}

function sourceHashScope(source) {
  return {
    path: source.path || null,
    hash_paths: [...(source.hash_paths || (source.path ? [source.path] : []))].map(toPosix),
    hash_excludes: [...(source.hash_excludes || ['.DS_Store'])].sort((a, b) => a.localeCompare(b, 'en'))
  };
}

function gitSourceMembers(root, commit, source) {
  const scope = sourceHashScope(source);
  const excludes = new Set(scope.hash_excludes);
  const output = git(root, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', '--name-only', commit, '--', ...scope.hash_paths]);
  return output.split('\0').filter(Boolean)
    .map(toPosix)
    .filter((file) => !file.split('/').some((segment) => excludes.has(segment)))
    .map((file) => ({ path: file, sha256: sha256Buffer(gitBlob(root, commit, file)) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function hashGitSource(root, commit, source) {
  const members = gitSourceMembers(root, commit, source);
  if (members.length === 0) throw new Error(`Git source has no members at ${commit}: ${source.path || source.hash_paths}`);
  if (members.length === 1 && (source.hash_paths || [source.path]).length === 1 && members[0].path === source.path) {
    return { sha256: members[0].sha256, memberCount: 1, members };
  }
  return {
    sha256: sha256String(members.map((item) => `${item.path}\0${item.sha256}\n`).join('')),
    memberCount: members.length,
    members
  };
}

function filesystemMembers(locator, hashPaths, excludes = ['.DS_Store'], keyRoot = '') {
  const excluded = new Set(excludes);
  const members = [];
  function walk(root, current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(root, full);
      if (entry.isFile()) {
        const relative = toPosix(path.relative(root, full));
        members.push({ path: relative ? `${keyRoot}/${relative}` : keyRoot, sha256: sha256Buffer(fs.readFileSync(full)) });
      }
    }
  }
  for (const item of hashPaths || [locator]) {
    const stat = fs.statSync(item);
    const rootKey = hashPaths?.length > 1 ? path.basename(item) : keyRoot;
    if (stat.isDirectory()) walk(item, item);
    if (stat.isFile()) members.push({ path: rootKey, sha256: sha256Buffer(fs.readFileSync(item)) });
  }
  members.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (members.length === 1 && !(hashPaths?.length > 1)) return { sha256: members[0].sha256, memberCount: 1, members };
  return { sha256: sha256String(members.map((item) => `${item.path}\0${item.sha256}\n`).join('')), memberCount: members.length, members };
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function projectRelative(locator, legacyProjectRoot) {
  if (!path.isAbsolute(locator)) return toPosix(locator);
  if (!legacyProjectRoot || !isInside(locator, legacyProjectRoot)) return null;
  return toPosix(path.relative(legacyProjectRoot, locator));
}

function freezeSources(root, sources, captureSubjectCommit, legacyProjectRoot = root) {
  return sources.map((source) => {
    const relativePath = source.locator_kind === 'external-frozen'
      ? null
      : source.locator_kind === 'git-tree'
        ? source.path
        : projectRelative(source.path, legacyProjectRoot);
    if (relativePath !== null) {
      const hashPaths = (source.hash_paths || [source.path]).map((item) => projectRelative(item, legacyProjectRoot));
      if (hashPaths.some((item) => item === null)) throw new Error(`project source mixes external hash paths: ${source.id}`);
      const frozen = {
        ...source,
        locator_kind: 'git-tree',
        path: relativePath,
        hash_paths: hashPaths,
        target_commit: captureSubjectCommit
      };
      delete frozen.external_locator;
      delete frozen.mirror_roots;
      const actual = hashGitSource(root, captureSubjectCommit, frozen);
      frozen.sha256 = actual.sha256;
      frozen.member_count = actual.memberCount;
      return frozen;
    }

    const locator = source.external_locator || source.path;
    const hashPaths = source.external_hash_paths || source.hash_paths || [locator];
    const actual = filesystemMembers(locator, hashPaths, source.hash_excludes, source.historical_repo_path || source.id);
    const frozen = {
      ...source,
      locator_kind: 'external-frozen',
      external_locator: locator,
      sha256: actual.sha256,
      member_count: actual.memberCount
    };
    delete frozen.path;
    delete frozen.hash_paths;
    delete frozen.external_hash_paths;
    delete frozen.mirror_roots;
    delete frozen.target_commit;
    return frozen;
  });
}

function canonicalSourceIdentity(source) {
  const result = {};
  for (const field of SOURCE_SET_IDENTITY_FIELDS) {
    let value = source[field];
    if (field === 'hash_excludes') value = [...(value || ['.DS_Store'])].sort((a, b) => a.localeCompare(b, 'en'));
    if (field === 'hash_paths') value = [...(value || (source.path ? [source.path] : []))].map(toPosix);
    result[field] = value ?? null;
  }
  return result;
}

function sourceSetHash(sources) {
  return sha256String([...sources]
    .sort((a, b) => a.id.localeCompare(b.id, 'en'))
    .map((source) => `${stableJson(canonicalSourceIdentity(source))}\n`)
    .join(''));
}

function frozenIdentityBase(root, projectStartCommit, captureSubjectCommit, sources) {
  return {
    schema_version: FROZEN_IDENTITY_SCHEMA,
    project_start_commit: projectStartCommit,
    capture_subject_commit: captureSubjectCommit,
    capture_tree: commitTree(root, captureSubjectCommit),
    tooling: {
      capture_tool: gitFileIdentity(root, captureSubjectCommit, CAPTURE_TOOL_PATH),
      snapshot_exporter: gitFileIdentity(root, captureSubjectCommit, SNAPSHOT_EXPORTER_PATH),
      normalizer: { version: NORMALIZER_VERSION, ...gitFileIdentity(root, captureSubjectCommit, NORMALIZER_PATH) },
      ...Object.fromEntries(Object.entries(VERIFIER_PATHS)
        .map(([name, file]) => [name, gitFileIdentity(root, captureSubjectCommit, file)]))
    },
    sources: sources.map(canonicalSourceIdentity).sort((a, b) => a.id.localeCompare(b.id, 'en')),
    source_set_sha256: sourceSetHash(sources)
  };
}

function debtPayload(debt) {
  const payload = { ...debt };
  delete payload.frozen_capture_identity;
  return payload;
}

function debtPayloadSha256(debt) {
  return sha256String(stableJson(debtPayload(debt)));
}

function finalizeFrozenIdentity(base, debt) {
  const withDebt = { ...base, debt_payload_sha256: debtPayloadSha256(debt) };
  return {
    ...withDebt,
    frozen_capture_id: `H00A-FROZEN-${sha256String(stableJson(withDebt)).slice(0, 24)}`
  };
}

function assertCanonicalCaptureEnvironment(root, captureSubjectCommit) {
  if (!/^[a-f0-9]{40}$/.test(captureSubjectCommit || '')) throw new Error('--subject-commit must be a full Git commit');
  if (currentHead(root) !== captureSubjectCommit) throw new Error('canonical capture HEAD must equal --subject-commit');
  if (spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: root }).status === 0) {
    throw new Error('canonical capture requires a detached HEAD worktree');
  }
  if (git(root, ['status', '--porcelain=v1', '-z'])) throw new Error('canonical capture requires a clean isolated worktree');
}

function parseNameStatus(output) {
  const parts = output.split('\0').filter(Boolean);
  const result = [];
  for (let index = 0; index < parts.length; index += 2) {
    result.push({ status: parts[index], path: toPosix(parts[index + 1]) });
  }
  return result;
}

function currentSourceDrift(root, source) {
  try {
    let actual;
    if (source.locator_kind === 'git-tree') {
      const locator = path.join(root, source.path);
      const hashPaths = (source.hash_paths || [source.path]).map((item) => path.join(root, item));
      if (!fs.existsSync(locator) || hashPaths.some((item) => !fs.existsSync(item))) return { id: source.id, status: 'missing' };
      const members = [];
      const excluded = new Set(source.hash_excludes || ['.DS_Store']);
      function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (excluded.has(entry.name)) continue;
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) walk(full);
          if (entry.isFile()) members.push({ path: toPosix(path.relative(root, full)), sha256: sha256Buffer(fs.readFileSync(full)) });
        }
      }
      for (const item of hashPaths) {
        const stat = fs.statSync(item);
        if (stat.isDirectory()) walk(item);
        if (stat.isFile()) members.push({ path: toPosix(path.relative(root, item)), sha256: sha256Buffer(fs.readFileSync(item)) });
      }
      members.sort((a, b) => a.path.localeCompare(b.path, 'en'));
      actual = members.length === 1 && (source.hash_paths || [source.path]).length === 1 && members[0].path === source.path
        ? { sha256: members[0].sha256, memberCount: 1 }
        : { sha256: sha256String(members.map((item) => `${item.path}\0${item.sha256}\n`).join('')), memberCount: members.length };
    } else {
      if (!fs.existsSync(source.external_locator)) return { id: source.id, status: 'missing' };
      actual = filesystemMembers(source.external_locator, null, source.hash_excludes, source.historical_repo_path || source.id);
    }
    return {
      id: source.id,
      status: actual.sha256 === source.sha256 && actual.memberCount === source.member_count ? 'unchanged' : 'changed',
      frozen_sha256: source.sha256,
      current_sha256: actual.sha256,
      frozen_member_count: source.member_count,
      current_member_count: actual.memberCount
    };
  } catch (error) {
    return { id: source.id, status: 'unreadable', error: error.message };
  }
}

function buildWorkspaceDrift(root, frozenIdentity) {
  const head = currentHead(root);
  const trackedTree = parseNameStatus(git(root, ['diff', '--name-status', '-z', '--no-renames', frozenIdentity.capture_subject_commit, head]));
  const trackedDirty = parseNameStatus(git(root, ['diff', '--name-status', '-z', '--no-renames', 'HEAD']));
  const untracked = git(root, ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean).map(toPosix).sort((a, b) => a.localeCompare(b, 'en'));
  const tools = Object.values(frozenIdentity.tooling).filter((item) => item.path).map((item) => {
    const file = path.join(root, item.path);
    if (!fs.existsSync(file)) return { path: item.path, status: 'missing', frozen_sha256: item.sha256 };
    const currentSha = sha256Buffer(fs.readFileSync(file));
    return { path: item.path, status: currentSha === item.sha256 ? 'unchanged' : 'changed', frozen_sha256: item.sha256, current_sha256: currentSha };
  });
  const sources = frozenIdentity.sources.map((source) => currentSourceDrift(root, source));
  const report = {
    schema_version: 'h00a-current-workspace-drift-r1',
    frozen_capture_id: frozenIdentity.frozen_capture_id,
    capture_subject_commit: frozenIdentity.capture_subject_commit,
    current_head: head,
    head_changed: head !== frozenIdentity.capture_subject_commit,
    tracked_tree_changes: trackedTree,
    tracked_dirty: trackedDirty,
    untracked,
    tooling: tools,
    sources
  };
  report.has_drift = report.head_changed || trackedTree.length > 0 || trackedDirty.length > 0 || untracked.length > 0
    || tools.some((item) => item.status !== 'unchanged') || sources.some((item) => item.status !== 'unchanged');
  return report;
}

module.exports = {
  CAPTURE_LEDGER_PATH,
  CAPTURE_TOOL_PATH,
  FROZEN_IDENTITY_SCHEMA,
  NORMALIZER_PATH,
  SNAPSHOT_EXPORTER_PATH,
  VERIFIER_PATHS,
  SOURCE_SET_IDENTITY_FIELDS,
  SOURCE_SET_IDENTITY_VERSION,
  assertCanonicalCaptureEnvironment,
  buildWorkspaceDrift,
  canonicalSourceIdentity,
  commitExists,
  commitTree,
  currentHead,
  debtPayloadSha256,
  finalizeFrozenIdentity,
  freezeSources,
  frozenIdentityBase,
  gitBlob,
  hashGitSource,
  isAncestor,
  sha256Buffer,
  sha256String,
  sourceSetHash,
  stableJson
};
