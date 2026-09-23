const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sourceSetHash, stableJson } = require('./h00a-identity');
const { CANONICAL_H00A_REVIEW_CHECK_IDS } = require('./h00a-contract');

const SCHEMA_VERSION = 'h00b-replayable-baseline-v1';
const CANONICAL_MANIFEST_PATH = 'tests/harness/baselines/source-manifest.json';
const CANONICAL_OUTPUT_PATH = '.harness-runtime/baselines/h00b.json';
const CANONICAL_OLD_HARNESS_IDENTITY = Object.freeze({
  id: 'O-OLD-HARNESS-EXPORT',
  type: 'O',
  locator_kind: 'external-frozen',
  historical_commit: '89f476727bb6919fecc21fef301d153fe946dd0c',
  historical_repo_path: 'harness',
  historical_tree_member_count: 15,
  member_count: 15,
  sha256: 'a997246b0844fbe59aedadf1386ce59da10f0a47164fb29a894da28d8362f394'
});
const CANONICAL_OLD_HARNESS_IDENTITY_FIELDS = Object.freeze(Object.keys(CANONICAL_OLD_HARNESS_IDENTITY));
const EVIDENCE_PATHS = Object.freeze([
  'doc/平台治理/harness-engineering/来源清册.md',
  'tests/harness/baselines/h00a-confirmation.json',
  'tests/harness/baselines/h00a-schema-migration-r1.json',
  'tests/harness/baselines/source-manifest.json',
  'tests/harness/baselines/validation-debt.json',
  'tests/harness/incidents/failure-family-candidates.jsonl',
  'tests/harness/incidents/seed.jsonl'
]);
const TOOLING_PATHS = Object.freeze([
  'scripts/harness/capture-baseline.js',
  'scripts/harness/h00b-contract.js',
  'scripts/harness/validate-baseline.js'
]);
const TOP_LEVEL_FIELDS = Object.freeze([
  'schema_version', 'baseline_id', 'payload_sha256', 'approval', 'evidence_files',
  'frozen_capture', 'git_patch', 'source_set', 'source_inventory', 'rule_sources',
  'old_harness_sources', 'providers', 'judge', 'environment', 'tooling', 'future_identities'
]);
const PAYLOAD_FIELDS = Object.freeze(TOP_LEVEL_FIELDS.filter((key) => !['baseline_id', 'payload_sha256'].includes(key)));
const FUTURE_IDENTITIES = Object.freeze({
  fixture_suite: { id: null, status: 'not-created', owner_batch: 'H04' },
  oracle: { id: null, status: 'not-created', owner_batch: 'H04' },
  adapter: { id: null, status: 'not-created', owner_batch: 'H09' },
  epoch: { id: null, status: 'not-created', owner_batch: 'H02A' }
});
const DIFF_CONTRACT = 'git --no-pager -c color.ui=false -c core.quotepath=false diff --no-ext-diff --raw -z --no-renames --full-index <base> <subject> --';

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function git(root, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function evidenceFiles(root) {
  return EVIDENCE_PATHS.map((relativePath) => ({
    path: relativePath,
    sha256: sha256Buffer(fs.readFileSync(path.join(root, relativePath)))
  }));
}

function parseNameStatus(buffer) {
  const parts = buffer.toString('utf8').split('\0').filter(Boolean);
  const records = [];
  for (let index = 0; index < parts.length; index += 2) records.push({ status: parts[index], path: parts[index + 1].replace(/\\/g, '/') });
  return records.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.status.localeCompare(b.status, 'en'));
}

function gitPatch(root, identity) {
  const base = identity.project_start_commit;
  const subject = identity.capture_subject_commit;
  const common = ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotepath=false', 'diff', '--no-ext-diff'];
  return {
    schema_version: 'h00b-git-patch-identity-v1',
    base_commit: base,
    subject_commit: subject,
    subject_tree: identity.capture_tree,
    state: 'committed-range',
    diff_contract: DIFF_CONTRACT,
    raw_diff_sha256: sha256Buffer(git(root, [...common, '--raw', '-z', '--no-renames', '--full-index', base, subject, '--'], null)),
    changed_paths: parseNameStatus(git(root, [...common, '--name-status', '-z', '--no-renames', base, subject, '--'], null))
  };
}

function environment(root) {
  return {
    schema_version: 'h00b-environment-v1',
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    git_version: git(root, ['--version']).trim().replace(/\s+/g, ' ')
  };
}

function tooling(root) {
  return TOOLING_PATHS.map((relativePath) => ({ path: relativePath, sha256: sha256Buffer(fs.readFileSync(path.join(root, relativePath))) }));
}

function assertFutureIdentities(actual) {
  for (const key of Object.keys(FUTURE_IDENTITIES)) {
    if (stableJson(actual?.[key]) !== stableJson(FUTURE_IDENTITIES[key])) throw new Error(`future_identities.${key} must remain not-created with owner ${FUTURE_IDENTITIES[key].owner_batch}`);
  }
  if (Object.keys(actual || {}).length !== Object.keys(FUTURE_IDENTITIES).length) throw new Error('future_identities contains an unexpected key');
}

