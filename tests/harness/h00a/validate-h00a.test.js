const assert = require('assert');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { CANONICAL_H00A_COMMANDS } = require('../../../scripts/harness/h00a-contract');
const { CANONICAL_H00A_REVIEW_CHECK_IDS } = require('../../../scripts/harness/h00a-contract');
const { compare } = require('../../../scripts/harness/compare-validation-debt');
const {
  assertCanonicalCaptureEnvironment,
  buildWorkspaceDrift,
  finalizeFrozenIdentity,
  freezeSources,
  frozenIdentityBase,
  sourceSetHash,
  sha256String
} = require('../../../scripts/harness/h00a-identity');
const { failureKey } = require('../../../scripts/harness/h00a-normalizer');
const {
  commitFileTransaction,
  parseCaptureOptions,
  resolveSafeTemporaryOutput
} = require('../../../scripts/harness/capture-validation-debt');
const { migrationDiagnostics } = require('../../../scripts/harness/validate-h00a');

const implementationRoot = path.resolve(__dirname, '../../..');
const validator = path.join(implementationRoot, 'scripts/harness/validate-h00a.js');
const captureImplementation = path.join(implementationRoot, 'scripts/harness/capture-validation-debt.js');

const R2_TEST_CASES = Object.freeze([
  { id: 'R2-01', scenario: 'pending-review v2 with all nine canonical checks', expected_exit: 0, assertions: ['confirmationStatus=pending-review', 'h00bUnlocked=false'], test_title: 'R2-01 pending-review v2 keeps H00B locked' },
  { id: 'R2-02', scenario: 'approved confirmation with one custom check', expected_exit: 1, assertions: ['reject custom approval check set'], test_title: 'R2-02 rejects a single custom approved check' },
  { id: 'R2-03', scenario: 'each canonical check is missing in turn', expected_exit: 1, assertions: ['report each missing canonical check ID'], test_title: 'R2-03 rejects every missing canonical check' },
  { id: 'R2-04', scenario: 'canonical checks are duplicated or reordered', expected_exit: 1, assertions: ['report set or order error'], test_title: 'R2-04 rejects duplicate and reordered canonical checks' },
  { id: 'R2-05', scenario: 'approved confirmation has no reviewed_by', expected_exit: 1, assertions: ['reviewed_by field error', 'approval rejected'], test_title: 'R2-05 rejects approved confirmation without reviewed_by' },
  { id: 'R2-06', scenario: 'approved confirmation has missing or forged reviewed_at', expected_exit: 1, assertions: ['reviewed_at field error', 'approval rejected'], test_title: 'R2-06 rejects approved confirmation with invalid reviewed_at' },
  { id: 'R2-07', scenario: 'approved confirmation capture ID mismatches frozen identity', expected_exit: 1, assertions: ['reviewed_frozen_capture_id mismatch', 'approval rejected'], test_title: 'R2-07 rejects approved confirmation with mismatched capture ID' },
  { id: 'R2-08', scenario: 'approved confirmation subject commit mismatches frozen identity', expected_exit: 1, assertions: ['reviewed_capture_subject_commit mismatch', 'approval rejected'], test_title: 'R2-08 rejects approved confirmation with mismatched subject commit' },
  { id: 'R2-09', scenario: 'old approval is replayed after frozen identity changes', expected_exit: 1, assertions: ['reviewed identity cannot be replayed'], test_title: 'R2-09 rejects approval replay after frozen identity changes' },
  { id: 'R2-10', scenario: 'synthetic approved confirmation is fully valid', expected_exit: 0, assertions: ['fixture-only h00b_unlocked=true'], test_title: 'R2-10 accepts a valid approved synthetic fixture' },
  { id: 'R2-11', scenario: 'temporary capture process runs in a hermetic repository', expected_exit: 0, assertions: ['temporary JSON generated', 'nine canonical commands'], test_title: 'R2-11 runs a real hermetic temporary capture' },
  { id: 'R2-12', scenario: 'temporary capture compares canonical artifact hashes before and after', expected_exit: 0, assertions: ['manifest debt ledger confirmation bytes unchanged'], test_title: 'R2-12 preserves canonical bytes during temporary capture' },
  { id: 'R2-13', scenario: 'temporary target already exists or aliases through symlink or hardlink', expected_exit: 1, assertions: ['target rejected', 'canonical bytes unchanged'], test_title: 'R2-13 rejects existing and aliased temporary targets' },
  { id: 'R2-14', scenario: 'migration summary is tampered', expected_exit: 1, assertions: ['migration recomputation mismatch'], test_title: 'R2-14 rejects tampered migration summary' },
  { id: 'R2-15', scenario: 'migration before or after hash is tampered', expected_exit: 1, assertions: ['migration hash mismatch'], test_title: 'R2-15 rejects tampered migration hashes' },
  { id: 'R2-16', scenario: 'migration frozen capture ID is tampered', expected_exit: 1, assertions: ['migration capture ID mismatch'], test_title: 'R2-16 rejects tampered migration capture ID' },
  { id: 'R2-17', scenario: 'migration added or removed detail is tampered', expected_exit: 1, assertions: ['migration per-key mismatch'], test_title: 'R2-17 rejects tampered migration details' },
  { id: 'R2-18', scenario: 'each verifier Git blob hash is tampered', expected_exit: 1, assertions: ['specific verifier frozen blob mismatch'], test_title: 'R2-18 rejects each tampered verifier Git blob hash' },
  { id: 'R2-19', scenario: 'current verifier content changes after frozen capture', expected_exit: 0, assertions: ['frozen remains valid', 'drift reports verifier changed'], test_title: 'R2-19 reports current verifier changes only as drift' },
  { id: 'R2-20', scenario: 'canonical capture completes while confirmation remains pending', expected_exit: 0, assertions: ['confirmation bytes unchanged', 'four reviewed fields null', 'h00b_unlocked=false'], test_title: 'R2-20 preserves pending confirmation after canonical capture' }
]);
const R2_MATRIX_SEMANTIC_SHA256 = '096c11d7364ea5f6a6c81bb2ddc108caae4efe54449c915600d19f3a6d51d46c';
const R2_TEST_MAP = Object.freeze(Object.fromEntries(R2_TEST_CASES.map(({ id, test_title }) => [id, test_title])));

function r2Case(id) {
  return R2_TEST_CASES.find((item) => item.id === id);
}

