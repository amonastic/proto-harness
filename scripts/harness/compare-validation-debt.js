const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { sha256String, stableJson } = require('./h00a-identity');

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1]) throw new Error(`${name} is required`);
  return argv[index + 1];
}

function readBefore(root, gitRef, relativePath) {
  return JSON.parse(execFileSync('git', ['show', `${gitRef}:${relativePath}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function recomputeMigration(root, beforeRef, baselinePath, after, afterFile) {
  return compare(
    readBefore(root, beforeRef, baselinePath),
    after,
    `${beforeRef}:${baselinePath}`,
    afterFile
  );
}

function inventory(debt) {
  return new Map((debt.failure_inventory || []).map((item) => [item.failure_key, item]));
}

function compare(before, after, beforeRef, afterFile) {
  const oldItems = inventory(before);
  const newItems = inventory(after);
  const added = [];
  const removed = [];
  const changed = [];
  let unchanged = 0;
  for (const [key, current] of newItems) {
    const previous = oldItems.get(key);
    if (!previous) added.push(current);
    else {
      const fields = {};
      for (const field of ['severity', 'message_fingerprint', 'occurrence_count', 'normalized_message']) {
        if (stableJson(previous[field]) !== stableJson(current[field])) fields[field] = { before: previous[field], after: current[field] };
      }
      if (Object.keys(fields).length) changed.push({ failure_key: key, fields });
      else unchanged += 1;
    }
  }
  for (const [key, previous] of oldItems) if (!newItems.has(key)) removed.push(previous);
  const occurrences = (debt) => (debt.failure_inventory || []).reduce((sum, item) => sum + item.occurrence_count, 0);
  return {
    schema_version: 'h00a-schema-migration-diff-r1',
    before: { ref: beforeRef, unique_failure_keys: oldItems.size, occurrences: occurrences(before), payload_sha256: sha256String(stableJson(before)) },
    after: { file: afterFile, frozen_capture_id: after.frozen_capture_identity?.frozen_capture_id, unique_failure_keys: newItems.size, occurrences: occurrences(after), payload_sha256: sha256String(stableJson(after)) },
    summary: { unchanged, added: added.length, removed: removed.length, changed: changed.length },
    added: added.sort((a, b) => a.failure_key.localeCompare(b.failure_key, 'en')),
    removed: removed.sort((a, b) => a.failure_key.localeCompare(b.failure_key, 'en')),
    changed: changed.sort((a, b) => a.failure_key.localeCompare(b.failure_key, 'en'))
  };
}

function main(argv = process.argv.slice(2)) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  const beforeRef = argument(argv, '--before-git');
  const baselinePath = argument(argv, '--baseline-path');
  const afterFile = path.resolve(argument(argv, '--after'));
  const outFile = path.resolve(argument(argv, '--out'));
  const expectedKeys = Number(argument(argv, '--expect-before-keys'));
  const expectedOccurrences = Number(argument(argv, '--expect-before-occurrences'));
  const before = readBefore(root, beforeRef, baselinePath);
  const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
  const report = compare(before, after, `${beforeRef}:${baselinePath}`, path.relative(root, afterFile).replace(/\\/g, '/'));
  if (report.before.unique_failure_keys !== expectedKeys || report.before.occurrences !== expectedOccurrences) {
    throw new Error(`before baseline expected ${expectedKeys} keys/${expectedOccurrences} occurrences, got ${report.before.unique_failure_keys}/${report.before.occurrences}`);
  }
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
}

if (require.main === module) main();

module.exports = { compare, readBefore, recomputeMigration };
