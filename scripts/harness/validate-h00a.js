const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { BOUNDARY_VERSION } = require('../lib/project-scan-boundary');
const { CANONICAL_H00A_REVIEW_CHECK_IDS, validateCanonicalH00ACommands } = require('./h00a-contract');
const { recomputeMigration } = require('./compare-validation-debt');
const { failureKey, sha256String } = require('./h00a-normalizer');
const {
  CAPTURE_LEDGER_PATH,
  FROZEN_IDENTITY_SCHEMA,
  SOURCE_SET_IDENTITY_FIELDS,
  SOURCE_SET_IDENTITY_VERSION,
  buildWorkspaceDrift,
  canonicalSourceIdentity,
  commitExists,
  commitTree,
  debtPayloadSha256,
  gitBlob,
  hashGitSource,
  isAncestor,
  sha256Buffer,
  sourceSetHash,
  stableJson
} = require('./h00a-identity');

const MIGRATION_BEFORE_REF = 'be7c6b69';
const MIGRATION_BEFORE_PATH = 'tests/harness/baselines/validation-debt.json';
const MIGRATION_AFTER_PATH = 'tests/harness/baselines/validation-debt.json';

function singleValueArgument(argv, name) {
  const indexes = argv.reduce((matches, value, index) => {
    if (value === name) matches.push(index);
    return matches;
  }, []);
  if (indexes.length > 1) throw new Error(`${name} must be provided exactly once`);
  if (indexes.length === 0) return null;
  const value = argv[indexes[0] + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function booleanArgument(argv, name) {
  const count = argv.filter((value) => value === name).length;
  if (count > 1) throw new Error(`${name} must be provided exactly once`);
  return count === 1;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function required(value, label, errors) {
  if (value === undefined || value === null || value === '') {
    errors.push(`${label} is required`);
    return false;
  }
  return true;
}

function readJson(file, errors, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function loadJsonl(file, errors, label) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    if (!lines.length) errors.push(`${label} must contain at least one JSONL record`);
    return lines.map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { errors.push(`${label} line ${index + 1} is not valid JSON: ${error.message}`); return null; }
    }).filter(Boolean);
  } catch (error) {
    errors.push(`${label} cannot be read: ${error.message}`);
    return [];
  }
}

function readLedgerFrozenIdentity(file, errors) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/<!-- H00A-CAPTURE-IDENTITY:START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- H00A-CAPTURE-IDENTITY:END -->/);
    if (!match) throw new Error('capture identity markers are missing or invalid');
    return JSON.parse(match[1]);
  } catch (error) {
    errors.push(`capture ledger identity is invalid: ${error.message}`);
    return null;
  }
}

function recomputeFrozenId(identity) {
  const { frozen_capture_id: ignoredId, debt_payload_sha256, ...base } = identity;
  return `H00A-FROZEN-${sha256String(stableJson({ ...base, debt_payload_sha256 })).slice(0, 24)}`;
}

