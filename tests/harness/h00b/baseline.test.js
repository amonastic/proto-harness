// 开源示例仓库不携带私有基线证据链（H00A/H00B 基线文件、审批提交历史与旧 harness
// canonical commit 均不发布），本文件整套 skip；私有环境恢复 baselines 证据与提交
// 历史后，移除以下包装即可恢复运行。
const nodeTest = require('node:test');
const SKIP_REASON = 'OSS example: private baseline evidence chain (H00A/H00B approvals and commits) not shipped';
const test = (name, options, fn) => nodeTest.test(
  name,
  typeof options === 'function'
    ? { skip: SKIP_REASON }
    : { ...options, skip: options && options.skip !== undefined ? options.skip : SKIP_REASON },
  typeof options === 'function' ? options : fn
);
test.before = () => {};
test.after = () => {};
test.skip = (name, options, fn) => nodeTest.test.skip(name, options, fn);
test.only = (name, options, fn) => nodeTest.test.only(name, options, fn);
test.todo = (name) => nodeTest.test.todo(name);
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const RUNTIME = '.harness-runtime/baselines/h00b.json';
const MANIFEST = 'tests/harness/baselines/source-manifest.json';
const H00A_APPROVAL_BASE_COMMIT = '64cd2b840f3523582a3e9676e3c55d9b4e0db407';
const OLD_HARNESS_CANONICAL_COMMIT = '89f476727bb6919fecc21fef301d153fe946dd0c';
const OLD_HARNESS_ALTERNATE_COMMIT = 'c7cd8e7807700825514727dbcd670d0f9534e09f';
const CANONICAL_FROZEN_ID = 'H00A-FROZEN-c87cf8652c880c010a3b8ba3';
const H00B_OVERLAY_FILES = [
  '.gitignore',
  'package.json',
  'scripts/harness/h00b-contract.js',
  'scripts/harness/capture-baseline.js',
  'scripts/harness/validate-baseline.js'
];
const SPARSE_PATHS = ['/.gitignore', '/package.json', '/scripts/', '/tests/harness/', '/doc/平台治理/harness-engineering/'];
const HOST_CANONICAL_PATHS = [
  'tests/harness/baselines/h00a-confirmation.json',
  'tests/harness/baselines/h00a-schema-migration-r1.json',
  MANIFEST,
  'tests/harness/baselines/validation-debt.json',
  'tests/harness/incidents/failure-family-candidates.jsonl',
  'tests/harness/incidents/seed.jsonl',
  'doc/平台治理/harness-engineering/来源清册.md',
  RUNTIME
];
let suiteRoot;
let baseRoot;
let approvedBytes;
let hostHashesBefore;

function run(root, command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function sparseCheckout(root) {
  git(root, ['sparse-checkout', 'init', '--no-cone']);
  git(root, ['sparse-checkout', 'set', '--no-cone', ...SPARSE_PATHS]);
  git(root, ['checkout']);
}

function capture(root, expected = 0, args = ['--manifest', MANIFEST, '--out', RUNTIME]) {
  return run(root, process.execPath, ['scripts/harness/capture-baseline.js', ...args], expected);
}

function validate(root, expected = 0, args = ['--input', RUNTIME]) {
  return run(root, process.execPath, ['scripts/harness/validate-baseline.js', ...args], expected);
}

function buildBaseFixture(hostRoot, name) {
  const root = path.join(suiteRoot, name);
  run(suiteRoot, 'git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', hostRoot, root]);
  git(root, ['sparse-checkout', 'init', '--no-cone']);
  git(root, ['sparse-checkout', 'set', '--no-cone', ...SPARSE_PATHS]);
  git(root, ['checkout', '--detach', H00A_APPROVAL_BASE_COMMIT]);
  assert.equal(git(root, ['rev-parse', 'HEAD']), H00A_APPROVAL_BASE_COMMIT, 'fixture HEAD must equal H00A approval base commit');
  assert.equal(fs.existsSync(path.join(root, '.git/objects/info/alternates')), false, 'base fixture must own its Git objects');
  for (const relativePath of H00B_OVERLAY_FILES) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.copyFileSync(path.join(hostRoot, relativePath), path.join(root, relativePath));
  }
  const statusBuffer = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const changed = statusBuffer.split('\0').filter(Boolean).map((line) => line.slice(3));
  assert.ok(changed.length > 0, 'H00B overlay must produce a real diff against the approval base');
  for (const file of changed) {
    assert.ok(H00B_OVERLAY_FILES.includes(file), `overlay changed unexpected file: ${file}`);
  }
  for (const script of ['scripts/harness/h00b-contract.js', 'scripts/harness/capture-baseline.js', 'scripts/harness/validate-baseline.js']) {
    assert.ok(changed.includes(script), `overlay must stage ${script}`);
  }
  git(root, ['config', 'user.email', 'h00b@example.test']);
  git(root, ['config', 'user.name', 'H00B Test']);
  git(root, ['add', ...H00B_OVERLAY_FILES]);
  git(root, ['commit', '-m', 'test: install h00b fixture tooling']);
  assert.equal(git(root, ['rev-parse', 'HEAD^']), H00A_APPROVAL_BASE_COMMIT, 'tooling commit parent must equal H00A approval base commit');
  return root;
}