function validateR2TestCases(cases) {
  const expectedIds = Array.from({ length: 20 }, (_, index) => `R2-${String(index + 1).padStart(2, '0')}`);
  assert.deepStrictEqual(cases.map((item) => item.id), expectedIds);
  assert.strictEqual(new Set(cases.map((item) => item.id)).size, 20);
  assert.strictEqual(new Set(cases.map((item) => item.test_title)).size, 20);
  for (const item of cases) {
    assert.match(item.test_title, new RegExp(`^${item.id} `));
    assert.ok(item.scenario);
    assert.ok([0, 1].includes(item.expected_exit));
    assert.ok(Array.isArray(item.assertions) && item.assertions.length > 0);
  }
  assert.strictEqual(sha256String(JSON.stringify(cases)), R2_MATRIX_SEMANTIC_SHA256);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(repo, args, options = {}) {
  return execFileSync('git', args, { cwd: repo, encoding: options.encoding ?? 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeJson(file, value) {
  write(file, `${JSON.stringify(value, null, 2)}\n`);
}

function commit(repo, message) {
  git(repo, ['add', '--all']);
  git(repo, ['-c', 'user.name=H00A Test', '-c', 'user.email=h00a@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

function commands() {
  return CANONICAL_H00A_COMMANDS.map((item) => ({
    ...item,
    exit_code: 0,
    issue_count: 0,
    failure_count: 0,
    output_sha256: sha256String(`${item.id}\n`),
    failure_keys: []
  }));
}

function prepare(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h00a-hermetic-'));
  const repo = path.join(directory, 'project');
  const artifacts = path.join(directory, 'artifacts');
  const external = path.join(directory, 'external');
  fs.mkdirSync(repo);
  fs.mkdirSync(artifacts);
  fs.mkdirSync(external);
  git(repo, ['init', '-q']);

  for (let index = 1; index <= 15; index += 1) write(path.join(repo, 'harness', `rule-${index}.md`), `old-rule-${index}\n`);
  const beforeDebt = {
    schema_version: 'h00a-validation-debt-v3',
    failure_inventory: Array.from({ length: 290 }, (_, index) => ({ failure_key: `OLD-${String(index).padStart(3, '0')}`, occurrence_count: index < 52 ? 2 : 1 }))
  };
  writeJson(path.join(repo, 'tests/harness/baselines/validation-debt.json'), beforeDebt);
  const projectStartCommit = commit(repo, 'old harness snapshot');
  git(repo, ['branch', 'be7c6b69', projectStartCommit]);
  const oldHarness = path.join(external, 'old-harness');
  fs.cpSync(path.join(repo, 'harness'), oldHarness, { recursive: true });
  const externalPrinciple = path.join(external, 'principle.md');
  write(externalPrinciple, 'external-principle\n');

  write(path.join(repo, 'AGENTS.md'), 'fixture-agent-rule\n');
  if (options.realTooling) {
    for (const relativePath of [
      'scripts/harness/capture-validation-debt.js',
      'scripts/harness/h00a-normalizer.js',
      'scripts/harness/validate-h00a.js',
      'scripts/harness/h00a-identity.js',
      'scripts/harness/h00a-contract.js',
      'scripts/harness/compare-validation-debt.js',
      'scripts/audit-iteration-snapshots.js',
      'scripts/lib/project-scan-boundary.js'
    ]) copyImplementation(relativePath, repo);
    writeJson(path.join(repo, 'package.json'), { scripts: { 'harness:h00a:validate': 'node scripts/harness/validate-h00a.js' } });
  } else {
    write(path.join(repo, 'scripts/harness/capture-validation-debt.js'), 'module.exports = "fixture-capture";\n');
    write(path.join(repo, 'scripts/harness/h00a-normalizer.js'), 'module.exports = "fixture-normalizer";\n');
    write(path.join(repo, 'scripts/harness/validate-h00a.js'), 'module.exports = "fixture-validator";\n');
    write(path.join(repo, 'scripts/harness/h00a-identity.js'), 'module.exports = "fixture-identity";\n');
    write(path.join(repo, 'scripts/harness/h00a-contract.js'), 'module.exports = "fixture-contract";\n');
    write(path.join(repo, 'scripts/harness/compare-validation-debt.js'), 'module.exports = "fixture-comparator";\n');
    write(path.join(repo, 'scripts/audit-iteration-snapshots.js'), 'module.exports = "fixture-snapshot";\n');
  }
  write(path.join(repo, 'unrelated.txt'), 'baseline\n');
  const captureSubjectCommit = commit(repo, 'capture subject');

  const sources = freezeSources(repo, [
    { id: 'R-AGENTS', type: 'R', path: path.join(repo, 'AGENTS.md'), owner: 'fixture', status: 'active', scope: 'entry' },
    { id: 'R-HARNESS', type: 'R', path: path.join(repo, 'harness'), owner: 'fixture', status: 'active', scope: 'rules' },
    { id: 'A-EXTERNAL', type: 'A', path: externalPrinciple, owner: 'fixture', status: 'active', scope: 'principle' },
    {
      id: 'O-OLD-HARNESS', type: 'O', path: oldHarness, owner: 'fixture', status: 'observed-exact-historical-snapshot', scope: 'old snapshot',
      historical_commit: projectStartCommit, historical_repo_path: 'harness', historical_tree_member_count: 15, hash_excludes: ['.DS_Store']
    }
  ], captureSubjectCommit, repo);

  const debt = {
    schema_version: 'h00a-validation-debt-v4',
    status: 'frozen-observation-pending-review',
    captured_at: '2026-08-01T00:00:00Z',
    capture_mode: 'canonical-isolated-detached-clean',
    policy: 'zero-new-or-worsened-by-failure-key',
    scope_note: 'fixture',
    scan_boundary: { version: 'project-scan-boundary-v1', excluded_patterns: ['**/.claude/worktrees/**'], exclude_gitlinks: true, rationale: 'fixture' },
    commands: commands(),
    failure_inventory: [],
    comparison_contract: {
      identity_fields: ['failure_key', 'file', 'rule_code', 'category', 'identity_subject'],
      comparison_fields: ['severity', 'message_fingerprint', 'occurrence_count']
    }
  };
  const identity = finalizeFrozenIdentity(frozenIdentityBase(repo, projectStartCommit, captureSubjectCommit, sources), debt);
  debt.frozen_capture_identity = identity;
  const manifest = {
    schema_version: 'h00a-source-manifest-v4',
    status: 'pending-human-review',
    source_set: {
      id: 'SRCSET-HERMETIC', aggregate_sha256: sourceSetHash(sources), identity_version: 'h00a-source-set-identity-v3',
      identity_fields: ['id', 'type', 'locator_kind', 'path', 'hash_paths', 'external_locator', 'target_commit', 'hash_excludes', 'owner', 'status', 'scope', 'sha256', 'member_count', 'historical_commit', 'historical_repo_path', 'historical_tree_member_count']
    },
    sources,
    decisions: [{ id: 'D-TEST', status: 'confirmed' }],
    observations: [{ id: 'V-TEST', status: 'verified' }],
    providers: [{ id: 'P-LONGCAT-2-0', role: 'execution-selected', model_family: 'LongCat', status: 'selected-pending-smoke', eligible_for_h04: false, entry_locator: 'fixture-longcat', evidence_refs: ['D-TEST'] }],
    judge: { id: 'J-CODEX', status: 'selected-pending-smoke', entry_locator: 'fixture-codex', independent_run_context: 'selected-not-verified', eligible_for_h04: false, evidence_refs: ['D-TEST'] },
    future_identities: {
      fixture_suite: { id: null, status: 'not-created', owner_batch: 'H04' },
      oracle: { id: null, status: 'not-created', owner_batch: 'H04' },
      adapter: { id: null, status: 'not-created', owner_batch: 'H09' },
      epoch: { id: null, status: 'not-created', owner_batch: 'H02A' }
    },
    frozen_capture_identity: identity
  };
  const families = Array.from({ length: 18 }, (_, index) => ({
    family_id: `FAMILY-${index + 1}`, title: `family ${index + 1}`, source_refs: ['R-AGENTS'], severity_candidate: 'P1',
    scope: 'fixture', status: 'failure-family-candidate', earliest_failed_handoff: 'fixture'
  }));
  const incidents = Array.from({ length: 4 }, (_, index) => ({
    incident_id: `INC-${index + 1}`, title: `incident ${index + 1}`, failure_family_refs: [`FAMILY-${index + 1}`],
    source_refs: ['O-OLD-HARNESS'], evidence_types: ['O'], severity: 'P1', severity_basis: 'fixture', scope: 'fixture',
    status: 'confirmed-observation', earliest_failed_handoff: 'fixture', affected_objects: ['fixture'], rework_cost: 'fixture', evidence_locator: 'fixture'
  }));
  const confirmation = {
    schema_version: 'h00a-confirmation-v2', status: 'pending-review', reviewed_by: null, reviewed_at: null,
    reviewed_frozen_capture_id: null, reviewed_capture_subject_commit: null, h00b_unlocked: false,
    required_checks: CANONICAL_H00A_REVIEW_CHECK_IDS.map((id) => ({ id, label: 'fixture', status: 'ready-for-review', evidence_refs: ['tests/harness/baselines/source-manifest.json'] }))
  };
  const files = {
    manifest: path.join(artifacts, 'source-manifest.json'), debt: path.join(artifacts, 'validation-debt.json'),
    incidents: path.join(artifacts, 'seed.jsonl'), families: path.join(artifacts, 'families.jsonl'),
    confirmation: path.join(artifacts, 'confirmation.json'), migration: path.join(artifacts, 'migration.json'), ledger: path.join(artifacts, 'ledger.md')
  };
  writeJson(files.manifest, manifest);
  writeJson(files.debt, debt);
  write(files.incidents, `${incidents.map(JSON.stringify).join('\n')}\n`);
  write(files.families, `${families.map(JSON.stringify).join('\n')}\n`);
  writeJson(files.confirmation, confirmation);
  writeJson(files.migration, compare(beforeDebt, debt, 'be7c6b69:tests/harness/baselines/validation-debt.json', 'tests/harness/baselines/validation-debt.json'));
  write(files.ledger, `<!-- H00A-CAPTURE-IDENTITY:START -->\n\`\`\`json\n${JSON.stringify(identity, null, 2)}\n\`\`\`\n<!-- H00A-CAPTURE-IDENTITY:END -->\n`);
  return { directory, repo, artifacts, external, externalPrinciple, oldHarness, files, projectStartCommit, captureSubjectCommit };
}

function copyImplementation(relativePath, repo) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(implementationRoot, relativePath), target);
}

function prepareCaptureFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h00a-capture-process-'));
  const repo = path.join(directory, 'project');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);

  for (const relativePath of [
    'scripts/harness/capture-validation-debt.js',
    'scripts/harness/h00a-contract.js',
    'scripts/harness/h00a-identity.js',
    'scripts/harness/h00a-normalizer.js',
    'scripts/harness/validate-h00a.js',
    'scripts/harness/compare-validation-debt.js',
    'scripts/lib/project-scan-boundary.js'
  ]) copyImplementation(relativePath, repo);

  write(path.join(repo, 'scripts/audit-iteration-snapshots.js'), `
if (process.argv.includes('--print-issues-json')) console.log('[]');
`);
  write(path.join(repo, 'scripts/stub.js'), `
const fs = require('fs');
const mode = process.argv[2];
if (mode === 'audit-ui') fs.writeFileSync('平台优化-一致性审计报告.md', '## 问题清单\\n\\n| 优先级 | 规则 | 文件 | 问题描述 |\\n| --- | --- | --- | --- |\\n| - | - | - | - |\\n');
if (mode === 'audit-docs') fs.writeFileSync('平台优化-需求文档审计报告.md', '## 问题清单\\n\\n| 文件 | 级别 | 类型 | 说明 |\\n| --- | --- | --- | --- |\\n| - | - | - | - |\\n');
`);
  const scripts = Object.fromEntries([
    'audit:rules', 'register:missing', 'lint:ui', 'audit:ui', 'audit:docs',
    'audit:snapshots', 'audit:version-tags', 'check:governance', 'check:all'
  ].map((name) => [name, `node scripts/stub.js ${name.replace(':', '-')}`]));
  writeJson(path.join(repo, 'package.json'), { scripts });
  write(path.join(repo, 'AGENTS.md'), 'fixture rule\n');
  write(path.join(repo, '平台优化-一致性审计报告.md'), 'original ui report\n');
  write(path.join(repo, '平台优化-需求文档审计报告.md'), 'original docs report\n');
  write(path.join(repo, 'doc/平台治理/harness-engineering/来源清册.md'), '<!-- H00A-CAPTURE-IDENTITY:START -->\n```json\n{}\n```\n<!-- H00A-CAPTURE-IDENTITY:END -->\n');
  writeJson(path.join(repo, 'tests/harness/baselines/validation-debt.json'), { placeholder: true });
  writeJson(path.join(repo, 'tests/harness/baselines/h00a-confirmation.json'), {
    schema_version: 'h00a-confirmation-v2', status: 'pending-review', reviewed_by: null, reviewed_at: null,
    reviewed_frozen_capture_id: null, reviewed_capture_subject_commit: null, h00b_unlocked: false,
    required_checks: CANONICAL_H00A_REVIEW_CHECK_IDS.map((id) => ({ id, label: 'fixture', status: 'ready-for-review', evidence_refs: ['fixture'] }))
  });
  const projectStartCommit = commit(repo, 'fixture project start');
  writeJson(path.join(repo, 'tests/harness/baselines/source-manifest.json'), {
    schema_version: 'h00a-source-manifest-v3',
    capture_identity: { project_start_commit: projectStartCommit },
    git: { remote: 'fixture', branch: 'detached', remote_divergence: 'none' },
    source_set: { id: 'SRCSET-CAPTURE-FIXTURE' },
    hash_contract: {},
    sources: [{ id: 'R-AGENTS', type: 'R', path: 'AGENTS.md', owner: 'fixture', status: 'active', scope: 'entry' }],
    decisions: [], observations: [], providers: [], judge: {}, future_identities: {}
  });
  const captureSubjectCommit = commit(repo, 'fixture capture subject');
  git(repo, ['checkout', '--detach', '-q', captureSubjectCommit]);
  return {
    directory,
    repo,
    captureSubjectCommit,
    files: {
      manifest: path.join(repo, 'tests/harness/baselines/source-manifest.json'),
      debt: path.join(repo, 'tests/harness/baselines/validation-debt.json'),
      ledger: path.join(repo, 'doc/平台治理/harness-engineering/来源清册.md'),
      confirmation: path.join(repo, 'tests/harness/baselines/h00a-confirmation.json')
    }
  };
}

function prepareNpmValidatorFixture() {
  const state = prepare({ realTooling: true });
  git(state.repo, ['checkout', '--detach', '-q', state.captureSubjectCommit]);
  assert.strictEqual(git(state.repo, ['rev-parse', 'HEAD']).trim(), state.captureSubjectCommit);
  assert.strictEqual(git(state.repo, ['status', '--porcelain']).trim(), '');
  return state;
}

function captureProcess(state, extra) {
  const result = spawnSync(process.execPath, ['scripts/harness/capture-validation-debt.js', ...extra], {
    cwd: state.repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', output: `${result.stdout || ''}${result.stderr || ''}` };
}

function canonicalValidatorArguments(state, migration = state.files.migration) {
  return [
    '--mode', 'frozen',
    '--project-root', state.repo,
    '--manifest', state.files.manifest,
    '--incidents', state.files.incidents,
    '--families', state.files.families,
    '--debt', state.files.debt,
    '--confirmation', state.files.confirmation,
    ...(migration ? ['--migration', migration] : []),
    '--ledger', state.files.ledger
  ];
}

function runNpmValidator(state, arguments_) {
  assert.notStrictEqual(state.repo, implementationRoot);
  assert.ok(arguments_.filter((value) => path.isAbsolute(value)).every((value) => {
    const relative = path.relative(state.directory, value);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }));
  const result = spawnSync('npm', ['run', 'harness:h00a:validate', '--', ...arguments_], {
    cwd: state.repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', output: `${result.stdout || ''}${result.stderr || ''}` };
}

function args(state, mode = 'frozen', extra = []) {
  return [validator, '--mode', mode, '--project-root', state.repo, '--manifest', state.files.manifest, '--incidents', state.files.incidents,
    '--families', state.files.families, '--debt', state.files.debt, '--confirmation', state.files.confirmation, '--migration', state.files.migration, '--ledger', state.files.ledger, ...extra];
}

function run(state, mode = 'frozen', extra = []) {
  const result = spawnSync(process.execPath, args(state, mode, extra), { cwd: state.repo, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', output: `${result.stdout || ''}${result.stderr || ''}` };
}

function mutateJson(file, callback) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  callback(value);
  writeJson(file, value);
}

function approveFixture(state) {
  const manifest = JSON.parse(fs.readFileSync(state.files.manifest, 'utf8'));
  mutateJson(state.files.confirmation, (value) => {
    value.status = 'approved';
    value.reviewed_by = 'independent-reviewer';
    value.reviewed_at = '2026-08-01T00:00:00Z';
    value.reviewed_frozen_capture_id = manifest.frozen_capture_identity.frozen_capture_id;
    value.reviewed_capture_subject_commit = manifest.frozen_capture_identity.capture_subject_commit;
    value.h00b_unlocked = true;
    value.required_checks.forEach((item) => { item.status = 'approved'; });
  });
}

function cleanup(state) {
  fs.rmSync(state.directory, { recursive: true, force: true });
}

test('R2 npm wrapper validates the explicitly supplied canonical migration', () => {
  const state = prepareNpmValidatorFixture();
  try {
    let result = runNpmValidator(state, canonicalValidatorArguments(state));
    assert.strictEqual(result.status, 0, result.output);
    assert.match(result.stdout, /valid-frozen-evidence/);
    write(path.join(state.repo, 'tracked-host-sentinel.txt'), 'tracked\n');
    git(state.repo, ['add', 'tracked-host-sentinel.txt']);
    write(path.join(state.repo, 'untracked-host-sentinel.txt'), 'untracked\n');
    result = runNpmValidator(state, canonicalValidatorArguments(state));
    assert.strictEqual(result.status, 0, result.output);
  } finally { cleanup(state); }
});

test('R2 npm wrapper rejects every explicitly supplied migration tampering class', () => {
  const state = prepareNpmValidatorFixture();
  const mutations = [
    (value) => { value.summary.added += 1; },
    (value) => { value.before.payload_sha256 = '0'.repeat(64); },
    (value) => { value.after.frozen_capture_id = 'H00A-FROZEN-tampered'; },
    (value) => { value.removed = []; }
  ];
  try {
    for (const [index, mutate] of mutations.entries()) {
      const migration = JSON.parse(fs.readFileSync(state.files.migration, 'utf8'));
      mutate(migration);
      const target = path.join(state.directory, `tampered-${index}.json`);
      writeJson(target, migration);
      const result = runNpmValidator(state, canonicalValidatorArguments(state, target));
      assert.strictEqual(result.status, 1, result.output);
      assert.match(result.output, /schema migration report does not match a fresh recomputation/);
    }
    mutateJson(state.files.migration, (value) => { value.summary.added += 1; });
    const result = runNpmValidator(state, canonicalValidatorArguments(state));
    assert.strictEqual(result.status, 1, result.output);
    assert.match(result.output, /schema migration report does not match a fresh recomputation/);
  } finally { cleanup(state); }
});

test('R2 validator rejects duplicate, missing and valueless arguments', () => {
  const state = prepareNpmValidatorFixture();
  try {
    for (const [arguments_, message] of [
      [canonicalValidatorArguments(state).concat('--migration', state.files.migration), /--migration must be provided exactly once/],
      [canonicalValidatorArguments(state, null), /--migration is required/],
      [canonicalValidatorArguments(state).concat('--mode', 'frozen'), /--mode must be provided exactly once/],
      [canonicalValidatorArguments(state).concat('--fail-on-drift', '--fail-on-drift'), /--fail-on-drift must be provided exactly once/],
      [['--migration'], /--migration requires a value/]
    ]) {
      const result = runNpmValidator(state, arguments_);
      assert.strictEqual(result.status, 1, result.output);
      assert.match(result.output, message);
    }
  } finally { cleanup(state); }
});

test(r2Case('R2-01').test_title, () => {
  const state = prepare();
  try {
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-01').expected_exit, result.output);
    const summary = JSON.parse(result.stdout);
    assert.strictEqual(summary.confirmationStatus, 'pending-review');
    assert.strictEqual(summary.h00bUnlocked, false);
    const confirmation = JSON.parse(fs.readFileSync(state.files.confirmation, 'utf8'));
    assert.strictEqual(confirmation.required_checks.length, 9);
  } finally { cleanup(state); }
});

test(r2Case('R2-02').test_title, () => {
  const state = prepare();
  try {
    approveFixture(state);
    mutateJson(state.files.confirmation, (value) => {
      value.required_checks = [{ id: 'CUSTOM', label: 'forged', status: 'approved', evidence_refs: ['fake'] }];
    });
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-02').expected_exit, result.output);
    assert.match(result.output, /canonical nine-check ID order/);
    assert.match(result.output, /unexpected IDs: CUSTOM/);
  } finally { cleanup(state); }
});

test(r2Case('R2-03').test_title, async (t) => {
  for (const missingId of CANONICAL_H00A_REVIEW_CHECK_IDS) {
    await t.test(`reports missing canonical check ${missingId}`, () => {
      const state = prepare();
      try {
        mutateJson(state.files.confirmation, (value) => {
          value.required_checks = value.required_checks.filter((check) => check.id !== missingId);
        });
        const result = run(state);
        assert.strictEqual(result.status, r2Case('R2-03').expected_exit, `${missingId}: ${result.output}`);
        assert.match(result.output, /missing IDs:/);
        assert.match(result.output, new RegExp(`missing IDs:[^\n]*${missingId}`));
      } finally { cleanup(state); }
    });
  }
});

test(r2Case('R2-04').test_title, async (t) => {
  for (const [name, mutate, message] of [
    ['duplicate', (value) => { value.required_checks[8].id = value.required_checks[0].id; }, /duplicate IDs: H00A-CHECK-SOURCES/],
    ['reordered', (value) => { value.required_checks.reverse(); }, /order mismatch:/]
  ]) {
    await t.test(name, () => {
      const state = prepare();
      try {
        mutateJson(state.files.confirmation, mutate);
        const result = run(state);
        assert.strictEqual(result.status, r2Case('R2-04').expected_exit, result.output);
        assert.match(result.output, message);
      } finally { cleanup(state); }
    });
  }
});

test(r2Case('R2-05').test_title, () => {
  const state = prepare();
  try {
    approveFixture(state);
    mutateJson(state.files.confirmation, (value) => { value.reviewed_by = null; });
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-05').expected_exit, result.output);
    assert.match(result.output, /confirmation\.reviewed_by must be a non-placeholder reviewer/);
  } finally { cleanup(state); }
});

test(r2Case('R2-06').test_title, async (t) => {
  for (const value of [null, 'not-a-time']) {
    await t.test(String(value), () => {
      const state = prepare();
      try {
        approveFixture(state);
        mutateJson(state.files.confirmation, (confirmation) => { confirmation.reviewed_at = value; });
        const result = run(state);
        assert.strictEqual(result.status, r2Case('R2-06').expected_exit, result.output);
        assert.match(result.output, /confirmation\.reviewed_at must be an ISO 8601 timestamp/);
      } finally { cleanup(state); }
    });
  }
});

test(r2Case('R2-07').test_title, () => {
  const state = prepare();
  try {
    approveFixture(state);
    mutateJson(state.files.confirmation, (value) => { value.reviewed_frozen_capture_id = 'H00A-FROZEN-old'; });
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-07').expected_exit, result.output);
    assert.match(result.output, /reviewed_frozen_capture_id must match manifest frozen_capture_id/);
  } finally { cleanup(state); }
});

test(r2Case('R2-08').test_title, () => {
  const state = prepare();
  try {
    approveFixture(state);
    mutateJson(state.files.confirmation, (value) => { value.reviewed_capture_subject_commit = '0'.repeat(40); });
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-08').expected_exit, result.output);
    assert.match(result.output, /reviewed_capture_subject_commit must match manifest capture_subject_commit/);
  } finally { cleanup(state); }
});

test(r2Case('R2-09').test_title, () => {
  const state = prepare();
  try {
    approveFixture(state);
    mutateJson(state.files.manifest, (value) => { value.frozen_capture_identity.frozen_capture_id = 'H00A-FROZEN-replayed'; });
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-09').expected_exit, result.output);
    assert.match(result.output, /reviewed_frozen_capture_id must match manifest frozen_capture_id/);
  } finally { cleanup(state); }
});

test(r2Case('R2-10').test_title, () => {
  const state = prepare();
  try {
    approveFixture(state);
    const result = run(state);
    assert.strictEqual(result.status, r2Case('R2-10').expected_exit, result.output);
    assert.strictEqual(JSON.parse(result.stdout).h00bUnlocked, true);
  } finally { cleanup(state); }
});

test(r2Case('R2-11').test_title, () => {
  const state = prepareCaptureFixture();
  const output = path.join(state.directory, 'r2-11-temporary.json');
  try {
    const result = captureProcess(state, ['--out', output, '--subject-commit', state.captureSubjectCommit]);
    assert.strictEqual(result.status, r2Case('R2-11').expected_exit, result.output);
    const debt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.strictEqual(debt.capture_mode, 'temporary-current-observation');
    assert.strictEqual(debt.commands.length, 9);
  } finally { cleanup(state); }
});

test(r2Case('R2-12').test_title, () => {
  const state = prepareCaptureFixture();
  const output = path.join(state.directory, 'r2-12-temporary.json');
  const before = Object.fromEntries(Object.entries(state.files).map(([name, file]) => [name, sha256File(file)]));
  try {
    const result = captureProcess(state, ['--out', output, '--subject-commit', state.captureSubjectCommit]);
    assert.strictEqual(result.status, r2Case('R2-12').expected_exit, result.output);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(state.files).map(([name, file]) => [name, sha256File(file)])), before);
  } finally { cleanup(state); }
});

test(r2Case('R2-13').test_title, async (t) => {
  for (const kind of ['existing', 'symlink', 'hardlink']) {
    await t.test(kind, () => {
      const state = prepareCaptureFixture();
      const output = path.join(state.directory, `r2-13-${kind}.json`);
      const before = Object.fromEntries(Object.entries(state.files).map(([name, file]) => [name, sha256File(file)]));
      try {
        if (kind === 'existing') write(output, 'existing\n');
        if (kind === 'symlink') fs.symlinkSync(state.files.confirmation, output);
        if (kind === 'hardlink') fs.linkSync(state.files.confirmation, output);
        const result = captureProcess(state, ['--out', output, '--subject-commit', state.captureSubjectCommit]);
        assert.strictEqual(result.status, r2Case('R2-13').expected_exit, result.output);
        assert.match(result.output, /must not already exist/);
        assert.deepStrictEqual(Object.fromEntries(Object.entries(state.files).map(([name, file]) => [name, sha256File(file)])), before);
      } finally { cleanup(state); }
    });
  }
});

function assertMigrationMutation(id, mutate, diagnostics = []) {
  const state = prepare();
  try {
    let dynamicDiagnostics = [];
    mutateJson(state.files.migration, (value) => { dynamicDiagnostics = mutate(value) || []; });
    const result = run(state);
    assert.strictEqual(result.status, r2Case(id).expected_exit, result.output);
    assert.match(result.output, /schema migration report does not match a fresh recomputation/);
    for (const diagnostic of [...diagnostics, ...dynamicDiagnostics]) assert.match(result.output, diagnostic);
  } finally { cleanup(state); }
}

test(r2Case('R2-14').test_title, async (t) => {
  for (const field of ['unchanged', 'added', 'removed', 'changed']) {
    await t.test(field, () => assertMigrationMutation('R2-14', (value) => { value.summary[field] += 1; }, [new RegExp(`summary\\.${field}`)]));
  }
});

test(r2Case('R2-15').test_title, async (t) => {
  await t.test('before hash', () => assertMigrationMutation('R2-15', (value) => { value.before.payload_sha256 = '0'.repeat(64); }, [/before\.payload_sha256/]));
  await t.test('after hash', () => assertMigrationMutation('R2-15', (value) => { value.after.payload_sha256 = '0'.repeat(64); }, [/after\.payload_sha256/]));
});

test(r2Case('R2-16').test_title, () => {
  assertMigrationMutation('R2-16', (value) => { value.after.frozen_capture_id = 'H00A-FROZEN-tampered'; }, [/after\.frozen_capture_id/]);
});

test(r2Case('R2-17').test_title, async (t) => {
  await t.test('added detail', () => assertMigrationMutation('R2-17', (value) => {
    value.added.push({ failure_key: 'FORGED-ADDED-KEY' });
    return [/added unexpected failure_key: FORGED-ADDED-KEY/];
  }));
  await t.test('removed detail', () => assertMigrationMutation('R2-17', (value) => {
    const failureKey = value.removed[0].failure_key;
    value.removed = value.removed.slice(1);
    return [new RegExp(`removed missing failure_key: ${failureKey}`)];
  }));
});

test('migration diagnostics report sorted missing, unexpected and changed failure keys', () => {
  const record = (failureKey, marker) => ({ failure_key: failureKey, marker });
  const expected = {
    before: { payload_sha256: 'before' }, after: { payload_sha256: 'after', frozen_capture_id: 'capture' },
    summary: { unchanged: 1, added: 2, removed: 2, changed: 2 },
    added: [record('A-MISSING', 1), record('B-CHANGED', 1)],
    removed: [record('C-MISSING', 1), record('D-CHANGED', 1)],
    changed: [record('E-MISSING', 1), record('F-CHANGED', 1)]
  };
  const actual = {
    ...expected,
    added: [record('B-CHANGED', 2), record('G-UNEXPECTED', 1)],
    removed: [record('D-CHANGED', 2), record('H-UNEXPECTED', 1)],
    changed: [record('F-CHANGED', 2), record('I-UNEXPECTED', 1)]
  };
  assert.deepStrictEqual(migrationDiagnostics(expected, actual), [
    'schema migration added missing failure_key: A-MISSING',
    'schema migration added changed failure_key: B-CHANGED',
    'schema migration added unexpected failure_key: G-UNEXPECTED',
    'schema migration changed missing failure_key: E-MISSING',
    'schema migration changed changed failure_key: F-CHANGED',
    'schema migration changed unexpected failure_key: I-UNEXPECTED',
    'schema migration removed missing failure_key: C-MISSING',
    'schema migration removed changed failure_key: D-CHANGED',
    'schema migration removed unexpected failure_key: H-UNEXPECTED'
  ]);
});

test(r2Case('R2-18').test_title, async (t) => {
  for (const verifier of ['validator', 'identity_engine', 'command_contract', 'migration_comparator']) {
    await t.test(verifier, () => {
      const state = prepare();
      try {
        for (const file of [state.files.manifest, state.files.debt]) {
          mutateJson(file, (value) => { value.frozen_capture_identity.tooling[verifier].sha256 = '0'.repeat(64); });
        }
        const result = run(state);
        assert.strictEqual(result.status, r2Case('R2-18').expected_exit, result.output);
        assert.match(result.output, new RegExp(`${verifier}\\.sha256 does not match the frozen Git blob`));
      } finally { cleanup(state); }
    });
  }
});

test(r2Case('R2-19').test_title, () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'scripts/harness/validate-h00a.js'), 'changed-verifier\n');
    const frozen = run(state);
    assert.strictEqual(frozen.status, r2Case('R2-19').expected_exit, frozen.output);
    const drift = run(state, 'current-drift');
    assert.strictEqual(drift.status, 0, drift.output);
    const report = JSON.parse(drift.stdout);
    assert.strictEqual(report.tooling.find((item) => item.path.endsWith('validate-h00a.js')).status, 'changed');
  } finally { cleanup(state); }
});

test(r2Case('R2-20').test_title, () => {
  const state = prepareCaptureFixture();
  const before = fs.readFileSync(state.files.confirmation);
  try {
    const result = captureProcess(state, ['--write-manifest', '--subject-commit', state.captureSubjectCommit]);
    assert.strictEqual(result.status, r2Case('R2-20').expected_exit, result.output);
    assert.deepStrictEqual(fs.readFileSync(state.files.confirmation), before);
    const confirmation = JSON.parse(before.toString('utf8'));
    assert.strictEqual(confirmation.status, 'pending-review');
    for (const field of ['reviewed_by', 'reviewed_at', 'reviewed_frozen_capture_id', 'reviewed_capture_subject_commit']) assert.strictEqual(confirmation[field], null);
    assert.strictEqual(confirmation.h00b_unlocked, false);
  } finally { cleanup(state); }
});

test('frozen evidence passes with H00B locked and drift is clean', () => {
  const state = prepare();
  try {
    const frozen = run(state);
    assert.strictEqual(frozen.status, 0, frozen.output);
    assert.match(frozen.stdout, /"h00bUnlocked": false/);
    const drift = run(state, 'current-drift');
    assert.strictEqual(drift.status, 0, drift.output);
    assert.strictEqual(JSON.parse(drift.stdout).has_drift, false);
  } finally { cleanup(state); }
});

test('an unrelated commit preserves frozen approval and appears only in drift', () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'later.txt'), 'later\n');
    commit(state.repo, 'unrelated later commit');
    assert.strictEqual(run(state).status, 0);
    const report = JSON.parse(run(state, 'current-drift').stdout);
    assert.strictEqual(report.head_changed, true);
    assert.deepStrictEqual(report.tracked_tree_changes, [{ status: 'A', path: 'later.txt' }]);
  } finally { cleanup(state); }
});

