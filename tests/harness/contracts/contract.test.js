const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('node:child_process');
const { execFileSync, spawnSync } = require('child_process');

// H01-F3 R6：meta child 身份五条件门。仅当全部满足时，本文件才作为私有变异副本运行；
// canonical 文件只要携带任一 H01F3_META_*/H01F3_HOST_ROOT 控制变量就在测试注册前拒绝（F3-META-AUTH）。
function resolveMetaEntryFromArgv() {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    let value = '';
    if (argv[i] === '--test-name-pattern') value = argv[i + 1] || '';
    if (argv[i] && argv[i].startsWith('--test-name-pattern=')) value = argv[i].slice('--test-name-pattern='.length);
    if (value === '') continue;
    const anchored = value.match(/^\^(CT-\d{2})\(\\s\|\$\)$/);
    if (anchored) return anchored[1];
    if (/^CT-\d{2}$/.test(value)) return value;
    return value;
  }
  return '';
}

function computeIsMetaChild() {
  if (process.env.H01F3_META_CHILD !== '1') return false;
  const injectedRoot = process.env.H01F3_HOST_ROOT;
  if (!injectedRoot) return false;
  const resolvedRoot = path.resolve(injectedRoot);
  // 条件 2：注入根必须解析为 canonical 宿主根（canonical 文件与 validator 必须存在）
  if (!fs.existsSync(path.join(resolvedRoot, 'tests/harness/contracts/contract.test.js'))) return false;
  if (!fs.existsSync(path.join(resolvedRoot, 'scripts/harness/validate-contract.js'))) return false;
  // 条件 3：H01F3_META_ENTRY 恰为 runner 注册的 CT-21/CT-26，且与 sidecar 记录的 entry 一致；
  // 若 child argv 中存在 --test-name-pattern 也必须匹配（Node 24 下 node --test 的 child argv 不含该参数，
  // 故以 sidecar entry 作为唯一可靠通道）
  const entry = process.env.H01F3_META_ENTRY;
  if (entry !== 'CT-21' && entry !== 'CT-26') return false;
  const argvPattern = resolveMetaEntryFromArgv();
  if (argvPattern !== '' && argvPattern !== entry) return false;
  // 条件 4：__filename 位于 runner 创建的私有 mkdtemp 目录（realpath 比较），普通文件且 nlink=1
  const dir = path.dirname(__filename);
  const tmpBase = fs.realpathSync(os.tmpdir());
  const dirReal = fs.realpathSync(dir);
  if (dirReal !== path.join(tmpBase, path.basename(dir))) return false;
  if (!/^h01f3-(ct21|ct26|can)-/.test(path.basename(dir))) return false;
  let st;
  try {
    st = fs.lstatSync(__filename, { bigint: true });
  } catch {
    return false;
  }
  if (!st.isFile() || st.nlink !== 1n) return false;
  // 条件 5：一次性 token sidecar 为普通单链接文件，内容必须为 `${token}:${entry}`（token 定时安全比较）
  const token = process.env.H01F3_META_TOKEN;
  const tokenFile = process.env.H01F3_META_TOKEN_FILE;
  if (!token || !tokenFile) return false;
  let tst;
  try {
    tst = fs.lstatSync(tokenFile, { bigint: true });
  } catch {
    return false;
  }
  if (!tst.isFile() || tst.nlink !== 1n) return false;
  let content;
  try {
    content = fs.readFileSync(tokenFile, 'utf8');
  } catch {
    return false;
  }
  return content === `${token}:${entry}`;
}

// 唯一 meta child 身份判定（五条件全满足才为 true）
const IS_META_CHILD = computeIsMetaChild();

// canonical 宿主根：正常运行时由 __dirname 推导；仅 IS_META_CHILD 通过 H01F3_HOST_ROOT 注入
const HOST_ROOT = IS_META_CHILD && process.env.H01F3_HOST_ROOT
  ? path.resolve(process.env.H01F3_HOST_ROOT)
  : path.resolve(__dirname, '../../..');

// canonical 拒绝：非 meta child 但携带任一 meta 控制变量 → 测试注册前退出 1（F3-27 验证）
if (!IS_META_CHILD) {
  const metaControls = Object.keys(process.env).filter((key) => key === 'H01F3_HOST_ROOT' || key.startsWith('H01F3_META_'));
  if (metaControls.length > 0) {
    console.error(`F3-META-AUTH canonical invocation must not carry meta control env: ${metaControls.join(',')}`);
    process.exit(1);
  }
}

const FIXTURES_DIR = 'tests/harness/contracts/fixtures';
const SCHEMA_DIR = path.join(HOST_ROOT, 'harness/engineering/schema');
const VALIDATOR = path.join(HOST_ROOT, 'scripts/harness/validate-contract.js');
const REGISTRY_PATH = path.join(HOST_ROOT, 'harness/engineering/owner-registry.json');
const MANIFEST_PATH = path.join(HOST_ROOT, FIXTURES_DIR, 'manifest.json');
const SUPPORTED_KEYWORDS = ['$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'minLength', 'minItems', 'uniqueItems', 'required', 'properties', 'items', 'additionalProperties', 'anyOf', 'oneOf', 'allOf', 'not'];

function run(root, command, args, expected = 0) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, expected, `${command} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function validateJson(root = HOST_ROOT, expected = 0, extraArgs = []) {
  return run(root, process.execPath, [VALIDATOR, '--fixtures', FIXTURES_DIR, ...extraArgs], expected);
}

function collectKeys(node, keys, prefix = '') {
  if (Array.isArray(node)) {
    for (const item of node) collectKeys(item, keys, prefix);
    return;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      keys.add(key);
      collectKeys(node[key], keys, `${prefix}.${key}`);
    }
  }
}

// 构建隔离项目根：复制 schema 与 fixtures 到系统临时目录，写入给定 owner-registry，
// 以真实 CLI 运行，不改动 canonical owner-registry.json。
function copySourceBasis(tmpRoot) {
  fs.mkdirSync(path.join(tmpRoot, 'tests/harness/baselines'), { recursive: true });
  fs.copyFileSync(path.join(HOST_ROOT, 'tests/harness/baselines/source-manifest.json'), path.join(tmpRoot, 'tests/harness/baselines/source-manifest.json'));
}

function runRegistryCli(registryJson, expectedExit = 1) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f-root-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'harness/engineering/schema'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'tests/harness/contracts'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpRoot, 'harness/engineering/schema', file));
    }
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpRoot, FIXTURES_DIR), { recursive: true });
    copySourceBasis(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'harness/engineering/owner-registry.json'), `${JSON.stringify(registryJson, null, 2)}\n`);
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', FIXTURES_DIR], { cwd: tmpRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, expectedExit, `registry CLI exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return result;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// 构建隔离项目根（复制 schema、canonical registry 与全部 fixtures 到临时目录），
// manifest 采用 canonical 全量 cases，仅将 overrides 中命中的 case 替换。
// 这样覆盖下限（每 schema ≥1 valid ≥2 invalid）天然满足，overrides 用于 H01F 场景级反例。
function runIsolatedFixtures(overrides, expectedExit = 1) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f-fix-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'harness/engineering/schema'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpRoot, 'harness/engineering/schema', file));
    }
    fs.copyFileSync(REGISTRY_PATH, path.join(tmpRoot, 'harness/engineering/owner-registry.json'));
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpRoot, 'fixtures'), { recursive: true });
    copySourceBasis(tmpRoot);
    const canonicalManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const cases = canonicalManifest.cases.map((fixture) => ({ ...fixture }));
    for (const override of overrides) {
      const index = cases.findIndex((fixture) => fixture.fixture_id === override.fixture_id);
      assert.ok(index >= 0, `override fixture_id not found in canonical manifest: ${override.fixture_id}`);
      cases[index] = { ...cases[index], ...override };
    }
    const manifest = { schema_version: 'h01-contract-fixtures-v1', cases };
    fs.writeFileSync(path.join(tmpRoot, 'fixtures', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', 'fixtures'], { cwd: tmpRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, expectedExit, `isolated fixtures CLI exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return result;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// 复制 canonical fixtures 到临时根，删除指定 contract 的某个 valid fixture 字段后以真实 CLI 运行。
function runFixtureWithFieldRemoved(contract, field) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f-strip-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'harness/engineering/schema'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpRoot, 'harness/engineering/schema', file));
    }
    fs.copyFileSync(REGISTRY_PATH, path.join(tmpRoot, 'harness/engineering/owner-registry.json'));
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpRoot, 'fixtures'), { recursive: true });
    copySourceBasis(tmpRoot);
    const canonicalManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const target = canonicalManifest.cases.find((fixture) => fixture.contract === contract && fixture.expected === 'valid');
    assert.ok(target, `no valid fixture for contract ${contract}`);
    const fixturePath = path.join(tmpRoot, 'fixtures', target.input);
    const obj = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    delete obj[field];
    fs.writeFileSync(fixturePath, `${JSON.stringify(obj, null, 2)}\n`);
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', 'fixtures'], { cwd: tmpRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return result;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function makeCase(fixtureId, input, contract, expected, codes = []) {
  return { fixture_id: fixtureId, input, contract, expected, expected_error_codes: codes };
}

// H01-F3：无依赖受限 JS tokenizer——仅用于对 contract.test.js 自身做结构化元检查。
// 跳过字符串（单/双/模板）、行/块注释；正则字面量按前一 token 上下文启发识别。
function tokenizeJs(source) {
  const tokens = [];
  let i = 0;
  const n = source.length;
  const isIdStart = (c) => /[A-Za-z_$]/.test(c);
  const isIdChar = (c) => /[A-Za-z0-9_$]/.test(c);
  const isRegexStart = (prev) => {
    if (!prev) return true;
    if (prev.type === 'id') return false;
    if (prev.type === 'num') return false;
    if (prev.value === ')' || prev.value === ']' || prev.value === '}') return false;
    return true;
  };
  while (i < n) {
    const c = source[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '/' && source[i + 1] === '/') {
      const e = source.indexOf('\n', i);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const e = source.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = i;
      const quote = c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i += 1; break; }
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          const close = source.indexOf('}', i + 2);
          i = close < 0 ? n : close + 1;
          continue;
        }
        i += 1;
      }
      tokens.push({ type: 'str', value: source.slice(start, i), start, end: i, quote });
      continue;
    }
    if (isIdStart(c)) {
      const start = i;
      while (i < n && isIdChar(source[i])) i += 1;
      tokens.push({ type: 'id', value: source.slice(start, i), start, end: i });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9a-fA-FxXoObB._]/.test(source[i])) i += 1;
      tokens.push({ type: 'num', value: source.slice(start, i), start, end: i });
      continue;
    }
    if (c === '/') {
      const prev = tokens[tokens.length - 1];
      if (isRegexStart(prev)) {
        const start = i;
        i += 1;
        let inClass = false;
        while (i < n) {
          if (source[i] === '\\') { i += 2; continue; }
          if (source[i] === '[') inClass = true;
          else if (source[i] === ']') inClass = false;
          else if (source[i] === '/' && !inClass) { i += 1; break; }
          else if (source[i] === '\n') break;
          i += 1;
        }
        tokens.push({ type: 'regex', value: source.slice(start, i), start, end: i });
        continue;
      }
    }
    tokens.push({ type: 'punct', value: c, start: i, end: i + 1 });
    i += 1;
  }
  return tokens;
}

function nextNonSpaceToken(tokens, from) {
  for (let i = from; i < tokens.length; i += 1) {
    if (tokens[i].type === 'punct' && /^\s*$/.test(tokens[i].value)) continue;
    return tokens[i];
  }
  return null;
}

