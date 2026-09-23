'use strict';

// H02：Trace/Result/Checkpoint/Provider 结构自检。
// 只读取 H01 已批准的既有 schema 文件（harness/engineering/schema/），不新增、不修改任何 schema。
// 校验逻辑为 scripts/harness/validate-contract.js 中 validateAgainstSchema 的等价独立实现
// （同一关键字子集：type/const/enum/pattern/minLength/minItems/uniqueItems/required/properties/additionalProperties/items），
// 供 Runner 写盘前与 R00-10 Provider 结构一致性校验复用同一套代码。

const fs = require('fs');
const path = require('path');

const HOST_ROOT = path.resolve(__dirname, '../../../../');
const SCHEMA_DIR = path.join(HOST_ROOT, 'harness/engineering/schema');

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function loadSchema(relativeFile) {
  const filePath = path.join(SCHEMA_DIR, relativeFile);
  const resolved = path.resolve(filePath);
  const relative = path.relative(SCHEMA_DIR, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`H02_SCHEMA_PATH ${relativeFile} escapes schema dir`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new Error(`H02_SCHEMA_PARSE ${relativeFile}: ${error.message}`);
  }
  if (!parsed.$id) throw new Error(`H02_SCHEMA_PARSE ${relativeFile}: missing $id`);
  return parsed;
}

// 校验 value 是否满足 schema（只支持本项目 schema 实际使用的关键字子集）。
// 返回错误数组；空数组表示通过。
function validateAgainstSchema(value, schema, instancePath = '', errors = []) {
  if (schema.type) {
    let matches = false;
    switch (schema.type) {
      case 'string': matches = typeof value === 'string'; break;
      case 'integer': matches = typeof value === 'number' && Number.isInteger(value); break;
      case 'number': matches = typeof value === 'number'; break;
      case 'boolean': matches = typeof value === 'boolean'; break;
      case 'object': matches = value !== null && typeof value === 'object' && !Array.isArray(value); break;
      case 'array': matches = Array.isArray(value); break;
      case 'null': matches = value === null; break;
      default: matches = true;
    }
    if (!matches) {
      errors.push(`${instancePath || '(root)'}: type violation expected ${schema.type}`);
      return errors;
    }
  }
  if (schema.const !== undefined) {
    if (stableJson(value) !== stableJson(schema.const)) errors.push(`${instancePath || '(root)'}: const mismatch expected ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum) {
    if (!schema.enum.some((item) => stableJson(item) === stableJson(value))) {
      errors.push(`${instancePath || '(root)'}: enum violation ${JSON.stringify(schema.enum)}`);
    }
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${instancePath || '(root)'}: pattern violation ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${instancePath || '(root)'}: minLength ${schema.minLength}`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${instancePath || '(root)'}: minimum violation`);
  if (schema.type === 'object' || (value && typeof value === 'object' && !Array.isArray(value))) {
    const actual = value || {};
    if (schema.required) {
      for (const required of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(actual, required)) errors.push(`${instancePath || '(root)'}: missing required field ${required}`);
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(actual, key)) {
          validateAgainstSchema(actual[key], subSchema, `${instancePath || '(root)'}.${key}`, errors);
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(actual)) {
        if (!allowed.has(key)) errors.push(`${instancePath || '(root)'}: unknown field ${key}`);
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${instancePath || '(root)'}: minItems ${schema.minItems}`);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = stableJson(item);
        if (seen.has(key)) errors.push(`${instancePath || '(root)'}: uniqueItems violation`);
        seen.add(key);
      }
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) validateAgainstSchema(item, schema.items, `${instancePath || '(root)'}[${index}]`, errors);
    }
  }
  return errors;
}

// 供测试与 Runner 共用的四个入口：返回 { errors } 或抛 H02_SCHEMA_LOAD。
function validateTrace(trace) {
  return { errors: validateAgainstSchema(trace, loadSchema('trace.schema.json')) };
}
function validateResult(result) {
  return { errors: validateAgainstSchema(result, loadSchema('result.schema.json')) };
}
function validateCheckpoint(checkpoint) {
  return { errors: validateAgainstSchema(checkpoint, loadSchema('checkpoint.schema.json')) };
}
function validateProvider(provider) {
  return { errors: validateAgainstSchema(provider, loadSchema('provider.schema.json')) };
}

module.exports = {
  HOST_ROOT,
  loadSchema,
  stableJson,
  validateAgainstSchema,
  validateTrace,
  validateResult,
  validateCheckpoint,
  validateProvider
};