function assertProviderJudge(manifest) {
  const selected = (manifest.providers || []).filter((item) => item.role === 'execution-selected');
  if (selected.length !== 1) throw new Error('providers must contain exactly one execution-selected provider');
  const provider = selected[0];
  if (provider.id !== 'P-LONGCAT-2-0') throw new Error('providers execution-selected ID must be P-LONGCAT-2-0');
  if (provider.status !== 'selected-pending-smoke' || provider.eligible_for_h04 !== false) throw new Error('provider P-LONGCAT-2-0 must remain selected-pending-smoke and ineligible for H04');
  const judge = manifest.judge;
  if (judge?.id !== 'J-CODEX-INDEPENDENT-TASK-SELECTED') throw new Error('judge ID must be J-CODEX-INDEPENDENT-TASK-SELECTED');
  if (judge.status !== 'selected-pending-smoke' || judge.independent_run_context !== 'selected-not-verified' || judge.eligible_for_h04 !== false) throw new Error('judge must remain selected-pending-smoke, selected-not-verified and ineligible for H04');
}

function assertCanonicalSourceSet(manifest) {
  const ids = (manifest.sources || []).map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('source_inventory IDs must be unique');
  if (manifest.source_set?.aggregate_sha256 !== sourceSetHash(manifest.sources || [])) throw new Error('source_set.aggregate_sha256 mismatch');
}

function assertCanonicalOldHarness(sourceInventory) {
  const matches = (sourceInventory || []).filter((item) => item && item.id === CANONICAL_OLD_HARNESS_IDENTITY.id);
  if (matches.length !== 1) throw new Error(`O-OLD-HARNESS-EXPORT must appear exactly once in source_inventory; found ${matches.length}`);
  const record = matches[0];
  for (const field of CANONICAL_OLD_HARNESS_IDENTITY_FIELDS) {
    const expected = CANONICAL_OLD_HARNESS_IDENTITY[field];
    const actual = record[field];
    if (actual !== expected) {
      throw new Error(`O-OLD-HARNESS-EXPORT.${field} mismatch: expected ${expected} actual ${actual === undefined ? '<missing>' : actual}`);
    }
  }
  return record;
}

function buildPayload(root, manifest, confirmation) {
  assertProviderJudge(manifest);
  assertFutureIdentities(manifest.future_identities);
  assertCanonicalSourceSet(manifest);
  const sourceInventory = [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  assertCanonicalOldHarness(sourceInventory);
  const oldHarnessSources = sourceInventory.filter((item) => item.type === 'O' && item.historical_commit && item.historical_repo_path);
  const oldHarnessRecord = oldHarnessSources.find((item) => item.id === CANONICAL_OLD_HARNESS_IDENTITY.id);
  if (!oldHarnessRecord) {
    throw new Error('O-OLD-HARNESS-EXPORT must appear identically in old_harness_sources');
  }
  return {
    schema_version: SCHEMA_VERSION,
    approval: {
      schema_version: confirmation.schema_version,
      status: confirmation.status,
      reviewed_by: confirmation.reviewed_by,
      reviewed_at: confirmation.reviewed_at,
      reviewed_frozen_capture_id: confirmation.reviewed_frozen_capture_id,
      reviewed_capture_subject_commit: confirmation.reviewed_capture_subject_commit,
      h00b_unlocked: confirmation.h00b_unlocked,
      required_check_ids: confirmation.required_checks.map((check) => check.id),
      confirmation_path: 'tests/harness/baselines/h00a-confirmation.json',
      confirmation_sha256: sha256Buffer(fs.readFileSync(path.join(root, 'tests/harness/baselines/h00a-confirmation.json')))
    },
    evidence_files: evidenceFiles(root),
    frozen_capture: manifest.frozen_capture_identity,
    git_patch: gitPatch(root, manifest.frozen_capture_identity),
    source_set: manifest.source_set,
    source_inventory: sourceInventory,
    rule_sources: sourceInventory.filter((item) => item.type === 'R'),
    old_harness_sources: oldHarnessSources,
    providers: [...manifest.providers].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    judge: manifest.judge,
    environment: environment(root),
    tooling: tooling(root),
    future_identities: manifest.future_identities
  };
}

function finalizeBaseline(payload) {
  const payloadSha256 = sha256Buffer(Buffer.from(stableJson(payload), 'utf8'));
  return {
    schema_version: payload.schema_version,
    baseline_id: `H00B-BASELINE-${payloadSha256.slice(0, 24)}`,
    payload_sha256: payloadSha256,
    ...Object.fromEntries(PAYLOAD_FIELDS.filter((key) => key !== 'schema_version').map((key) => [key, payload[key]]))
  };
}

function firstDifference(expected, actual, prefix = 'baseline') {
  if (stableJson(expected) === stableJson(actual)) return null;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return `${prefix}.length`;
    for (let index = 0; index < expected.length; index += 1) {
      const element = expected[index];
      const label = element && typeof element === 'object' && element.id !== undefined ? element.id : index;
      const result = firstDifference(expected[index], actual[index], `${prefix}[${label}]`);
      if (result) return result;
    }
  } else if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && !Array.isArray(expected) && !Array.isArray(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!(key in expected) || !(key in actual)) return `${prefix}.${key}`;
      const result = firstDifference(expected[key], actual[key], `${prefix}.${key}`);
      if (result) return result;
    }
  }
  return prefix;
}

module.exports = {
  CANONICAL_H00A_REVIEW_CHECK_IDS, CANONICAL_MANIFEST_PATH, CANONICAL_OUTPUT_PATH,
  CANONICAL_OLD_HARNESS_IDENTITY, CANONICAL_OLD_HARNESS_IDENTITY_FIELDS,
  EVIDENCE_PATHS, FUTURE_IDENTITIES, PAYLOAD_FIELDS, SCHEMA_VERSION, TOOLING_PATHS,
  TOP_LEVEL_FIELDS, assertCanonicalOldHarness, assertCanonicalSourceSet, assertFutureIdentities, buildPayload,
  canonicalJson, finalizeBaseline, firstDifference, parseSingleValueCli, sha256Buffer, stableJson
};
