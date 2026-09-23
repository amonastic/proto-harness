const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { BOUNDARY_VERSION } = require('../lib/project-scan-boundary');
const { CANONICAL_H00A_COMMANDS, validateCanonicalH00ACommands } = require('./h00a-contract');
const { makeFailure: makeNormalizedFailure, normalizeMessage: normalizeFailureMessage, sha256String } = require('./h00a-normalizer');
const {
  CAPTURE_LEDGER_PATH,
  SOURCE_SET_IDENTITY_FIELDS,
  SOURCE_SET_IDENTITY_VERSION,
  assertCanonicalCaptureEnvironment,
  currentHead,
  finalizeFrozenIdentity,
  freezeSources,
  frozenIdentityBase,
  sourceSetHash
} = require('./h00a-identity');

const root = process.cwd();

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a path`);
  return argv[index + 1];
}

function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function lstatIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveSafeTemporaryOutput(requestedOutput, projectRoot) {
  const lexicalOutput = path.resolve(projectRoot, requestedOutput);
  const lexicalParent = path.dirname(lexicalOutput);
  const parentStat = fs.statSync(lexicalParent);
  if (!parentStat.isDirectory()) throw new Error('--out parent must be an existing directory');

  const realProjectRoot = fs.realpathSync(projectRoot);
  const realParent = fs.realpathSync(lexicalParent);
  const realOutput = path.join(realParent, path.basename(lexicalOutput));
  const allowedTempRoots = [...new Set([os.tmpdir(), '/tmp']
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.realpathSync(candidate)))];

  if (isPathInside(realOutput, realProjectRoot)) {
    throw new Error('temporary --out must resolve outside the project root');
  }
  if (!allowedTempRoots.some((tempRoot) => isPathInside(realOutput, tempRoot))) {
    throw new Error('temporary --out must resolve inside an operating-system temporary directory');
  }
  if (lstatIfPresent(lexicalOutput) || lstatIfPresent(realOutput)) {
    throw new Error('temporary --out must not already exist; symlink and hardlink aliases are forbidden');
  }
  return realOutput;
}

function parseCaptureOptions(argv, projectRoot) {
  const writeManifest = argv.includes('--write-manifest');
  const canonicalManifestFile = path.join(projectRoot, 'tests/harness/baselines/source-manifest.json');
  const canonicalDebtFile = path.join(projectRoot, 'tests/harness/baselines/validation-debt.json');
  const canonicalLedgerFile = path.join(projectRoot, CAPTURE_LEDGER_PATH);
  const manifestArg = argumentValue(argv, '--manifest');
  const outputArg = argumentValue(argv, '--out');
  const ledgerArg = argumentValue(argv, '--ledger');
  const subjectCommit = argumentValue(argv, '--subject-commit');
  const manifestFile = manifestArg ? path.resolve(projectRoot, manifestArg) : canonicalManifestFile;
  const requestedOutput = outputArg ? path.resolve(projectRoot, outputArg) : canonicalDebtFile;
  const ledgerFile = ledgerArg ? path.resolve(projectRoot, ledgerArg) : canonicalLedgerFile;

  if (writeManifest && (
    manifestFile !== canonicalManifestFile
    || requestedOutput !== canonicalDebtFile
    || ledgerFile !== canonicalLedgerFile
  )) {
    throw new Error('--write-manifest requires canonical manifest, ledger and debt paths; custom paths are temporary-output mode only');
  }
  if (writeManifest && !subjectCommit) {
    throw new Error('canonical capture requires an explicit --subject-commit');
  }
  if (!writeManifest && requestedOutput === canonicalDebtFile) {
    throw new Error('canonical H00A capture requires --write-manifest so manifest, ledger and debt cannot drift');
  }

  return {
    writeManifest,
    manifestFile,
    outputFile: writeManifest ? canonicalDebtFile : resolveSafeTemporaryOutput(requestedOutput, projectRoot),
    ledgerFile,
    subjectCommit
  };
}

function sha256(value) {
  return sha256String(value);
}

function normalizeMessage(value) {
  return normalizeFailureMessage(value, root);
}

function makeFailure(...args) {
  return makeNormalizedFailure(root, ...args);
}

function snapshotIdentitySubject(detail) {
  const mappings = [
    ['历史迭代不得直接引用源页面：', 'live-source:'],
    ['本地资源不存在：', 'missing-resource:'],
    ['快照文件不存在：', 'missing-snapshot:'],
    ['历史迭代快照目录应为 ', 'wrong-snapshot-directory:'],
    ['缺少快照元信息：', 'missing-metadata:']
  ];
  const match = mappings.find(([prefix]) => detail.startsWith(prefix));
  return match ? `${match[1]}${detail.slice(match[0].length)}` : normalizeMessage(detail);
}

function coalesceFailures(items) {
  const grouped = new Map();
  for (const item of items) {
    const existing = grouped.get(item.failure_key);
    if (existing) existing.occurrence_count += item.occurrence_count;
    else grouped.set(item.failure_key, item);
  }
  return [...grouped.values()].sort((a, b) => a.failure_key.localeCompare(b.failure_key, 'en'));
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  return { exitCode: result.status ?? 1, stdout, stderr, output: `${stdout}${stderr}` };
}

function withRestoredFile(file, callback) {
  const existed = fs.existsSync(file);
  const before = existed ? fs.readFileSync(file) : null;
  try {
    return callback();
  } finally {
    if (existed) fs.writeFileSync(file, before);
    else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

function renderLedgerCaptureIdentity(current, captureIdentity) {
  const start = '<!-- H00A-CAPTURE-IDENTITY:START -->';
  const end = '<!-- H00A-CAPTURE-IDENTITY:END -->';
  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('capture identity markers are missing from the ledger');
  }
  const block = `${start}\n\`\`\`json\n${JSON.stringify(captureIdentity, null, 2)}\n\`\`\`\n${end}`;
  return `${current.slice(0, startIndex)}${block}${current.slice(endIndex + end.length)}`;
}