test('tracked dirty preserves frozen approval and is reported precisely', () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'AGENTS.md'), 'dirty-agent-rule\n');
    assert.strictEqual(run(state).status, 0);
    const report = JSON.parse(run(state, 'current-drift').stdout);
    assert.deepStrictEqual(report.tracked_dirty, [{ status: 'M', path: 'AGENTS.md' }]);
    assert.strictEqual(report.sources.find((item) => item.id === 'R-AGENTS').status, 'changed');
  } finally { cleanup(state); }
});

test('untracked files preserve frozen approval and are reported precisely', () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'new-untracked.html'), '<title>new</title>\n');
    assert.strictEqual(run(state).status, 0);
    const report = JSON.parse(run(state, 'current-drift').stdout);
    assert.deepStrictEqual(report.untracked, ['new-untracked.html']);
  } finally { cleanup(state); }
});

test('deleted tracked files preserve frozen approval and are reported precisely', () => {
  const state = prepare();
  try {
    fs.unlinkSync(path.join(state.repo, 'AGENTS.md'));
    assert.strictEqual(run(state).status, 0);
    const report = JSON.parse(run(state, 'current-drift').stdout);
    assert.deepStrictEqual(report.tracked_dirty, [{ status: 'D', path: 'AGENTS.md' }]);
    assert.strictEqual(report.sources.find((item) => item.id === 'R-AGENTS').status, 'missing');
  } finally { cleanup(state); }
});

