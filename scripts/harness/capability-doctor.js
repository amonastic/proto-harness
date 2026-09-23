'use strict';

// H06（P3）：Capability 探测器 CLI。
// 读取 capability 清单（tests/harness/capabilities/test-manifest.json），
// 输出满足 capability.schema.json 结构的报告：每个工具的 action/target/risk/status
// 与 ready 判定（capability 存在不代表 permission 已授权——permission 判定由 permission-guard.js 承担）。
//
// 用法：npm run harness:capability:doctor -- --manifest tests/harness/capabilities/test-manifest.json
// 不误报未定义工具为 ready：缺必要字段/risk 非法/status 非 ready → not-ready 并给原因。

const fs = require('fs');
const path = require('path');
const { isCapabilityReady } = require('./permission-guard');
const { validateAgainstSchema, loadSchema } = require('./lib/trace/schema-check');

const HOST_ROOT = path.resolve(__dirname, '../..');

function readManifest(manifestPath) {
  const resolved = path.resolve(HOST_ROOT, manifestPath);
  const relative = path.relative(HOST_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`H06_DOCTOR manifest escapes project root: ${manifestPath}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`H06_DOCTOR manifest parse failed: ${manifestPath}: ${error.message}`);
  }
  return parsed;
}

function doctorReport(manifest) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const capabilitySchema = loadSchema('capability.schema.json');
  const report = [];
  for (const entry of entries) {
    const ready = isCapabilityReady(entry);
    const schemaErrors = validateAgainstSchema(entry, capabilitySchema);
    report.push({
      capability_id: entry && entry.capability_id ? entry.capability_id : '(missing)',
      action: entry && entry.action ? entry.action : '(missing)',
      target: entry && entry.target ? entry.target : null,
      risk: entry && entry.risk ? entry.risk : '(missing)',
      status: entry && entry.status ? entry.status : '(missing)',
      ready: ready.ready,
      ready_reason: ready.reason,
      schema_valid: schemaErrors.length === 0,
      schema_errors: schemaErrors
    });
  }
  return { manifest, report };
}

function parseCli(argv) {
  const options = { manifest: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`H06_DOCTOR ${token} requires a value`);
      index += 1;
      return value;
    };
    if (token === '--manifest') options.manifest = next();
    else throw new Error(`H06_DOCTOR unknown argument: ${token}`);
  }
  if (!options.manifest) throw new Error('H06_DOCTOR --manifest is required');
  return options;
}

if (require.main === module) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = doctorReport(readManifest(options.manifest));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { readManifest, doctorReport, parseCli };