function validateFrozenIdentity(identity, projectRoot, manifestSources, debt, errors, prefix) {
  if (!identity || typeof identity !== 'object') {
    errors.push(`${prefix} is required`);
    return;
  }
  for (const key of ['schema_version', 'project_start_commit', 'capture_subject_commit', 'capture_tree', 'tooling', 'sources', 'source_set_sha256', 'debt_payload_sha256', 'frozen_capture_id']) {
    required(identity[key], `${prefix}.${key}`, errors);
  }
  if (identity.schema_version !== FROZEN_IDENTITY_SCHEMA) errors.push(`${prefix}.schema_version must be ${FROZEN_IDENTITY_SCHEMA}`);
  for (const key of ['project_start_commit', 'capture_subject_commit', 'capture_tree']) {
    if (!/^[a-f0-9]{40}$/.test(identity[key] || '')) errors.push(`${prefix}.${key} must be a full Git object id`);
  }
  for (const key of ['source_set_sha256', 'debt_payload_sha256']) if (!isSha256(identity[key])) errors.push(`${prefix}.${key} must be a lowercase sha256`);
  if (!commitExists(projectRoot, identity.project_start_commit)) errors.push(`${prefix}.project_start_commit is not readable from Git`);
  if (!commitExists(projectRoot, identity.capture_subject_commit)) errors.push(`${prefix}.capture_subject_commit is not readable from Git`);
  if (commitExists(projectRoot, identity.project_start_commit) && commitExists(projectRoot, identity.capture_subject_commit)
    && !isAncestor(projectRoot, identity.project_start_commit, identity.capture_subject_commit)) {
    errors.push(`${prefix}.project_start_commit must be an ancestor of capture_subject_commit`);
  }
  if (commitExists(projectRoot, identity.capture_subject_commit)) {
    try {
      if (commitTree(projectRoot, identity.capture_subject_commit) !== identity.capture_tree) errors.push(`${prefix}.capture_tree does not match capture_subject_commit`);
    } catch (error) {
      errors.push(`${prefix}.capture_tree cannot be recomputed: ${error.message}`);
    }
  }

  const tools = identity.tooling || {};
  for (const name of ['capture_tool', 'snapshot_exporter', 'normalizer', 'validator', 'identity_engine', 'command_contract', 'migration_comparator']) {
    if (!tools[name]) errors.push(`${prefix}.tooling.${name} is required`);
  }
  for (const [name, tool] of Object.entries(tools)) {
    required(tool?.path, `${prefix}.tooling.${name}.path`, errors);
    if (!isSha256(tool?.sha256)) errors.push(`${prefix}.tooling.${name}.sha256 must be a lowercase sha256`);
    if (name === 'normalizer') required(tool?.version, `${prefix}.tooling.normalizer.version`, errors);
    if (commitExists(projectRoot, identity.capture_subject_commit) && tool?.path) {
      try {
        if (sha256Buffer(gitBlob(projectRoot, identity.capture_subject_commit, tool.path)) !== tool.sha256) {
          errors.push(`${prefix}.tooling.${name}.sha256 does not match the frozen Git blob`);
        }
      } catch (error) {
        errors.push(`${prefix}.tooling.${name} is missing from the frozen Git tree`);
      }
    }
  }

  const canonicalManifestSources = (manifestSources || []).map(canonicalSourceIdentity).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (stableJson(identity.sources || []) !== stableJson(canonicalManifestSources)) errors.push(`${prefix}.sources must exactly match manifest frozen sources`);
  if (sourceSetHash(manifestSources || []) !== identity.source_set_sha256) errors.push(`${prefix}.source_set_sha256 does not match frozen source records`);
  if (debt && debtPayloadSha256(debt) !== identity.debt_payload_sha256) errors.push(`${prefix}.debt_payload_sha256 does not match frozen validation debt payload`);
  if (recomputeFrozenId(identity) !== identity.frozen_capture_id) errors.push(`${prefix}.frozen_capture_id does not match frozen inputs and debt payload`);
}