test('current capture and normalizer tool changes are drift, not frozen evidence failure', () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'scripts/harness/capture-validation-debt.js'), 'changed\n');
    write(path.join(state.repo, 'scripts/harness/h00a-normalizer.js'), 'changed normalizer\n');
    assert.strictEqual(run(state).status, 0);
    const report = JSON.parse(run(state, 'current-drift').stdout);
    assert.strictEqual(report.tooling.find((item) => item.path.endsWith('capture-validation-debt.js')).status, 'changed');
    assert.strictEqual(report.tooling.find((item) => item.path.endsWith('h00a-normalizer.js')).status, 'changed');
  } finally { cleanup(state); }
});

test('external source changes and disappearance are drift only', () => {
  const state = prepare();
  try {
    write(state.externalPrinciple, 'changed external\n');
    assert.strictEqual(run(state).status, 0);
    let report = JSON.parse(run(state, 'current-drift').stdout);
    assert.strictEqual(report.sources.find((item) => item.id === 'A-EXTERNAL').status, 'changed');
    fs.unlinkSync(state.externalPrinciple);
    assert.strictEqual(run(state).status, 0);
    report = JSON.parse(run(state, 'current-drift').stdout);
    assert.strictEqual(report.sources.find((item) => item.id === 'A-EXTERNAL').status, 'missing');
  } finally { cleanup(state); }
});