function fixture(name, withBaseline = false) {
  const root = path.join(suiteRoot, name);
  run(suiteRoot, 'git', ['clone', '--quiet', '--shared', '--no-checkout', baseRoot, root]);
  const alternates = path.join(root, '.git/objects/info/alternates');
  assert.equal(fs.existsSync(alternates), true, 'child fixture must use alternates');
  const alternatesContent = fs.readFileSync(alternates, 'utf8');
  assert.ok(alternatesContent.includes(suiteRoot), 'child alternates must point inside suiteRoot');
  assert.ok(!alternatesContent.includes(HOST_ROOT), 'child alternates must not point at host repository');
  sparseCheckout(root);
  assert.equal(git(root, ['rev-parse', 'HEAD']), git(baseRoot, ['rev-parse', 'HEAD']), 'child fixture HEAD must equal suite base tooling commit');
  git(root, ['config', 'user.email', 'h00b@example.test']);
  git(root, ['config', 'user.name', 'H00B Test']);
  if (withBaseline) {
    fs.mkdirSync(path.join(root, path.dirname(RUNTIME)), { recursive: true });
    fs.writeFileSync(path.join(root, RUNTIME), approvedBytes);
  }
  return root;
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeJson(root, relativePath, value) {
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function resign(baseline) {
  const payload = { ...baseline };
  delete payload.baseline_id;
  delete payload.payload_sha256;
  const hash = crypto.createHash('sha256').update(Buffer.from(stableJson(payload))).digest('hex');
  baseline.payload_sha256 = hash;
  baseline.baseline_id = `H00B-BASELINE-${hash.slice(0, 24)}`;
  return baseline;
}

function mutateBaseline(root, mutate, shouldResign = true) {
  const baseline = readJson(root, RUNTIME);
  mutate(baseline);
  if (shouldResign) resign(baseline);
  writeJson(root, RUNTIME, baseline);
}

function mutateJson(root, relativePath, mutate) {
  const value = readJson(root, relativePath);
  mutate(value);
  writeJson(root, relativePath, value);
}

function hostCanonicalHashes() {
  const records = [];
  for (const relativePath of HOST_CANONICAL_PATHS) {
    const fullPath = path.join(HOST_ROOT, relativePath);
    if (!fs.existsSync(fullPath)) {
      records.push(`${relativePath}\0<missing>`);
      continue;
    }
    records.push(`${relativePath}\0${crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex')}`);
  }
  return records.join('\n');
}

function resignH00ABundle(root) {
  const identityLib = require(path.join(root, 'scripts/harness/h00a-identity.js'));
  const { recomputeFrozenId } = require(path.join(root, 'scripts/harness/validate-h00a.js'));
  const { recomputeMigration } = require(path.join(root, 'scripts/harness/compare-validation-debt.js'));
  const manifest = readJson(root, MANIFEST);
  const debt = readJson(root, 'tests/harness/baselines/validation-debt.json');
  const confirmation = readJson(root, 'tests/harness/baselines/h00a-confirmation.json');
  const ledgerPath = path.join(root, 'doc/平台治理/harness-engineering/来源清册.md');
  const ledgerContent = fs.readFileSync(ledgerPath, 'utf8');
  const ledgerMatch = ledgerContent.match(/<!-- H00A-CAPTURE-IDENTITY:START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- H00A-CAPTURE-IDENTITY:END -->/);
  assert.ok(ledgerMatch, 'ledger identity block must exist');

  const oldHarness = manifest.sources.find((item) => item.id === 'O-OLD-HARNESS-EXPORT');
  assert.ok(oldHarness, 'manifest must contain O-OLD-HARNESS-EXPORT');
  assert.equal(oldHarness.historical_commit, OLD_HARNESS_CANONICAL_COMMIT);
  oldHarness.historical_commit = OLD_HARNESS_ALTERNATE_COMMIT;
  manifest.source_set.aggregate_sha256 = identityLib.sourceSetHash(manifest.sources);

  const identity = manifest.frozen_capture_identity;
  identity.sources = manifest.sources.map(identityLib.canonicalSourceIdentity).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  identity.source_set_sha256 = identityLib.sourceSetHash(manifest.sources);
  const newFrozenId = recomputeFrozenId(identity);
  assert.notEqual(newFrozenId, identity.frozen_capture_id);
  identity.frozen_capture_id = newFrozenId;

  manifest.frozen_capture_identity = identity;
  debt.frozen_capture_identity = identity;
  writeJson(root, MANIFEST, manifest);
  writeJson(root, 'tests/harness/baselines/validation-debt.json', debt);

  const newLedger = ledgerContent.replace(
    ledgerMatch[0],
    `<!-- H00A-CAPTURE-IDENTITY:START -->\n\`\`\`json\n${JSON.stringify(identity, null, 2)}\n\`\`\`\n<!-- H00A-CAPTURE-IDENTITY:END -->`
  );
  fs.writeFileSync(ledgerPath, newLedger);

  const newMigration = recomputeMigration(root, 'be7c6b69', 'tests/harness/baselines/validation-debt.json', debt, 'tests/harness/baselines/validation-debt.json');
  writeJson(root, 'tests/harness/baselines/h00a-schema-migration-r1.json', newMigration);

  confirmation.reviewed_frozen_capture_id = newFrozenId;
  writeJson(root, 'tests/harness/baselines/h00a-confirmation.json', confirmation);
  return newFrozenId;
}

test.before(() => {
  suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h00b-hermetic-'));
  baseRoot = buildBaseFixture(HOST_ROOT, 'base');
  capture(baseRoot);
  approvedBytes = fs.readFileSync(path.join(baseRoot, RUNTIME));
  validate(baseRoot);
  hostHashesBefore = hostCanonicalHashes();
});

test.after(() => {
  fs.rmSync(suiteRoot, { recursive: true, force: true });
  assert.equal(fs.existsSync(suiteRoot), false, `fixture cleanup failed: ${suiteRoot}`);
});

test('B00-01 approved canonical evidence captures and validates', () => {
  const root = fixture('b00-01');
  assert.match(capture(root).stdout, /captured-h00b-baseline/);
  assert.match(validate(root).stdout, /valid-h00b-baseline/);
});

test('B00-02 consecutive captures are byte-identical', () => {
  const root = fixture('b00-02');
  capture(root); const first = fs.readFileSync(path.join(root, RUNTIME));
  capture(root); const second = fs.readFileSync(path.join(root, RUNTIME));
  assert.deepEqual(second, first);
});

test('B00-03 pending-review does not create output', () => {
  const root = fixture('b00-03');
  mutateJson(root, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.status = 'pending-review'; c.reviewed_by = null; c.reviewed_at = null; c.reviewed_frozen_capture_id = null; c.reviewed_capture_subject_commit = null; c.h00b_unlocked = false; c.required_checks.forEach((x) => { x.status = 'ready-for-review'; }); });
  assert.match(capture(root, 1).stderr, /confirmation|pending-review/i);
  assert.equal(fs.existsSync(path.join(root, RUNTIME)), false);
});

test('B00-04 pending-review with h00b_unlocked=true remains locked', () => {
  const root = fixture('b00-04');
  mutateJson(root, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.status = 'pending-review'; c.h00b_unlocked = true; });
  assert.match(capture(root, 1).stderr, /pending-review|h00b_unlocked/i);
});

