'use strict';

// H05（P2）：运行包编译器。
// 把 H04 语料 fixture + H01 契约引用 + provider 配置模板编译为自包含运行包 JSON。
//
// 契约（任务包 5.3）：
//   1. 读取语料库中对应 task_id 的 fixture
//   2. contract_ref 引用 H01 task 契约（task_id + 契约版本，不嵌入规则正文）
//   3. provider_config_template 复用 P1 runtime 的配置形态，API key 字段为占位符 ${DEEPSEEK_API_KEY}
//   4. 运行包不含仓库内文件路径、不含 Harness 规则文件内容
//   5. 输出 .harness-runtime/packs/<pack_id>.json（.harness-runtime/ 已被 .gitignore 排除）

const fs = require('fs');
const path = require('path');
const { readConfig: readExecutionConfig } = require('../providers/execution-runtime');
const { readJudgeConfig } = require('../providers/judge-runtime');
const { PROVIDER_REQUEST_SCHEMA_VERSION } = require('../lib/runner/protocol');

const HOST_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_CORPUS = 'tests/harness/fixtures/corpus/corpus.json';
const DEFAULT_PACKS_DIR = '.harness-runtime/packs';

function readCorpus(corpusPath) {
  const filePath = path.resolve(HOST_ROOT, corpusPath);
  const relative = path.relative(HOST_ROOT, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H05_PACK corpus escapes project root: ${corpusPath}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`H05_PACK corpus parse failed: ${corpusPath}: ${error.message}`);
  }
  return parsed;
}

function findFixtureForTask(corpus, taskId) {
  const fixtures = Array.isArray(corpus.fixtures) ? corpus.fixtures : [];
  const match = fixtures.find((item) => item.task_id === taskId);
  if (!match) throw new Error(`H05_PACK no fixture for task_id ${taskId} in corpus`);
  return match;
}

// provider 配置模板：复用 P1 runtime config 形态，key 为占位符（不填充实际值）
function buildProviderConfigTemplate() {
  const execution = readExecutionConfig();
  const judge = readJudgeConfig();
  return {
    execution: {
      provider_id: 'P-DEEPSEEK-V4-FLASH',
      model_id: execution.modelId,
      base_url: execution.baseUrl,
      auth_method: 'api-key',
      api_key: '${DEEPSEEK_API_KEY}'
    },
    judge: {
      provider_id: 'J-GENERIC-JUDGE',
      model_id: judge.modelId,
      base_url: judge.baseUrl,
      auth_method: judge.authMethod,
      api_key: '${JUDGE_API_KEY}'
    }
  };
}

// 编译运行包
function compilePack({ taskId, corpusPath = DEFAULT_CORPUS, outDir = DEFAULT_PACKS_DIR }) {
  if (typeof taskId !== 'string' || taskId.length === 0) throw new Error('H05_PACK taskId required');
  // 安全校验：taskId 白名单（与 task.schema.json:10 的 pattern ^TASK-[A-Z0-9][A-Z0-9-]*$ 逐字符一致），
  // 防止 path 注入逃逸 outDir
  if (!/^TASK-[A-Z0-9][A-Z0-9-]*$/.test(taskId)) {
    throw new Error(`H05_PACK invalid task_id (must match ^TASK-[A-Z0-9][A-Z0-9-]*$): ${taskId}`);
  }
  const corpus = readCorpus(corpusPath);
  const fixture = findFixtureForTask(corpus, taskId);

  const packId = `PACK-${taskId}-${Date.now()}`;
  const pack = {
    pack_id: packId,
    schema_version: 'h05-pack-v1',
    task_id: taskId,
    fixture,
    // H02 Runner 执行形态：由 fixture 派生（H04 验证器 payload 不是 Runner 执行输入，
    // 运行包必须携带可执行 steps 才能调用 runner.execute() 产出 trace/result）
    execution_fixture: {
      task_id: taskId,
      ruleset_id: 'RULESET-H04-CORPUS-V1',
      epoch_id: 'EPOCH-H04-CORPUS-V1',
      fixture_suite_ref: 'FS-H04-CORPUS-V1',
      oracle_ref: 'ORACLE-H04-CORPUS-V1',
      adapter_ref: 'ADAPTER-H04-CORPUS-V1',
      steps: [
        {
          tool: 'synth-echo',
          args: { corpus_id: fixture.corpus_id, scenario_type: fixture.scenario_type },
          behavior: 'success',
          exit_code: 0
        }
      ]
    },
    contract_ref: {
      task_id: taskId,
      contract_version: 'h01-task-v1',
      provider_protocol: PROVIDER_REQUEST_SCHEMA_VERSION
    },
    provider_config_template: buildProviderConfigTemplate()
  };

  // 写入 .harness-runtime/packs/（gitignore 排除）
  const resolved = path.resolve(HOST_ROOT, outDir);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H05_PACK outDir escapes project root: ${outDir}`);
  fs.mkdirSync(resolved, { recursive: true });
  const fileName = path.join(resolved, `${packId}.json`);
  fs.writeFileSync(`${fileName}.tmp`, `${JSON.stringify(pack, null, 2)}\n`);
  fs.renameSync(`${fileName}.tmp`, fileName);

  return { pack, fileName };
}

// CLI：npm run harness:pack -- --task <task_id> [--out <path>]
function parseCli(argv) {
  const options = { taskId: null, outDir: DEFAULT_PACKS_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`H05_PACK ${token} requires a value`);
      index += 1;
      return value;
    };
    if (token === '--task') options.taskId = next();
    else if (token === '--out') options.outDir = next();
    else if (token === '--corpus') options.corpusPath = next();
    else throw new Error(`H05_PACK unknown argument: ${token}`);
  }
  if (!options.taskId) throw new Error('H05_PACK --task is required');
  return options;
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = compilePack({ taskId: options.taskId, corpusPath: options.corpusPath, outDir: options.outDir });
    process.stdout.write(`${JSON.stringify({ pack_id: result.pack.pack_id, task_id: result.pack.task_id, file: result.fileName }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  readCorpus,
  findFixtureForTask,
  buildProviderConfigTemplate,
  compilePack,
  parseCli
};