test('fail-on-drift exits 2 without changing frozen approval', () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'dirty.txt'), 'dirty\n');
    const drift = run(state, 'current-drift', ['--fail-on-drift']);
    assert.strictEqual(drift.status, 2, drift.output);
    assert.strictEqual(run(state).status, 0);
  } finally { cleanup(state); }
});

test('tampered source hash fails frozen validation', () => {
  const state = prepare();
  try {
    mutateJson(state.files.manifest, (value) => { value.sources[0].sha256 = '0'.repeat(64); });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /does not match frozen Git-tree content/);
  } finally { cleanup(state); }
});

test('tampered source semantics fail the source-set identity', () => {
  const state = prepare();
  try {
    mutateJson(state.files.manifest, (value) => { value.sources[0].owner = 'tampered'; });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /aggregate_sha256|sources must exactly match/);
  } finally { cleanup(state); }
});

test('tampered capture tree fails frozen validation', () => {
  const state = prepare();
  try {
    for (const file of [state.files.manifest, state.files.debt]) mutateJson(file, (value) => { value.frozen_capture_identity.capture_tree = state.projectStartCommit; });
    let ledger = fs.readFileSync(state.files.ledger, 'utf8');
    ledger = ledger.replace(/"capture_tree": "[a-f0-9]{40}"/, `"capture_tree": "${state.projectStartCommit}"`);
    write(state.files.ledger, ledger);
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /capture_tree does not match/);
  } finally { cleanup(state); }
});