test('B00-05 missing canonical check reports the concrete check', () => {
  const root = fixture('b00-05');
  mutateJson(root, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.required_checks.splice(3, 1); });
  assert.match(capture(root, 1).stderr, /H00A-CHECK-PROVIDERS/);
  const customRoot = fixture('b00-05-custom');
  mutateJson(customRoot, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.required_checks[3].id = 'H00A-CHECK-CUSTOM'; });
  assert.match(capture(customRoot, 1).stderr, /H00A-CHECK-CUSTOM/);
});

test('B00-06 reviewed frozen ID mismatch is rejected', () => {
  const root = fixture('b00-06');
  mutateJson(root, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.reviewed_frozen_capture_id = 'H00A-FROZEN-000000000000000000000000'; });
  assert.match(capture(root, 1).stderr, /reviewed_frozen_capture_id|frozen capture ID/i);
});

test('B00-07 reviewed subject mismatch is rejected', () => {
  const root = fixture('b00-07');
  mutateJson(root, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.reviewed_capture_subject_commit = c.reviewed_capture_subject_commit.replace(/^./, '0'); });
  assert.match(capture(root, 1).stderr, /subject/i);
});

test('B00-08 manifest debt ledger identity mismatch preserves H00A diagnosis', () => {
  for (const target of ['manifest', 'debt', 'ledger']) {
    const root = fixture(`b00-08-${target}`);
    if (target === 'ledger') {
      const ledger = path.join(root, 'doc/平台治理/harness-engineering/来源清册.md');
      fs.writeFileSync(ledger, fs.readFileSync(ledger, 'utf8').replace(CANONICAL_FROZEN_ID, 'H00A-FROZEN-000000000000000000000000'));
    } else {
      const relativePath = target === 'manifest' ? MANIFEST : 'tests/harness/baselines/validation-debt.json';
      mutateJson(root, relativePath, (value) => { value.frozen_capture_identity.frozen_capture_id = 'H00A-FROZEN-000000000000000000000000'; });
    }
    assert.match(capture(root, 1).stderr, /ledger identity|frozen_capture|capture ID/i);
  }
});

