#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateFrozenPackage } = require('./validate-h00a');
const { assertNoSymlinkParents, h00aOptions } = require('./capture-baseline');
const {
  CANONICAL_H00A_REVIEW_CHECK_IDS, CANONICAL_MANIFEST_PATH, CANONICAL_OUTPUT_PATH,
  TOP_LEVEL_FIELDS, buildPayload, finalizeBaseline, firstDifference, parseSingleValueCli, stableJson
} = require('./h00b-contract');

function projectRoot(cwd = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

function validateBaseline(options) {
  const root = options.projectRoot || projectRoot(options.cwd);
  const input = path.resolve(root, options.input);
  if (input !== path.join(root, CANONICAL_OUTPUT_PATH)) throw new Error(`--input must be ${CANONICAL_OUTPUT_PATH}`);
  assertNoSymlinkParents(root, input);
  const stat = fs.lstatSync(input);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`input must be a single-link regular file: ${CANONICAL_OUTPUT_PATH}`);
  const original = fs.readFileSync(input);
  let baseline;
  try { baseline = JSON.parse(original.toString('utf8')); } catch (error) { throw new Error(`input JSON parse failed: ${error.message}`); }
  const keys = Object.keys(baseline);
  if (stableJson(keys) !== stableJson(TOP_LEVEL_FIELDS)) throw new Error(`baseline top-level fields/order mismatch: ${keys.join(', ')}`);
  const h00a = validateFrozenPackage(h00aOptions(root, path.join(root, CANONICAL_MANIFEST_PATH)));
  if (h00a.errors.length) throw new Error(`H00A frozen validation failed:\n${h00a.errors.join('\n')}`);
  if (stableJson(baseline.approval?.required_check_ids) !== stableJson(CANONICAL_H00A_REVIEW_CHECK_IDS)) throw new Error('approval.required_check_ids must match canonical H00A checks');
  const expected = finalizeBaseline(buildPayload(root, h00a.manifest, h00a.confirmation));
  if (baseline.payload_sha256 !== expected.payload_sha256) {
    const actualPayload = { ...baseline }; delete actualPayload.baseline_id; delete actualPayload.payload_sha256;
    const expectedPayload = { ...expected }; delete expectedPayload.baseline_id; delete expectedPayload.payload_sha256;
    throw new Error(`payload_sha256 mismatch; first differing field: ${firstDifference(expectedPayload, actualPayload, 'baseline') || 'payload'}`);
  }
  if (baseline.baseline_id !== expected.baseline_id) throw new Error('baseline_id mismatch');
  const difference = firstDifference(expected, baseline, 'baseline');
  if (difference) throw new Error(`${difference} mismatch`);
  if (!original.equals(Buffer.from(`${JSON.stringify(baseline, null, 2)}\n`, 'utf8'))) throw new Error('input is not canonical two-space JSON with one trailing newline');
  return {
    status: 'valid-h00b-baseline', baselineId: baseline.baseline_id, payloadSha256: baseline.payload_sha256,
    frozenCaptureId: baseline.frozen_capture.frozen_capture_id,
    captureSubjectCommit: baseline.frozen_capture.capture_subject_commit,
    confirmationStatus: baseline.approval.status, h01Eligible: true
  };
}

function main(argv = process.argv.slice(2)) {
  try { console.log(JSON.stringify(validateBaseline({ input: parseSingleValueCli(argv, '--input') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

if (require.main === module) main();
module.exports = { validateBaseline };