function ledgerCaptureIdentity(ledger) {
  const match = ledger.match(/<!-- H00A-CAPTURE-IDENTITY:START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- H00A-CAPTURE-IDENTITY:END -->/);
  if (!match) throw new Error('generated ledger does not contain a valid capture identity block');
  return JSON.parse(match[1]);
}

function validateGeneratedArtifacts(manifestText, debtText, ledgerText) {
  const manifest = JSON.parse(manifestText);
  const debt = JSON.parse(debtText);
  const ledgerIdentity = ledgerCaptureIdentity(ledgerText);
  if (JSON.stringify(manifest.frozen_capture_identity) !== JSON.stringify(debt.frozen_capture_identity)
    || JSON.stringify(manifest.frozen_capture_identity) !== JSON.stringify(ledgerIdentity)) {
    throw new Error('generated manifest, debt and ledger capture identities must match exactly');
  }
  const commandErrors = validateCanonicalH00ACommands(debt.commands);
  if (commandErrors.length) throw new Error(`generated debt command contract is invalid: ${commandErrors.join('; ')}`);
}

function exclusiveWrite(file, content, mode = 0o600) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, mode);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function transactionSibling(file, suffix) {
  const nonce = crypto.randomBytes(8).toString('hex');
  return path.join(path.dirname(file), `.${path.basename(file)}.h00a-${process.pid}-${nonce}.${suffix}`);
}