test('B00-09 migration tamper reports its field', () => {
  const cases = [
    ['summary', (m) => { m.summary.added += 1; }, /summary\.added/],
    ['hash', (m) => { m.before.payload_sha256 = '0'.repeat(64); }, /before\.payload_sha256/],
    ['id', (m) => { m.after.frozen_capture_id = 'H00A-FROZEN-000000000000000000000000'; }, /after\.frozen_capture_id/],
    ['added-key', (m) => { m.added[0].failure_key = 'FAIL-000000000000000000000000'; }, /added.*failure_key|FAIL-/],
    ['removed-key', (m) => { m.removed[0].failure_key = 'FAIL-000000000000000000000000'; }, /removed.*failure_key|FAIL-/]
  ];
  for (const [name, mutate, diagnosis] of cases) {
    const root = fixture(`b00-09-${name}`);
    mutateJson(root, 'tests/harness/baselines/h00a-schema-migration-r1.json', mutate);
    assert.match(capture(root, 1).stderr, diagnosis);
  }
});

test('B00-10 current HEAD dirty and untracked changes do not affect bytes', () => {
  const root = fixture('b00-10');
  capture(root); const first = fs.readFileSync(path.join(root, RUNTIME));
  fs.writeFileSync(path.join(root, 'unrelated-commit.txt'), 'committed\n'); git(root, ['add', '--sparse', 'unrelated-commit.txt']); git(root, ['commit', '-m', 'test: unrelated head']);
  fs.writeFileSync(path.join(root, 'package-lock.json'), 'dirty\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n');
  capture(root); assert.deepEqual(fs.readFileSync(path.join(root, RUNTIME)), first);
  validate(root);
});

test('B00-11 payload_sha256 tamper is rejected', () => {
  const root = fixture('b00-11', true);
  mutateBaseline(root, (b) => { b.payload_sha256 = '0'.repeat(64); }, false);
  assert.match(validate(root, 1).stderr, /payload_sha256/);
});

test('B00-12 baseline_id tamper is rejected', () => {
  const root = fixture('b00-12', true);
  mutateBaseline(root, (b) => { b.baseline_id = 'H00B-BASELINE-' + '0'.repeat(24); }, false);
  assert.match(validate(root, 1).stderr, /baseline_id/);
});

test('B00-13 Git patch hash or changed path tamper is rejected', () => {
  for (const target of ['hash', 'path']) {
    const root = fixture(`b00-13-${target}`, true);
    mutateBaseline(root, (b) => { if (target === 'hash') b.git_patch.raw_diff_sha256 = '0'.repeat(64); else b.git_patch.changed_paths[0].path = 'tampered-path'; });
    assert.match(validate(root, 1).stderr, /git_patch/);
  }
});

