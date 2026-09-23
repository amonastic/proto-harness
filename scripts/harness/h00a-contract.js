const CANONICAL_H00A_COMMANDS = Object.freeze([
  { id: 'V-H00A-AUDIT-RULES', command: 'npm run audit:rules', kind: 'atomic' },
  { id: 'V-H00A-REGISTER-MISSING', command: 'npm run register:missing', kind: 'atomic' },
  { id: 'V-H00A-LINT-UI', command: 'npm run lint:ui', kind: 'atomic' },
  { id: 'V-H00A-AUDIT-UI', command: 'npm run audit:ui', kind: 'atomic' },
  { id: 'V-H00A-AUDIT-DOCS', command: 'npm run audit:docs', kind: 'atomic' },
  { id: 'V-H00A-AUDIT-SNAPSHOTS', command: 'npm run audit:snapshots', kind: 'atomic' },
  { id: 'V-H00A-AUDIT-VERSION-TAGS', command: 'npm run audit:version-tags', kind: 'atomic' },
  {
    id: 'V-H00A-CHECK-GOVERNANCE',
    command: 'npm run check:governance',
    kind: 'composite',
    component_command_ids: ['V-H00A-AUDIT-SNAPSHOTS', 'V-H00A-AUDIT-VERSION-TAGS'],
    executed_component_command_ids: ['V-H00A-AUDIT-SNAPSHOTS']
  },
  {
    id: 'V-H00A-CHECK-ALL',
    command: 'npm run check:all',
    kind: 'composite',
    component_command_ids: [
      'V-H00A-AUDIT-RULES',
      'V-H00A-REGISTER-MISSING',
      'V-H00A-LINT-UI',
      'V-H00A-AUDIT-UI',
      'V-H00A-AUDIT-DOCS',
      'V-H00A-AUDIT-SNAPSHOTS',
      'V-H00A-AUDIT-VERSION-TAGS'
    ],
    executed_component_command_ids: ['V-H00A-AUDIT-RULES', 'V-H00A-REGISTER-MISSING', 'V-H00A-LINT-UI']
  }
]);

const CANONICAL_H00A_REVIEW_CHECK_IDS = Object.freeze([
  'H00A-CHECK-SOURCES',
  'H00A-CHECK-CAPTURE-IDENTITY',
  'H00A-CHECK-OLD-HARNESS',
  'H00A-CHECK-PROVIDERS',
  'H00A-CHECK-JUDGE',
  'H00A-CHECK-INCIDENTS',
  'H00A-CHECK-DEBT',
  'H00A-CHECK-SCHEMA-MIGRATION',
  'H00A-CHECK-FUTURE-IDENTITIES'
]);

function validateCanonicalH00ACommands(commands) {
  const errors = [];
  if (!Array.isArray(commands)) return ['commands must be an array'];
  const ids = commands.map((command) => command?.id);
  if (new Set(ids).size !== ids.length) errors.push('commands must use unique IDs');
  if (commands.length !== CANONICAL_H00A_COMMANDS.length) {
    errors.push(`commands must contain exactly ${CANONICAL_H00A_COMMANDS.length} entries`);
  }
  if (JSON.stringify(ids) !== JSON.stringify(CANONICAL_H00A_COMMANDS.map((command) => command.id))) {
    errors.push('commands must match the canonical H00A command order and complete ID set');
  }
  const actualById = new Map(commands.map((command) => [command?.id, command]));
  for (const expected of CANONICAL_H00A_COMMANDS) {
    const actual = actualById.get(expected.id);
    if (!actual) {
      errors.push(`commands is missing ${expected.id}`);
      continue;
    }
    for (const key of ['command', 'kind', 'component_command_ids', 'executed_component_command_ids']) {
      if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
        errors.push(`${expected.id}.${key} must match the canonical command contract`);
      }
    }
  }
  for (const id of new Set(ids)) {
    if (!CANONICAL_H00A_COMMANDS.some((expected) => expected.id === id)) errors.push(`commands contains unknown ID ${id}`);
  }
  return errors;
}

module.exports = {
  CANONICAL_H00A_COMMANDS,
  CANONICAL_H00A_REVIEW_CHECK_IDS,
  validateCanonicalH00ACommands
};