function commitFileTransaction(entries, options = {}) {
  const restoreBackup = options.restoreBackup || (({ backup, file }) => fs.renameSync(backup, file));
  const removeBackup = options.removeBackup || (({ backup }) => fs.unlinkSync(backup));
  const states = entries.map(({ file, content }) => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`transaction target must be a regular file: ${file}`);
    return {
      file,
      content,
      original: fs.readFileSync(file),
      mode: stat.mode & 0o777,
      temp: transactionSibling(file, 'tmp'),
      backup: transactionSibling(file, 'bak'),
      backedUp: false,
      committed: false
    };
  });

  try {
    for (const state of states) exclusiveWrite(state.temp, state.content, state.mode);
    for (const state of states) {
      if (!fs.readFileSync(state.file).equals(state.original)) {
        throw new Error(`transaction target changed during capture: ${state.file}`);
      }
    }
    for (const [index, state] of states.entries()) {
      options.beforeReplace?.({ index, file: state.file });
      fs.renameSync(state.file, state.backup);
      state.backedUp = true;
      fs.renameSync(state.temp, state.file);
      state.committed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    const cleanupWarnings = [];
    const recoveryBackups = [];
    for (const [index, state] of states.map((item, itemIndex) => [itemIndex, item]).reverse()) {
      try {
        if (state.backedUp && lstatIfPresent(state.backup)) {
          restoreBackup({ index, backup: state.backup, file: state.file });
          state.backedUp = false;
          state.committed = false;
        }
      } catch (rollbackError) {
        rollbackErrors.push({ file: state.file, backup: state.backup, error: rollbackError });
        recoveryBackups.push(state.backup);
      }
      try {
        if (lstatIfPresent(state.temp)) fs.unlinkSync(state.temp);
      } catch (cleanupError) {
        cleanupWarnings.push({ file: state.temp, error: cleanupError });
      }
    }
    if (rollbackErrors.length) {
      const aggregate = new AggregateError(
        [error, ...rollbackErrors.map((item) => item.error), ...cleanupWarnings.map((item) => item.error)],
        `capture transaction failed; rollback was incomplete and original backups were preserved: ${recoveryBackups.join(', ')}`
      );
      aggregate.transactionState = 'rollback-incomplete-with-preserved-backups';
      aggregate.recoveryBackups = recoveryBackups;
      aggregate.rollbackErrors = rollbackErrors;
      aggregate.cleanupWarnings = cleanupWarnings;
      throw aggregate;
    }
    error.transactionState = 'rolled-back';
    error.cleanupWarnings = cleanupWarnings;
    throw error;
  }

  const cleanupWarnings = [];
  const recoveryBackups = [];
  for (const [index, state] of states.entries()) {
    if (!lstatIfPresent(state.backup)) continue;
    try {
      removeBackup({ index, backup: state.backup, file: state.file });
    } catch (error) {
      cleanupWarnings.push({ file: state.backup, error: error.message });
      recoveryBackups.push(state.backup);
    }
  }
  return {
    transactionState: cleanupWarnings.length ? 'committed-with-cleanup-warnings' : 'committed',
    cleanupWarnings,
    recoveryBackups
  };
}

function parseMarkdownTable(markdown, heading, columns) {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`Missing report heading: ${heading}`);
  const lines = markdown.slice(start + heading.length).split(/\r?\n/);
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!line.startsWith('|')) {
      if (inTable && rows.length) break;
      continue;
    }
    inTable = true;
    if (/^\|\s*[-:]+/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells[0] === columns[0]) continue;
    if (cells.length >= columns.length) rows.push(Object.fromEntries(columns.map((column, index) => [column, cells[index]])));
  }
  return rows;
}