test('B00-14 source set or inventory tamper reports source identity', () => {
  for (const target of ['aggregate', 'inventory']) {
    const root = fixture(`b00-14-${target}`, true);
    mutateBaseline(root, (b) => { if (target === 'aggregate') b.source_set.aggregate_sha256 = '0'.repeat(64); else b.source_inventory[0].sha256 = '0'.repeat(64); });
    assert.match(validate(root, 1).stderr, /source_set|source_inventory/);
  }
});

test('B00-15 rule source missing extra or mixed type is rejected', () => {
  for (const target of ['missing', 'extra', 'mixed']) {
    const root = fixture(`b00-15-${target}`, true);
    mutateBaseline(root, (b) => {
      if (target === 'missing') b.rule_sources.shift();
      if (target === 'extra') b.rule_sources.push({ ...b.rule_sources[0], id: 'R-EXTRA' });
      if (target === 'mixed') b.rule_sources.push(b.source_inventory.find((x) => x.type !== 'R'));
    });
    assert.match(validate(root, 1).stderr, /rule_sources/);
  }
});

test('B00-16 old Harness identity tamper reports canonical export', () => {
  for (const target of ['commit', 'member', 'hash']) {
    const root = fixture(`b00-16-${target}`, true);
    mutateBaseline(root, (b) => {
      if (target === 'commit') b.old_harness_sources[0].historical_commit = '0'.repeat(40);
      if (target === 'member') b.old_harness_sources[0].historical_tree_member_count = 14;
      if (target === 'hash') b.old_harness_sources[0].sha256 = '0'.repeat(64);
    });
    assert.match(validate(root, 1).stderr, /old_harness_sources/);
  }
});

test('B00-17 execution provider cannot become callable or H04 eligible', () => {
  const root = fixture('b00-17');
  mutateJson(root, MANIFEST, (m) => { const p = m.providers.find((x) => x.role === 'execution-selected'); p.status = 'callable-confirmed'; p.eligible_for_h04 = true; });
  assert.match(capture(root, 1).stderr, /provider|H04/i);
  fs.mkdirSync(path.join(root, path.dirname(RUNTIME)), { recursive: true }); fs.writeFileSync(path.join(root, RUNTIME), approvedBytes);
  mutateBaseline(root, (b) => { const p = b.providers.find((x) => x.role === 'execution-selected'); p.status = 'callable-confirmed'; p.eligible_for_h04 = true; });
  assert.match(validate(root, 1).stderr, /provider|payload_sha256/i);
});

test('B00-18 judge cannot become callable verified or H04 eligible', () => {
  const root = fixture('b00-18');
  mutateJson(root, MANIFEST, (m) => { m.judge.status = 'callable-confirmed'; m.judge.independent_run_context = 'verified'; m.judge.eligible_for_h04 = true; });
  assert.match(capture(root, 1).stderr, /judge|H04/i);
  fs.mkdirSync(path.join(root, path.dirname(RUNTIME)), { recursive: true }); fs.writeFileSync(path.join(root, RUNTIME), approvedBytes);
  mutateBaseline(root, (b) => { b.judge.status = 'callable-confirmed'; b.judge.eligible_for_h04 = true; });
  assert.match(validate(root, 1).stderr, /judge|payload_sha256/i);
});

test('B00-19 future identity creation is rejected by capture and validate', () => {
  const root = fixture('b00-19');
  mutateJson(root, MANIFEST, (m) => { m.future_identities.epoch.id = 'EPOCH-1'; });
  assert.match(capture(root, 1).stderr, /epoch|future/i);
  fs.mkdirSync(path.join(root, path.dirname(RUNTIME)), { recursive: true }); fs.writeFileSync(path.join(root, RUNTIME), approvedBytes);
  mutateBaseline(root, (b) => { b.future_identities.epoch.id = 'EPOCH-1'; });
  assert.match(validate(root, 1).stderr, /future_identities|payload_sha256/i);
});

test('B00-20 capture CLI rejects missing duplicate valueless and unknown arguments', () => {
  const root = fixture('b00-20');
  assert.match(capture(root, 1, []).stderr, /--manifest/);
  assert.match(capture(root, 1, ['--manifest', MANIFEST, '--manifest', MANIFEST, '--out', RUNTIME]).stderr, /exactly once/);
  assert.match(capture(root, 1, ['--manifest', '--out', RUNTIME]).stderr, /requires a value/);
  assert.match(capture(root, 1, ['--manifest', MANIFEST, '--out', RUNTIME, '--unknown', 'x']).stderr, /unknown argument/);
});