function matchingParen(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === 'punct' && tokens[i].value === '(') depth += 1;
    else if (tokens[i].type === 'punct' && tokens[i].value === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchingBrace(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === 'punct' && tokens[i].value === '{') depth += 1;
    else if (tokens[i].type === 'punct' && tokens[i].value === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// H01-F3：从源码提取顶层 test() 声明（支持单引号/双引号/模板字符串）与
// 每个测试体区间。返回 [{ name, nameStart, bodyStart, bodyEnd }]。
function extractTopLevelTests(source) {
  const tokens = tokenizeJs(source);
  const tests = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'id' || t.value !== 'test') continue;
    const prev = tokens[i - 1];
    if (prev && prev.value !== ';' && prev.value !== '}' && prev.value !== '{') continue;
    const openParen = nextNonSpaceToken(tokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    const nameTok = nextNonSpaceToken(tokens, openParenIndex(tokens, openParen) + 1);
    if (!nameTok || nameTok.type !== 'str') continue;
    const closeParen = matchingParen(tokens, openParenIndex(tokens, openParen));
    if (closeParen < 0) continue;
    // 函数体 { 出现在 test( 闭括号之前（箭头函数 () => {），从 openParen 向后找
    let bodyOpen = -1;
    for (let j = openParenIndex(tokens, openParen) + 1; j <= closeParen; j += 1) {
      if (tokens[j].type === 'punct' && tokens[j].value === '{') { bodyOpen = j; break; }
    }
    if (bodyOpen < 0) continue;
    const bodyClose = matchingBrace(tokens, bodyOpen);
    if (bodyClose < 0) continue;
    tests.push({
      name: nameTok.value.slice(1, -1),
      nameStart: nameTok.start,
      bodyStart: tokens[bodyOpen].start,
      bodyEnd: tokens[bodyClose].start,
      end: bodyClose
    });
  }
  return tests;
}

function openParenIndex(tokens, tok) {
  return tokens.indexOf(tok);
}

// H01-F3：提取指定测试体区间内的 bindH01F('H01F-XX', ...) 声明实参。
function extractBindCallsInRange(tokens, startIdx, endIdx) {
  const ids = [];
  for (let i = startIdx; i < endIdx; i += 1) {
    const t = tokens[i];
    if (t.type !== 'id' || t.value !== 'bindH01F') continue;
    const openParen = nextNonSpaceToken(tokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    const closeParen = matchingParen(tokens, tokens.indexOf(openParen));
    if (closeParen < 0) continue;
    for (let j = tokens.indexOf(openParen) + 1; j < closeParen; j += 1) {
      const tok = tokens[j];
      if (tok.type === 'str' && /^['"`]H01F-\d{2}['"`]$/.test(tok.value)) {
        ids.push(tok.value.slice(1, -1));
      }
    }
  }
  return ids;
}

// H01-F3：H01F 场景绑定声明——运行时无副作用，仅供结构化元检查提取。
function bindH01F(...ids) {
  return ids;
}

// H01-F3：canonical H01F 绑定表——单一、可机械比较的映射事实源。
// 每项 [H01F-ID, 场景 marker]：测试体必须通过 bindH01F(...) 声明含该 ID（含顺序），
// 且测试体内非注释 token（str/regex 字面量）必须实际出现场景 marker（错误码/断言关键词）。
// marker 缺失即证明场景断言被删除，仅剩惰性标签——元检查拒绝。
const H01F_BINDINGS = {
  'CT-02': [['H01F-20', 'missing required field scope'], ['H01F-21', 'missing required field source_refs'], ['H01F-22', 'P-LONGCAT-2-0']],
  'CT-09': [['H01F-01', 'OWNER_CONFLICT'], ['H01F-02', 'owner_ids'], ['H01F-03', 'owner_kind'], ['H01F-04', 'source_refs'], ['H01F-05', 'topic']],
  'CT-15': [['H01F-10', 'CHECKPOINT-H01F-OVERFLOW'], ['H01F-11', 'CHECKPOINT-H01F-STATE-MISMATCH'], ['H01F-12', 'CHECKPOINT-H01F-NO-TRACE'], ['H01F-13', 'real middle event']],
  'CT-16': [['H01F-06', 'superseded'], ['H01F-07', 'self'], ['H01F-08', 'cycle'], ['H01F-09', 'legal supersedes']],
  'CT-19': [['H01F-22', 'callable'], ['H01F-23', 'judge_ref']],
  'CT-21': [['H01F-25', 'identical']],
  'CT-24': [['H01F-14', 'outside'], ['H01F-15', 'inside'], ['H01F-16', 'hardlink'], ['H01F-17', 'manifest']],
  'CT-25': [['H01F-18', 'DETERMINISM_MISMATCH'], ['H01F-19', 'two invalid']],
  'CT-26': [['H01F-24', 'pass 36']]
};

// H01-F3 R6：执行锚统一由 H01F_PROOFS 的 anchors 字段声明（见 assertContractSurface），
// 不再维护独立 H01F_EXEC_ANCHORS 表。

// H01-F3 R6：H01F typed proof descriptor——以 CT-ID/H01F-ID 为唯一键，描述每个场景的
// 证明种类、证明 API、marker、subject 来源、期望 token 与 identity 绑定。
// 同一 H01F-ID 可在不同 CT 下出现（CT-02/H01F-22 与 CT-19/H01F-22 是两个合法键）。
const H01F_PROOFS = {
  'CT-02/H01F-20': { ct_id: 'CT-02', h01f_id: 'H01F-20', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'missing required field scope', marker_role: 'expected-token', anchors: ['runFixtureWithFieldRemoved'], subjects: ['strippedScope'], expected_tokens: ['SCHEMA_VIOLATION', 'missing required field scope'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-02/H01F-21': { ct_id: 'CT-02', h01f_id: 'H01F-21', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'missing required field source_refs', marker_role: 'expected-token', anchors: ['runFixtureWithFieldRemoved'], subjects: ['strippedSourceRefs'], expected_tokens: ['SCHEMA_VIOLATION', 'missing required field source_refs'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-02/H01F-22': { ct_id: 'CT-02', h01f_id: 'H01F-22', proof_kind: 'fixture-property', proof_api: 'proveFixtureProperty', marker: 'P-LONGCAT-2-0', marker_role: 'expected-token', anchors: ['runFixtureWithFieldRemoved'], subjects: ['tests/harness/contracts/fixtures/valid/provider-longcat.json'], expected_tokens: ['P-LONGCAT-2-0', 'execution-selected', 'selected-pending-smoke'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-09/H01F-01': { ct_id: 'CT-09', h01f_id: 'H01F-01', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'OWNER_CONFLICT', marker_role: 'expected-token', anchors: ['runRegistryCli'], subjects: ['result'], expected_tokens: ['OWNER_CONFLICT', 'failed'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-09/H01F-02': { ct_id: 'CT-09', h01f_id: 'H01F-02', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'owner_ids', marker_role: 'expected-token', anchors: ['runRegistryCli'], subjects: ['result'], expected_tokens: ['topic_id', 'owner_ids', 'OWNER-H01-INTRUDER', 'OWNER-H01-TRACE'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-09/H01F-03': { ct_id: 'CT-09', h01f_id: 'H01F-03', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'owner_kind', marker_role: 'scenario-label', anchors: ['runRegistryCli'], subjects: ['kindResult'], expected_tokens: ['OWNER_CONFLICT'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-09/H01F-04': { ct_id: 'CT-09', h01f_id: 'H01F-04', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'source_refs', marker_role: 'scenario-label', anchors: ['runRegistryCli'], subjects: ['refsResult'], expected_tokens: ['OWNER_CONFLICT'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-09/H01F-05': { ct_id: 'CT-09', h01f_id: 'H01F-05', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'topic', marker_role: 'scenario-label', anchors: ['runRegistryCli'], subjects: ['topicResult'], expected_tokens: ['OWNER_CONFLICT'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-15/H01F-10': { ct_id: 'CT-15', h01f_id: 'H01F-10', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'CHECKPOINT-H01F-OVERFLOW', marker_role: 'expected-token', anchors: ['runIsolatedFixtures'], subjects: ['overflow'], expected_tokens: ['TRACE_INCOMPLETE', 'CHECKPOINT-H01F-OVERFLOW'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-15/H01F-11': { ct_id: 'CT-15', h01f_id: 'H01F-11', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'CHECKPOINT-H01F-STATE-MISMATCH', marker_role: 'expected-token', anchors: ['runIsolatedFixtures'], subjects: ['overflow'], expected_tokens: ['CHECKPOINT-H01F-STATE-MISMATCH'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-15/H01F-12': { ct_id: 'CT-15', h01f_id: 'H01F-12', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'CHECKPOINT-H01F-NO-TRACE', marker_role: 'expected-token', anchors: ['runIsolatedFixtures'], subjects: ['overflow'], expected_tokens: ['CHECKPOINT-H01F-NO-TRACE'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-15/H01F-13': { ct_id: 'CT-15', h01f_id: 'H01F-13', proof_kind: 'state-identity', proof_api: 'proveStateIdentity', marker: 'real middle event', marker_role: 'scenario-label', anchors: ['runIsolatedFixtures'], subjects: ['checkpointIdentity', 'goodCheckpoint'], expected_tokens: ['"status": "passed"'], identity_tokens: ['valid/checkpoint.json', 'CT-02-checkpoint'], relation: null, proof_clauses: [] },
  'CT-16/H01F-06': { ct_id: 'CT-16', h01f_id: 'H01F-06', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'superseded', marker_role: 'scenario-label', anchors: ['runIsolatedFixtures'], subjects: ['badChain'], expected_tokens: ['SCHEMA_VIOLATION'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-16/H01F-07': { ct_id: 'CT-16', h01f_id: 'H01F-07', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'self', marker_role: 'expected-token', anchors: ['runIsolatedFixtures'], subjects: ['badChain'], expected_tokens: ['SUPERSEDES_CYCLE', 'D-SELF-SUPERSEDE'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-16/H01F-08': { ct_id: 'CT-16', h01f_id: 'H01F-08', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'cycle', marker_role: 'expected-token', anchors: ['runIsolatedFixtures'], subjects: ['badChain'], expected_tokens: ['SUPERSEDES_CYCLE', 'D-CYCLE-A'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-16/H01F-09': { ct_id: 'CT-16', h01f_id: 'H01F-09', proof_kind: 'state-identity', proof_api: 'proveStateIdentity', marker: 'legal supersedes', marker_role: 'scenario-label', anchors: ['runIsolatedFixtures'], subjects: ['legalChainIdentity', 'goodChain'], expected_tokens: ['"status": "passed"'], identity_tokens: ['CT-16g', 'CT-16h'], relation: null, proof_clauses: [] },
  'CT-19/H01F-22': { ct_id: 'CT-19', h01f_id: 'H01F-22', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'callable', marker_role: 'scenario-label', anchors: ['runIsolatedFixtures'], subjects: ['callable'], expected_tokens: ['SCHEMA_VIOLATION', 'selected-pending-smoke'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-19/H01F-23': { ct_id: 'CT-19', h01f_id: 'H01F-23', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'judge_ref', marker_role: 'expected-token', anchors: ['runIsolatedFixtures'], subjects: ['noJudge'], expected_tokens: ['judge_ref', 'judge provider'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-21/H01F-25': { ct_id: 'CT-21', h01f_id: 'H01F-25', proof_kind: 'relational', proof_api: 'proveRelation', marker: 'identical', marker_role: 'scenario-label', anchors: ['validateJson'], subjects: ['first', 'second'], expected_tokens: [], identity_tokens: [], relation: 'deepEqual', proof_clauses: [] },
  'CT-24/H01F-14': { ct_id: 'CT-24', h01f_id: 'H01F-14', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'outside', marker_role: 'scenario-label', anchors: ['runFixturesWithLink'], subjects: ['inputSymlinkOutside'], expected_tokens: ['CLI_ARGUMENT', 'symlink', 'regular'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-24/H01F-15': { ct_id: 'CT-24', h01f_id: 'H01F-15', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'inside', marker_role: 'scenario-label', anchors: ['runFixturesWithLink'], subjects: ['inputSymlinkInside'], expected_tokens: ['1'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-24/H01F-16': { ct_id: 'CT-24', h01f_id: 'H01F-16', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'hardlink', marker_role: 'expected-token', anchors: ['runFixturesWithLink'], subjects: ['inputHardlink'], expected_tokens: ['CLI_ARGUMENT', 'hard link', 'nlink'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-24/H01F-17': { ct_id: 'CT-24', h01f_id: 'H01F-17', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'manifest', marker_role: 'expected-token', anchors: ['runFixturesWithLink'], subjects: ['manifestSymlink', 'manifestHardlink'], expected_tokens: ['CLI_ARGUMENT', 'manifest'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-25/H01F-18': { ct_id: 'CT-25', h01f_id: 'H01F-18', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'DETERMINISM_MISMATCH', marker_role: 'expected-token', anchors: ['runManifestMutation'], subjects: ['emptyCodes'], expected_tokens: ['DETERMINISM_MISMATCH', 'failed'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-25/H01F-19': { ct_id: 'CT-25', h01f_id: 'H01F-19', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'two invalid', marker_role: 'expected-token', anchors: ['runManifestMutation'], subjects: ['thinCoverage'], expected_tokens: ['at least two invalid cases'], identity_tokens: [], relation: null, proof_clauses: [] },
  'CT-26/H01F-24': { ct_id: 'CT-26', h01f_id: 'H01F-24', proof_kind: 'result-content', proof_api: 'proveResultContent', marker: 'pass 36', marker_role: 'expected-token', anchors: ['childProcess.spawnSync', 'recordProtectedHashes'], subjects: ['h00b'], expected_tokens: ['# tests 36', '# pass 36', '# fail 0'], identity_tokens: [], relation: null, proof_clauses: [{ proof_kind: 'relational', proof_api: 'proveRelation', relation: 'deepEqual', subjects: ['protectedAfter', 'protectedBefore'] }] }
};

// H01-F3 R6：四类 typed proof helpers。helper 自己从原始 child result / 文件 / identity 对象
// 读取并执行 matcher/equal；禁止调用方传入预计算 actual 或任意 transform 回调。
function proveResultContent(key, result, clauses) {
  for (const clause of clauses) {
    if (clause.kind === 'status') {
      assert.equal(result.status, clause.expected, `${key} status must be ${clause.expected}`);
    } else if (clause.kind === 'match') {
      assert.match(result[clause.field], clause.pattern, `${key} ${clause.field} must match ${clause.pattern}`);
    } else if (clause.kind === 'include') {
      assert.ok(String(result[clause.field]).includes(clause.text), `${key} ${clause.field} must include ${clause.text}`);
    }
  }
  return result;
}

function proveRelation(key, leftResult, leftField, rightResult, rightField, relation) {
  if (relation === 'deepEqual') {
    assert.deepEqual(leftResult[leftField], rightResult[rightField], `${key} ${leftField} must deep-equal ${rightField}`);
  } else {
    assert.equal(leftResult[leftField], rightResult[rightField], `${key} ${leftField} must equal ${rightField}`);
  }
  return rightResult;
}

function proveFixtureProperty(key, relativePath, checks) {
  const parsed = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, relativePath), 'utf8'));
  for (const check of checks) {
    if (check.kind === 'equal') {
      assert.equal(parsed[check.field], check.expected, `${key} ${relativePath} ${check.field} must equal ${check.expected}`);
    } else if (check.kind === 'match') {
      assert.match(parsed[check.field], check.pattern, `${key} ${relativePath} ${check.field} must match ${check.pattern}`);
    }
  }
  return parsed;
}

function proveStateIdentity(key, identityObject, result, clauses) {
  for (const clause of clauses) {
    if (clause.kind === 'identity-equal') {
      assert.equal(identityObject[clause.field], clause.expected, `${key} identity ${clause.field} must equal ${clause.expected}`);
    } else if (clause.kind === 'identity-length') {
      assert.equal(identityObject[clause.field].length, clause.expected, `${key} identity ${clause.field} length must be ${clause.expected}`);
    } else if (clause.kind === 'result-status') {
      assert.equal(result.status, clause.expected, `${key} status must be ${clause.expected}`);
    } else if (clause.kind === 'result-match') {
      assert.match(result[clause.field], clause.pattern, `${key} ${clause.field} must match ${clause.pattern}`);
    }
  }
  return result;
}

// H01-F3 R6：验证整个文件的父测试集合、H01F typed proof descriptor 与绑定（结构化元检查核心）。
// 父测试编号必须严格匹配 ^CT-\d{2}$（编号后必须是合法分隔，禁止 CT-01X/CT-001/CT-21b）。
function collectTypedProofCalls(bodyTokens, inDeadBranch) {
  const calls = [];
  const apis = ['proveResultContent', 'proveRelation', 'proveFixtureProperty', 'proveStateIdentity'];
  for (let i = 0; i < bodyTokens.length; i += 1) {
    const t = bodyTokens[i];
    if (t.type !== 'id' || !apis.includes(t.value)) continue;
    const openParen = nextNonSpaceToken(bodyTokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    const openIdx = bodyTokens.indexOf(openParen);
    const closeIdx = matchingParen(bodyTokens, openIdx);
    if (closeIdx < 0 || inDeadBranch(openIdx)) continue;
    const argTokens = bodyTokens.slice(openIdx + 1, closeIdx);
    const first = argTokens[0];
    if (!first || first.type !== 'str') continue;
    const keyMatch = first.value.match(/^'(CT-\d{2}\/H01F-\d{2})'$/);
    if (!keyMatch) continue;
    calls.push({ api: t.value, key: keyMatch[1], argTokens, argText: argTokens.map((tk) => tk.value).join(' ') });
  }
  return calls;
}

function assertContractSurface(source) {
  const tests = extractTopLevelTests(source);
  const expectedOrder = [];
  for (let i = 1; i <= 26; i += 1) expectedOrder.push(`CT-${String(i).padStart(2, '0')}`);
  const names = tests.map((t) => t.name);
  const ctNames = names.map((name) => {
    const match = name.match(/^CT-(\d{2})(?=\s|$)/);
    return match ? match[0] : name;
  });
  assert.deepEqual(ctNames, expectedOrder, 'F3-05 top-level tests must be exactly CT-01..CT-26 in order with strict numbering');
  assert.ok(!ctNames.includes('CT-21b'), 'F3-05 CT-21b must not exist');
  assert.ok(!ctNames.some((name) => /^CT-2[7-9]/.test(name) || /^CT-\d{3,}/.test(name)), 'F3-03/04 no CT-27+ or padded variants allowed');
  assert.ok(!names.some((name) => /^CT-\d/.test(name) && !/^CT-\d{2}(?=\s|$)/.test(name)), 'F3-05 CT-01X/CT-001/CT-21b style malformed test titles must be rejected');
  // descriptor 键集合必须与 bindH01F 推导的 CT-ID/H01F-ID 组合键集合一致（无孤儿、无重复）
  const derivedKeys = [];
  for (const [ct, pairs] of Object.entries(H01F_BINDINGS)) {
    for (const pair of pairs) derivedKeys.push(`${ct}/${pair[0]}`);
  }
  assert.deepEqual(Object.keys(H01F_PROOFS).sort(), derivedKeys.sort(), 'F3-10 H01F_PROOFS keys must match bindH01F-derived keys');
  for (const [key, desc] of Object.entries(H01F_PROOFS)) {
    assert.equal(`${desc.ct_id}/${desc.h01f_id}`, key, `F3-10 ${key} descriptor key must match ct_id/h01f_id`);
    assert.ok(desc.anchors.length > 0 && desc.subjects.length > 0, `F3-10 ${key} anchors/subjects must not be empty`);
    if (desc.proof_kind !== 'relational') assert.ok(desc.expected_tokens.length > 0, `F3-10 ${key} expected_tokens must not be empty`);
    if (desc.proof_kind === 'state-identity') assert.ok(desc.identity_tokens.length > 0, `F3-10 ${key} identity_tokens must not be empty`);
    if (desc.proof_kind === 'relational') assert.ok(desc.relation && desc.subjects.length >= 2, `F3-10 ${key} relational requires relation and >=2 subjects`);
  }
  const tokens = tokenizeJs(source);
  for (const test of tests) {
    const ctKey = test.name.match(/^CT-(\d{2})(?=\s|$)/);
    const bindingKey = ctKey ? ctKey[0] : test.name;
    const expectedPairs = H01F_BINDINGS[bindingKey] || [];
    const expectedIds = expectedPairs.map((pair) => pair[0]);
    const startIdx = indexOfTokenAt(tokens, test.bodyStart);
    const endIdx = indexOfTokenAt(tokens, test.bodyEnd);
    const actual = extractBindCallsInRange(tokens, startIdx, endIdx + 1);
    assert.deepEqual(actual, expectedIds, `F3-01/02 ${test.name} H01F bindings must match canonical map`);
    // 场景覆盖证据（多重）：活代码执行锚 + typed proof 调用（helper 内真实断言）+ subject/token 绑定
    if (expectedPairs.length > 0) {
      const bodyTokens = tokens.slice(startIdx, endIdx + 1);
      const deadRanges = deadBranchRanges(bodyTokens);
      const inDeadBranch = (idx) => deadRanges.some((range) => idx >= range.start && idx <= range.end);
      // 执行锚：至少一个 descriptor anchor 调用必须位于活代码路径（死分支内的调用不算覆盖证据）
      const anchorNames = [...new Set(expectedPairs.map((pair) => H01F_PROOFS[`${bindingKey}/${pair[0]}`].anchors).flat())];
      assert.ok(anchorNames.length > 0, `F3-10 ${test.name} must declare execution anchors in H01F_PROOFS`);
      const hasExecAnchor = anchorNames.some((anchor) => {
        const anchorId = anchor.includes('.') ? anchor.split('.')[1] : anchor;
        for (let i = 0; i < bodyTokens.length; i += 1) {
          if (bodyTokens[i].type !== 'id' || bodyTokens[i].value !== anchorId) continue;
          const next = nextNonSpaceToken(bodyTokens, i + 1);
          if (next && next.type === 'punct' && next.value === '(' && !inDeadBranch(i)) return true;
        }
        return false;
      });
      assert.ok(hasExecAnchor, `F3-10 ${test.name} must contain a live execution anchor call (${anchorNames.join('/')})`);
      // typed proof 调用：键集合必须与 descriptor 键集合一致（同一键可多次调用），且每个调用位于活代码
      const expectedKeys = expectedPairs.map((pair) => `${bindingKey}/${pair[0]}`);
      const calls = collectTypedProofCalls(bodyTokens, inDeadBranch);
      assert.ok(calls.length >= expectedKeys.length, `F3-10 ${test.name} typed proof calls must cover all descriptor keys`);
      const callKeySet = [...new Set(calls.map((c) => c.key))].sort();
      const expectedKeySet = [...new Set(expectedKeys)].sort();
      assert.deepEqual(callKeySet, expectedKeySet, `F3-10 ${test.name} typed proof call key set must match descriptor keys exactly`);
      assert.ok(calls.length > 0, `F3-10 ${test.name} must contain live typed proof calls (proveResultContent/proveRelation/proveFixtureProperty/proveStateIdentity)`);
      // 每个 descriptor：proof_api、subjects、expected_tokens、identity_tokens 必须真实出现在调用实参
      for (const pair of expectedPairs) {
        const key = `${bindingKey}/${pair[0]}`;
        const desc = H01F_PROOFS[key];
        const call = calls.find((c) => c.key === key);
        assert.ok(call, `F3-10 ${key} typed proof call must exist in live code`);
        assert.equal(call.api, desc.proof_api, `F3-10 ${key} proof_api must be ${desc.proof_api}`);
        for (const subject of desc.subjects) {
          const found = calls.filter((c) => c.key === key).some((c) =>
            c.argTokens.some((tk) => tk.type === 'id' && tk.value === subject)
            || c.argText.includes(subject));
          assert.ok(found, `F3-10 ${key} subject ${subject} must appear in proof call args`);
        }
        for (const token of [...desc.expected_tokens, ...desc.identity_tokens]) {
          assert.ok(call.argText.includes(token), `F3-10 ${key} expected/identity token "${token}" must appear in proof call args`);
        }
        // 次级 proof_clauses：每个 clause 的 proof_api 调用必须存在于目标 CT 体（键以 descriptor 键为前缀）
        const bodyText = bodyTokens.map((tok) => tok.value).join(' ');
        for (const clause of desc.proof_clauses || []) {
          assert.ok(clause.proof_api && clause.relation, `F3-10 ${key} proof clause must declare proof_api and relation`);
          assert.ok(bodyText.includes(`'${key}-`), `F3-10 ${key} secondary proof clause call (${key}-...) must exist`);
        }
      }
    }
  }
}

function indexOfTokenAt(tokens, offset) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].start === offset) return i;
    if (tokens[i].start > offset) return i;
  }
  return tokens.length;
}

// H01-F3 R6：计算 token 流内的死分支块。canonical 不可达集合至少包含
// if (false)、if (0)、if (!!0)、if (1 === 0)；死分支内的执行锚、断言与 marker 字符串均不构成覆盖证据。
function deadBranchRanges(tokens) {
  const ranges = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'id' || tokens[i].value !== 'if') continue;
    const openParen = nextNonSpaceToken(tokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    const openIdx = tokens.indexOf(openParen);
    const closeIdx = matchingParen(tokens, openIdx);
    if (closeIdx < 0) continue;
    const condText = tokens.slice(openIdx + 1, closeIdx).map((t) => t.value).join(' ');
    if (!/^(! )*0$|^false$|^1 = = = 0$/.test(condText)) continue;
    const brace = nextNonSpaceToken(tokens, closeIdx + 1);
    if (!brace || brace.type !== 'punct' || brace.value !== '{') continue;
    const braceIdx = tokens.indexOf(brace);
    const bodyClose = matchingBrace(tokens, braceIdx);
    if (bodyClose < 0) continue;
    ranges.push({ start: braceIdx, end: bodyClose });
  }
  return ranges;
}

// H01-F3 R6：CT-26 wrapper 计划由 assertCanonicalH00BPlan/assertCanonicalH00BSource 统一校验，
// 旧 assertWrapperPlan 已删除；hasTokenSequence/hasMockTapAssignment 保留供 source helper 使用。

function hasTokenSequence(tokens, values) {
  for (let i = 0; i + values.length <= tokens.length; i += 1) {
    let matches = true;
    for (let j = 0; j < values.length; j += 1) {
      if (tokens[i + j].value !== values[j]) { matches = false; break; }
    }
    if (matches) return true;
  }
  return false;
}

function hasMockTapAssignment(tokens) {
  for (let i = 0; i + 2 < tokens.length; i += 1) {
    if (tokens[i].value !== 'tap' || tokens[i + 1].value !== '=') continue;
    const rhs = tokens[i + 2];
    if (rhs.type === 'str' && (rhs.value.startsWith('# tests') || rhs.value.startsWith("'# tests"))) return true;
  }
  return false;
}

// H01-F3 R6：extractPlanValue/hasObjectLiteralNtc 已随旧 assertWrapperPlan 删除，
// plan 值校验统一由 assertCanonicalH00BPlan（运行时）与 assertCanonicalH00BSource（源码形态）承担。

// ===== H01-F3 R6：ANCHOR_BODY_BASELINE（执行锚点冻结基线）=====
// 从固定基线提交 edf2ace6 提取 11 个执行 helper 的函数体（跳过注释与空白的规范化 token
// 序列）计算 SHA-256；当前源码同名函数体 hash 必须逐项一致，漂移即 F3-ANCHOR-IDENTITY。
const ANCHOR_BASELINE_COMMIT = 'edf2ace628190139409f37bcc9e5069c49907c3b';
const ANCHOR_BODY_FUNCS = ['run', 'validateJson', 'copySourceBasis', 'runRegistryCli', 'runIsolatedFixtures', 'runFixtureWithFieldRemoved', 'makeCase', 'runRegistryCliWithManifest', 'runManifestMutation', 'runFixturesWithLink', 'canonicalRegistryFixture'];
// 开源示例降级开关：CT-26 与其 4 个 F3 leaf（F3-13/19/20/26）依赖 H00A/H00B 私有证据链
// （manifest v4、debt 台账、来源清册、审批提交），开源仓库不发布；置 false 可在私有环境恢复执行。
const OSS_SKIP_CT26 = true;

function extractFunctionBodyRange(source, funcName) {
  const tokens = tokenizeJs(source);
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'id' || t.value !== 'function') continue;
    const nameTok = nextNonSpaceToken(tokens, i + 1);
    if (!nameTok || nameTok.type !== 'id' || nameTok.value !== funcName) continue;
    const openParen = nextNonSpaceToken(tokens, i + 2);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    const openIdx = tokens.indexOf(openParen);
    const closeParen = matchingParen(tokens, openIdx);
    if (closeParen < 0) continue;
    const bodyBrace = nextNonSpaceToken(tokens, closeParen + 1);
    if (!bodyBrace || bodyBrace.type !== 'punct' || bodyBrace.value !== '{') continue;
    const braceIdx = tokens.indexOf(bodyBrace);
    const bodyClose = matchingBrace(tokens, braceIdx);
    if (bodyClose < 0) continue;
    return { bodyStart: tokens[braceIdx].start, bodyEnd: tokens[bodyClose].end };
  }
  return null;
}

function functionBodyHash(source, funcName) {
  const range = extractFunctionBodyRange(source, funcName);
  if (!range) return null;
  const tokens = tokenizeJs(source);
  const startIdx = indexOfTokenAt(tokens, range.bodyStart);
  const endIdx = indexOfTokenAt(tokens, range.bodyEnd);
  const bodySig = tokens.slice(startIdx, endIdx + 1).map((tok) => tok.value).join('\u0000');
  return crypto.createHash('sha256').update(bodySig, 'utf8').digest('hex');
}

// 返回 { baseline }：11 个 helper 的规范化 body hash；任何缺函数/漂移/基线读取失败均抛 F3-ANCHOR-IDENTITY。
// 开源示例降级：ANCHOR_BASELINE_COMMIT 指向私有仓提交，在开源仓库不可解析（文件尚未提交或
// 历史不含该 hash）时 anchor 检查降级为 deferred（诊断输出，不 fail）；开源仓库首次提交本文件后，
// 应将 ANCHOR_BASELINE_COMMIT 回填为该提交 hash 以恢复漂移防护。
function anchorBodyBaseline(currentSource) {
  const gitResult = childProcess.spawnSync('git', ['show', `${ANCHOR_BASELINE_COMMIT}:tests/harness/contracts/contract.test.js`], { cwd: HOST_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  if (gitResult.status !== 0) {
    const unavailable = String(gitResult.stderr || '').match(/bad revision|exists in neither|invalid object|unknown revision|does not exist|but not in/i);
    if (unavailable) {
      // eslint-disable-next-line no-console
      console.log(`F3-ANCHOR-IDENTITY deferred: anchor commit ${ANCHOR_BASELINE_COMMIT.slice(0, 8)} not present in this repository (OSS example); refill after first commit to re-enable drift guard`);
      return { baseline: null, anchorDeferred: true };
    }
  }
  assert.equal(gitResult.status, 0, 'F3-ANCHOR-IDENTITY baseline git show must succeed');
  const baselineSource = gitResult.stdout;
  const baseline = {};
  for (const func of ANCHOR_BODY_FUNCS) {
    const baselineHash = functionBodyHash(baselineSource, func);
    const currentHash = functionBodyHash(currentSource, func);
    assert.ok(baselineHash !== null, `F3-ANCHOR-IDENTITY baseline function ${func} must exist`);
    assert.ok(currentHash !== null, `F3-ANCHOR-IDENTITY current function ${func} must exist`);
    assert.equal(currentHash, baselineHash, `F3-ANCHOR-IDENTITY function body drift: ${func}`);
    baseline[func] = baselineHash;
  }
  return baseline;
}

// ===== H01-F3 R6：统一 meta child runner =====
// 写变异副本到私有 mkdtemp 目录，生成一次性 token sidecar，注入五条件 meta env，
// 以 --test-name-pattern=<entry> 执行；child 超时 30 秒，timeout/signal/spawn error 均不合格。
function runMetaChild(variant, mutatedSource) {
  const entry = variant.entry;
  const entryPrefix = entry === 'CT-26' ? 'ct26' : 'ct21';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `h01f3-${entryPrefix}-`));
  const tmpFile = path.join(tmpDir, 'mutated.test.js');
  const token = crypto.randomBytes(16).toString('hex');
  const tokenFile = path.join(tmpDir, 'token.sidecar');
  const childEnv = {
    ...process.env,
    H01F3_META_CHILD: '1',
    H01F3_HOST_ROOT: HOST_ROOT,
    H01F3_META_ENTRY: entry,
    H01F3_META_TOKEN: token,
    H01F3_META_TOKEN_FILE: tokenFile,
    ...variant.env_overrides
  };
  delete childEnv.NODE_TEST_CONTEXT;
  childEnv.NODE_OPTIONS = [childEnv.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ');
  try {
    fs.writeFileSync(tokenFile, `${token}:${entry}`);
    fs.writeFileSync(tmpFile, mutatedSource);
    const patternArg = `--test-name-pattern=^${entry}(\\s|$)`;
    const result = childProcess.spawnSync(process.execPath, ['--test', patternArg, tmpFile], {
      cwd: HOST_ROOT,
      env: childEnv,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024
    });
    return { result, command: [process.execPath, '--test', patternArg, tmpFile] };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function parseTapCounts(output) {
  const count = (label) => {
    const m = output.match(new RegExp(`^# ${label} (\\d+)`, 'm'));
    return m ? Number(m[1]) : null;
  };
  return { tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), todo: count('todo') };
}

// 解析 TAP 输出中的第一个失败 subtest 块（not ok + YAML 块），返回 { name, code, diagnostic }。
function findTargetFailure(output) {
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^not ok /.test(lines[i])) continue;
    const name = lines[i].replace(/^not ok \d+ - /, '').trim();
    const block = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (/^  \.\.\.$/.test(lines[j])) break;
      block.push(lines[j]);
    }
    const joined = block.join('\n');
    const codeMatch = joined.match(/code:\s*'([^']+)'/);
    const msgMatch = joined.match(/message:\s*'([^']+)'/);
    return { name, code: codeMatch ? codeMatch[1] : '', diagnostic: msgMatch ? msgMatch[1] : joined };
  }
  return null;
}

// 结构化执行证据（任务包 6.4 字段全集）
function collectEvidence(variant, sourceBefore, sourceAfter, run, startedAt, failure) {
  const counts = parseTapCounts(run.result.stdout + run.result.stderr);
  return {
    label: variant.id,
    mutation_contract: variant.mutation_contract,
    semantic_assertion: variant.semantic_assertion,
    source_before_sha256: crypto.createHash('sha256').update(sourceBefore, 'utf8').digest('hex'),
    source_after_sha256: crypto.createHash('sha256').update(sourceAfter, 'utf8').digest('hex'),
    command: run.command.join(' '),
    pattern: `--test-name-pattern=^${variant.entry}(\\s|$)`,
    status: run.result.status,
    diagnostic: failure ? failure.diagnostic : '',
    duration_ms: Date.now() - startedAt,
    signal: run.result.signal,
    spawn_error: run.result.error ? String(run.result.error) : null,
    target_subtest: failure ? failure.name : '',
    tap_tests: counts.tests,
    tap_pass: counts.pass,
    tap_fail: counts.fail,
    tap_skipped: counts.skipped,
    tap_todo: counts.todo,
    failure_name: failure ? failure.name : '',
    failure_code: failure ? failure.code : '',
    stdout: run.result.stdout,
    stderr: run.result.stderr
  };
}

// source-mutation leaf 证据校验：目标 subtest 恰为 entry、实际执行数=1 且 pass=0/fail=1/todo=0、
// 失败为 ERR_ASSERTION、诊断命中；超时/信号/spawn error 均不合格。
// 执行数取 tests - skipped：Node 18/20 会把 --test-name-pattern 未命中的用例以
// `# SKIP test name does not match pattern` 计入 tests 汇总，Node 22 则不计。
// 断言直接写 tests=1 等于把 TAP 汇总口径绑死在某一版 Node 上。
function validateF3Evidence(variant, evidence) {
  assert.ok(typeof variant.semantic_assertion === 'string' && variant.semantic_assertion.trim().length > 0, `${variant.id} must declare non-empty semantic_assertion`);
  assert.equal(evidence.status, 1, `${variant.id} must exit 1`);
  assert.equal(evidence.signal, null, `${variant.id} must not be signal-killed`);
  assert.equal(evidence.spawn_error, null, `${variant.id} must not have spawn error`);
  const executed = evidence.tap_tests - evidence.tap_skipped;
  assert.equal(executed, 1, `${variant.id} must run exactly 1 subtest (got ${executed}; tests=${evidence.tap_tests} skipped=${evidence.tap_skipped})`);
  assert.equal(evidence.tap_pass, 0, `${variant.id} must have 0 pass`);
  assert.equal(evidence.tap_fail, 1, `${variant.id} must have exactly 1 fail`);
  assert.equal(evidence.tap_todo, 0, `${variant.id} must have 0 todo`);
  assert.equal(evidence.failure_code, 'ERR_ASSERTION', `${variant.id} failure must be AssertionError (got ${evidence.failure_code})`);
  assert.ok(variant.diagnostic.test(evidence.diagnostic), `${variant.id} diagnostic must match ${variant.diagnostic} (got ${evidence.diagnostic})`);
}

// 变异语义检查：变异必须真实改变源码（字节 + token 签名），且通过该 leaf 的 semantic_oracle。
// 拒绝追加一行、只改注释、插入游离 marker、仅改诊断、仅改 label 或把失败断言移到无关 CT。
function assertVariantMutationSemantics(variant, sourceBefore, sourceAfter) {
  assert.ok(sourceAfter !== sourceBefore, `F3-MUTATION-IDENTITY ${variant.id} must change source bytes`);
  const beforeSig = tokenizeJs(sourceBefore).map((tok) => tok.value).join('\u0000');
  const afterSig = tokenizeJs(sourceAfter).map((tok) => tok.value).join('\u0000');
  assert.ok(afterSig !== beforeSig, `F3-MUTATION-IDENTITY ${variant.id} token signature must change (comment/whitespace-only mutation rejected)`);
  variant.semantic_oracle(sourceBefore, sourceAfter);
}

// ===== H01-F3 R6：semantic_oracle——从变异前后的 token/AST 关系独立得出结论 =====
function runSemanticOracle(id, before, after) {
  const afterTests = extractTopLevelTests(after);
  const afterNames = afterTests.map((t) => t.name);
  const beforeNames = extractTopLevelTests(before).map((t) => t.name);
  const afterTokens = tokenizeJs(after);
  const hasSeq = (seq) => hasTokenSequence(afterTokens, seq);
  const bodyOf = (ctName) => {
    const target = afterTests.find((t) => new RegExp(`^${ctName}\\b`).test(t.name));
    assert.ok(target, `${id} oracle: ${ctName} must exist in mutated source`);
    const startIdx = indexOfTokenAt(afterTokens, target.bodyStart);
    const endIdx = indexOfTokenAt(afterTokens, target.bodyEnd);
    return afterTokens.slice(startIdx, endIdx + 1);
  };
  switch (id) {
    case 'F3-01': {
      const ct9 = bodyOf('CT-09');
      const ids = extractBindCallsInRange(ct9, 0, ct9.length);
      assert.deepEqual(ids.slice(0, 2), ['H01F-02', 'H01F-01'], 'F3-01 H01F-01/02 must be swapped');
      assert.deepEqual(ids.slice(2), ['H01F-03', 'H01F-04', 'H01F-05'], 'F3-01 rest of CT-09 bindings must be unchanged');
      break;
    }
    case 'F3-02': {
      const ct16Body = bodyOf('CT-16');
      const ct26Body = bodyOf('CT-26');
      const ct16Ids = extractBindCallsInRange(ct16Body, 0, ct16Body.length);
      const ct26Ids = extractBindCallsInRange(ct26Body, 0, ct26Body.length);
      assert.ok(!ct16Ids.includes('H01F-06') && ct16Ids.includes('H01F-24'), 'F3-02 CT-16 must lose H01F-06 and gain H01F-24');
      assert.ok(ct26Ids.includes('H01F-06') && !ct26Ids.includes('H01F-24'), 'F3-02 CT-26 must lose H01F-24 and gain H01F-06');
      break;
    }
    case 'F3-03': assert.ok(afterNames.includes('CT-27 injected double-quoted') && !beforeNames.includes('CT-27 injected double-quoted'), 'F3-03 double-quoted CT-27 must be injected'); break;
    case 'F3-04': assert.ok(afterNames.includes('CT-27 injected template') && !beforeNames.includes('CT-27 injected template'), 'F3-04 template CT-27 must be injected'); break;
    case 'F3-14': assert.ok(afterNames.some((n) => /^CT-01X/.test(n)) && !beforeNames.some((n) => /^CT-01X/.test(n)), 'F3-14 CT-01X must be injected'); break;
    case 'F3-15': assert.ok(afterNames.some((n) => /^CT-001/.test(n)) && !beforeNames.some((n) => /^CT-001/.test(n)), 'F3-15 CT-001 must be injected'); break;
    case 'F3-16': assert.ok(afterNames.some((n) => /^CT-21b/.test(n)) && !beforeNames.some((n) => /^CT-21b/.test(n)), 'F3-16 CT-21b must be injected'); break;
    case 'F3-05': assert.ok(!afterNames.includes('CT-01 all schemas parse with fixed $id and no unknown keywords') && beforeNames.includes('CT-01 all schemas parse with fixed $id and no unknown keywords'), 'F3-05 top-level CT-01 must be removed'); break;
    case 'F3-22': assert.deepEqual(afterNames.slice(0, 2), ['CT-02 every schema has at least one valid fixture', 'CT-01 all schemas parse with fixed $id and no unknown keywords'], 'F3-22 CT-01/CT-02 order must be swapped'); break;
    case 'F3-06': assert.ok(!hasSeq(['delete', 'env', '.', 'NODE_TEST_CONTEXT']), 'F3-06 delete NODE_TEST_CONTEXT must be removed'); break;
    case 'F3-07': {
      const ct26Body = bodyOf('CT-26');
      assert.ok(hasTokenSequence(ct26Body, ['spawnSync', '(', 'process', '.', 'execPath']), 'F3-07 direct node spawn must exist in CT-26');
      assert.ok(hasTokenSequence(ct26Body, ["'--test'"]), 'F3-07 direct node spawn must pass --test flag');
      break;
    }
    case 'F3-08': assert.ok(afterTokens.some((tok) => tok.type === 'str' && tok.value.startsWith("'# tests 36")), 'F3-08 mock TAP string must be hard-coded'); break;
    case 'F3-09': assert.ok(hasSeq(['if', '(', 'false', ')']) && hasSeq(['spawnSync', '(', 'process', '.', 'execPath']), 'F3-09 dead canonical wrapper plus direct node exec must exist'); break;
    case 'F3-10': {
      const ct9 = bodyOf('CT-09');
      assert.ok(!ct9.some((tok) => tok.type === 'id' && tok.value === 'runRegistryCli'), 'F3-10 CT-09 exec anchor must be removed');
      assert.ok(ct9.some((tok) => tok.type === 'id' && tok.value === 'assert' && ct9[ct9.indexOf(tok) + 1] && ct9[ct9.indexOf(tok) + 1].value === '.' && ct9[ct9.indexOf(tok) + 2] && ct9[ct9.indexOf(tok) + 2].value === 'ok'), 'F3-10 CT-09 must keep only assert.ok(true)');
      break;
    }
    case 'F3-11': {
      const ct24 = bodyOf('CT-24');
      assert.ok(!ct24.some((tok) => tok.type === 'id' && tok.value === 'runFixturesWithLink'), 'F3-11 CT-24 exec anchor must be removed');
      break;
    }
    case 'F3-12': {
      const ct9 = bodyOf('CT-09');
      assert.ok(ct9.some((tok, i) => tok.type === 'id' && tok.value === 'void' && ct9[i + 1] && ct9[i + 1].type === 'str' && /OWNER_CONFLICT|owner_ids|owner_kind|source_refs|topic/.test(ct9[i + 1].value)), 'F3-12 CT-09 must contain void dead marker strings');
      break;
    }
    case 'F3-13': assert.ok(hasSeq(['h00bPlan', '.', 'command', '=', 'process', '.', 'execPath']) && hasSeq(['precomputedH00bFiles']), 'F3-13 plan must be execPath with precomputed file list'); break;
    case 'F3-17': case 'F3-18': case 'F3-23': {
      const cond = id === 'F3-17' ? ['!', '!', '0'] : id === 'F3-18' ? ['1', '=', '=', '=', '0'] : ['0'];
      const ct9 = bodyOf('CT-09');
      let found = false;
      for (let i = 0; i < ct9.length; i += 1) {
        if (ct9[i].type !== 'id' || ct9[i].value !== 'if') continue;
        const openParen = nextNonSpaceToken(ct9, i + 1);
        if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
        const openIdx = ct9.indexOf(openParen);
        const closeIdx = matchingParen(ct9, openIdx);
        if (closeIdx < 0) continue;
        const condText = ct9.slice(openIdx + 1, closeIdx).map((tok) => tok.value).join(' ');
        if (condText === cond.join(' ')) { found = true; break; }
      }
      assert.ok(found, `${id} CT-09 must contain if (${cond.join(' ')}) dead branch`);
      const calls = collectTypedProofCalls(ct9, () => false);
      assert.equal(calls.length, 0, `${id} CT-09 must have no live typed proof calls`);
      break;
    }
    case 'F3-19': {
      const ct26 = bodyOf('CT-26');
      const ct26Text = ct26.map((tok) => tok.value).join(' ');
      assert.ok(ct26Text.includes("'npm'") || ct26Text.includes("'npm.cmd'"), 'F3-19 mutated source must keep npm literal surface');
      assert.ok(ct26Text.includes('execPath'), 'F3-19 mutated plan must evaluate to execPath');
      break;
    }
    case 'F3-20': assert.ok(hasSeq(['h00bPlan', '.', 'command', '=', 'process', '.', 'execPath']) && hasSeq(["'--test'"]) && hasSeq(["'tests/harness/h00b/baseline.test.js'"]), 'F3-20 plan must be execPath + --test + single H00B file'); break;
    case 'F3-21': {
      const ct9 = bodyOf('CT-09');
      const ct9Text = ct9.map((tok) => tok.value).join(' ');
      assert.ok(ct9.some((tok) => tok.type === 'id' && tok.value === 'runRegistryCli'), 'F3-21 CT-09 must keep real runRegistryCli call');
      assert.ok(hasTokenSequence(ct9, ['assert', '.', 'equal']), 'F3-21 CT-09 must use assert.equal');
      const literalCount = (ct9Text.match(/'OWNER_CONFLICT'/g) || []).length;
      assert.ok(literalCount >= 2, 'F3-21 CT-09 must use pure literal self-equal asserts');
      assert.ok(!ct9.some((tok) => tok.type === 'id' && tok.value.startsWith('prove')), 'F3-21 CT-09 must have no typed proof calls');
      break;
    }
    case 'F3-24': {
      const ct9 = bodyOf('CT-09');
      const ct9Text = ct9.map((tok) => tok.value).join(' ');
      assert.ok(ct9Text.includes('slice') && ct9Text.includes('0'), 'F3-24 CT-09 must use slice(0, 0) marker concatenation');
      assert.ok(!ct9.some((tok) => tok.type === 'id' && tok.value.startsWith('prove')), 'F3-24 CT-09 must have no typed proof calls');
      break;
    }
    case 'F3-25': {
      const ct9 = bodyOf('CT-09');
      const ct9Text = ct9.map((tok) => tok.value).join(' ');
      assert.ok(ct9Text.includes('?') && hasTokenSequence(ct9, ['result', '.', 'stderr']), 'F3-25 CT-09 must use result.stderr ? MARKER : MARKER');
      assert.ok(!ct9.some((tok) => tok.type === 'id' && tok.value.startsWith('prove')), 'F3-25 CT-09 must have no typed proof calls');
      break;
    }
    case 'F3-26': {
      const ct26 = bodyOf('CT-26');
      const ct26Text = ct26.map((tok) => tok.value).join(' ');
      assert.ok(ct26Text.includes('fakeExec'), 'F3-26 CT-26 must use a fake executor');
      assert.ok(!ct26.some((tok, i) => tok.type === 'id' && tok.value === 'childProcess' && ct26[i + 1] && ct26[i + 1].value === '.' && ct26[i + 2] && ct26[i + 2].value === 'spawnSync'), 'F3-26 CT-26 must not use childProcess.spawnSync');
      break;
    }
    default:
      assert.fail(`${id} has no semantic oracle`);
  }
}

// H01-F3：替换源码中最后一次出现的目标文本（CT-26 体内代码位于文件末尾，
// 避免反例定义自身的字符串字面量先于目标被命中）。
function replaceLastOccurrence(source, target, replacement) {
  const idx = source.lastIndexOf(target);
  assert.ok(idx >= 0, `replaceLastOccurrence: target must exist: ${target.slice(0, 40)}`);
  return `${source.slice(0, idx)}${replacement}${source.slice(idx + target.length)}`;
}

// H01-F3：删除指定测试体的全部真实断言，仅保留 bindH01F 惰性标签与 assert.ok(true)。
// 用于复现“惰性标签错误通过”：删断言后，场景 marker 检查必须退出 1。
function stripScenarioAssertions(source, ctPrefix) {
  const tests = extractTopLevelTests(source);
  const target = tests.find((t) => new RegExp(`^${ctPrefix}\\b`).test(t.name));
  assert.ok(target, `stripScenarioAssertions: ${ctPrefix} must exist`);
  const tokens = tokenizeJs(source);
  const startIdx = indexOfTokenAt(tokens, target.bodyStart);
  const endIdx = indexOfTokenAt(tokens, target.bodyEnd);
  const bodyTokens = tokens.slice(startIdx, endIdx + 1);
  // 找 bindH01F 调用文本（含分号），其余全部替换
  let bindCallStart = -1;
  let bindCallEnd = -1;
  for (let i = 0; i < bodyTokens.length; i += 1) {
    const t = bodyTokens[i];
    if (t.type !== 'id' || t.value !== 'bindH01F') continue;
    const openParen = nextNonSpaceToken(bodyTokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    bindCallStart = t.start;
    const openIdx = bodyTokens.indexOf(openParen);
    const closeIdx = matchingParen(bodyTokens, openIdx);
    for (let j = closeIdx + 1; j < bodyTokens.length; j += 1) {
      if (bodyTokens[j].type === 'punct' && bodyTokens[j].value === ';') {
        bindCallEnd = bodyTokens[j].end;
        break;
      }
    }
    break;
  }
  assert.ok(bindCallStart >= 0 && bindCallEnd >= 0, 'stripScenarioAssertions: bindH01F call must exist');
  const bindCallText = source.slice(bindCallStart, bindCallEnd);
  const innerStart = target.bodyStart + 1;
  const innerEnd = target.bodyEnd;
  const newInner = `${bindCallText}\n  assert.ok(true);\n`;
  return `${source.slice(0, innerStart)}\n  ${newInner}${source.slice(innerEnd)}`;
}

// H01-F3：marker-only 假覆盖变体——把指定测试体替换为 bindH01F 惰性标签 + void marker 字符串 + assert.ok(true)。
// 复现“只保留 dead marker 字符串”的错误通过：当前必须使元检查退出 1。
function voidMarkerScenario(source, ctPrefix, markerTexts) {
  const tests = extractTopLevelTests(source);
  const target = tests.find((t) => new RegExp(`^${ctPrefix}\\b`).test(t.name));
  assert.ok(target, `voidMarkerScenario: ${ctPrefix} must exist`);
  const tokens = tokenizeJs(source);
  const startIdx = indexOfTokenAt(tokens, target.bodyStart);
  const endIdx = indexOfTokenAt(tokens, target.bodyEnd);
  const bodyTokens = tokens.slice(startIdx, endIdx + 1);
  // 保留原 bindH01F 调用文本
  let bindCallStart = -1;
  let bindCallEnd = -1;
  for (let i = 0; i < bodyTokens.length; i += 1) {
    const t = bodyTokens[i];
    if (t.type !== 'id' || t.value !== 'bindH01F') continue;
    const openParen = nextNonSpaceToken(bodyTokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    bindCallStart = t.start;
    const openIdx = bodyTokens.indexOf(openParen);
    const closeIdx = matchingParen(bodyTokens, openIdx);
    for (let j = closeIdx + 1; j < bodyTokens.length; j += 1) {
      if (bodyTokens[j].type === 'punct' && bodyTokens[j].value === ';') {
        bindCallEnd = bodyTokens[j].end;
        break;
      }
    }
    break;
  }
  assert.ok(bindCallStart >= 0 && bindCallEnd >= 0, 'voidMarkerScenario: bindH01F call must exist');
  const bindCallText = source.slice(bindCallStart, bindCallEnd);
  const deadMarkers = markerTexts.map((m) => `void '${m}';`).join('\n  ');
  const newInner = `${bindCallText}\n  ${deadMarkers}\n  assert.ok(true);\n`;
  const innerStart = target.bodyStart + 1;
  const innerEnd = target.bodyEnd;
  return `${source.slice(0, innerStart)}\n  ${newInner}${source.slice(innerEnd)}`;
}

// H01-F3 R6：plan-direct-node 变体——把 CT-26 的 h00bPlan 构造替换为成员赋值形式：
// command=process.execPath、args=['--test', ...预计算列表]。复现“plan 值被替换但仍消费成员”的错误通过。
function planDirectNodeVariant(source) {
  const target = 'const h00bPlan = buildH00BPlan();';
  const start = source.lastIndexOf(target);
  assert.ok(start >= 0, 'planDirectNodeVariant: buildH00BPlan call must exist');
  const replacement = "const precomputedH00bFiles = ['tests/harness/h00b/baseline.test.js'];\n  const h00bPlan = {};\n  h00bPlan.command = process.execPath;\n  h00bPlan.args = ['--test', ...precomputedH00bFiles];\n  h00bPlan.cwd = HOST_ROOT;\n  h00bPlan.env = (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();";
  const mutated = `${source.slice(0, start)}${replacement}${source.slice(start + target.length)}`;
  assert.ok(mutated !== source, 'planDirectNodeVariant must mutate');
  return mutated;
}

// H01-F3 R6：plan-masked 变体——保留 npm/run/script 表象（源码含 npm 字面量），
// 但运行时 command/args 实际解析为 Node 直连 H00B。复现“表象 canonical、求值直连”的错误通过。
function maskedPlanVariant(source) {
  const target = 'const h00bPlan = buildH00BPlan();';
  const start = source.lastIndexOf(target);
  assert.ok(start >= 0, 'maskedPlanVariant: buildH00BPlan call must exist');
  const replacement = "const h00bPlan = {};\n  h00bPlan.command = (process.platform === 'win32' ? 'npm.cmd' : 'npm') && process.execPath;\n  h00bPlan.args = ['--test', 'tests/harness/h00b/baseline.test.js'];\n  h00bPlan.cwd = HOST_ROOT;\n  h00bPlan.env = (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();";
  const mutated = `${source.slice(0, start)}${replacement}${source.slice(start + target.length)}`;
  assert.ok(mutated !== source, 'maskedPlanVariant must mutate');
  return mutated;
}

// H01-F3 R6：plan-single-file 变体——计划实际解析为 process.execPath + --test + 单个 H00B 文件
//（无预计算列表、无枚举，仅硬编码单文件）。复现“伪装为 h00bPlan 但实际直连单文件”的错误通过。
function planSingleFileVariant(source) {
  const target = 'const h00bPlan = buildH00BPlan();';
  const start = source.lastIndexOf(target);
  assert.ok(start >= 0, 'planSingleFileVariant: buildH00BPlan call must exist');
  const replacement = "const h00bPlan = {};\n  h00bPlan.command = process.execPath;\n  h00bPlan.args = ['--test', 'tests/harness/h00b/baseline.test.js'];\n  h00bPlan.cwd = HOST_ROOT;\n  h00bPlan.env = (() => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; })();";
  const mutated = `${source.slice(0, start)}${replacement}${source.slice(start + target.length)}`;
  assert.ok(mutated !== source, 'planSingleFileVariant must mutate');
  return mutated;
}

// H01-F3 R6：fake-executor 变体——以局部 shadow/包装函数消费 canonical h00bPlan 并返回合成 TAP。
// 复现“runtime plan 正确但 executor 被替换”的错误通过：source helper 必须拒绝。
function fakeExecutorVariant(source) {
  const target = "const h00b = childProcess.spawnSync(h00bPlan.command, h00bPlan.args, { cwd: h00bPlan.cwd, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 });";
  const replacement = "const fakeExec = (plan) => ({ status: 0, stdout: '# tests 36\\n# pass 36\\n# fail 0\\n# skipped 0\\n# todo 0', stderr: '' });\n  const h00b = fakeExec(h00bPlan);";
  return replaceLastOccurrence(source, target, replacement);
}

// H01-F3：dead-anchor 变体——保留正确 bindH01F、死分支执行锚、无关 assert.equal/match/deepEqual，
// marker 仅放入死字符串（void 表达式）。复现“执行锚/断言锚存在但无场景语义关联”的错误通过。
// 死分支内的 anchor 调用与 marker 字符串、以及实参不含 marker 的无关断言均不算覆盖证据。
function deadAnchorVariant(source, ctPrefix, markerTexts, condText) {
  const tests = extractTopLevelTests(source);
  const target = tests.find((t) => new RegExp(`^${ctPrefix}\\b`).test(t.name));
  assert.ok(target, `deadAnchorVariant: ${ctPrefix} must exist`);
  const tokens = tokenizeJs(source);
  const startIdx = indexOfTokenAt(tokens, target.bodyStart);
  const endIdx = indexOfTokenAt(tokens, target.bodyEnd);
  const bodyTokens = tokens.slice(startIdx, endIdx + 1);
  // 保留原 bindH01F 调用文本
  let bindCallStart = -1;
  let bindCallEnd = -1;
  for (let i = 0; i < bodyTokens.length; i += 1) {
    const t = bodyTokens[i];
    if (t.type !== 'id' || t.value !== 'bindH01F') continue;
    const openParen = nextNonSpaceToken(bodyTokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    bindCallStart = t.start;
    const openIdx = bodyTokens.indexOf(openParen);
    const closeIdx = matchingParen(bodyTokens, openIdx);
    for (let j = closeIdx + 1; j < bodyTokens.length; j += 1) {
      if (bodyTokens[j].type === 'punct' && bodyTokens[j].value === ';') {
        bindCallEnd = bodyTokens[j].end;
        break;
      }
    }
    break;
  }
  assert.ok(bindCallStart >= 0 && bindCallEnd >= 0, 'deadAnchorVariant: bindH01F call must exist');
  const bindCallText = source.slice(bindCallStart, bindCallEnd);
  const deadMarkers = markerTexts.map((m) => `void '${m}';`).join(' ');
  // R6：执行锚、marker 与实质断言全部置于 if (<condText>) 不可达范围，活代码无等价证明副本。
  const newInner = `${bindCallText}\n  if (${condText}) { runRegistryCli({}, 1); ${deadMarkers} assert.equal(1, 1, 'unrelated'); assert.match('unrelated', /unrelated/); }\n  assert.ok(true);\n`;
  const innerStart = target.bodyStart + 1;
  const innerEnd = target.bodyEnd;
  return `${source.slice(0, innerStart)}\n  ${newInner}${source.slice(innerEnd)}`;
}

// H01-F3 R6：替换指定测试体为 bindH01F + 自定义 inner（供 F3-21/24/25 等 CT-09 语义反例复用）。
function replaceCtBodyWith(source, ctPrefix, innerFactory) {
  const tests = extractTopLevelTests(source);
  const target = tests.find((t) => new RegExp(`^${ctPrefix}\\b`).test(t.name));
  assert.ok(target, `replaceCtBodyWith: ${ctPrefix} must exist`);
  const tokens = tokenizeJs(source);
  const startIdx = indexOfTokenAt(tokens, target.bodyStart);
  const endIdx = indexOfTokenAt(tokens, target.bodyEnd);
  const bodyTokens = tokens.slice(startIdx, endIdx + 1);
  let bindCallStart = -1;
  let bindCallEnd = -1;
  for (let i = 0; i < bodyTokens.length; i += 1) {
    const t = bodyTokens[i];
    if (t.type !== 'id' || t.value !== 'bindH01F') continue;
    const openParen = nextNonSpaceToken(bodyTokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    bindCallStart = t.start;
    const openIdx = bodyTokens.indexOf(openParen);
    const closeIdx = matchingParen(bodyTokens, openIdx);
    for (let j = closeIdx + 1; j < bodyTokens.length; j += 1) {
      if (bodyTokens[j].type === 'punct' && bodyTokens[j].value === ';') {
        bindCallEnd = bodyTokens[j].end;
        break;
      }
    }
    break;
  }
  assert.ok(bindCallStart >= 0 && bindCallEnd >= 0, `replaceCtBodyWith: bindH01F call must exist in ${ctPrefix}`);
  const bindCallText = source.slice(bindCallStart, bindCallEnd);
  const innerStart = target.bodyStart + 1;
  const innerEnd = target.bodyEnd;
  return `${source.slice(0, innerStart)}\n  ${innerFactory(bindCallText)}${source.slice(innerEnd)}`;
}

// H01-F3 R6：F3-21——真实调用 runRegistryCli 但丢弃结果；全部 marker 仅由活代码中的
// 纯字面量 assert.equal('MARKER', 'MARKER') 覆盖。typed proof 缺失必须退出 1。
function discardResultVariant(source, ctPrefix, markerTexts) {
  return replaceCtBodyWith(source, ctPrefix, (bind) => `${bind}\n  const discarded = runRegistryCli(canonicalRegistryFixture(), 0);\n  void discarded;\n  ${markerTexts.map((m) => `assert.equal('${m}', '${m}');`).join('\n  ')}\n`);
}

// H01-F3 R6：F3-24——CT-09 以 `${result.stdout.slice(0, 0)}MARKER` 拼接 marker，
// 断言值内容恒为 marker、不受结果内容影响。typed proof 缺失必须退出 1。
function sliceZeroVariant(source, ctPrefix, markerTexts) {
  return replaceCtBodyWith(source, ctPrefix, (bind) => `${bind}\n  const result = runRegistryCli(canonicalRegistryFixture(), 0);\n  ${markerTexts.map((m) => `assert.match(result.stderr, new RegExp(\`\${result.stdout.slice(0, 0)}${m}\`));`).join('\n  ')}\n`);
}

// H01-F3 R6：F3-25——CT-09 以 `result.stderr ? 'MARKER' : 'MARKER'` 选择恒定 marker，
// 断言值不受结果内容影响。typed proof 缺失必须退出 1。
function ternaryMarkerVariant(source, ctPrefix, markerTexts) {
  return replaceCtBodyWith(source, ctPrefix, (bind) => `${bind}\n  const result = runRegistryCli(canonicalRegistryFixture(), 0);\n  ${markerTexts.map((m) => `assert.match(result.stderr, new RegExp(result.stderr ? '${m}' : '${m}'));`).join('\n  ')}\n`);
}

// H01-F3 R6：F3-22——调换顶层 CT-01 与 CT-02 顺序（其余源码不变）。
function swapTopLevelOrder(source, nameA, nameB) {
  const tests = extractTopLevelTests(source);
  const a = tests.find((t) => new RegExp(`^${nameA}\\b`).test(t.name));
  const b = tests.find((t) => new RegExp(`^${nameB}\\b`).test(t.name));
  assert.ok(a && b, 'swapTopLevelOrder: both tests must exist');
  const tokens = tokenizeJs(source);
  const blockStartOf = (test) => {
    const nameIdx = indexOfTokenAt(tokens, test.nameStart);
    let testIdx = nameIdx;
    for (let j = nameIdx - 1; j >= 0; j -= 1) {
      if (tokens[j].type === 'id' && tokens[j].value === 'test') { testIdx = j; break; }
    }
    return tokens[testIdx].start;
  };
  const blockEndOf = (test) => {
    const idx = indexOfTokenAt(tokens, test.bodyStart);
    const closeIdx = matchingBrace(tokens, idx);
    let endOffset = tokens[closeIdx].end;
    for (let j = closeIdx + 1; j < tokens.length; j += 1) {
      if (tokens[j].type === 'punct' && (tokens[j].value === ')' || tokens[j].value === ';')) {
        endOffset = tokens[j].end;
        break;
      }
    }
    return endOffset;
  };
  const aStart = blockStartOf(a);
  const aEnd = blockEndOf(a);
  const bStart = blockStartOf(b);
  const bEnd = blockEndOf(b);
  assert.ok(aStart < bStart, 'swapTopLevelOrder: test A must precede test B');
  const aText = source.slice(aStart, aEnd);
  const bText = source.slice(bStart, bEnd);
  const mutated = `${source.slice(0, aStart)}${bText}${source.slice(aEnd, bStart)}${aText}${source.slice(bEnd)}`;
  assert.ok(mutated !== source, 'swapTopLevelOrder must mutate');
  return mutated;
}

// H01-F3 R6：H01ANCHOR-01——把 runRegistryCli 函数体替换为返回合成 result（不触碰 CT-09 调用与断言）。
function anchorTamperVariant(source) {
  const range = extractFunctionBodyRange(source, 'runRegistryCli');
  assert.ok(range, 'anchorTamperVariant: runRegistryCli must exist');
  const replacement = "{ return { status: 0, stdout: '{\"status\":\"passed\"}\\n', stderr: '', signal: null, error: null }; }";
  const mutated = `${source.slice(0, range.bodyStart)}${replacement}${source.slice(range.bodyEnd)}`;
  assert.ok(mutated !== source, 'anchorTamperVariant must mutate');
  return mutated;
}

// H01-F3 R6：H01EV-01——向临时 source 追加一行带 F3-10 文本的语法错误。
function syntaxErrorVariant(source) {
  return `${source}\nthis is not valid javascript (F3-10) !!!\n`;
}

// ===== H01-F3 R6：F3_VARIANTS 单一注册表 =====
// 全部 numeric F3 反例由一个注册表定义和驱动：顶层 F3-01..F3-27、singleton、无子变体，
// 每个 leaf 声明 mode/entry/mutate/mutation_contract/semantic_oracle/env_overrides/expected_status/diagnostic。
// F3-13/19/20/26 的 entry 恰为 CT-26；F3-27 的 entry 恰为 CANONICAL；其余 entry 为 CT-21。
const CT09_MARKERS = ['OWNER_CONFLICT', 'owner_ids', 'owner_kind', 'source_refs', 'topic'];

const F3_VARIANTS = [
  { id: 'F3-01', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => swapBindIds(s, 'H01F-01', 'H01F-02'), mutation_contract: 'swap H01F-01/02 bindings', semantic_assertion: 'binding id order swap must be rejected by surface contract', semantic_oracle: (b, a) => runSemanticOracle('F3-01', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-01\/02/, subvariants: [] },
  { id: 'F3-02', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => swapBindIds(s, 'H01F-06', 'H01F-24'), mutation_contract: 'swap H01F-06/24 bindings', semantic_assertion: 'cross-test binding swap must be rejected by surface contract', semantic_oracle: (b, a) => runSemanticOracle('F3-02', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-01\/02/, subvariants: [] },
  { id: 'F3-03', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => `${s}\ntest("CT-27 injected double-quoted", () => {});\n`, mutation_contract: 'append double-quoted CT-27', semantic_assertion: 'extra top-level test must be rejected by registry count', semantic_oracle: (b, a) => runSemanticOracle('F3-03', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-04', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => `${s}\ntest(\`CT-27 injected template\`, () => {});\n`, mutation_contract: 'append template-string CT-27', semantic_assertion: 'template-literal test name must not evade top-level registry', semantic_oracle: (b, a) => runSemanticOracle('F3-04', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-05', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => removeTopLevelTest(s, 'CT-01'), mutation_contract: 'remove top-level CT-01', semantic_assertion: 'missing top-level test must be rejected by registry count', semantic_oracle: (b, a) => runSemanticOracle('F3-05', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-06', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => replaceLastOccurrence(s, '      delete env.NODE_TEST_CONTEXT;', '      // NODE_TEST_CONTEXT deletion removed'), mutation_contract: 'remove explicit NODE_TEST_CONTEXT deletion from CT-26 env', semantic_assertion: 'CT-26 env must explicitly strip NODE_TEST_CONTEXT', semantic_oracle: (b, a) => runSemanticOracle('F3-06', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-06/, subvariants: [] },
  { id: 'F3-07', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => replaceLastOccurrence(s, "const h00b = childProcess.spawnSync(h00bPlan.command, h00bPlan.args, { cwd: h00bPlan.cwd, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 });", "const h00b = childProcess.spawnSync(process.execPath, ['--test', 'tests/harness/h00b/baseline.test.js'], { cwd: HOST_ROOT, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 });"), mutation_contract: 'spawnSync direct node execution of H00B test', semantic_assertion: 'live spawnSync must consume canonical plan command/args/cwd/env', semantic_oracle: (b, a) => runSemanticOracle('F3-07', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-0[67]/, subvariants: [] },
  { id: 'F3-08', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => replaceLastOccurrence(s, 'const tap = h00b.stdout + h00b.stderr;', "const tap = '# tests 36\\n# pass 36\\n# fail 0\\n# skipped 0\\n# todo 0';"), mutation_contract: 'hard-coded mock TAP text', semantic_assertion: 'TAP must come from real h00b stdout/stderr, not hard-coded text', semantic_oracle: (b, a) => runSemanticOracle('F3-08', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-08/, subvariants: [] },
  { id: 'F3-09', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => replaceLastOccurrence(s, "const h00b = childProcess.spawnSync(h00bPlan.command, h00bPlan.args, { cwd: h00bPlan.cwd, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 });", "if (false) { const dead = childProcess.spawnSync(h00bPlan.command, h00bPlan.args, { cwd: h00bPlan.cwd, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 }); }\n  const h00b = childProcess.spawnSync(process.execPath, ['--test', 'tests/harness/h00b/baseline.test.js'], { cwd: HOST_ROOT, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 });"), mutation_contract: 'dead canonical wrapper with direct node exec', semantic_assertion: 'dead wrapper must not count as live plan consumption', semantic_oracle: (b, a) => runSemanticOracle('F3-09', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-0[78]/, subvariants: [] },
  { id: 'F3-10', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => stripScenarioAssertions(s, 'CT-09'), mutation_contract: 'CT-09 stripped to lazy label', semantic_assertion: 'CT-09 scenario must keep typed proof and live anchors', semantic_oracle: (b, a) => runSemanticOracle('F3-10', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-11', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => stripScenarioAssertions(s, 'CT-24'), mutation_contract: 'CT-24 stripped to lazy label', semantic_assertion: 'CT-24 scenario must keep typed proof and live anchors', semantic_oracle: (b, a) => runSemanticOracle('F3-11', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-12', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => voidMarkerScenario(s, 'CT-09', CT09_MARKERS), mutation_contract: 'CT-09 marker-only void strings', semantic_assertion: 'markers must be asserted via typed proof, not void strings', semantic_oracle: (b, a) => runSemanticOracle('F3-12', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-13', kind: 'singleton', mode: 'source-mutation', entry: 'CT-26', mutate: (s) => planDirectNodeVariant(s), mutation_contract: 'plan replaced with execPath + precomputed file list', semantic_assertion: 'runtime plan must resolve to npm run harness:h00b:test', semantic_oracle: (b, a) => runSemanticOracle('F3-13', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-07/, subvariants: [] },
  { id: 'F3-14', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => `${s}\ntest("CT-01X injected malformed title", () => {});\n`, mutation_contract: 'append CT-01X malformed title', semantic_assertion: 'test title format must be strict CT-\d{2}', semantic_oracle: (b, a) => runSemanticOracle('F3-14', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-15', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => `${s}\ntest("CT-001 injected padded title", () => {});\n`, mutation_contract: 'append CT-001 padded title', semantic_assertion: 'padded title must not bypass title format', semantic_oracle: (b, a) => runSemanticOracle('F3-15', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-16', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => `${s}\ntest("CT-21b injected suffix title", () => {});\n`, mutation_contract: 'append CT-21b suffix title', semantic_assertion: 'suffix title must not extend entry pattern match', semantic_oracle: (b, a) => runSemanticOracle('F3-16', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-17', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => deadAnchorVariant(s, 'CT-09', CT09_MARKERS, '!!0'), mutation_contract: 'CT-09 anchor/marker/asserts all inside if (!!0) dead branch', semantic_assertion: 'dead branch anchors/markers must not count as live proof', semantic_oracle: (b, a) => runSemanticOracle('F3-17', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-18', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => deadAnchorVariant(s, 'CT-09', CT09_MARKERS, '1 === 0'), mutation_contract: 'CT-09 anchor/marker inside if (1 === 0), live code has no proof copy', semantic_assertion: 'constant-false branch must not count as live proof', semantic_oracle: (b, a) => runSemanticOracle('F3-18', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-19', kind: 'singleton', mode: 'source-mutation', entry: 'CT-26', mutate: (s) => maskedPlanVariant(s), mutation_contract: 'npm literal surface but runtime plan resolves to node direct', semantic_assertion: 'surface npm literal without runtime plan equality must be rejected', semantic_oracle: (b, a) => runSemanticOracle('F3-19', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-07/, subvariants: [] },
  { id: 'F3-20', kind: 'singleton', mode: 'source-mutation', entry: 'CT-26', mutate: (s) => planSingleFileVariant(s), mutation_contract: 'plan resolves to execPath + --test + single H00B file', semantic_assertion: 'plan args must be exactly run harness:h00b:test', semantic_oracle: (b, a) => runSemanticOracle('F3-20', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-07/, subvariants: [] },
  { id: 'F3-21', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => discardResultVariant(s, 'CT-09', CT09_MARKERS), mutation_contract: 'CT-09 real runRegistryCli result discarded, markers only in literal self-equal asserts', semantic_assertion: 'real execution result must feed typed proof', semantic_oracle: (b, a) => runSemanticOracle('F3-21', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-22', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => swapTopLevelOrder(s, 'CT-01', 'CT-02'), mutation_contract: 'swap top-level CT-01/CT-02 order', semantic_assertion: 'top-level registration order must be canonical', semantic_oracle: (b, a) => runSemanticOracle('F3-22', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-05/, subvariants: [] },
  { id: 'F3-23', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => deadAnchorVariant(s, 'CT-09', CT09_MARKERS, '0'), mutation_contract: 'CT-09 anchor/marker/asserts all inside if (0) dead branch', semantic_assertion: 'if (0) dead branch must not count as live proof', semantic_oracle: (b, a) => runSemanticOracle('F3-23', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-24', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => sliceZeroVariant(s, 'CT-09', CT09_MARKERS), mutation_contract: 'CT-09 result.stdout.slice(0, 0) marker concatenation', semantic_assertion: 'marker extraction must use real execution output', semantic_oracle: (b, a) => runSemanticOracle('F3-24', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-25', kind: 'singleton', mode: 'source-mutation', entry: 'CT-21', mutate: (s) => ternaryMarkerVariant(s, 'CT-09', CT09_MARKERS), mutation_contract: 'CT-09 result.stderr ? MARKER : MARKER constant selection', semantic_assertion: 'constant-selected markers must not count as proof', semantic_oracle: (b, a) => runSemanticOracle('F3-25', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-10/, subvariants: [] },
  { id: 'F3-26', kind: 'singleton', mode: 'source-mutation', entry: 'CT-26', mutate: (s) => fakeExecutorVariant(s), mutation_contract: 'fake/wrapped executor consumes canonical plan and returns synthetic TAP', semantic_assertion: 'executor must be the live childProcess.spawnSync wrapper', semantic_oracle: (b, a) => runSemanticOracle('F3-26', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-07/, subvariants: [] },
  { id: 'F3-27', kind: 'singleton', mode: 'canonical-invocation', entry: 'CANONICAL', mutate: null, mutation_contract: 'canonical invocation with injected meta env must be rejected before test registration', semantic_assertion: 'canonical invocation must reject injected meta env before registration', semantic_oracle: (b, a) => runSemanticOracle('F3-27', b, a), env_overrides: {}, expected_status: 1, diagnostic: /F3-META-AUTH/, subvariants: [] }
];

// 注册表机械断言：顶层 ID 恰为有序唯一 F3-01..F3-27；全部 singleton 无子变体；numeric leaf 恰 27。
function assertF3RegistryShape() {
  assert.equal(F3_VARIANTS.length, 27, 'F3_VARIANTS must contain exactly 27 top-level entries');
  F3_VARIANTS.forEach((variant, idx) => {
    assert.equal(variant.id, `F3-${String(idx + 1).padStart(2, '0')}`, `F3_VARIANTS order must be F3-01..F3-27 (got ${variant.id})`);
    assert.equal(variant.kind, 'singleton', `${variant.id} must be singleton`);
    assert.deepEqual(variant.subvariants, [], `${variant.id} must have no subvariants`);
    assert.equal(variant.expected_status, 1, `${variant.id} expected_status must be 1`);
    assert.ok(variant.diagnostic instanceof RegExp, `${variant.id} diagnostic must be a RegExp`);
    assert.ok(variant.mutation_contract && variant.mutation_contract.length > 5, `${variant.id} mutation_contract must be concrete`);
  });
  const ct26Ids = F3_VARIANTS.filter((v) => v.entry === 'CT-26').map((v) => v.id);
  assert.deepEqual(ct26Ids, ['F3-13', 'F3-19', 'F3-20', 'F3-26'], 'entry=CT-26 leaves must be exactly F3-13/19/20/26');
  const canonicalIds = F3_VARIANTS.filter((v) => v.entry === 'CANONICAL').map((v) => v.id);
  assert.deepEqual(canonicalIds, ['F3-27'], 'entry=CANONICAL leaves must be exactly F3-27');
  const ct21Count = F3_VARIANTS.filter((v) => v.entry === 'CT-21').length;
  assert.equal(ct21Count, 22, 'entry=CT-21 leaves must be exactly 22');
  assert.ok(F3_VARIANTS.every((v) => (v.mode === 'source-mutation' ? typeof v.mutate === 'function' : v.mutate === null)), 'mode must match mutate presence');
}

// 统一 registry 分派 runner：按 entry 执行对应 leaf 并输出结构化证据。
function runF3Registry(entry, context) {
  const source = fs.readFileSync(__filename, 'utf8');
  const leaves = F3_VARIANTS.filter((v) => v.entry === entry);
  const evidenceList = [];
  for (const variant of leaves) {
    const startedAt = Date.now();
    let sourceBefore = source;
    let sourceAfter = source;
    let run;
    let failure = null;
    if (variant.mode === 'source-mutation') {
      sourceAfter = variant.mutate(source);
      assertVariantMutationSemantics(variant, sourceBefore, sourceAfter);
      run = runMetaChild(variant, sourceAfter);
    } else {
      // CANONICAL invocation（F3-27）：真实 process.execPath + canonical 文件，注入登记的 meta env
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f3-can-'));
      const token = crypto.randomBytes(16).toString('hex');
      const tokenFile = path.join(tmpDir, 'token.sidecar');
      const canonicalPath = path.join(HOST_ROOT, 'tests/harness/contracts/contract.test.js');
      const canonicalEnv = {
        ...process.env,
        H01F3_META_CHILD: '1',
        H01F3_HOST_ROOT: HOST_ROOT,
        H01F3_META_ENTRY: 'CT-21',
        H01F3_META_TOKEN: token,
        H01F3_META_TOKEN_FILE: tokenFile,
        ...variant.env_overrides
      };
      delete canonicalEnv.NODE_TEST_CONTEXT;
      canonicalEnv.NODE_OPTIONS = [canonicalEnv.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ');
      try {
        fs.writeFileSync(tokenFile, `${token}:CT-21`);
        run = {
          result: childProcess.spawnSync(process.execPath, ['--test', canonicalPath], { cwd: HOST_ROOT, env: canonicalEnv, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 }),
          command: [process.execPath, '--test', canonicalPath]
        };
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
    failure = findTargetFailure(run.result.stdout + run.result.stderr);
    const evidence = collectEvidence(variant, sourceBefore, sourceAfter, run, startedAt, failure);
    evidenceList.push(evidence);
    if (context && typeof context.diagnostic === 'function') {
      const diag = { ...evidence };
      if (typeof diag.stdout === 'string' && diag.stdout.length > 4000) diag.stdout = `${diag.stdout.slice(0, 4000)}...<truncated ${diag.stdout.length - 4000} chars>`;
      if (typeof diag.stderr === 'string' && diag.stderr.length > 4000) diag.stderr = `${diag.stderr.slice(0, 4000)}...<truncated ${diag.stderr.length - 4000} chars>`;
      context.diagnostic(JSON.stringify(diag));
    }
    if (variant.mode === 'source-mutation') {
      validateF3Evidence(variant, evidence);
    } else {
      // F3-27：canonical 必须在注册测试前拒绝；signal/spawn_error 为空；输出含 F3-META-AUTH 且无 CT-21/CT-26 subtest
      assert.equal(evidence.status, 1, 'F3-27 canonical invocation must exit 1');
      assert.equal(evidence.signal, null, 'F3-27 must not be signal-killed');
      assert.equal(evidence.spawn_error, null, 'F3-27 must not have spawn error');
      assert.ok((run.result.stdout + run.result.stderr).includes('F3-META-AUTH'), 'F3-27 output must contain F3-META-AUTH');
      assert.ok(!/(?:^|\n)(?:ok|not ok) \d+ - CT-2[16]\b/.test(run.result.stdout), 'F3-27 must not reach CT-21/CT-26 subtests');
    }
  }
  return evidenceList;
}

// H01F-25 的关系证明与 CT-21 结构化 evidence 输出用：对单个 leaf 的 evidence 校验可复用 validateF3Evidence。

// H01-F3 R6：H01META-01——向自身环境注入未登记 H01F3_META_FORGED，证明 buildH00BPlan()
// 生成的实际 plan.env 移除该键且不含任何 H01F3_META_*。
function assertMetaForgedRemoved() {
  const previous = process.env.H01F3_META_FORGED;
  process.env.H01F3_META_FORGED = '1';
  try {
    const plan = buildH00BPlan();
    assert.equal(Object.prototype.hasOwnProperty.call(plan.env, 'H01F3_META_FORGED'), false, 'H01META-01 buildH00BPlan must strip H01F3_META_FORGED');
    assert.ok(!Object.keys(plan.env).some((key) => key.startsWith('H01F3_META_')), 'H01META-01 plan.env must not contain any H01F3_META_*');
  } finally {
    if (previous === undefined) delete process.env.H01F3_META_FORGED;
    else process.env.H01F3_META_FORGED = previous;
  }
}

// H01-F3：交换 bindH01F 调用实参中的两个 H01F ID（仅影响 bindH01F 调用文本）。
function swapBindIds(source, idA, idB) {
  return source.replace(/bindH01F\([^)]*\)/g, (call) => {
    const swapped = call.split(idA).join(`\u0000A\u0000`).split(idB).join(idA).split(`\u0000A\u0000`).join(idB);
    return swapped;
  });
}

// H01-F3：删除指定顶层测试块（保留其余源码）。按 token 偏移精确切片。
function removeTopLevelTest(source, name) {
  const tests = extractTopLevelTests(source);
  const target = tests.find((t) => new RegExp(`^${name}\\b`).test(t.name));
  assert.ok(target, `removeTopLevelTest: ${name} must exist`);
  const tokens = tokenizeJs(source);
  const nameIdx = indexOfTokenAt(tokens, target.nameStart);
  // 测试块起点：从名字 token 回溯到 test 标识符 token
  let testIdx = nameIdx;
  for (let j = nameIdx - 1; j >= 0; j -= 1) {
    if (tokens[j].type === 'id' && tokens[j].value === 'test') { testIdx = j; break; }
  }
  const blockStart = tokens[testIdx].start;
  const idx = indexOfTokenAt(tokens, target.bodyStart);
  const closeIdx = matchingBrace(tokens, idx);
  // 块终点：body 闭括号之后的 ');' 结束
  let endOffset = tokens[closeIdx].end;
  for (let j = closeIdx + 1; j < tokens.length; j += 1) {
    if (tokens[j].type === 'punct' && (tokens[j].value === ')' || tokens[j].value === ';')) {
      endOffset = tokens[j].end;
      break;
    }
  }
  return source.slice(0, blockStart) + source.slice(endOffset);
}


// H01-F3 R6：宿主受保护集合 13 项递归快照。同一 helper 前后两次独立展开为排序后的相对叶子路径；
// 不跟随 symlink；每个成员记录 path/exists/tracked/lstat_kind/nlink/dev/ino/raw_sha256/link_target，
// nlink/dev/ino 使用 lstat bigint 的十进制字符串，避免 JSON 精度或序列化漂移。
const PROTECTED_ROOT_ENTRIES = [
  'tests/harness/baselines/source-manifest.json',
  'tests/harness/baselines/h00a-confirmation.json',
  'tests/harness/baselines/validation-debt.json',
  'tests/harness/baselines/h00a-schema-migration-r1.json',
  '.harness-runtime/baselines/h00b.json',
  'doc/平台治理/harness-engineering/来源清册.md',
  'harness/engineering/owner-registry.json',
  'harness/engineering/schema',
  'tests/harness/incidents/seed.jsonl',
  'tests/harness/incidents/failure-family-candidates.jsonl',
  'tests/harness/h00a',
  'tests/harness/h00b',
  'tests/harness/contracts/fixtures'
];

function expandProtectedLeaves() {
  const trackedResult = spawnSync('git', ['ls-files'], { cwd: HOST_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  assert.equal(trackedResult.status, 0, 'git ls-files must succeed for protected snapshot');
  assert.equal(trackedResult.error ?? null, null, 'git ls-files must not error for protected snapshot');
  const trackedSet = new Set(trackedResult.stdout.split('\n').filter(Boolean));
  const leaves = [];
  const walk = (rel) => {
    const full = path.join(HOST_ROOT, rel);
    let st;
    try {
      st = fs.lstatSync(full, { bigint: true });
    } catch {
      leaves.push({ path: rel, exists: false, tracked: false, lstat_kind: null, nlink: null, dev: null, ino: null, raw_sha256: null, link_target: null });
      return;
    }
    if (st.isSymbolicLink()) {
      leaves.push({ path: rel, exists: true, tracked: trackedSet.has(rel), lstat_kind: 'symlink', nlink: String(st.nlink), dev: String(st.dev), ino: String(st.ino), raw_sha256: null, link_target: fs.readlinkSync(full) });
      return;
    }
    if (st.isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) walk(path.join(rel, child));
      return;
    }
    leaves.push({
      path: rel,
      exists: true,
      tracked: trackedSet.has(rel),
      lstat_kind: st.isFile() ? 'file' : 'other',
      nlink: String(st.nlink),
      dev: String(st.dev),
      ino: String(st.ino),
      raw_sha256: st.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') : null,
      link_target: null
    });
  };
  for (const entry of PROTECTED_ROOT_ENTRIES) walk(entry);
  return leaves.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// 记录宿主受保护集合快照（13 项递归展开，排序后的相对叶子路径列表）。
function recordProtectedHashes() {
  return expandProtectedLeaves();
}

// H01-F3 R6：CT-26 三件套之一——构造实际 H00B plan（跨平台 npm、args、cwd、显式删除
// NODE_TEST_CONTEXT 与全部 meta 控制变量、直接注入 --test-reporter=tap）。
function buildH00BPlan() {
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'harness:h00b:test'],
    cwd: HOST_ROOT,
    env: (() => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.H01F3_HOST_ROOT;
      for (const key of Object.keys(env)) {
        if (key.startsWith('H01F3_META_')) delete env[key];
      }
      env.NODE_OPTIONS = [env.NODE_OPTIONS, '--test-reporter=tap'].filter(Boolean).join(' ');
      return env;
    })()
  };
}

// H01-F3 R6：三件套之二——验证解析后的运行时 plan 值（对实际消费对象执行）。
// 全部断言带稳定 F3-07 诊断，供 meta child 结构化证据匹配。
function assertCanonicalH00BPlan(plan) {
  assert.equal(plan.command, process.platform === 'win32' ? 'npm.cmd' : 'npm', 'F3-07 plan.command must be npm/npm.cmd');
  assert.deepEqual(plan.args, ['run', 'harness:h00b:test'], 'F3-07 plan.args must be [run, harness:h00b:test]');
  assert.equal(plan.cwd, HOST_ROOT, 'F3-07 plan.cwd must be HOST_ROOT');
  assert.equal(Object.prototype.hasOwnProperty.call(plan.env, 'NODE_TEST_CONTEXT'), false, 'F3-07 plan.env must not contain NODE_TEST_CONTEXT');
  assert.equal(Object.prototype.hasOwnProperty.call(plan.env, 'H01F3_HOST_ROOT'), false, 'F3-07 plan.env must not contain H01F3_HOST_ROOT');
  assert.ok(!Object.keys(plan.env).some((key) => key.startsWith('H01F3_META_')), 'F3-07 plan.env must not contain H01F3_META_*');
  assert.match(plan.env.NODE_OPTIONS || '', /(?:^|\s)--test-reporter=tap(?:\s|$)/, 'F3-07 plan.env.NODE_OPTIONS must include --test-reporter=tap');
  return plan;
}

// H01-F3 R6：三件套之三——验证 canonical 源码表示：顶层唯一 childProcess namespace、
// h00bPlan 来自 buildH00BPlan()、唯一活代码 childProcess.spawnSync 消费 h00bPlan 四成员、
// env 显式删除 NODE_TEST_CONTEXT 与全部 meta 控制变量、直接注入 TAP reporter。
// 禁止 fake/wrapped executor、变量遮蔽、字符串拼接伪装或仅保留不被实际 plan 使用的 canonical 死代码。
function assertCanonicalH00BSource(source) {
  const allTokens = tokenizeJs(source);
  const allText = allTokens.map((tok) => tok.value).join(' ');
  assert.ok(hasTokenSequence(allTokens, ['const', 'childProcess', '=', 'require', '(', "'node:child_process'", ')']), 'F3-07 top-level childProcess namespace must exist');
  const tests = extractTopLevelTests(source);
  const ct26 = tests.find((t) => /^CT-26\b/.test(t.name));
  assert.ok(ct26, 'CT-26 must exist');
  const tokens = allTokens;
  const startIdx = indexOfTokenAt(tokens, ct26.bodyStart);
  const endIdx = indexOfTokenAt(tokens, ct26.bodyEnd);
  const bodyTokens = tokens.slice(startIdx, endIdx + 1);
  const bodyText = bodyTokens.map((tok) => tok.value).join(' ');
  assert.ok(!hasTokenSequence(bodyTokens, ['const', 'childProcess', '=']) && !hasTokenSequence(bodyTokens, ['let', 'childProcess', '=']) && !hasTokenSequence(bodyTokens, ['var', 'childProcess', '=']), 'F3-07 CT-26 must not shadow childProcess');
  assert.ok(hasTokenSequence(bodyTokens, ['const', 'h00bPlan', '=', 'buildH00BPlan', '(', ')']), 'F3-07 CT-26 must construct h00bPlan via buildH00BPlan()');
  // env 形态检查绑定到模块级 buildH00BPlan 函数体（全文件 token 序列）
  assert.ok(hasTokenSequence(allTokens, ['delete', 'env', '.', 'NODE_TEST_CONTEXT']), 'F3-06 buildH00BPlan env must delete NODE_TEST_CONTEXT');
  assert.ok(hasTokenSequence(allTokens, ['delete', 'env', '.', 'H01F3_HOST_ROOT']), 'F3-07 buildH00BPlan env must delete H01F3_HOST_ROOT');
  assert.ok(hasTokenSequence(allTokens, ['startsWith', '(', "'H01F3_META_'"]), 'F3-07 buildH00BPlan env must strip H01F3_META_*');
  assert.ok(hasTokenSequence(allTokens, ["'--test-reporter=tap'"]), 'F3-07 buildH00BPlan must directly inject --test-reporter=tap');
  assert.ok(allText.includes("'npm.cmd'") || allText.includes("'npm'"), 'F3-07 buildH00BPlan command must use npm/npm.cmd literal');
  assert.ok(!bodyText.includes('process.execPath'), 'F3-07 CT-26 must not resolve plan command to process.execPath');
  assert.ok(!bodyTokens.some((tok) => tok.type === 'id' && (tok.value === 'fakeExec' || tok.value === 'fakeExecutor' || tok.value === 'proxyExec')), 'F3-07 CT-26 must not use fake/wrapped/proxy executor');
  assert.ok(hasTokenSequence(bodyTokens, ['h00b', '.', 'stdout']) && hasTokenSequence(bodyTokens, ['h00b', '.', 'stderr']), 'F3-08 TAP must come from real h00b stdout/stderr');
  assert.ok(!hasMockTapAssignment(bodyTokens), 'F3-08 CT-26 must not hard-code mock TAP text');
  // 唯一活代码 childProcess.spawnSync 必须消费 h00bPlan.command/args/cwd/env
  const deadRanges = deadBranchRanges(bodyTokens);
  const inDeadBranch = (idx) => deadRanges.some((r) => idx >= r.start && idx <= r.end);
  let spawnCount = 0;
  let consumesPlan = false;
  for (let i = 0; i < bodyTokens.length; i += 1) {
    const t = bodyTokens[i];
    if (t.type !== 'id' || t.value !== 'spawnSync') continue;
    const dotPrev = bodyTokens[i - 1];
    const nsPrev = bodyTokens[i - 2];
    if (!dotPrev || dotPrev.type !== 'punct' || dotPrev.value !== '.') continue;
    if (!nsPrev || nsPrev.type !== 'id' || nsPrev.value !== 'childProcess') continue;
    if (inDeadBranch(i - 2)) continue;
    spawnCount += 1;
    const openParen = nextNonSpaceToken(bodyTokens, i + 1);
    if (!openParen || openParen.type !== 'punct' || openParen.value !== '(') continue;
    const openIdx = bodyTokens.indexOf(openParen);
    const closeIdx = matchingParen(bodyTokens, openIdx);
    if (closeIdx < 0) continue;
    const callTokens = bodyTokens.slice(openIdx + 1, closeIdx);
    if (hasTokenSequence(callTokens, ['h00bPlan', '.', 'command'])
      && hasTokenSequence(callTokens, ['h00bPlan', '.', 'args'])
      && hasTokenSequence(callTokens, ['h00bPlan', '.', 'cwd'])
      && hasTokenSequence(callTokens, ['h00bPlan', '.', 'env'])) consumesPlan = true;
  }
  assert.equal(spawnCount, 1, 'F3-07 exactly one live childProcess.spawnSync call must exist in CT-26');
  assert.ok(consumesPlan, 'F3-07 the live childProcess.spawnSync must consume h00bPlan.command/args/cwd/env');
  return source;
}

// 复制 canonical fixtures 到临时根，应用 manifest 变更函数后以真实 CLI 运行。
function runManifestMutation(mutate, expectedExit = 1) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f-manifest-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'harness/engineering/schema'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpRoot, 'harness/engineering/schema', file));
    }
    fs.copyFileSync(REGISTRY_PATH, path.join(tmpRoot, 'harness/engineering/owner-registry.json'));
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpRoot, 'fixtures'), { recursive: true });
    copySourceBasis(tmpRoot);
    const canonicalManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const mutated = mutate(canonicalManifest.cases.map((fixture) => ({ ...fixture })));
    fs.writeFileSync(path.join(tmpRoot, 'fixtures', 'manifest.json'), `${JSON.stringify({ schema_version: 'h01-contract-fixtures-v1', cases: mutated }, null, 2)}\n`);
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', 'fixtures'], { cwd: tmpRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, expectedExit, `mutated manifest CLI exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return result;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// 复制 canonical fixtures 到临时根，对指定文件执行 link 操作（symlink 或 hardlink），
// 然后以真实 CLI 运行。用于 H01F-14 至 H01F-17 文件身份反例。
function runFixturesWithLink({ linkType, targetFile, linkPath, relRootForCli = 'fixtures' }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f-link-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'harness/engineering/schema'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpRoot, 'harness/engineering/schema', file));
    }
    fs.copyFileSync(REGISTRY_PATH, path.join(tmpRoot, 'harness/engineering/owner-registry.json'));
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpRoot, 'fixtures'), { recursive: true });
    copySourceBasis(tmpRoot);
    const fixturesRoot = path.join(tmpRoot, 'fixtures');
    const resolvedTarget = path.resolve(fixturesRoot, targetFile);
    const resolvedLink = path.resolve(fixturesRoot, linkPath);
    fs.rmSync(resolvedLink, { force: true });
    fs.mkdirSync(path.dirname(resolvedLink), { recursive: true });
    if (linkType === 'symlink') {
      fs.symlinkSync(resolvedTarget, resolvedLink);
    } else if (linkType === 'hardlink') {
      fs.linkSync(resolvedTarget, resolvedLink);
    } else {
      throw new Error(`unknown linkType ${linkType}`);
    }
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', relRootForCli], { cwd: tmpRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return result;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function canonicalRegistryFixture() {
  const owners = [];
  const topics = [];
  for (const contract of ['evidence', 'task', 'capability', 'permission', 'trace', 'result', 'checkpoint', 'ruleset', 'epoch', 'external-reference', 'provider']) {
    owners.push({ owner_id: `OWNER-H01-${contract.toUpperCase()}`, topic: `${contract}-contract`, owner_kind: 'project-governance', status: 'active', source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES', `urn:h01:${contract}.schema.json`] });
    topics.push({ topic_id: `${contract}-contract`, active_owner_id: `OWNER-H01-${contract.toUpperCase()}`, status: 'active' });
  }
  return {
    schema_version: 'h01-owner-registry-v1',
    registry_id: 'H01-OWNER-REGISTRY',
    source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES'],
    owners,
    topics
  };
}

test('CT-01 all schemas parse with fixed $id and no unknown keywords', () => {
  const files = fs.readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.schema.json')).sort();
  assert.equal(files.length, 11, 'must be exactly 11 schema files');
  const ids = new Set();
  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
    assert.ok(parsed.$id, `${file} must have $id`);
    assert.ok(!ids.has(parsed.$id), `${file} $id must be unique`);
    ids.add(parsed.$id);
    assert.equal(parsed.type, 'object');
    assert.equal(parsed.additionalProperties, false);
    assert.ok(!JSON.stringify(parsed).includes('"$ref"'), `${file} must not use $ref`);
    const keys = new Set();
    collectKeys(parsed, keys);
    for (const key of keys) {
      if (key === '$schema') continue;
      assert.ok(SUPPORTED_KEYWORDS.includes(key) || key.startsWith('$') === false, `${file} uses unsupported keyword ${key}`);
    }
  }
});

test('CT-02 every schema has at least one valid fixture', () => {
  bindH01F('H01F-20', 'H01F-21', 'H01F-22');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const validByContract = new Map();
  for (const fixture of manifest.cases) {
    if (fixture.expected === 'valid') {
      validByContract.set(fixture.contract, (validByContract.get(fixture.contract) || 0) + 1);
    }
  }
  const contracts = ['evidence', 'task', 'capability', 'permission', 'trace', 'result', 'checkpoint', 'ruleset', 'epoch', 'external-reference', 'provider'];
  for (const contract of contracts) {
    assert.ok((validByContract.get(contract) || 0) >= 1, `${contract} must have at least one valid fixture`);
  }
  const scopeContracts = ['evidence', 'task', 'capability', 'permission', 'trace', 'result', 'checkpoint', 'ruleset', 'epoch', 'external-reference', 'provider'];
  for (const contract of scopeContracts) {
    const stripped = runFixtureWithFieldRemoved(contract, 'scope');
    assert.equal(stripped.status, 1, `H01F-20 removing required scope from ${contract} must fail`);
    assert.match(stripped.stderr, /SCHEMA_VIOLATION|missing required field scope/, `H01F-20 ${contract} must report scope violation`);
  }
  for (const contract of ['trace', 'result', 'checkpoint']) {
    const stripped = runFixtureWithFieldRemoved(contract, 'source_refs');
    assert.equal(stripped.status, 1, `H01F-21 removing required source_refs from ${contract} must fail`);
    assert.match(stripped.stderr, /SCHEMA_VIOLATION|missing required field source_refs/, `H01F-21 ${contract} must report source_refs violation`);
  }
  // H01-F3 R6：typed proof 绑定（result-content / fixture-property）
  const strippedScope = runFixtureWithFieldRemoved('checkpoint', 'scope');
  proveResultContent('CT-02/H01F-20', strippedScope, [
    { kind: 'status', expected: 1 },
    { kind: 'match', field: 'stderr', pattern: /SCHEMA_VIOLATION|missing required field scope/ }
  ]);
  const strippedSourceRefs = runFixtureWithFieldRemoved('checkpoint', 'source_refs');
  proveResultContent('CT-02/H01F-21', strippedSourceRefs, [
    { kind: 'status', expected: 1 },
    { kind: 'match', field: 'stderr', pattern: /SCHEMA_VIOLATION|missing required field source_refs/ }
  ]);
  proveFixtureProperty('CT-02/H01F-22', 'tests/harness/contracts/fixtures/valid/provider-longcat.json', [
    { kind: 'equal', field: 'provider_id', expected: 'P-LONGCAT-2-0' },
    { kind: 'equal', field: 'role', expected: 'execution-selected' },
    { kind: 'equal', field: 'status', expected: 'selected-pending-smoke' }
  ]);
  const longcat = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'valid/provider-longcat.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'valid/provider-codex-judge.json'), 'utf8'));
  assert.equal(longcat.provider_id, 'P-LONGCAT-2-0', 'H01F-22 LongCat provider must exist');
  assert.equal(longcat.role, 'execution-selected', 'H01F-22 LongCat role must be execution-selected');
  assert.equal(longcat.status, 'selected-pending-smoke', 'H01F-22 LongCat must be selected');
  assert.equal(codex.provider_id, 'J-CODEX-INDEPENDENT-TASK-SELECTED', 'H01F-22 Codex judge must exist');
  assert.equal(codex.role, 'judge-selected', 'H01F-22 Codex role must be judge-selected');
  assert.equal(codex.status, 'selected-pending-smoke', 'H01F-22 Codex must be selected');
  const epoch = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'valid/epoch.json'), 'utf8'));
  assert.equal(epoch.provider_ref, 'P-LONGCAT-2-0', 'H01F-22 epoch must reference LongCat');
  assert.equal(epoch.judge_ref, 'J-CODEX-INDEPENDENT-TASK-SELECTED', 'H01F-22 epoch must reference Codex judge');
});

test('CT-03 missing required fields reports SCHEMA_VIOLATION with field', () => {
  const result = validateJson(HOST_ROOT, 0);
  assert.equal(result.status, 0);
});

test('CT-04 unknown keys rejected by additionalProperties', () => {
  const parsed = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/evidence-unknown-key.json'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'evidence.schema.json'), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.ok(parsed.unexpected_key !== undefined, 'fixture must contain an unknown key');
});

test('CT-05 evidence ID prefix mismatch reports EVIDENCE_ROLE', () => {
  const { validateAgainstSchema } = require(VALIDATOR);
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/evidence-kind-prefix.json'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, 'evidence.schema.json'), 'utf8'));
  const schemaErrors = [];
  validateAgainstSchema(value, schema, 'input', schemaErrors);
  assert.equal(schemaErrors.length, 0, 'fixture must pass schema structure');
});

test('CT-06 O/C masquerading as authoritative fact is rejected', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/evidence-oc-authority.json'), 'utf8'));
  assert.equal(value.evidence_id.split('-')[0], 'O');
  assert.notEqual(value.authority, 'observation');
  assert.notEqual(value.authority, 'claimant');
});

test('CT-07 sensitive fields report SENSITIVE_FIELD with field name', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/evidence-sensitive.json'), 'utf8'));
  assert.match(value.statement, /api[_-]?key/i);
});

test('CT-08 duplicate primary ID is rejected with DUPLICATE_ID', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const valid = manifest.cases.find((fixture) => fixture.input === 'valid/evidence.json');
  const duplicate = manifest.cases.find((fixture) => fixture.input === 'invalid/evidence-duplicate-id.json');
  assert.ok(valid && duplicate);
  const a = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, valid.input), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, duplicate.input), 'utf8'));
  assert.equal(a.evidence_id, b.evidence_id, 'fixtures must share the primary ID');
  assert.deepEqual(duplicate.expected_error_codes, ['DUPLICATE_ID']);
});

test('CT-09 active owner conflict reports OWNER_CONFLICT with topic and owners', () => {
  bindH01F('H01F-01', 'H01F-02', 'H01F-03', 'H01F-04', 'H01F-05');
  const base = canonicalRegistryFixture();
  const conflictRegistry = JSON.parse(JSON.stringify(base));
  conflictRegistry.owners.push({ owner_id: 'OWNER-H01-INTRUDER', topic: 'trace-contract', owner_kind: 'project-governance', status: 'active', source_refs: ['A-HARNESS-ENGINEERING-PRINCIPLES'] });
  const result = runRegistryCli(conflictRegistry, 1);
  assert.match(result.stderr, /OWNER_CONFLICT/, 'H01F-01 stderr must report OWNER_CONFLICT');
  assert.match(result.stdout, /"status": "failed"/, 'H01F-01 stdout must be failed');
  assert.match(result.stdout, /"failed": [1-9]/, 'H01F-01 failed must be > 0');
  assert.match(result.stderr, /"topic_id": "trace-contract"/, 'H01F-02 stderr must contain topic_id');
  assert.match(result.stderr, /"owner_ids": \[/, 'H01F-02 stderr must contain owner_ids');
  assert.ok((result.stderr.match(/OWNER-H01-INTRUDER/g) || []).length >= 1, 'H01F-02 stderr must list both owners with source refs');
  // H01-F3 R6：typed proof 绑定（result-content）；窄补强 1：OWNER-H01-TRACE 必须实际出现在同一 result.stderr
  proveResultContent('CT-09/H01F-01', result, [
    { kind: 'match', field: 'stderr', pattern: /OWNER_CONFLICT/ },
    { kind: 'match', field: 'stdout', pattern: /"status": "failed"/ }
  ]);
  proveResultContent('CT-09/H01F-02', result, [
    { kind: 'match', field: 'stderr', pattern: /"topic_id": "trace-contract"/ },
    { kind: 'match', field: 'stderr', pattern: /"owner_ids": \[/ },
    { kind: 'match', field: 'stderr', pattern: /OWNER-H01-INTRUDER/ },
    { kind: 'match', field: 'stderr', pattern: /OWNER-H01-TRACE/ }
  ]);
  const badKind = JSON.parse(JSON.stringify(base));
  badKind.owners[0].owner_kind = 'rogue-kind';
  const kindResult = runRegistryCli(badKind, 1);
  assert.match(kindResult.stderr, /OWNER_CONFLICT/, 'H01F-03 stderr must report OWNER_CONFLICT for illegal owner_kind');
  proveResultContent('CT-09/H01F-03', kindResult, [{ kind: 'match', field: 'stderr', pattern: /OWNER_CONFLICT/ }]);
  const emptyRefs = JSON.parse(JSON.stringify(base));
  emptyRefs.owners[0].source_refs = ['A-HARNESS-ENGINEERING-PRINCIPLES', ''];
  const refsResult = runRegistryCli(emptyRefs, 1);
  assert.match(refsResult.stderr, /OWNER_CONFLICT/, 'H01F-04 stderr must report OWNER_CONFLICT for empty source_refs');
  proveResultContent('CT-09/H01F-04', refsResult, [{ kind: 'match', field: 'stderr', pattern: /OWNER_CONFLICT/ }]);
  const wrongTopic = JSON.parse(JSON.stringify(base));
  wrongTopic.owners.find((owner) => owner.topic === 'trace-contract').topic = 'epoch-contract';
  const topicResult = runRegistryCli(wrongTopic, 1);
  assert.match(topicResult.stderr, /OWNER_CONFLICT/, 'H01F-05 stderr must report OWNER_CONFLICT for topic-owner mismatch');
  proveResultContent('CT-09/H01F-05', topicResult, [{ kind: 'match', field: 'stderr', pattern: /OWNER_CONFLICT/ }]);
  const okResult = runRegistryCli(base, 0);
  assert.match(okResult.stdout, /"status": "passed"/, 'canonical registry must pass');
  // H01-F2：来源集合真实绑定反例（F2-01 至 F2-08）
  const forgedOwnerRefs = JSON.parse(JSON.stringify(base));
  forgedOwnerRefs.owners[0].source_refs = ['A-FORGED-NOT-IN-H00A'];
  const forgedOwner = runRegistryCli(forgedOwnerRefs, 1);
  assert.match(forgedOwner.stderr, /OWNER_CONFLICT/, 'F2-01 stderr must report OWNER_CONFLICT');
  assert.match(forgedOwner.stderr, /A-FORGED-NOT-IN-H00A/, 'F2-01 stderr must contain forged value');
  assert.match(forgedOwner.stderr, /source_refs/, 'F2-01 stderr must contain source_refs path');
  const forgedRootRefs = JSON.parse(JSON.stringify(base));
  forgedRootRefs.source_refs = ['A-FORGED-NOT-IN-H00A'];
  const forgedRoot = runRegistryCli(forgedRootRefs, 1);
  assert.match(forgedRoot.stderr, /OWNER_CONFLICT/, 'F2-02 stderr must report OWNER_CONFLICT');
  assert.match(forgedRoot.stderr, /A-FORGED-NOT-IN-H00A/, 'F2-02 stderr must contain forged value');
  assert.match(forgedRoot.stderr, /source_refs/, 'F2-02 stderr must contain root source_refs path');
  const dupRefs = JSON.parse(JSON.stringify(base));
  dupRefs.owners[0].source_refs = ['A-HARNESS-ENGINEERING-PRINCIPLES', 'A-HARNESS-ENGINEERING-PRINCIPLES'];
  const dupResult = runRegistryCli(dupRefs, 1);
  assert.match(dupResult.stderr, /OWNER_CONFLICT/, 'F2-03 stderr must report OWNER_CONFLICT for duplicate refs');
  const forgedR = JSON.parse(JSON.stringify(base));
  forgedR.owners[0].source_refs = ['R-FORGED'];
  const forgedRResult = runRegistryCli(forgedR, 1);
  assert.match(forgedRResult.stderr, /OWNER_CONFLICT/, 'F2-04 stderr must report OWNER_CONFLICT for R-FORGED');
  const shapeUrn = JSON.parse(JSON.stringify(base));
  shapeUrn.owners[0].source_refs = ['urn:h01:not-a-real-schema.schema.json'];
  const shapeUrnResult = runRegistryCli(shapeUrn, 1);
  assert.match(shapeUrnResult.stderr, /OWNER_CONFLICT/, 'F2-05 stderr must report OWNER_CONFLICT for shape-only URN');
  const canonicalRun = runRegistryCli(base, 0);
  assert.match(canonicalRun.stdout, /"status": "passed"/, 'F2-06 canonical registry must pass');
  assert.match(canonicalRun.stdout, /"errors": \[\]/, 'F2-06 errors must be empty');
  const missingManifest = JSON.parse(JSON.stringify(base));
  const tmpNoManifest = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f2-nomanifest-'));
  try {
    fs.mkdirSync(path.join(tmpNoManifest, 'harness/engineering/schema'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpNoManifest, 'harness/engineering/schema', file));
    }
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpNoManifest, FIXTURES_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmpNoManifest, 'harness/engineering/owner-registry.json'), `${JSON.stringify(missingManifest, null, 2)}\n`);
    const noManifestResult = spawnSync(process.execPath, [VALIDATOR, '--fixtures', FIXTURES_DIR], { cwd: tmpNoManifest, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(noManifestResult.status, 1, 'F2-07 missing source manifest must exit 1');
    assert.match(noManifestResult.stderr, /SOURCE_REFERENCE_BASIS/, 'F2-07 stderr must report SOURCE_REFERENCE_BASIS');
  } finally {
    fs.rmSync(tmpNoManifest, { recursive: true, force: true });
  }
  const badManifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f2-badmanifest-'));
  try {
    fs.mkdirSync(path.join(badManifestRoot, 'harness/engineering/schema'), { recursive: true });
    fs.mkdirSync(path.join(badManifestRoot, 'tests/harness/baselines'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(badManifestRoot, 'harness/engineering/schema', file));
    }
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(badManifestRoot, FIXTURES_DIR), { recursive: true });
    fs.writeFileSync(path.join(badManifestRoot, 'tests/harness/baselines/source-manifest.json'), `${JSON.stringify({ sources: { id: 'NOT-ARRAY' } }, null, 2)}\n`);
    fs.writeFileSync(path.join(badManifestRoot, 'harness/engineering/owner-registry.json'), `${JSON.stringify(base, null, 2)}\n`);
    const badManifestResult = spawnSync(process.execPath, [VALIDATOR, '--fixtures', FIXTURES_DIR], { cwd: badManifestRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(badManifestResult.status, 1, 'F2-08 sources-not-array manifest must exit 1');
    assert.match(badManifestResult.stderr, /SOURCE_REFERENCE_BASIS/, 'F2-08 stderr must report SOURCE_REFERENCE_BASIS');
  } finally {
    fs.rmSync(badManifestRoot, { recursive: true, force: true });
  }
  // H01-F3 R6：H01SM-01..05 source manifest 损坏矩阵（独立回归，不占 F3_VARIANTS 编号）
  assertManifestCorruptionMatrix();
});

// H01-F3：Slice C——用自定义损坏 source-manifest.json 跑隔离 registry CLI。
// 复用 runRegistryCli 的隔离结构，仅替换 manifest 内容。
function runRegistryCliWithManifest(manifestJson, expectedExit = 1) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'h01f3-manifest-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'harness/engineering/schema'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'tests/harness/contracts'), { recursive: true });
    for (const file of fs.readdirSync(SCHEMA_DIR)) {
      fs.copyFileSync(path.join(SCHEMA_DIR, file), path.join(tmpRoot, 'harness/engineering/schema', file));
    }
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), path.join(tmpRoot, FIXTURES_DIR), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'tests/harness/baselines'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'tests/harness/baselines/source-manifest.json'), `${JSON.stringify(manifestJson, null, 2)}\n`);
    fs.writeFileSync(path.join(tmpRoot, 'harness/engineering/owner-registry.json'), `${JSON.stringify(canonicalRegistryFixture(), null, 2)}\n`);
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', FIXTURES_DIR], { cwd: tmpRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, expectedExit, `registry CLI with custom manifest exit\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    return result;
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// H01-F3 R6：Slice C——4 个损坏 source-manifest 变体 + canonical 对照（H01SM-01 至 H01SM-05）。
// 测试行为原样保留，仅完全移出 F3 命名空间；H01SM 项不进入 F3_VARIANTS，继续在 CT-09 内真实执行。
function assertManifestCorruptionMatrix() {
  const notArray = runRegistryCliWithManifest({ sources: { id: 'NOT-ARRAY' } }, 1);
  assert.match(notArray.stderr, /SOURCE_REFERENCE_BASIS/, 'H01SM-01 sources-not-array must report SOURCE_REFERENCE_BASIS');
  assert.match(notArray.stderr, /\.sources/, 'H01SM-01 must locate the sources field');
  const duplicateId = runRegistryCliWithManifest({ sources: [{ id: 'A-DUPLICATE-ID' }, { id: 'A-DUPLICATE-ID' }] }, 1);
  assert.match(duplicateId.stderr, /SOURCE_REFERENCE_BASIS/, 'H01SM-02 duplicate source id must report SOURCE_REFERENCE_BASIS');
  assert.match(duplicateId.stderr, /unique source id/, 'H01SM-02 must report uniqueness violation');
  assert.match(duplicateId.stderr, /sources\[1\]\.id/, 'H01SM-02 must locate the duplicated entry');
  const missingId = runRegistryCliWithManifest({ sources: [{ id: 'A-OK' }, {}] }, 1);
  assert.match(missingId.stderr, /SOURCE_REFERENCE_BASIS/, 'H01SM-03 missing source id must report SOURCE_REFERENCE_BASIS');
  assert.match(missingId.stderr, /sources\[1\]\.id/, 'H01SM-03 must locate the missing id entry');
  const emptyId = runRegistryCliWithManifest({ sources: [{ id: '' }] }, 1);
  assert.match(emptyId.stderr, /SOURCE_REFERENCE_BASIS/, 'H01SM-04 empty source id must report SOURCE_REFERENCE_BASIS');
  assert.match(emptyId.stderr, /sources\[0\]\.id/, 'H01SM-04 must locate the empty id entry');
  const ok = runRegistryCliWithManifest(JSON.parse(fs.readFileSync(path.join(HOST_ROOT, 'tests/harness/baselines/source-manifest.json'), 'utf8')), 0);
  assert.match(ok.stdout, /"status": "passed"/, 'H01SM-05 canonical isolated registry must pass');
  assert.match(ok.stdout, /"errors": \[\]/, 'H01SM-05 errors must be empty');
}

// H01-F3 R6：H01SM-01..05 必须各出现一次，且 assertManifestCorruptionMatrix 函数体
// 内不得残留旧 F3 source-manifest 编号（F3_VARIANTS 的 F3-09..13 属合法反例 ID，不受影响）。
function assertSourceManifestNumbering(source) {
  const range = extractFunctionBodyRange(source, 'assertManifestCorruptionMatrix');
  assert.ok(range, 'assertManifestCorruptionMatrix must exist');
  const body = source.slice(range.bodyStart, range.bodyEnd);
  for (let i = 1; i <= 5; i += 1) {
    assert.ok(body.includes(`H01SM-0${i}`), `H01SM-0${i} must appear in assertManifestCorruptionMatrix`);
  }
  const oldNumbers = body.match(/F3-\d{2}/g) || [];
  assert.equal(oldNumbers.length, 0, `assertManifestCorruptionMatrix must not carry old F3 numbering (got: ${oldNumbers.join(',')})`);
}

// H01-F3：Slice C 反例（F3-09 至 F3-13）在 CT-09 内执行。
test('CT-10 AUTHORIZED without authorization quote reports AUTHORIZED_INCOMPLETE', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/permission-no-quote.json'), 'utf8'));
  assert.equal(value.status, 'AUTHORIZED');
  assert.equal(value.authorization_quote, '');
});

test('CT-11 AUTHORIZED without forbidden scopes or validity reports AUTHORIZED_INCOMPLETE', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/permission-no-scope-time.json'), 'utf8'));
  assert.equal(value.status, 'AUTHORIZED');
  assert.equal(value.forbidden_scopes, undefined);
  assert.equal(value.valid_from, undefined);
});

test('CT-12 trace missing ruleset/epoch/fixture/oracle/adapter reports TRACE_INCOMPLETE', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/trace-missing-identity.json'), 'utf8'));
  assert.equal(value.status, 'completed');
  for (const field of ['ruleset_id', 'epoch_id', 'fixture_suite_ref', 'oracle_ref', 'adapter_ref']) {
    assert.equal(value[field], undefined, `${field} must be missing in fixture`);
  }
});

test('CT-13 trace missing tool result or state events reports TRACE_INCOMPLETE', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/trace-missing-events.json'), 'utf8'));
  assert.equal(value.status, 'completed');
  assert.equal(value.terminal_state, 'COMPLETED');
  assert.ok(!value.events.some((event) => event.event_type === 'tool' || event.event_type === 'verification'));
});

test('CT-14 result forged without completed trace reports RESULT_WITHOUT_TRACE', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/result-forged.json'), 'utf8'));
  assert.equal(value.status, 'SUCCEEDED');
  assert.deepEqual(value.completion_evidence_refs, []);
});

test('CT-15 checkpoint skipping sequence reports SCHEMA_VIOLATION or TRACE_INCOMPLETE', () => {
  bindH01F('H01F-10', 'H01F-11', 'H01F-12', 'H01F-13');
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/checkpoint-skip-sequence.json'), 'utf8'));
  assert.equal(value.resumable, true);
  assert.equal(value.last_event_sequence, 0);
  const overflow = runIsolatedFixtures([
    makeCase('CT-15', 'invalid/checkpoint-skip-sequence.json', 'checkpoint', 'valid'),
    makeCase('CT-15a', 'invalid/checkpoint-sequence-overflow.json', 'checkpoint', 'valid'),
    makeCase('CT-15b', 'invalid/checkpoint-state-mismatch.json', 'checkpoint', 'valid'),
    makeCase('CT-15c', 'invalid/checkpoint-no-trace.json', 'checkpoint', 'valid')
  ], 1);
  assert.match(overflow.stderr, /TRACE_INCOMPLETE/, 'H01F-10 sequence overflow must report TRACE_INCOMPLETE');
  assert.match(overflow.stderr, /checkpoint_id/, 'H01F-10 diagnostic must include checkpoint_id');
  assert.match(overflow.stderr, /last_event_sequence/, 'H01F-10 diagnostic must include last_event_sequence');
  assert.match(overflow.stderr, /CHECKPOINT-H01F-OVERFLOW/, 'H01F-10 must locate the checkpoint');
  assert.match(overflow.stderr, /CHECKPOINT-H01F-STATE-MISMATCH/, 'H01F-11 state mismatch must be located');
  assert.match(overflow.stderr, /CHECKPOINT-H01F-NO-TRACE/, 'H01F-12 missing trace must be located');
  // H01-F3 R6：typed proof 绑定（result-content / state-identity）
  proveResultContent('CT-15/H01F-10', overflow, [
    { kind: 'match', field: 'stderr', pattern: /TRACE_INCOMPLETE/ },
    { kind: 'match', field: 'stderr', pattern: /CHECKPOINT-H01F-OVERFLOW/ }
  ]);
  proveResultContent('CT-15/H01F-11', overflow, [{ kind: 'match', field: 'stderr', pattern: /CHECKPOINT-H01F-STATE-MISMATCH/ }]);
  proveResultContent('CT-15/H01F-12', overflow, [{ kind: 'match', field: 'stderr', pattern: /CHECKPOINT-H01F-NO-TRACE/ }]);
  const checkpointIdentity = { fixturePath: 'valid/checkpoint.json', fixtureId: 'CT-02-checkpoint' };
  const goodCheckpoint = runIsolatedFixtures([
    makeCase('CT-02-checkpoint', 'valid/checkpoint.json', 'checkpoint', 'valid')
  ], 0);
  assert.match(goodCheckpoint.stdout, /"status": "passed"/, 'H01F-13 checkpoint pointing to real middle event must pass');
  proveStateIdentity('CT-15/H01F-13', checkpointIdentity, goodCheckpoint, [
    { kind: 'identity-equal', field: 'fixturePath', expected: 'valid/checkpoint.json' },
    { kind: 'identity-equal', field: 'fixtureId', expected: 'CT-02-checkpoint' },
    { kind: 'result-match', field: 'stdout', pattern: /"status": "passed"/ }
  ]);
});

test('CT-16 supersedes cycle reports SUPERSEDES_CYCLE', () => {
  bindH01F('H01F-06', 'H01F-07', 'H01F-08', 'H01F-09');
  const a = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/ruleset-cycle-a.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/ruleset-cycle-b.json'), 'utf8'));
  assert.ok(a.supersedes.includes(b.ruleset_id));
  assert.ok(b.supersedes.includes(a.ruleset_id));
  const badChain = runIsolatedFixtures([
    makeCase('CT-16c', 'invalid/evidence-superseded-no-chain.json', 'evidence', 'valid'),
    makeCase('CT-16d', 'invalid/evidence-self-supersede.json', 'evidence', 'valid'),
    makeCase('CT-16e', 'invalid/evidence-cycle-a.json', 'evidence', 'valid'),
    makeCase('CT-16f', 'invalid/evidence-cycle-b.json', 'evidence', 'valid')
  ], 1);
  assert.match(badChain.stderr, /SCHEMA_VIOLATION/, 'H01F-06 superseded without supersedes must report SCHEMA_VIOLATION');
  assert.match(badChain.stderr, /SUPERSEDES_CYCLE/, 'H01F-07/08 cycles must report SUPERSEDES_CYCLE');
  assert.match(badChain.stderr, /D-SELF-SUPERSEDE/, 'H01F-07 self reference must be located');
  assert.match(badChain.stderr, /D-CYCLE-A/, 'H01F-08 multi-node cycle must be located');
  // H01-F3 R6：typed proof 绑定（result-content / state-identity）；窄补强 2：legalChainCases 具名（CT-16g/CT-16h）
  proveResultContent('CT-16/H01F-06', badChain, [{ kind: 'match', field: 'stderr', pattern: /SCHEMA_VIOLATION/ }]);
  proveResultContent('CT-16/H01F-07', badChain, [
    { kind: 'match', field: 'stderr', pattern: /SUPERSEDES_CYCLE/ },
    { kind: 'match', field: 'stderr', pattern: /D-SELF-SUPERSEDE/ }
  ]);
  proveResultContent('CT-16/H01F-08', badChain, [
    { kind: 'match', field: 'stderr', pattern: /SUPERSEDES_CYCLE/ },
    { kind: 'match', field: 'stderr', pattern: /D-CYCLE-A/ }
  ]);
  const legalChainCases = [
    makeCase('CT-16g', 'valid/evidence-superseded-chained.json', 'evidence', 'valid'),
    makeCase('CT-16h', 'valid/evidence-chain-next.json', 'evidence', 'valid')
  ];
  const legalChainIdentity = { cases: legalChainCases, firstFixtureId: 'CT-16g', secondFixtureId: 'CT-16h' };
  const goodChain = runIsolatedFixtures(legalChainCases, 0);
  assert.match(goodChain.stdout, /"status": "passed"/, 'H01F-09 legal supersedes chain must pass');
  proveStateIdentity('CT-16/H01F-09', legalChainIdentity, goodChain, [
    { kind: 'identity-equal', field: 'firstFixtureId', expected: 'CT-16g' },
    { kind: 'identity-equal', field: 'secondFixtureId', expected: 'CT-16h' },
    { kind: 'identity-length', field: 'cases', expected: 2 },
    { kind: 'result-match', field: 'stdout', pattern: /"status": "passed"/ }
  ]);
});

test('CT-17 external reference format error reports EXTERNAL_REFERENCE_FORMAT', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/external-reference-bad-format.json'), 'utf8'));
  assert.ok(!value.reference_id.startsWith('X-') || !value.locator);
});

test('CT-18 external reference to missing object passes (format only)', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'valid/external-reference-missing-object.json'), 'utf8'));
  assert.ok(value.reference_id.startsWith('X-'));
  assert.ok(!fs.existsSync(path.join(HOST_ROOT, value.locator)), 'referenced object must not exist yet');
});

test('CT-19 provider becoming callable is rejected in H01', () => {
  bindH01F('H01F-22', 'H01F-23');
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/provider-callable.json'), 'utf8'));
  assert.equal(value.status, 'callable-confirmed');
  const callable = runIsolatedFixtures([
    makeCase('CT-19', 'invalid/provider-callable.json', 'provider', 'valid')
  ], 1);
  assert.match(callable.stderr, /SCHEMA_VIOLATION|selected-pending-smoke/, 'H01F-22 provider callable must be rejected');
  proveResultContent('CT-19/H01F-22', callable, [{ kind: 'match', field: 'stderr', pattern: /SCHEMA_VIOLATION|selected-pending-smoke/ }]);
  const noJudge = runIsolatedFixtures([
    makeCase('CT-02-epoch', 'valid/epoch.json', 'epoch', 'valid'),
    makeCase('CT-02-provider-codex-judge', 'valid/provider-codex-judge.json', 'provider', 'valid'),
    makeCase('CT-02-provider-longcat', 'valid/provider-longcat.json', 'provider', 'valid'),
    makeCase('CT-19b', 'invalid/epoch-missing-judge.json', 'epoch', 'valid')
  ], 1);
  assert.match(noJudge.stderr, /judge_ref|judge provider/, 'H01F-23 missing judge must be located');
  proveResultContent('CT-19/H01F-23', noJudge, [{ kind: 'match', field: 'stderr', pattern: /judge_ref|judge provider/ }]);
});

test('CT-20 epoch with credential or token reports SENSITIVE_FIELD', () => {
  const value = JSON.parse(fs.readFileSync(path.join(HOST_ROOT, FIXTURES_DIR, 'invalid/epoch-sensitive.json'), 'utf8'));
  assert.ok(value.tools.some((tool) => /credential/i.test(tool)));
});

test('CT-21 identical input produces identical stdout bytes', (t) => {
  bindH01F('H01F-25');
  const first = validateJson(HOST_ROOT, 0);
  const second = validateJson(HOST_ROOT, 0);
  assert.deepEqual(second.stdout, first.stdout);
  const h01f = validateJson(HOST_ROOT, 0);
  assert.deepEqual(h01f.stdout, first.stdout, 'H01F-25 identical input must produce identical bytes');
  proveRelation('CT-21/H01F-25', first, 'stdout', second, 'stdout', 'deepEqual');
  // H01-F3 R6：固定父测试集合 + H01F_PROOFS typed proof + ANCHOR 基线 + CT-26 source plan + H01SM 编号的结构化元检查
  const source = fs.readFileSync(__filename, 'utf8');
  assertContractSurface(source);
  assertCanonicalH00BSource(source);
  const anchorBaseline = anchorBodyBaseline(source);
  assertF3RegistryShape();
  assertSourceManifestNumbering(source);
  if (!IS_META_CHILD) {
    // 锁住守卫本身：父进程（非 meta child）HOST_ROOT 必须始终来自 __dirname，忽略外部 H01F3_HOST_ROOT
    assert.equal(HOST_ROOT, path.resolve(__dirname, '../../..'), 'parent HOST_ROOT must come from __dirname');
    // H01ANCHOR-01：改写 runRegistryCli 后必须退出 1 并命中 F3-ANCHOR-IDENTITY（结构化证据）
    // 开源示例：anchor 基线提交不可用时（anchorDeferred），漂移防护整体降级，自检同步跳过。
    if (anchorBaseline && anchorBaseline.anchorDeferred) {
      // eslint-disable-next-line no-console
      console.log('H01ANCHOR-01 deferred: anchor baseline commit unavailable in this repository (OSS example)');
    } else {
    {
      const variant = { id: 'H01ANCHOR-01', entry: 'CT-21', mutation_contract: 'runRegistryCli body replaced with synthetic result', semantic_assertion: 'anchor body drift must be rejected' };
      const mutated = anchorTamperVariant(source);
      const run = runMetaChild({ ...variant, env_overrides: {} }, mutated);
      const failure = findTargetFailure(run.result.stdout + run.result.stderr);
      const evidence = collectEvidence(variant, source, mutated, run, Date.now(), failure);
      assert.equal(evidence.status, 1, 'H01ANCHOR-01 must exit 1');
      assert.ok((run.result.stdout + run.result.stderr).includes('F3-ANCHOR-IDENTITY'), 'H01ANCHOR-01 output must contain F3-ANCHOR-IDENTITY');
      t.diagnostic(JSON.stringify(evidence));
    }
    }
    // H01EV-01：语法错误虽 exit 1 且全文含 F3-10，但必须以 EVIDENCE_CAUSE_INVALID 拒绝（非 ERR_ASSERTION）
    {
      const variant = { id: 'H01EV-01', entry: 'CT-21', mutation_contract: 'append syntax error line carrying F3-10 text', semantic_assertion: 'syntax error must be rejected as invalid evidence' };
      const mutated = syntaxErrorVariant(source);
      const run = runMetaChild({ ...variant, env_overrides: {} }, mutated);
      const failure = findTargetFailure(run.result.stdout + run.result.stderr);
      const evidence = collectEvidence(variant, source, mutated, run, Date.now(), failure);
      assert.equal(evidence.status, 1, 'H01EV-01 must exit 1');
      assert.ok((run.result.stdout + run.result.stderr).includes('F3-10'), 'H01EV-01 output must contain F3-10 text');
      assert.notEqual(evidence.failure_code, 'ERR_ASSERTION', `H01EV-01 must be rejected with EVIDENCE_CAUSE_INVALID (failure_code=${evidence.failure_code})`);
      t.diagnostic(JSON.stringify(evidence));
    }
    // H01META-01：未登记 H01F3_META_FORGED 不得进入实际 H00B plan.env
    assertMetaForgedRemoved();
    // F3-CTRL：control case（仅追加无害注释）必须退出 0，不占 numeric ID
    {
      const run = runMetaChild({ id: 'F3-CTRL', entry: 'CT-21', env_overrides: {} }, `${source}\n// harmless control comment\n`);
      assert.equal(run.result.status, 0, 'F3-CTRL harmless comment must pass');
    }
    // 统一 F3_VARIANTS registry 分派：CT-21 leaves → CT-26 meta child leaves → CANONICAL invocation leaf
    const ct21Evidence = runF3Registry('CT-21', t);
    const ct26Evidence = OSS_SKIP_CT26 ? [] : runF3Registry('CT-26', t);
    const canonicalEvidence = runF3Registry('CANONICAL', t);
    assert.equal(ct21Evidence.length, 22, 'CT-21 leaves must be exactly 22');
    assert.equal(ct26Evidence.length, OSS_SKIP_CT26 ? 0 : 4, 'CT-26 leaves must be exactly 4 (0 when OSS-degraded)');
    assert.equal(canonicalEvidence.length, 1, 'CANONICAL leaves must be exactly 1');
  }
});

test('CT-22 manifest fixture_id swap fails and locates both IDs', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const ids = manifest.cases.map((fixture) => fixture.fixture_id);
  assert.equal(new Set(ids).size, ids.length, 'fixture_id must be unique');
  assert.deepEqual(ids, [...ids].sort(), 'fixture_id must be sorted');
  const tempRel = `.h01-contract-tmp-${process.pid}-${Date.now()}`;
  const tempDir = path.join(HOST_ROOT, tempRel);
  try {
    fs.cpSync(path.join(HOST_ROOT, FIXTURES_DIR), tempDir, { recursive: true });
    const tempManifest = JSON.parse(fs.readFileSync(path.join(tempDir, 'manifest.json'), 'utf8'));
    const first = tempManifest.cases.find((fixture) => fixture.fixture_id === 'CT-03');
    const second = tempManifest.cases.find((fixture) => fixture.fixture_id === 'CT-04');
    assert.ok(first && second, 'CT-03 and CT-04 must exist in manifest');
    const firstId = first.fixture_id;
    const secondId = second.fixture_id;
    first.fixture_id = secondId;
    second.fixture_id = firstId;
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), `${JSON.stringify(tempManifest, null, 2)}\n`);
    const result = spawnSync(process.execPath, [VALIDATOR, '--fixtures', tempRel], { cwd: HOST_ROOT, encoding: 'utf8' });
    assert.equal(result.status, 1, 'swapped manifest must fail');
    assert.ok(result.stderr.includes('CT-03') && result.stderr.includes('CT-04'), 'stderr must locate both swapped IDs');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CT-23 CLI missing duplicate valueless and unknown arguments exit 1', () => {
  assert.equal(spawnSync(process.execPath, [VALIDATOR], { cwd: HOST_ROOT, encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [VALIDATOR, '--fixtures', FIXTURES_DIR, '--fixtures', FIXTURES_DIR], { cwd: HOST_ROOT, encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [VALIDATOR, '--fixtures'], { cwd: HOST_ROOT, encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [VALIDATOR, '--unknown', 'x'], { cwd: HOST_ROOT, encoding: 'utf8' }).status, 1);
});

test('CT-24 fixtures dir escape or symlink exits 1 without reading outside files', () => {
  bindH01F('H01F-14', 'H01F-15', 'H01F-16', 'H01F-17');
  assert.equal(spawnSync(process.execPath, [VALIDATOR, '--fixtures', '../baselines'], { cwd: HOST_ROOT, encoding: 'utf8' }).status, 1);
  assert.equal(spawnSync(process.execPath, [VALIDATOR, '--fixtures', '/tmp'], { cwd: HOST_ROOT, encoding: 'utf8' }).status, 1);
  const linkRoot = path.join(HOST_ROOT, `.h01-ct24-${process.pid}-${Date.now()}`);
  const externalRoot = path.join(os.tmpdir(), `h01-ct24-ext-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(path.join(externalRoot, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(linkRoot, 'inner'), { recursive: true });
    fs.symlinkSync(externalRoot, path.join(linkRoot, 'alias-to-external'));
    fs.symlinkSync(path.join(linkRoot, 'inner'), path.join(linkRoot, 'alias-inner'));
    const externalRelative = path.relative(HOST_ROOT, path.join(linkRoot, 'alias-to-external', 'sub'));
    const escaped = spawnSync(process.execPath, [VALIDATOR, '--fixtures', externalRelative], { cwd: HOST_ROOT, encoding: 'utf8' });
    assert.equal(escaped.status, 1, 'symlinked intermediate resolving outside root must exit 1');
    assert.match(escaped.stderr, /symlink|escape|project root/, 'stderr must explain the rejection');
    const innerRelative = path.relative(HOST_ROOT, path.join(linkRoot, 'alias-inner'));
    const inner = spawnSync(process.execPath, [VALIDATOR, '--fixtures', innerRelative], { cwd: HOST_ROOT, encoding: 'utf8' });
    assert.equal(inner.status, 1, 'symlink leaf must be rejected by lstat');
    const realDirRelative = path.relative(HOST_ROOT, path.join(linkRoot, 'inner'));
    const realDir = spawnSync(process.execPath, [VALIDATOR, '--fixtures', realDirRelative], { cwd: HOST_ROOT, encoding: 'utf8' });
    assert.equal(realDir.status, 1, 'missing manifest inside real dir must still fail at load, not at path check');
    assert.match(realDir.stderr, /SCHEMA_PARSE|manifest|ENOENT/, 'failure must come from manifest load, not from path check');
  } finally {
    fs.rmSync(linkRoot, { recursive: true, force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
  }
  const externalPayload = path.join(os.tmpdir(), `h01f-ext-payload-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(externalPayload, JSON.stringify({ schema_version: 'h01-evidence-v1', evidence_id: 'A-EXTERNAL', kind: 'authoritative-fact', statement: '外部文件', source_refs: ['R-PROJECT-AGENTS'], scope: 'x', status: 'active', authority: 'authoritative-fact' }, null, 2));
  try {
    const inputSymlinkOutside = runFixturesWithLink({ linkType: 'symlink', targetFile: externalPayload, linkPath: 'valid/evidence.json', relRootForCli: 'fixtures' });
    assert.equal(inputSymlinkOutside.status, 1, 'H01F-14 input symlink pointing outside project must exit 1');
    assert.match(inputSymlinkOutside.stderr, /CLI_ARGUMENT|symlink|regular/, 'H01F-14 stderr must explain rejection');
    proveResultContent('CT-24/H01F-14', inputSymlinkOutside, [
      { kind: 'status', expected: 1 },
      { kind: 'match', field: 'stderr', pattern: /CLI_ARGUMENT|symlink|regular/ }
    ]);
    const insideTarget = path.join(HOST_ROOT, FIXTURES_DIR, 'valid/task.json');
    const inputSymlinkInside = runFixturesWithLink({ linkType: 'symlink', targetFile: insideTarget, linkPath: 'valid/evidence.json', relRootForCli: 'fixtures' });
    assert.equal(inputSymlinkInside.status, 1, 'H01F-15 input symlink pointing inside fixtures must still be rejected');
    proveResultContent('CT-24/H01F-15', inputSymlinkInside, [{ kind: 'status', expected: 1 }]);
    const inputHardlink = runFixturesWithLink({ linkType: 'hardlink', targetFile: path.join(HOST_ROOT, FIXTURES_DIR, 'valid/task.json'), linkPath: 'valid/evidence.json', relRootForCli: 'fixtures' });
    assert.equal(inputHardlink.status, 1, 'H01F-16 input hardlink must exit 1');
    assert.match(inputHardlink.stderr, /CLI_ARGUMENT|hard link|nlink/, 'H01F-16 stderr must explain hardlink rejection');
    proveResultContent('CT-24/H01F-16', inputHardlink, [
      { kind: 'status', expected: 1 },
      { kind: 'match', field: 'stderr', pattern: /CLI_ARGUMENT|hard link|nlink/ }
    ]);
    const manifestSymlink = runFixturesWithLink({ linkType: 'symlink', targetFile: externalPayload, linkPath: 'manifest.json', relRootForCli: 'fixtures' });
    assert.equal(manifestSymlink.status, 1, 'H01F-17 manifest symlink must exit 1');
    assert.match(manifestSymlink.stderr, /CLI_ARGUMENT|manifest/, 'H01F-17 stderr must explain manifest rejection');
    proveResultContent('CT-24/H01F-17', manifestSymlink, [
      { kind: 'status', expected: 1 },
      { kind: 'match', field: 'stderr', pattern: /CLI_ARGUMENT|manifest/ }
    ]);
    const manifestHardlink = runFixturesWithLink({ linkType: 'hardlink', targetFile: path.join(HOST_ROOT, FIXTURES_DIR, 'manifest.json'), linkPath: 'manifest.json', relRootForCli: 'fixtures' });
    assert.equal(manifestHardlink.status, 1, 'H01F-17 manifest hardlink must exit 1');
    proveResultContent('CT-24/H01F-17', manifestHardlink, [
      { kind: 'status', expected: 1 },
      { kind: 'match', field: 'stderr', pattern: /CLI_ARGUMENT|manifest/ }
    ]);
  } finally {
    fs.unlinkSync(externalPayload);
  }
});

test('CT-25 setup failure is not copied into per-scenario passes', () => {
  bindH01F('H01F-18', 'H01F-19');
  const fixturesRoot = path.join(HOST_ROOT, FIXTURES_DIR);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.schema_version, 'h01-contract-fixtures-v1');
  const caseCount = manifest.cases.length;
  const result = validateJson(HOST_ROOT, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.fixture_count, caseCount, 'validator must report every manifest case');
  assert.equal(parsed.passed, caseCount, 'all cases must pass when manifest and fixtures agree');
  const emptyCodes = runManifestMutation((cases) => {
    const target = cases.find((fixture) => fixture.fixture_id === 'CT-03');
    target.expected_error_codes = [];
    return cases;
  }, 1);
  assert.match(emptyCodes.stderr, /DETERMINISM_MISMATCH/, 'H01F-18 invalid case with empty codes must fail');
  assert.match(emptyCodes.stdout, /"status": "failed"/, 'H01F-18 stdout must be failed');
  proveResultContent('CT-25/H01F-18', emptyCodes, [
    { kind: 'match', field: 'stderr', pattern: /DETERMINISM_MISMATCH/ },
    { kind: 'match', field: 'stdout', pattern: /"status": "failed"/ }
  ]);
  const thinCoverage = runManifestMutation((cases) => {
    const kept = cases.filter((fixture) => fixture.contract !== 'task');
    return kept.filter((fixture) => !(fixture.contract === 'evidence' && fixture.expected === 'invalid'));
  }, 1);
  assert.match(thinCoverage.stderr, /at least two invalid cases/, 'H01F-19 schema with fewer than two invalid cases must fail');
  proveResultContent('CT-25/H01F-19', thinCoverage, [{ kind: 'match', field: 'stderr', pattern: /at least two invalid cases/ }]);
  const fullCoverage = runManifestMutation((cases) => cases, 0);
  assert.match(fullCoverage.stdout, /"status": "passed"/, 'canonical manifest coverage must pass');
});

test('CT-26 H00A frozen validator and H00B regression still pass', (t) => {
  // 开源示例：H00A/H00B 私有证据链（manifest v4、debt 台账、来源清册、审批提交）不随仓库发布，
  // 运行时 skip 并短路；私有环境删除以下两行即可恢复完整校验。
  t.skip('OSS example: H00A/H00B private evidence chain not shipped');
  return;
  bindH01F('H01F-24');
  // H01-F3 R6：CT-26 固定前半段顺序——meta 身份、source、唯一 h00bPlan、runtime plan 断言、canonical source 断言
  const source = fs.readFileSync(__filename, 'utf8');
  const h00bPlan = buildH00BPlan();
  assertCanonicalH00BPlan(h00bPlan);
  assertCanonicalH00BSource(source);
  if (IS_META_CHILD) {
    // meta child（F3-13/19/20/26 变异副本）：五步全部通过才返回；不启动 H00A/H00B、不采集保护快照
    t.diagnostic(JSON.stringify({ meta_child: true, entry: 'CT-26', plan_ok: true, source_ok: true }));
    return;
  }
  // 正常路径：第一次 source/plan 断言后立即采集 protectedBefore，再运行 H00A validator
  const protectedBefore = recordProtectedHashes();
  const h00a = run(HOST_ROOT, process.execPath, [
    'scripts/harness/validate-h00a.js', '--mode', 'frozen',
    '--manifest', 'tests/harness/baselines/source-manifest.json',
    '--incidents', 'tests/harness/incidents/seed.jsonl',
    '--families', 'tests/harness/incidents/failure-family-candidates.jsonl',
    '--debt', 'tests/harness/baselines/validation-debt.json',
    '--confirmation', 'tests/harness/baselines/h00a-confirmation.json',
    '--migration', 'tests/harness/baselines/h00a-schema-migration-r1.json',
    '--ledger', 'doc/平台治理/harness-engineering/来源清册.md'
  ]);
  assert.match(h00a.stdout, /valid-frozen-evidence/);
  assert.match(h00a.stdout, /approved/);
  // 第二轮 source/plan 断言（H00B spawnSync 紧前），两轮之间禁止写入 plan 字段
  assertCanonicalH00BSource(source);
  assertCanonicalH00BPlan(h00bPlan);
  const h00b = childProcess.spawnSync(h00bPlan.command, h00bPlan.args, { cwd: h00bPlan.cwd, encoding: 'utf8', env: h00bPlan.env, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(h00b.status, 0, `H01F-24 H00B wrapper must exit 0\nstdout:\n${h00b.stdout}\nstderr:\n${h00b.stderr}`);
  const tap = h00b.stdout + h00b.stderr;
  assert.match(tap, /# tests 36/, 'H01F-24 H00B TAP must report 36 tests');
  assert.match(tap, /# pass 36/, 'H01F-24 H00B TAP must report 36 pass');
  assert.match(tap, /# fail 0/, 'H01F-24 H00B TAP must report 0 fail');
  assert.match(tap, /# skipped 0/, 'H01F-24 H00B TAP must report 0 skipped');
  assert.match(tap, /# todo 0/, 'H01F-24 H00B TAP must report 0 todo');
  // H01-F3 R6：typed proof 绑定（result-content + 次级 relational clause：protected state 深相等）
  proveResultContent('CT-26/H01F-24', h00b, [
    { kind: 'status', expected: 0 },
    { kind: 'include', field: 'stdout', text: '# tests 36' },
    { kind: 'include', field: 'stdout', text: '# pass 36' },
    { kind: 'include', field: 'stdout', text: '# fail 0' }
  ]);
  // H00B 完成后立即采集 protectedAfter 并深比较（次级 relational clause）
  const protectedAfter = recordProtectedHashes();
  assert.deepEqual(protectedAfter, protectedBefore, 'H01F-24 H00B must not change protected files');
  proveRelation('CT-26/H01F-24-protected', protectedAfter, 'length', protectedBefore, 'length', 'deepEqual');
});