function validateSources(manifest, projectRoot, errors) {
  for (const [index, source] of (manifest.sources || []).entries()) {
    const prefix = `manifest.sources[${index}]`;
    for (const key of ['id', 'type', 'locator_kind', 'sha256', 'member_count', 'owner', 'status', 'scope']) required(source[key], `${prefix}.${key}`, errors);
    if (!isSha256(source.sha256)) errors.push(`${prefix}.sha256 must be a lowercase sha256`);
    if (!Number.isInteger(source.member_count) || source.member_count < 1) errors.push(`${prefix}.member_count must be a positive integer`);
    if (source.locator_kind === 'git-tree') {
      if (path.isAbsolute(source.path || '')) errors.push(`${prefix}.path must be project-relative`);
      if (source.target_commit !== manifest.frozen_capture_identity?.capture_subject_commit) errors.push(`${prefix}.target_commit must equal capture_subject_commit`);
      if ((source.hash_paths || [source.path]).some((item) => path.isAbsolute(item || ''))) errors.push(`${prefix}.hash_paths must be project-relative`);
      if (commitExists(projectRoot, source.target_commit)) {
        try {
          const actual = hashGitSource(projectRoot, source.target_commit, source);
          if (actual.sha256 !== source.sha256) errors.push(`${prefix}.sha256 does not match frozen Git-tree content`);
          if (actual.memberCount !== source.member_count) errors.push(`${prefix}.member_count does not match frozen Git-tree content`);
        } catch (error) {
          errors.push(`${prefix} cannot be read from frozen Git tree: ${error.message}`);
        }
      }
    } else if (source.locator_kind === 'external-frozen') {
      required(source.external_locator, `${prefix}.external_locator`, errors);
      if (source.path !== undefined || source.hash_paths !== undefined) errors.push(`${prefix} external source must not carry project path fields`);
      if (source.historical_commit) {
        if (!commitExists(projectRoot, source.historical_commit)) errors.push(`${prefix}.historical_commit is not readable from Git`);
        else {
          try {
            const historical = hashGitSource(projectRoot, source.historical_commit, {
              path: source.historical_repo_path,
              hash_paths: [source.historical_repo_path],
              hash_excludes: source.hash_excludes
            });
            if (historical.memberCount !== source.historical_tree_member_count) errors.push(`${prefix}.historical_tree_member_count does not match Git tree`);
            if (historical.memberCount !== source.member_count || historical.sha256 !== source.sha256) errors.push(`${prefix} frozen external snapshot does not match historical Git tree`);
          } catch (error) {
            errors.push(`${prefix} historical snapshot cannot be verified: ${error.message}`);
          }
        }
      }
    } else {
      errors.push(`${prefix}.locator_kind must be git-tree or external-frozen`);
    }
  }
}

function validateProviders(manifest, knownRefs, errors) {
  const switchProviderActive = (manifest.decisions || []).some((item) => item.id === 'D-USER-SWITCH-PROVIDER');
  for (const [index, provider] of (manifest.providers || []).entries()) {
    const prefix = `manifest.providers[${index}]`;
    for (const key of ['id', 'role', 'model_family', 'status', 'evidence_refs']) required(provider[key], `${prefix}.${key}`, errors);
    for (const ref of provider.evidence_refs || []) if (!knownRefs.has(ref)) errors.push(`${prefix}.evidence_refs contains unknown ref ${ref}`);
    if (provider.status === 'selected-pending-smoke' && provider.eligible_for_h04 !== false) errors.push(`${prefix} must not be H04 eligible before H02A`);
  }
  const selected = (manifest.providers || []).filter((item) => item.role === 'execution-selected' && item.status === 'selected-pending-smoke');
  if (switchProviderActive) {
    // D-USER-SWITCH-PROVIDER 覆盖后：允许 0 个 selected-pending-smoke 执行 provider，
    // 但要求存在 superseded 声明（防止状态丢失），且 superseded 条目必须带 entry_locator
    const superseded = (manifest.providers || []).filter((item) => item.role === 'execution-selected' && item.status === 'superseded-by-D-USER-SWITCH-PROVIDER');
    if (superseded.length === 0 && selected.length === 0) {
      errors.push('manifest must declare a superseded-by-D-USER-SWITCH-PROVIDER execution provider when D-USER-SWITCH-PROVIDER is active');
    }
    if (superseded.length > 0) required(superseded[0].entry_locator, 'superseded execution provider.entry_locator', errors);
  } else if (selected.length !== 1) {
    errors.push('manifest must contain exactly one selected-pending-smoke execution provider');
  } else {
    required(selected[0].entry_locator, 'selected execution provider.entry_locator', errors);
  }
  const judgeStatusOk = manifest.judge?.status === 'selected-pending-smoke'
    || (switchProviderActive && manifest.judge?.status === 'superseded-by-D-USER-SWITCH-PROVIDER');
  if (!judgeStatusOk) errors.push('manifest.judge.status must be selected-pending-smoke in H00A');
  required(manifest.judge?.entry_locator, 'manifest.judge.entry_locator', errors);
  if (manifest.judge?.eligible_for_h04 !== false) errors.push('manifest.judge must not be H04 eligible before H02A');
  if (manifest.judge?.independent_run_context !== 'selected-not-verified') errors.push('manifest.judge.independent_run_context must be selected-not-verified in H00A');
  for (const ref of manifest.judge?.evidence_refs || []) if (!knownRefs.has(ref)) errors.push(`manifest.judge.evidence_refs contains unknown ref ${ref}`);
  for (const key of ['fixture_suite', 'oracle', 'adapter', 'epoch']) {
    const identity = manifest.future_identities?.[key];
    if (!identity || identity.status !== 'not-created' || identity.id !== null || !identity.owner_batch) {
      errors.push(`manifest.future_identities.${key} must be not-created with id null and owner_batch`);
    }
  }
}