test('B00-21 validate CLI rejects missing duplicate valueless and unknown arguments', () => {
  const root = fixture('b00-21', true);
  assert.match(validate(root, 1, []).stderr, /--input/);
  assert.match(validate(root, 1, ['--input', RUNTIME, '--input', RUNTIME]).stderr, /exactly once/);
  assert.match(validate(root, 1, ['--input']).stderr, /requires a value/);
  assert.match(validate(root, 1, ['--unknown', RUNTIME]).stderr, /unknown argument/);
});

test('B00-22 symlink hardlink and parent symlink outputs are rejected without target mutation', () => {
  for (const kind of ['symlink', 'hardlink', 'parent']) {
    const root = fixture(`b00-22-${kind}`);
    const victim = path.join(root, 'victim.txt'); fs.writeFileSync(victim, 'victim\n');
    fs.mkdirSync(path.join(root, '.harness-runtime'), { recursive: true });
    if (kind === 'parent') fs.symlinkSync(path.join(root, 'elsewhere'), path.join(root, '.harness-runtime', 'baselines'));
    else { fs.mkdirSync(path.join(root, '.harness-runtime/baselines'), { recursive: true }); kind === 'symlink' ? fs.symlinkSync(victim, path.join(root, RUNTIME)) : fs.linkSync(victim, path.join(root, RUNTIME)); }
    assert.match(capture(root, 1).stderr, /symlink|hardlink|regular file/i);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'victim\n');
  }
});

test('B00-23 failure before rename preserves old output and leaves no temp file', () => {
  const root = fixture('b00-23', true);
  const before = fs.readFileSync(path.join(root, RUNTIME));
  const { captureBaseline } = require(path.join(root, 'scripts/harness/capture-baseline.js'));
  assert.throws(() => captureBaseline({ projectRoot: root, manifest: MANIFEST, out: RUNTIME, beforeRename() { throw new Error('injected-before-rename'); } }), /injected-before-rename/);
  assert.deepEqual(fs.readFileSync(path.join(root, RUNTIME)), before);
  assert.deepEqual(fs.readdirSync(path.join(root, path.dirname(RUNTIME))).filter((x) => x.endsWith('.tmp')), []);
});

test('B00-24 validator failure leaves input bytes unchanged', () => {
  const root = fixture('b00-24', true);
  mutateBaseline(root, (b) => { b.baseline_id = 'H00B-BASELINE-' + 'f'.repeat(24); }, false);
  const before = fs.readFileSync(path.join(root, RUNTIME)); validate(root, 1);
  assert.deepEqual(fs.readFileSync(path.join(root, RUNTIME)), before);
});

test('B00-25 time PID hostname cwd and secret fields are rejected', () => {
  const root = fixture('b00-25', true);
  mutateBaseline(root, (b) => { Object.assign(b.environment, { captured_at: new Date().toISOString(), pid: 1, hostname: 'HOST', cwd: '/tmp/root', env_secret: 'TOKEN' }); });
  assert.match(validate(root, 1).stderr, /environment|payload_sha256/i);
});

test('B00-26 Git-tracked runtime output blocks capture', () => {
  const root = fixture('b00-26', true);
  git(root, ['add', '--sparse', '-f', RUNTIME]);
  assert.match(capture(root, 1).stderr, /tracked by Git/);
});

test('B00-27 unrelated dirty fixture state does not become an input', () => {
  const root = fixture('b00-27');
  fs.writeFileSync(path.join(root, 'package-lock.json'), 'dirty\n'); fs.writeFileSync(path.join(root, 'untracked-fixture.txt'), 'x\n');
  capture(root); validate(root);
  assert.deepEqual(fs.readFileSync(path.join(root, RUNTIME)), approvedBytes);
});

test('B00-28 tooling file hash tamper reports the concrete tooling path', () => {
  const root = fixture('b00-28', true);
  fs.appendFileSync(path.join(root, 'scripts/harness/capture-baseline.js'), '\n// tooling tamper\n');
  assert.match(validate(root, 1).stderr, /tooling|capture-baseline\.js|payload_sha256/i);
});