test('tampered debt payload fails frozen validation', () => {
  const state = prepare();
  try {
    mutateJson(state.files.debt, (value) => { value.scope_note = 'tampered payload'; });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /debt_payload_sha256 does not match/);
  } finally { cleanup(state); }
});

test('missing frozen Git object or wrong commit identity fails', () => {
  const state = prepare();
  try {
    for (const file of [state.files.manifest, state.files.debt]) mutateJson(file, (value) => { value.frozen_capture_identity.capture_subject_commit = '0'.repeat(40); });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /capture_subject_commit is not readable from Git/);
  } finally { cleanup(state); }
});

test('tampered frozen tool hash fails', () => {
  const state = prepare();
  try {
    for (const file of [state.files.manifest, state.files.debt]) mutateJson(file, (value) => { value.frozen_capture_identity.tooling.capture_tool.sha256 = '0'.repeat(64); });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /capture_tool.sha256 does not match the frozen Git blob/);
  } finally { cleanup(state); }
});

test('manifest, debt and ledger identity divergence fails', () => {
  const state = prepare();
  try {
    mutateJson(state.files.debt, (value) => { value.frozen_capture_identity.frozen_capture_id = 'H00A-FROZEN-tampered'; });
    write(state.files.ledger, fs.readFileSync(state.files.ledger, 'utf8').replace(/H00A-FROZEN-[a-f0-9]{24}/, 'H00A-FROZEN-ledger-tampered'));
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /must exactly match|capture ledger identity/);
  } finally { cleanup(state); }
});

test('old Harness remains an exact 15-file historical snapshot', () => {
  const state = prepare();
  try {
    mutateJson(state.files.manifest, (value) => { value.sources.find((item) => item.id === 'O-OLD-HARNESS').historical_tree_member_count = 14; });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /historical_tree_member_count does not match/);
  } finally { cleanup(state); }
});

test('confirmed incident evidence types remain enforced', () => {
  const state = prepare();
  try {
    const records = fs.readFileSync(state.files.incidents, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    records[0].evidence_types = ['V'];
    write(state.files.incidents, `${records.map(JSON.stringify).join('\n')}\n`);
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /declares V without a matching source ref/);
  } finally { cleanup(state); }
});

test('failure keys and message fingerprints remain enforced', () => {
  const state = prepare();
  try {
    mutateJson(state.files.debt, (value) => {
      const failure = {
        failure_key: 'FAIL-invalid', command_id: value.commands[0].id, file: 'AGENTS.md', rule_code: 'fixture/rule', category: 'fixture',
        identity_subject: 'fixture', severity: 'P1', normalized_message: 'fixture', message_fingerprint: '0'.repeat(64), occurrence_count: 1
      };
      value.failure_inventory = [failure];
      value.commands[0].failure_keys = [failure.failure_key];
      value.commands[0].failure_count = 1;
      value.commands[0].issue_count = 1;
    });
    const result = run(state);
    assert.strictEqual(result.status, 1);
    assert.match(result.output, /message_fingerprint|failure_key is not stable/);
  } finally { cleanup(state); }
});