function validateIncidents(incidents, families, knownRefs, errors) {
  const familyIds = new Set();
  for (const [index, family] of families.entries()) {
    const prefix = `families[${index}]`;
    for (const key of ['family_id', 'title', 'source_refs', 'severity_candidate', 'scope', 'status', 'earliest_failed_handoff']) required(family[key], `${prefix}.${key}`, errors);
    if (family.status !== 'failure-family-candidate') errors.push(`${prefix}.status must be failure-family-candidate`);
    if (familyIds.has(family.family_id)) errors.push(`${prefix}.family_id duplicates ${family.family_id}`);
    familyIds.add(family.family_id);
    for (const ref of family.source_refs || []) if (!knownRefs.has(ref)) errors.push(`${prefix}.source_refs contains unknown ref ${ref}`);
  }
  const incidentIds = new Set();
  for (const [index, incident] of incidents.entries()) {
    const prefix = `incidents[${index}]`;
    for (const key of ['incident_id', 'title', 'failure_family_refs', 'source_refs', 'evidence_types', 'severity', 'severity_basis', 'scope', 'status', 'earliest_failed_handoff', 'affected_objects', 'rework_cost', 'evidence_locator']) required(incident[key], `${prefix}.${key}`, errors);
    if (incidentIds.has(incident.incident_id)) errors.push(`${prefix}.incident_id duplicates ${incident.incident_id}`);
    incidentIds.add(incident.incident_id);
    if (!String(incident.status || '').startsWith('confirmed-')) errors.push(`${prefix}.status must be a confirmed status`);
    for (const familyRef of incident.failure_family_refs || []) if (!familyIds.has(familyRef)) errors.push(`${prefix}.failure_family_refs contains unknown family ${familyRef}`);
    const actualTypes = new Set((incident.source_refs || []).map((ref) => ref.split('-')[0]));
    if (![...actualTypes].some((type) => ['D', 'O', 'V'].includes(type))) errors.push(`${prefix} requires at least one actual D/O/V source`);
    for (const type of incident.evidence_types || []) if (!actualTypes.has(type)) errors.push(`${prefix}.evidence_types declares ${type} without a matching source ref`);
    for (const ref of incident.source_refs || []) if (!knownRefs.has(ref)) errors.push(`${prefix}.source_refs contains unknown ref ${ref}`);
  }
}