test('H00B-F-01 committed H00B files still create a real tooling commit', () => {
  for (const file of ['scripts/harness/h00b-contract.js', 'scripts/harness/capture-baseline.js', 'scripts/harness/validate-baseline.js']) {
    git(HOST_ROOT, ['cat-file', '-e', `HEAD:${file}`]);
  }
  const head = git(baseRoot, ['rev-parse', 'HEAD']);
  const subject = git(baseRoot, ['log', '-1', '--format=%s', 'HEAD']);
  assert.equal(subject, 'test: install h00b fixture tooling');
  const commitFiles = git(baseRoot, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).sort();
  assert.deepEqual(commitFiles, [...H00B_OVERLAY_FILES].sort());
  assert.equal(git(baseRoot, ['rev-parse', 'HEAD^']), H00A_APPROVAL_BASE_COMMIT);
  assert.notEqual(head, git(HOST_ROOT, ['rev-parse', 'HEAD']), 'tooling commit must not equal host HEAD');
});

test('H00B-F-02 fixture is pinned to the fixed approval base', () => {
  assert.equal(git(baseRoot, ['rev-parse', 'HEAD^']), H00A_APPROVAL_BASE_COMMIT, 'tooling parent must be 64cd2b84');
  assert.equal(git(baseRoot, ['rev-parse', `${H00A_APPROVAL_BASE_COMMIT}^{commit}`]), H00A_APPROVAL_BASE_COMMIT);
  for (const file of ['tests/harness/baselines/source-manifest.json', 'tests/harness/baselines/h00a-confirmation.json', 'tests/harness/baselines/validation-debt.json']) {
    const baseBlob = git(baseRoot, ['rev-parse', `HEAD^:${file}`]);
    const fixtureBlob = git(baseRoot, ['rev-parse', `HEAD:${file}`]);
    assert.equal(fixtureBlob, baseBlob, `${file} must come from the approval base, not the host HEAD`);
  }
  assert.equal(fs.existsSync(path.join(baseRoot, '.git/objects/info/alternates')), false);
});

test('H00B-F-03 host plus an unrelated commit keeps fixture evidence and baseline bytes', () => {
  const hostPlus = path.join(suiteRoot, 'host-plus-commit');
  run(suiteRoot, 'git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', HOST_ROOT, hostPlus]);
  sparseCheckout(hostPlus);
  git(hostPlus, ['config', 'user.email', 'h00b@example.test']);
  git(hostPlus, ['config', 'user.name', 'H00B Test']);
  for (const relativePath of H00B_OVERLAY_FILES) {
    fs.copyFileSync(path.join(HOST_ROOT, relativePath), path.join(hostPlus, relativePath));
  }
  fs.writeFileSync(path.join(hostPlus, 'scripts/harness/unrelated-host-note.txt'), 'unrelated host commit\n');
  git(hostPlus, ['add', '--sparse', 'scripts/harness/unrelated-host-note.txt']);
  git(hostPlus, ['commit', '-m', 'test: unrelated host commit']);
  assert.notEqual(git(hostPlus, ['rev-parse', 'HEAD']), git(HOST_ROOT, ['rev-parse', 'HEAD']), 'host-plus must have one extra commit');
  const plusBase = buildBaseFixture(hostPlus, 'base-plus-commit');
  capture(plusBase);
  assert.deepEqual(fs.readFileSync(path.join(plusBase, RUNTIME)), approvedBytes, 'host extra commit must not change fixture baseline bytes');
  validate(plusBase);
});

test('H00B-F-04 canonical old harness identity captures and validates', () => {
  const root = fixture('h00b-f-04');
  assert.match(capture(root).stdout, /captured-h00b-baseline/);
  assert.match(validate(root).stdout, /valid-h00b-baseline/);
  const baseline = readJson(root, RUNTIME);
  const record = baseline.old_harness_sources.find((item) => item.id === 'O-OLD-HARNESS-EXPORT');
  assert.ok(record, 'baseline must contain O-OLD-HARNESS-EXPORT');
  const contract = require(path.join(root, 'scripts/harness/h00b-contract.js')).CANONICAL_OLD_HARNESS_IDENTITY;
  for (const field of Object.keys(contract)) assert.equal(record[field], contract[field], `canonical field ${field} must match`);
});

test('H00B-F-05 baseline local tamper of old harness commit is located by ID and field', () => {
  const root = fixture('h00b-f-05', true);
  mutateBaseline(root, (b) => { b.old_harness_sources[0].historical_commit = '0'.repeat(40); });
  const result = validate(root, 1);
  assert.match(result.stderr, /O-OLD-HARNESS-EXPORT/);
  assert.match(result.stderr, /historical_commit/);
});