test('deleting any canonical command fails', () => {
  const state = prepare();
  try {
    for (const command of CANONICAL_H00A_COMMANDS) {
      const original = fs.readFileSync(state.files.debt);
      mutateJson(state.files.debt, (value) => { value.commands = value.commands.filter((item) => item.id !== command.id); });
      const result = run(state);
      assert.strictEqual(result.status, 1, command.id);
      assert.match(result.output, /exactly 9 entries|complete ID set|is missing/);
      fs.writeFileSync(state.files.debt, original);
    }
  } finally { cleanup(state); }
});

test('duplicate command IDs and relation drift fail', () => {
  const state = prepare();
  try {
    mutateJson(state.files.debt, (value) => { value.commands[1].id = value.commands[0].id; });
    assert.match(run(state).output, /unique IDs/);
    const clean = prepare();
    try {
      mutateJson(clean.files.debt, (value) => { value.commands[7].component_command_ids = []; });
      assert.match(run(clean).output, /component_command_ids must match/);
    } finally { cleanup(clean); }
  } finally { cleanup(state); }
});

test('approval can consume frozen evidence while providers remain pending smoke', () => {
  const state = prepare();
  try {
    mutateJson(state.files.confirmation, (value) => {
      value.status = 'approved'; value.h00b_unlocked = true;
      value.reviewed_by = 'independent-reviewer';
      value.reviewed_at = '2026-08-01T00:00:00Z';
      value.reviewed_frozen_capture_id = JSON.parse(fs.readFileSync(state.files.manifest, 'utf8')).frozen_capture_identity.frozen_capture_id;
      value.reviewed_capture_subject_commit = state.captureSubjectCommit;
      value.required_checks.forEach((item) => { item.status = 'approved'; });
    });
    assert.strictEqual(run(state).status, 0);
  } finally { cleanup(state); }
});

test('R2 rejects a forged custom approval check set', () => {
  const state = prepare();
  try {
    mutateJson(state.files.confirmation, (value) => {
      value.status = 'approved'; value.h00b_unlocked = true;
      value.required_checks = [{ id: 'CUSTOM', label: 'forged', status: 'approved', evidence_refs: ['fake'] }];
    });
    assert.strictEqual(run(state).status, 1);
    assert.match(run(state).output, /canonical nine-check ID order/);
  } finally { cleanup(state); }
});

test('R2 rejects missing, duplicate and reordered canonical checks', () => {
  for (const mutate of [
    (value) => { value.required_checks.pop(); },
    (value) => { value.required_checks[8].id = value.required_checks[0].id; },
    (value) => { value.required_checks.reverse(); }
  ]) {
    const state = prepare();
    try {
      mutateJson(state.files.confirmation, mutate);
      assert.strictEqual(run(state).status, 1);
      assert.match(run(state).output, /canonical nine-check ID order/);
    } finally { cleanup(state); }
  }
});

test('R2 binds approved reviewer, time and frozen identity fields', () => {
  for (const mutate of [
    (value) => { value.reviewed_by = null; },
    (value) => { value.reviewed_at = 'not-a-time'; },
    (value) => { value.reviewed_frozen_capture_id = 'H00A-FROZEN-old'; },
    (value) => { value.reviewed_capture_subject_commit = '0'.repeat(40); }
  ]) {
    const state = prepare();
    try {
      approveFixture(state);
      mutateJson(state.files.confirmation, mutate);
      assert.strictEqual(run(state).status, 1);
    } finally { cleanup(state); }
  }
});

test('R2 rejects replaying an approval after frozen capture identity changes', () => {
  const state = prepare();
  try {
    approveFixture(state);
    mutateJson(state.files.manifest, (value) => { value.frozen_capture_identity.frozen_capture_id = 'H00A-FROZEN-replayed'; });
    assert.match(run(state).output, /reviewed_frozen_capture_id must match manifest frozen_capture_id/);
  } finally { cleanup(state); }
});

test('R2 rejects every migration report tampering class', () => {
  for (const mutate of [
    (value) => { value.summary.added += 1; },
    (value) => { value.before.payload_sha256 = '0'.repeat(64); },
    (value) => { value.after.frozen_capture_id = 'H00A-FROZEN-tampered'; },
    (value) => { value.removed = []; }
  ]) {
    const state = prepare();
    try {
      mutateJson(state.files.migration, mutate);
      assert.strictEqual(run(state).status, 1);
      assert.match(run(state).output, /schema migration report does not match/);
    } finally { cleanup(state); }
  }
});

test('R2 tracks verifier components in current drift', () => {
  const state = prepare();
  try {
    write(path.join(state.repo, 'scripts/harness/validate-h00a.js'), 'changed-verifier\n');
    const report = JSON.parse(run(state, 'current-drift').stdout);
    assert.strictEqual(report.tooling.find((item) => item.path.endsWith('validate-h00a.js')).status, 'changed');
    assert.strictEqual(report.tooling.find((item) => item.path.endsWith('h00a-identity.js')).status, 'unchanged');
  } finally { cleanup(state); }
});

test('R2 hermetic temporary capture runs the real capture process', () => {
  const state = prepareCaptureFixture();
  const output = path.join(state.directory, 'temporary-capture.json');
  try {
    const result = captureProcess(state, ['--out', output, '--subject-commit', state.captureSubjectCommit]);
    assert.strictEqual(result.status, 0, result.output);
    const summary = JSON.parse(result.stdout);
    const debt = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.strictEqual(summary.transaction_state, 'temporary-output-written');
    assert.strictEqual(summary.manifest_written, false);
    assert.strictEqual(summary.commands, 9);
    assert.strictEqual(debt.capture_mode, 'temporary-current-observation');
    assert.deepStrictEqual(debt.commands.map((command) => command.id), CANONICAL_H00A_COMMANDS.map((command) => command.id));
  } finally { cleanup(state); }
});

test('R2 temporary capture preserves canonical artifact bytes', () => {
  const state = prepareCaptureFixture();
  const output = path.join(state.directory, 'temporary-capture.json');
  const before = Object.fromEntries(Object.entries(state.files).map(([name, file]) => [name, sha256File(file)]));
  try {
    const result = captureProcess(state, ['--out', output, '--subject-commit', state.captureSubjectCommit]);
    assert.strictEqual(result.status, 0, result.output);
    assert.deepStrictEqual(
      Object.fromEntries(Object.entries(state.files).map(([name, file]) => [name, sha256File(file)])),
      before
    );
  } finally { cleanup(state); }
});

test('R2 rejects each tampered verifier Git blob hash', () => {
  for (const verifier of ['validator', 'identity_engine', 'command_contract', 'migration_comparator']) {
    const state = prepare();
    try {
      for (const file of [state.files.manifest, state.files.debt]) {
        mutateJson(file, (value) => { value.frozen_capture_identity.tooling[verifier].sha256 = '0'.repeat(64); });
      }
      const result = run(state);
      assert.strictEqual(result.status, 1, result.output);
      assert.match(result.output, new RegExp(`${verifier}\\.sha256 does not match the frozen Git blob`));
    } finally { cleanup(state); }
  }
});

test('R2 canonical capture preserves pending confirmation and H00B lock', () => {
  const state = prepareCaptureFixture();
  const confirmationBefore = fs.readFileSync(state.files.confirmation);
  try {
    const result = captureProcess(state, ['--write-manifest', '--subject-commit', state.captureSubjectCommit]);
    assert.strictEqual(result.status, 0, result.output);
    const summary = JSON.parse(result.stdout);
    assert.strictEqual(summary.manifest_written, true);
    assert.strictEqual(summary.commands, 9);
    assert.deepStrictEqual(fs.readFileSync(state.files.confirmation), confirmationBefore);
    const confirmation = JSON.parse(confirmationBefore.toString('utf8'));
    assert.strictEqual(confirmation.schema_version, 'h00a-confirmation-v2');
    assert.strictEqual(confirmation.status, 'pending-review');
    for (const field of ['reviewed_by', 'reviewed_at', 'reviewed_frozen_capture_id', 'reviewed_capture_subject_commit']) {
      assert.strictEqual(confirmation[field], null);
    }
    assert.strictEqual(confirmation.h00b_unlocked, false);
    assert.strictEqual(confirmation.required_checks.length, 9);
    assert.ok(confirmation.required_checks.every((check) => check.status === 'ready-for-review'));
  } finally { cleanup(state); }
});