function main() {
const { writeManifest, manifestFile, outputFile, ledgerFile, subjectCommit } = parseCaptureOptions(process.argv.slice(2), root);
const captureSubjectCommit = subjectCommit || currentHead(root);
if (writeManifest) assertCanonicalCaptureEnvironment(root, captureSubjectCommit);
const failures = [];
const commands = [];
const byCommand = new Map();

function addCommand(id, command, kind, result, commandFailures, extra = {}) {
  const uniqueFailures = coalesceFailures(commandFailures);
  failures.push(...uniqueFailures);
  byCommand.set(id, uniqueFailures);
  commands.push({
    id,
    command,
    kind,
    exit_code: result.exitCode,
    issue_count: uniqueFailures.reduce((sum, failure) => sum + failure.occurrence_count, 0),
    failure_count: uniqueFailures.length,
    output_sha256: sha256(result.output),
    failure_keys: uniqueFailures.map((failure) => failure.failure_key),
    ...extra
  });
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const projectStartCommit = manifest.frozen_capture_identity?.project_start_commit
  || manifest.capture_identity?.project_start_commit
  || manifest.git?.project_start_commit
  || manifest.git?.commit;
if (!projectStartCommit) {
  throw new Error('source manifest must define project_start_commit before capture');
}

const legacyProjectRoot = manifest.project_root || root;
const frozenSources = freezeSources(root, manifest.sources || [], captureSubjectCommit, legacyProjectRoot);
const identityBase = frozenIdentityBase(root, projectStartCommit, captureSubjectCommit, frozenSources);
manifest.schema_version = 'h00a-source-manifest-v4';
manifest.sources = frozenSources;
delete manifest.project_root;
delete manifest.capture_identity;
manifest.git = {
  remote: manifest.git?.remote,
  branch: manifest.git?.branch,
  remote_divergence: manifest.git?.remote_divergence
};
manifest.source_set.identity_version = SOURCE_SET_IDENTITY_VERSION;
manifest.source_set.identity_fields = [...SOURCE_SET_IDENTITY_FIELDS];
manifest.source_set.aggregate_sha256 = sourceSetHash(manifest.sources || []);
manifest.hash_contract.source_set_mode = 'sha256 of sorted frozen Git-tree and external locator identities';
manifest.hash_contract.workspace_drift_mode = 'current workspace state is reported separately and never mutates frozen approval evidence';
delete manifest.hash_contract.untracked_overlay_mode;
delete manifest.target_patch;

const rules = run('npm', ['run', 'audit:rules']);
addCommand('V-H00A-AUDIT-RULES', 'npm run audit:rules', 'atomic', rules, []);

const register = run('npm', ['run', 'register:missing']);
const registerFailures = register.output.split(/\r?\n/)
  .filter((line) => line.startsWith(' - '))
  .map((line) => {
    const message = line.slice(3);
    const file = message.replace(/ \([^)]*\)$/, '');
    return makeFailure('V-H00A-REGISTER-MISSING', file, 'source-registration/missing-page', 'source-registration', 'P1', message, file);
  });
addCommand('V-H00A-REGISTER-MISSING', 'npm run register:missing', 'atomic', register, registerFailures);

const lint = run('npm', ['run', 'lint:ui']);
const lintFailures = lint.output.split(/\r?\n/)
  .filter((line) => line.startsWith(' - '))
  .map((line) => {
    const message = line.slice(3);
    const separator = message.indexOf(': ');
    const file = separator === -1 ? '<repository>' : message.slice(0, separator);
    const detail = separator === -1 ? message : message.slice(separator + 2);
    let ruleCode = 'ui-lint/required-structure';
    let category = 'required-structure';
    let severity = 'P2';
    if (detail.includes('未加入 ui-spec')) [ruleCode, category, severity] = ['ui-lint/unregistered', 'source-registration', 'P1'];
    else if (detail.includes('file not found')) [ruleCode, category, severity] = ['ui-lint/missing-file', 'missing-file', 'P1'];
    else if (detail.includes('遮罩')) [ruleCode, category, severity] = ['ui-lint/blocking-overlay', 'interaction-boundary', 'P1'];
    else if (detail.includes('需求文档入口')) [ruleCode, category] = ['ui-lint/doc-entry', 'doc-panel'];
    else if (detail.includes('variables.css')) [ruleCode, category] = ['ui-lint/design-token', 'design-token'];
    return makeFailure('V-H00A-LINT-UI', file, ruleCode, category, severity, detail, file);
  });
addCommand('V-H00A-LINT-UI', 'npm run lint:ui', 'atomic', lint, lintFailures);

const uiReport = path.join(root, '平台优化-一致性审计报告.md');
const auditUi = withRestoredFile(uiReport, () => {
  const result = run('npm', ['run', 'audit:ui']);
  return { result, report: fs.readFileSync(uiReport, 'utf8') };
});
const auditUiFailures = parseMarkdownTable(auditUi.report, '## 问题清单', ['优先级', '规则', '文件', '问题描述'])
  .filter((row) => row.优先级 !== '-')
  .map((row) => makeFailure('V-H00A-AUDIT-UI', row.文件, `audit-ui/${row.规则}`, 'ui-consistency', row.优先级, row.问题描述, row.文件));
addCommand('V-H00A-AUDIT-UI', 'npm run audit:ui', 'atomic', auditUi.result, auditUiFailures);

const docsReport = path.join(root, '平台优化-需求文档审计报告.md');
const auditDocs = withRestoredFile(docsReport, () => {
  const result = run('npm', ['run', 'audit:docs']);
  return { result, report: fs.readFileSync(docsReport, 'utf8') };
});
const auditDocsFailures = parseMarkdownTable(auditDocs.report, '## 问题清单', ['文件', '级别', '类型', '说明'])
  .filter((row) => row.文件 !== '-')
  .map((row) => makeFailure('V-H00A-AUDIT-DOCS', row.文件, `audit-docs/${row.类型}`, 'requirements-document', row.级别, row.说明, row.文件));
addCommand('V-H00A-AUDIT-DOCS', 'npm run audit:docs', 'atomic', auditDocs.result, auditDocsFailures, { side_effect: 'Generated report restored byte-for-byte after capture.' });

const snapshotRaw = run('node', ['scripts/audit-iteration-snapshots.js', '--print-issues-json']);
const snapshotEntries = JSON.parse(snapshotRaw.stdout);
const snapshotFailures = snapshotEntries.map((entry) => {
  const file = entry.file;
  const detail = entry.detail;
  return makeFailure('V-H00A-AUDIT-SNAPSHOTS', file, 'snapshot-integrity/audit', 'historical-snapshot', 'P0', detail, file, snapshotIdentitySubject(detail));
});
const snapshot = run('npm', ['run', 'audit:snapshots']);
const snapshotResult = run('npm', ['run', 'check:governance']);
addCommand('V-H00A-AUDIT-SNAPSHOTS', 'npm run audit:snapshots', 'atomic', snapshot, snapshotFailures);

const version = run('npm', ['run', 'audit:version-tags']);
const versionFailures = version.output.split(/\r?\n/)
  .map((line) => line.match(/^(.+?):(\d+): (.+)$/))
  .filter(Boolean)
  .map((match) => makeFailure('V-H00A-AUDIT-VERSION-TAGS', match[1], 'version-tags/forbidden-prefix', 'version-marker', 'P1', match[3], `${match[1]}:${match[2]}`));
addCommand('V-H00A-AUDIT-VERSION-TAGS', 'npm run audit:version-tags', 'atomic', version, versionFailures);

const governanceKeys = [...byCommand.get('V-H00A-AUDIT-SNAPSHOTS').map((failure) => failure.failure_key)];
commands.push({
  id: 'V-H00A-CHECK-GOVERNANCE',
  command: 'npm run check:governance',
  kind: 'composite',
  component_command_ids: ['V-H00A-AUDIT-SNAPSHOTS', 'V-H00A-AUDIT-VERSION-TAGS'],
  executed_component_command_ids: ['V-H00A-AUDIT-SNAPSHOTS'],
  exit_code: snapshotResult.exitCode,
  issue_count: byCommand.get('V-H00A-AUDIT-SNAPSHOTS').reduce((sum, failure) => sum + failure.occurrence_count, 0),
  failure_count: governanceKeys.length,
  output_sha256: sha256(snapshotResult.output),
  failure_keys: governanceKeys
});

const checkAll = run('npm', ['run', 'check:all']);
const checkAllKeys = [
  ...byCommand.get('V-H00A-REGISTER-MISSING'),
  ...byCommand.get('V-H00A-LINT-UI')
].map((failure) => failure.failure_key);
commands.push({
  id: 'V-H00A-CHECK-ALL',
  command: 'npm run check:all',
  kind: 'composite',
  component_command_ids: ['V-H00A-AUDIT-RULES', 'V-H00A-REGISTER-MISSING', 'V-H00A-LINT-UI', 'V-H00A-AUDIT-UI', 'V-H00A-AUDIT-DOCS', 'V-H00A-AUDIT-SNAPSHOTS', 'V-H00A-AUDIT-VERSION-TAGS'],
  executed_component_command_ids: ['V-H00A-AUDIT-RULES', 'V-H00A-REGISTER-MISSING', 'V-H00A-LINT-UI'],
  exit_code: checkAll.exitCode,
  issue_count: [...byCommand.get('V-H00A-REGISTER-MISSING'), ...byCommand.get('V-H00A-LINT-UI')].reduce((sum, failure) => sum + failure.occurrence_count, 0),
  failure_count: checkAllKeys.length,
  output_sha256: sha256(checkAll.output),
  failure_keys: checkAllKeys
});

const debt = {
  schema_version: 'h00a-validation-debt-v4',
  status: 'frozen-observation-pending-review',
  captured_at: execFileSync('git', ['show', '-s', '--format=%cI', captureSubjectCommit], { cwd: root, encoding: 'utf8' }).trim(),
  capture_mode: writeManifest ? 'canonical-isolated-detached-clean' : 'temporary-current-observation',
  policy: 'zero-new-or-worsened-by-failure-key',
  scope_note: 'Captured from the immutable Git tree identified by capture_subject_commit. Current workspace changes are drift only and never rewrite this frozen debt.',
  scan_boundary: {
    version: BOUNDARY_VERSION,
    excluded_patterns: ['**/.claude/worktrees/**'],
    exclude_gitlinks: true,
    rationale: 'Canonical capture runs from a clean detached Git tree; nested agent worktrees and mode-160000 gitlinks are excluded host material.'
  },
  commands,
  failure_inventory: failures.sort((a, b) => a.failure_key.localeCompare(b.failure_key, 'en')),
  comparison_contract: {
    identity_fields: ['failure_key', 'file', 'rule_code', 'category', 'identity_subject'],
    comparison_fields: ['severity', 'message_fingerprint', 'occurrence_count'],
    pass: 'No new failure_key, no occurrence-count or severity increase for an existing key, and no unexplained message-fingerprint drift.',
    compare_as_sets: true,
    baseline_update: 'Requires a separately authorized debt-cleanup task and independent review.',
    forbidden: 'Do not edit business pages, historical snapshots or expected failures merely to make a Harness batch pass.'
  }
};

const frozenCaptureIdentity = finalizeFrozenIdentity(identityBase, debt);
debt.frozen_capture_identity = frozenCaptureIdentity;
manifest.frozen_capture_identity = frozenCaptureIdentity;

const debtText = `${JSON.stringify(debt, null, 2)}\n`;
if (writeManifest) {
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const ledgerText = renderLedgerCaptureIdentity(fs.readFileSync(ledgerFile, 'utf8'), frozenCaptureIdentity);
  validateGeneratedArtifacts(manifestText, debtText, ledgerText);
  var transactionResult = commitFileTransaction([
    { file: outputFile, content: debtText },
    { file: manifestFile, content: manifestText },
    { file: ledgerFile, content: ledgerText }
  ]);
} else {
  validateGeneratedArtifacts(`${JSON.stringify(manifest, null, 2)}\n`, debtText, renderLedgerCaptureIdentity(fs.readFileSync(ledgerFile, 'utf8'), frozenCaptureIdentity));
  exclusiveWrite(outputFile, debtText);
}
console.log(JSON.stringify({
  output: outputFile,
  commands: commands.length,
  failures: failures.length,
  manifest_written: writeManifest,
  manifest: writeManifest ? manifestFile : null,
  ledger: writeManifest ? ledgerFile : null,
  frozen_capture_id: frozenCaptureIdentity.frozen_capture_id,
  capture_subject_commit: captureSubjectCommit,
  transaction_state: writeManifest ? transactionResult.transactionState : 'temporary-output-written',
  cleanup_warnings: writeManifest ? transactionResult.cleanupWarnings : [],
  recovery_backups: writeManifest ? transactionResult.recoveryBackups : []
}, null, 2));
}

if (require.main === module) main();

module.exports = {
  CANONICAL_H00A_COMMANDS,
  commitFileTransaction,
  parseCaptureOptions,
  resolveSafeTemporaryOutput,
  validateCanonicalH00ACommands
};