test('H00B-F-06 resigned bundle passes H00A but fails H00B capture with precise commit diagnosis', () => {
  const canonicalTree = git(HOST_ROOT, ['rev-parse', `${OLD_HARNESS_CANONICAL_COMMIT}:harness`]);
  const alternateTree = git(HOST_ROOT, ['rev-parse', `${OLD_HARNESS_ALTERNATE_COMMIT}:harness`]);
  assert.equal(canonicalTree, alternateTree, 'alternate commit must share the same harness tree');
  assert.notEqual(OLD_HARNESS_CANONICAL_COMMIT, OLD_HARNESS_ALTERNATE_COMMIT);

  const root = fixture('h00b-f-06');
  const newFrozenId = resignH00ABundle(root);
  assert.notEqual(newFrozenId, CANONICAL_FROZEN_ID, 'resigned bundle must produce a new frozen ID');

  const h00a = run(root, process.execPath, [
    'scripts/harness/validate-h00a.js', '--mode', 'frozen',
    '--manifest', MANIFEST,
    '--incidents', 'tests/harness/incidents/seed.jsonl',
    '--families', 'tests/harness/incidents/failure-family-candidates.jsonl',
    '--debt', 'tests/harness/baselines/validation-debt.json',
    '--confirmation', 'tests/harness/baselines/h00a-confirmation.json',
    '--migration', 'tests/harness/baselines/h00a-schema-migration-r1.json',
    '--ledger', 'doc/平台治理/harness-engineering/来源清册.md'
  ]);
  assert.match(h00a.stdout, /approved/);
  assert.match(h00a.stdout, /h00bUnlocked/);
  assert.match(h00a.stdout, /c87cf865|valid-frozen-evidence/);

  const captureResult = capture(root, 1);
  assert.match(captureResult.stderr, /O-OLD-HARNESS-EXPORT/);
  assert.match(captureResult.stderr, /historical_commit/);
  assert.match(captureResult.stderr, new RegExp(OLD_HARNESS_CANONICAL_COMMIT));
  assert.match(captureResult.stderr, new RegExp(OLD_HARNESS_ALTERNATE_COMMIT));
  assert.equal(fs.existsSync(path.join(root, RUNTIME)), false, 'failed capture must not create output');
  const baselinesDir = path.join(root, path.dirname(RUNTIME));
  const tempFiles = fs.existsSync(baselinesDir) ? fs.readdirSync(baselinesDir).filter((x) => x.endsWith('.tmp')) : [];
  assert.deepEqual(tempFiles, [], 'failed capture must leave no temp files');
});

test('H00B-F-07 validating existing baseline under a resigned bundle fails and preserves input', () => {
  const root = fixture('h00b-f-07', true);
  const before = fs.readFileSync(path.join(root, RUNTIME));
  resignH00ABundle(root);
  const result = validate(root, 1);
  assert.match(result.stderr, /O-OLD-HARNESS-EXPORT/);
  assert.match(result.stderr, /historical_commit/);
  assert.match(result.stderr, new RegExp(OLD_HARNESS_CANONICAL_COMMIT));
  assert.match(result.stderr, new RegExp(OLD_HARNESS_ALTERNATE_COMMIT));
  assert.deepEqual(fs.readFileSync(path.join(root, RUNTIME)), before, 'failed validator must preserve input baseline bytes');
});

test('H00B-F-08 setup and counterexample failure recovery keeps output and host canonical bytes', () => {
  const root = fixture('h00b-f-08', true);
  const before = fs.readFileSync(path.join(root, RUNTIME));
  mutateJson(root, 'tests/harness/baselines/h00a-confirmation.json', (c) => { c.status = 'pending-review'; c.reviewed_by = null; c.reviewed_at = null; c.reviewed_frozen_capture_id = null; c.reviewed_capture_subject_commit = null; c.h00b_unlocked = false; c.required_checks.forEach((x) => { x.status = 'ready-for-review'; }); });
  const captureResult = capture(root, 1);
  assert.match(captureResult.stderr, /pending-review|confirmation/i);
  assert.deepEqual(fs.readFileSync(path.join(root, RUNTIME)), before, 'failed capture must preserve previous output');
  assert.deepEqual(fs.readdirSync(path.join(root, path.dirname(RUNTIME))).filter((x) => x.endsWith('.tmp')), [], 'failed capture must leave no temp files');
  assert.equal(hostCanonicalHashes(), hostHashesBefore, 'host canonical evidence and runtime bytes must stay unchanged');
});