function validateDebt(debt, manifest, errors) {
  for (const key of ['schema_version', 'status', 'captured_at', 'capture_mode', 'frozen_capture_identity', 'scan_boundary', 'policy', 'commands', 'failure_inventory', 'comparison_contract']) required(debt?.[key], `validation_debt.${key}`, errors);
  if (debt?.schema_version !== 'h00a-validation-debt-v4') errors.push('validation_debt.schema_version must be h00a-validation-debt-v4');
  if (debt?.capture_mode !== 'canonical-isolated-detached-clean') errors.push('validation_debt.capture_mode must be canonical-isolated-detached-clean');
  if (stableJson(debt?.frozen_capture_identity) !== stableJson(manifest?.frozen_capture_identity)) errors.push('validation_debt.frozen_capture_identity must exactly match manifest.frozen_capture_identity');
  if (debt?.scan_boundary?.version !== BOUNDARY_VERSION) errors.push(`validation_debt.scan_boundary.version must be ${BOUNDARY_VERSION}`);
  if (debt?.scan_boundary?.exclude_gitlinks !== true) errors.push('validation_debt.scan_boundary.exclude_gitlinks must be true');
  if (debt?.policy !== 'zero-new-or-worsened-by-failure-key') errors.push('validation_debt.policy must be zero-new-or-worsened-by-failure-key');
  for (const error of validateCanonicalH00ACommands(debt?.commands)) errors.push(`validation_debt.${error}`);
  const commandById = new Map((debt?.commands || []).map((command) => [command.id, command]));
  const failuresByKey = new Map();
  for (const [index, failure] of (debt?.failure_inventory || []).entries()) {
    const prefix = `validation_debt.failure_inventory[${index}]`;
    for (const key of ['failure_key', 'command_id', 'file', 'rule_code', 'category', 'identity_subject', 'severity', 'normalized_message', 'message_fingerprint', 'occurrence_count']) required(failure[key], `${prefix}.${key}`, errors);
    if (!commandById.has(failure.command_id)) errors.push(`${prefix}.command_id is unknown`);
    if (!Number.isInteger(failure.occurrence_count) || failure.occurrence_count < 1) errors.push(`${prefix}.occurrence_count must be a positive integer`);
    if (failure.message_fingerprint !== sha256String(failure.normalized_message || '')) errors.push(`${prefix}.message_fingerprint does not match normalized_message`);
    if (failure.failure_key !== failureKey(failure)) errors.push(`${prefix}.failure_key is not stable for its identity fields`);
    if (String(failure.file || '').includes('/.claude/worktrees/')) errors.push(`${prefix}.file points inside an excluded nested worktree`);
    if (failuresByKey.has(failure.failure_key)) errors.push(`${prefix}.failure_key duplicates ${failure.failure_key}`);
    failuresByKey.set(failure.failure_key, failure);
  }
  for (const [index, command] of (debt?.commands || []).entries()) {
    const prefix = `validation_debt.commands[${index}]`;
    for (const key of ['id', 'command', 'kind', 'exit_code', 'output_sha256', 'issue_count', 'failure_count', 'failure_keys']) required(command[key], `${prefix}.${key}`, errors);
    if (!Number.isInteger(command.exit_code)) errors.push(`${prefix}.exit_code must be an integer`);
    if (!isSha256(command.output_sha256)) errors.push(`${prefix}.output_sha256 must be a lowercase sha256`);
    if (command.failure_count !== (command.failure_keys || []).length) errors.push(`${prefix}.failure_count must equal failure_keys length`);
    const occurrences = (command.failure_keys || []).reduce((sum, key) => sum + (failuresByKey.get(key)?.occurrence_count || 0), 0);
    if (command.issue_count !== occurrences) errors.push(`${prefix}.issue_count must equal summed occurrence_count`);
    for (const key of command.failure_keys || []) if (!failuresByKey.has(key)) errors.push(`${prefix}.failure_keys contains unknown key ${key}`);
  }
  if (stableJson(debt?.comparison_contract?.identity_fields) !== stableJson(['failure_key', 'file', 'rule_code', 'category', 'identity_subject'])) errors.push('validation_debt.comparison_contract.identity_fields is invalid');
  if (stableJson(debt?.comparison_contract?.comparison_fields) !== stableJson(['severity', 'message_fingerprint', 'occurrence_count'])) errors.push('validation_debt.comparison_contract.comparison_fields is invalid');
}

function hasOwn(value, key) {
  return value !== null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value));
}

function isRealReviewer(value) {
  return typeof value === 'string' && value.trim() !== ''
    && !['synthetic', 'todo', 'unknown', 'executor-self-approved'].includes(value.trim().toLowerCase());
}

function validateReviewedFields(confirmation, manifest, errors, requiredForStatus) {
  const fields = ['reviewed_by', 'reviewed_at', 'reviewed_frozen_capture_id', 'reviewed_capture_subject_commit'];
  for (const field of fields) if (!hasOwn(confirmation, field)) errors.push(`confirmation.${field} is required`);
  if (!requiredForStatus) {
    for (const field of fields) if (confirmation?.[field] !== null) errors.push(`confirmation.${field} must be null before review`);
    return;
  }
  if (!isRealReviewer(confirmation?.reviewed_by)) errors.push('confirmation.reviewed_by must be a non-placeholder reviewer');
  if (!isIsoTimestamp(confirmation?.reviewed_at)) errors.push('confirmation.reviewed_at must be an ISO 8601 timestamp');
  const identity = manifest?.frozen_capture_identity;
  if (confirmation?.reviewed_frozen_capture_id !== identity?.frozen_capture_id) errors.push('confirmation.reviewed_frozen_capture_id must match manifest frozen_capture_id');
  if (confirmation?.reviewed_capture_subject_commit !== identity?.capture_subject_commit) errors.push('confirmation.reviewed_capture_subject_commit must match manifest capture_subject_commit');
}