test('R2 matrix contract rejects semantic ID swaps', () => {
  validateR2TestCases(R2_TEST_CASES);
  assert.deepStrictEqual(R2_TEST_MAP, Object.fromEntries(R2_TEST_CASES.map(({ id, test_title }) => [id, test_title])));
  for (let left = 0; left < R2_TEST_CASES.length; left += 1) {
    for (let right = left + 1; right < R2_TEST_CASES.length; right += 1) {
      const scenarioSwap = R2_TEST_CASES.map((item) => ({ ...item, assertions: [...item.assertions] }));
      [scenarioSwap[left].scenario, scenarioSwap[right].scenario] = [scenarioSwap[right].scenario, scenarioSwap[left].scenario];
      assert.throws(() => validateR2TestCases(scenarioSwap), `${scenarioSwap[left].id}/${scenarioSwap[right].id} scenario swap`);
      const titleSwap = R2_TEST_CASES.map((item) => ({ ...item, assertions: [...item.assertions] }));
      [titleSwap[left].test_title, titleSwap[right].test_title] = [titleSwap[right].test_title, titleSwap[left].test_title];
      assert.throws(() => validateR2TestCases(titleSwap), `${titleSwap[left].id}/${titleSwap[right].id} title swap`);
    }
  }
});

test('canonical capture requires clean detached HEAD equal to subject', () => {
  const state = prepare();
  try {
    assert.throws(() => assertCanonicalCaptureEnvironment(state.repo, state.captureSubjectCommit), /detached HEAD/);
    git(state.repo, ['checkout', '--detach', '-q', state.captureSubjectCommit]);
    assert.doesNotThrow(() => assertCanonicalCaptureEnvironment(state.repo, state.captureSubjectCommit));
    write(path.join(state.repo, 'dirty.txt'), 'dirty\n');
    assert.throws(() => assertCanonicalCaptureEnvironment(state.repo, state.captureSubjectCommit), /clean isolated worktree/);
  } finally { cleanup(state); }
});

test('capture generation has no legacy live-workspace identity variable', () => {
  const source = fs.readFileSync(captureImplementation, 'utf8');
  assert.doesNotMatch(source, /const ledgerText = [^\n]+captureIdentity/);
  assert.match(source, /renderLedgerCaptureIdentity\([^\n]+frozenCaptureIdentity\)/);
});

test('canonical output requires write-manifest and rejects mixed custom paths', () => {
  const state = prepare();
  try {
    assert.throws(() => parseCaptureOptions([], state.repo), /requires --write-manifest/);
    assert.throws(() => parseCaptureOptions(['--write-manifest'], state.repo), /explicit --subject-commit/);
    assert.throws(() => parseCaptureOptions(['--write-manifest', '--out', path.join(state.directory, 'debt.json')], state.repo), /requires canonical manifest/);
    assert.throws(() => parseCaptureOptions(['--write-manifest', '--manifest', path.join(state.directory, 'manifest.json')], state.repo), /requires canonical manifest/);
    assert.throws(() => parseCaptureOptions(['--write-manifest', '--ledger', path.join(state.directory, 'ledger.md')], state.repo), /requires canonical manifest/);
  } finally { cleanup(state); }
});

test('temporary output rejects project paths, traversal and parent symlinks', () => {
  const state = prepare();
  const link = path.join(state.directory, 'project-link');
  fs.symlinkSync(state.repo, link, 'dir');
  try {
    for (const candidate of [path.join(state.repo, 'index.html'), path.join('..', path.basename(state.repo), 'index.html'), path.join(link, 'index.html')]) {
      assert.throws(() => resolveSafeTemporaryOutput(candidate, state.repo), /outside the project root/);
    }
  } finally { cleanup(state); }
});

test('temporary output rejects existing symlink and hardlink aliases without mutation', () => {
  const state = prepare();
  const target = path.join(state.repo, 'AGENTS.md');
  const symlink = path.join(state.directory, 'symlink.json');
  const hardlink = path.join(state.directory, 'hardlink.json');
  const before = fs.readFileSync(target);
  fs.symlinkSync(target, symlink);
  fs.linkSync(target, hardlink);
  try {
    assert.throws(() => resolveSafeTemporaryOutput(symlink, state.repo), /must not already exist/);
    assert.throws(() => resolveSafeTemporaryOutput(hardlink, state.repo), /must not already exist/);
    assert.deepStrictEqual(fs.readFileSync(target), before);
  } finally { cleanup(state); }
});

function transactionFixture(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const files = ['debt.json', 'manifest.json', 'ledger.md'].map((name, index) => {
    const file = path.join(directory, name); write(file, `original-${index}\n`); return file;
  });
  return { directory, files };
}

test('transaction restores all files when the third replacement fails', () => {
  const state = transactionFixture('h00a-transaction-');
  try {
    assert.throws(() => commitFileTransaction(state.files.map((file, index) => ({ file, content: `replacement-${index}\n` })), {
      beforeReplace: ({ index }) => { if (index === 2) throw new Error('third failure'); }
    }), /third failure/);
    state.files.forEach((file, index) => assert.strictEqual(fs.readFileSync(file, 'utf8'), `original-${index}\n`));
    assert.strictEqual(fs.readdirSync(state.directory).some((name) => name.includes('.h00a-')), false);
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('rollback failure preserves the only original backup', () => {
  const state = transactionFixture('h00a-rollback-');
  try {
    let failure;
    try {
      commitFileTransaction(state.files.map((file, index) => ({ file, content: `replacement-${index}\n` })), {
        beforeReplace: ({ index }) => { if (index === 2) throw new Error('third failure'); },
        restoreBackup: ({ index, backup, file }) => { if (index === 1) throw new Error('restore failure'); fs.renameSync(backup, file); }
      });
    } catch (error) { failure = error; }
    assert.strictEqual(failure.transactionState, 'rollback-incomplete-with-preserved-backups');
    assert.strictEqual(fs.readFileSync(failure.recoveryBackups[0], 'utf8'), 'original-1\n');
    assert.strictEqual(fs.readFileSync(state.files[1], 'utf8'), 'replacement-1\n');
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('post-commit cleanup failure returns committed state with backup residue', () => {
  const state = transactionFixture('h00a-cleanup-');
  try {
    const result = commitFileTransaction(state.files.map((file, index) => ({ file, content: `replacement-${index}\n` })), {
      removeBackup: ({ index, backup }) => { if (index === 1) throw new Error('cleanup failure'); fs.unlinkSync(backup); }
    });
    assert.strictEqual(result.transactionState, 'committed-with-cleanup-warnings');
    assert.strictEqual(fs.readFileSync(result.recoveryBackups[0], 'utf8'), 'original-1\n');
    state.files.forEach((file, index) => assert.strictEqual(fs.readFileSync(file, 'utf8'), `replacement-${index}\n`));
  } finally { fs.rmSync(state.directory, { recursive: true, force: true }); }
});

test('nested worktree failure paths remain rejected without reading the real repository', () => {
  const state = prepare();
  try {
    mutateJson(state.files.debt, (value) => {
      const failure = {
        command_id: value.commands[0].id, file: 'module/.claude/worktrees/local/page.html', rule_code: 'fixture/rule', category: 'fixture',
        identity_subject: 'fixture', severity: 'P1', normalized_message: 'fixture', message_fingerprint: sha256String('fixture'), occurrence_count: 1
      };
      failure.failure_key = failureKey(failure);
      value.failure_inventory = [failure];
      value.commands[0].failure_keys = [failure.failure_key]; value.commands[0].failure_count = 1; value.commands[0].issue_count = 1;
    });
    assert.match(run(state).output, /excluded nested worktree/);
  } finally { cleanup(state); }
});
