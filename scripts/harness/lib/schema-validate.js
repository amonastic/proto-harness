'use strict';

// P8.3（2026-08-21）：轻量 JSON Schema 校验器。
//
// 仓库无 ajv 等校验依赖（package.json 只在 optionalDependencies 声明 docx，供 scripts/convert-md-to-docx.js 使用）。
// requirement-interview adapter 需要结构校验，故实现
// 一个仅覆盖本项目 schema 用到的关键字子集的校验器：
//   - type（object / array / string / integer / number / boolean / null）
//   - properties + required（对象必填字段）
//   - items（数组元素类型）
//   - minItems / maxItems
//   - minLength / maxLength
// 未知关键字（description、additionalProperties 等）一律忽略，不做额外约束。
//
// 用法：
//   const { validateSchema } = require('./schema-validate');
//   const result = validateSchema(value, schema);
//   result.valid === true 时通过；否则 result.errors 为人类可读错误数组。

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// 校验单个值；返回错误数组（空数组 = 通过）
function check(value, schema, path, errors) {
  if (schema === undefined || schema === null) return;
  if (typeof schema !== 'object' || Array.isArray(schema)) return;

  if (schema.type !== undefined) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!expectedTypes.includes(actual)) {
      errors.push(`${path}: 类型应为 ${expectedTypes.join('|')}，实际为 ${actual}`);
      return; // 类型错误后不再继续细查
    }
  }

  switch (schema.type) {
    case 'object': {
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (value[key] === undefined) {
            errors.push(`${path}.${key}: 缺少必填字段`);
          }
        }
      }
      if (schema.properties && value !== null && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, subSchema] of Object.entries(schema.properties)) {
          if (value[key] !== undefined) {
            check(value[key], subSchema, `${path}.${key}`, errors);
          }
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) break;
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: 至少需要 ${schema.minItems} 项，实际 ${value.length} 项`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: 最多允许 ${schema.maxItems} 项，实际 ${value.length} 项`);
      }
      if (schema.items) {
        value.forEach((item, index) => check(item, schema.items, `${path}[${index}]`, errors));
      }
      break;
    }
    case 'string': {
      if (typeof value !== 'string') break;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: 长度超过 ${schema.maxLength}（实际 ${value.length}）`);
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: 长度不足 ${schema.minLength}（实际 ${value.length}）`);
      }
      break;
    }
    default:
      break;
  }
}

// 返回 { valid: boolean, errors: string[] }
function validateSchema(value, schema) {
  const errors = [];
  check(value, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateSchema,
  typeOf
};
