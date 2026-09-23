const crypto = require('crypto');

const NORMALIZER_VERSION = 'h00a-failure-normalizer-v3';

function sha256String(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeMessage(value, projectRoot = '') {
  let normalized = String(value || '');
  if (projectRoot) normalized = normalized.replaceAll(projectRoot, '<ROOT>');
  return normalized
    .replace(/([?&])v=[^&#"'<>\s]+/g, '$1v=<version>')
    .replace(/\s+/g, ' ')
    .trim();
}

function failureKey(failure) {
  return `FAIL-${sha256String([
    failure.command_id,
    failure.file,
    failure.rule_code,
    failure.category,
    failure.identity_subject
  ].join('\0')).slice(0, 24)}`;
}

function makeFailure(projectRoot, commandId, file, ruleCode, category, severity, message, sourceLocator = null, identitySubject = null) {
  const normalizedMessage = normalizeMessage(message, projectRoot);
  const normalizedSubject = normalizeMessage(identitySubject || ruleCode, projectRoot);
  const failure = {
    command_id: commandId,
    file,
    rule_code: ruleCode,
    category,
    identity_subject: normalizedSubject,
    severity,
    normalized_message: normalizedMessage,
    message_fingerprint: sha256String(normalizedMessage),
    source_locator: sourceLocator,
    occurrence_count: 1
  };
  failure.failure_key = failureKey(failure);
  return failure;
}

module.exports = { NORMALIZER_VERSION, failureKey, makeFailure, normalizeMessage, sha256String };