function valueAtPath(value, fieldPath) {
  return fieldPath.split('.').reduce((current, key) => current?.[key], value);
}

function diagnosticValue(value) {
  if (value === undefined) return '<missing>';
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[array length=${value.length}]`;
  return '[object]';
}

function migrationDiagnostics(expected, actual) {
  const differences = [];
  const scalarPaths = [
    'before.payload_sha256',
    'after.payload_sha256',
    'after.frozen_capture_id',
    'summary.unchanged',
    'summary.added',
    'summary.removed',
    'summary.changed'
  ].sort((left, right) => left.localeCompare(right, 'en'));
  for (const fieldPath of scalarPaths) {
    const expectedValue = valueAtPath(expected, fieldPath);
    const actualValue = valueAtPath(actual, fieldPath);
    if (stableJson(expectedValue) !== stableJson(actualValue)) {
      differences.push({
        fieldPath,
        failureKey: '',
        kind: 'field',
        message: `schema migration difference at ${fieldPath}: expected=${diagnosticValue(expectedValue)} actual=${diagnosticValue(actualValue)}`
      });
    }
  }

  for (const section of ['added', 'removed', 'changed']) {
    const expectedByKey = new Map((Array.isArray(expected?.[section]) ? expected[section] : [])
      .filter((item) => typeof item?.failure_key === 'string')
      .map((item) => [item.failure_key, item]));
    const actualByKey = new Map((Array.isArray(actual?.[section]) ? actual[section] : [])
      .filter((item) => typeof item?.failure_key === 'string')
      .map((item) => [item.failure_key, item]));
    for (const failureKey of expectedByKey.keys()) {
      if (!actualByKey.has(failureKey)) {
        differences.push({ fieldPath: section, failureKey, kind: 'missing', message: `schema migration ${section} missing failure_key: ${failureKey}` });
      } else if (stableJson(expectedByKey.get(failureKey)) !== stableJson(actualByKey.get(failureKey))) {
        differences.push({ fieldPath: section, failureKey, kind: 'changed', message: `schema migration ${section} changed failure_key: ${failureKey}` });
      }
    }
    for (const failureKey of actualByKey.keys()) {
      if (!expectedByKey.has(failureKey)) {
        differences.push({ fieldPath: section, failureKey, kind: 'unexpected', message: `schema migration ${section} unexpected failure_key: ${failureKey}` });
      }
    }
  }

  return differences
    .sort((left, right) => left.fieldPath.localeCompare(right.fieldPath, 'en')
      || left.failureKey.localeCompare(right.failureKey, 'en')
      || left.kind.localeCompare(right.kind, 'en'))
    .map((difference) => difference.message);
}

function validateMigration(migrationFile, debt, manifest, projectRoot, errors) {
  const migration = readJson(migrationFile, errors, 'schema migration');
  if (!migration) return;
  try {
    const expected = recomputeMigration(projectRoot, MIGRATION_BEFORE_REF, MIGRATION_BEFORE_PATH, debt, MIGRATION_AFTER_PATH);
    if (stableJson(migration) !== stableJson(expected)) {
      errors.push('schema migration report does not match a fresh recomputation');
      errors.push(...migrationDiagnostics(expected, migration));
    }
    if (migration.after?.frozen_capture_id !== manifest?.frozen_capture_identity?.frozen_capture_id) errors.push('schema migration after.frozen_capture_id must match current frozen identity');
  } catch (error) {
    errors.push(`schema migration cannot be recomputed: ${error.message}`);
  }
}

function validateConfirmation(confirmation, manifest, errors) {
  for (const key of ['schema_version', 'status', 'h00b_unlocked', 'required_checks']) required(confirmation?.[key], `confirmation.${key}`, errors);
  if (confirmation?.schema_version !== 'h00a-confirmation-v2') errors.push('confirmation.schema_version must be h00a-confirmation-v2');
  if (!['pending-review', 'approved', 'rejected'].includes(confirmation?.status)) errors.push('confirmation.status is invalid');
  const checks = confirmation?.required_checks || [];
  const ids = checks.map((check) => check?.id);
  const missingIds = CANONICAL_H00A_REVIEW_CHECK_IDS.filter((id) => !ids.includes(id));
  const unexpectedIds = [...new Set(ids.filter((id) => !CANONICAL_H00A_REVIEW_CHECK_IDS.includes(id)))].sort((left, right) => String(left).localeCompare(String(right), 'en'));
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort((left, right) => String(left).localeCompare(String(right), 'en'));
  if (JSON.stringify(ids) !== JSON.stringify(CANONICAL_H00A_REVIEW_CHECK_IDS)) {
    errors.push('confirmation.required_checks must match the canonical nine-check ID order');
    if (missingIds.length) errors.push(`confirmation.required_checks missing IDs: ${missingIds.join(', ')}`);
    if (unexpectedIds.length) errors.push(`confirmation.required_checks unexpected IDs: ${unexpectedIds.join(', ')}`);
    if (duplicateIds.length) errors.push(`confirmation.required_checks duplicate IDs: ${duplicateIds.join(', ')}`);
    if (!missingIds.length && !unexpectedIds.length && !duplicateIds.length) {
      errors.push(`confirmation.required_checks order mismatch: expected ${CANONICAL_H00A_REVIEW_CHECK_IDS.join(', ')}; actual ${ids.join(', ')}`);
    }
  }
  if (duplicateIds.length) errors.push('confirmation.required_checks IDs must be unique');
  for (const [index, check] of checks.entries()) {
    for (const key of ['id', 'label', 'status', 'evidence_refs']) required(check?.[key], `confirmation.required_checks[${index}].${key}`, errors);
    if (!Array.isArray(check?.evidence_refs) || !check.evidence_refs.length || check.evidence_refs.some((ref) => typeof ref !== 'string' || !ref.trim())) errors.push(`confirmation.required_checks[${index}].evidence_refs must be a non-empty string array`);
  }
  if (confirmation?.status === 'pending-review') {
    validateReviewedFields(confirmation, manifest, errors, false);
    if (checks.some((check) => check.status !== 'ready-for-review')) errors.push('pending-review confirmation requires every check to be ready-for-review');
    if (confirmation.h00b_unlocked !== false) errors.push('pending-review confirmation requires h00b_unlocked false');
  } else if (confirmation?.status === 'rejected') {
    validateReviewedFields(confirmation, manifest, errors, true);
    if (!checks.some((check) => check.status === 'rejected')) errors.push('rejected confirmation requires at least one rejected check');
    if (confirmation.h00b_unlocked !== false) errors.push('rejected confirmation requires h00b_unlocked false');
  } else if (confirmation?.status === 'approved') {
    validateReviewedFields(confirmation, manifest, errors, true);
    if (checks.some((check) => check.status !== 'approved')) errors.push('approved confirmation requires every canonical check to be approved');
    if (confirmation.h00b_unlocked !== true) errors.push('approved confirmation requires h00b_unlocked true');
    if ((manifest.providers || []).some((item) => item.eligible_for_h04 === true) || manifest.judge?.eligible_for_h04 === true) errors.push('H00A approval must not grant H04 eligibility');
  }
}

function validateFrozenPackage(options) {
  const errors = [];
  const manifest = readJson(options.manifest, errors, 'manifest');
  const debt = readJson(options.debt, errors, 'validation debt');
  const confirmation = readJson(options.confirmation, errors, 'confirmation');
  const incidents = loadJsonl(options.incidents, errors, 'incidents');
  const families = loadJsonl(options.families, errors, 'failure families');
  const ledgerIdentity = readLedgerFrozenIdentity(options.ledger, errors);
  if (manifest) {
    for (const key of ['schema_version', 'status', 'source_set', 'sources', 'providers', 'judge', 'future_identities', 'frozen_capture_identity']) required(manifest[key], `manifest.${key}`, errors);
    if (manifest.schema_version !== 'h00a-source-manifest-v4') errors.push('manifest.schema_version must be h00a-source-manifest-v4');
    if (manifest.project_root !== undefined) errors.push('manifest.project_root must not bind frozen evidence to a local absolute path');
    if (manifest.source_set?.identity_version !== SOURCE_SET_IDENTITY_VERSION) errors.push(`manifest.source_set.identity_version must be ${SOURCE_SET_IDENTITY_VERSION}`);
    if (stableJson(manifest.source_set?.identity_fields) !== stableJson(SOURCE_SET_IDENTITY_FIELDS)) errors.push('manifest.source_set.identity_fields does not match the frozen source contract');
    if (manifest.source_set?.aggregate_sha256 !== sourceSetHash(manifest.sources || [])) errors.push('manifest.source_set.aggregate_sha256 does not match frozen source records');
    validateSources(manifest, options.projectRoot, errors);
    validateFrozenIdentity(manifest.frozen_capture_identity, options.projectRoot, manifest.sources, debt, errors, 'manifest.frozen_capture_identity');
    if (stableJson(ledgerIdentity) !== stableJson(manifest.frozen_capture_identity)) errors.push('capture ledger identity must exactly match manifest.frozen_capture_identity');
  }
  if (debt && manifest) validateDebt(debt, manifest, errors);
  const knownRefs = new Set([...(manifest?.sources || []).map((item) => item.id), ...(manifest?.decisions || []).map((item) => item.id), ...(manifest?.observations || []).map((item) => item.id), ...(debt?.commands || []).map((item) => item.id)]);
  if (manifest) validateProviders(manifest, knownRefs, errors);
  validateIncidents(incidents, families, knownRefs, errors);
  if (manifest) validateConfirmation(confirmation, manifest, errors);
  if (manifest && debt) validateMigration(options.migration, debt, manifest, options.projectRoot, errors);
  return {
    errors,
    manifest,
    debt,
    confirmation,
    summary: {
      status: 'valid-frozen-evidence',
      frozenCaptureId: manifest?.frozen_capture_identity?.frozen_capture_id,
      captureSubjectCommit: manifest?.frozen_capture_identity?.capture_subject_commit,
      confirmedIncidents: incidents.length,
      failureFamilyCandidates: families.length,
      validationDebtCommands: debt?.commands?.length,
      validationDebtFailures: debt?.failure_inventory?.length,
      confirmationStatus: confirmation?.status,
      h00bUnlocked: confirmation?.h00b_unlocked
    }
  };
}

function parseOptions(argv) {
  const projectRoot = path.resolve(singleValueArgument(argv, '--project-root') || execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }).trim());
  const options = {
    mode: singleValueArgument(argv, '--mode') || 'frozen',
    projectRoot,
    manifest: singleValueArgument(argv, '--manifest'),
    incidents: singleValueArgument(argv, '--incidents'),
    families: singleValueArgument(argv, '--families'),
    debt: singleValueArgument(argv, '--debt'),
    confirmation: singleValueArgument(argv, '--confirmation'),
    migration: singleValueArgument(argv, '--migration'),
    ledger: singleValueArgument(argv, '--ledger') || path.join(projectRoot, CAPTURE_LEDGER_PATH),
    failOnDrift: booleanArgument(argv, '--fail-on-drift')
  };
  for (const key of ['manifest', 'incidents', 'families', 'debt', 'confirmation', 'migration', 'ledger']) {
    if (!options[key]) throw new Error(`--${key} is required`);
    options[key] = path.resolve(options[key]);
  }
  if (!['frozen', 'current-drift'].includes(options.mode)) throw new Error('--mode must be frozen or current-drift');
  return options;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseOptions(argv); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }
  const result = validateFrozenPackage(options);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  if (options.mode === 'frozen') {
    console.log(JSON.stringify(result.summary, null, 2));
    return;
  }
  const drift = buildWorkspaceDrift(options.projectRoot, result.manifest.frozen_capture_identity);
  console.log(JSON.stringify(drift, null, 2));
  if (options.failOnDrift && drift.has_drift) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { migrationDiagnostics, parseOptions, recomputeFrozenId, validateFrozenPackage };
