# H01 Engineering Contracts

本目录承载 H01 核心结构化工程契约：schema、owner registry 与验证入口。它不替代 `AGENTS.md`、Harness 角色正文、`standards/**`、业务外脑或 Memory 入口，也不构成平行规则体系。

## 目录用途与 schema 清单

- `schema/evidence.schema.json`：证据对象（A/D/O/C/R/Q/V/X 前缀）
- `schema/task.schema.json`：任务对象（TASK-*）
- `schema/capability.schema.json`：能力对象（CAP-*）
- `schema/permission.schema.json`：授权对象（PERM-*，AUTHORIZED 完整性约束）
- `schema/trace.schema.json`：执行轨迹（TRACE-*，完成态完整性约束）
- `schema/result.schema.json`：结果对象（RESULT-*，依赖已完成 Trace）
- `schema/checkpoint.schema.json`：检查点（CHECKPOINT-*）
- `schema/ruleset.schema.json`：规则集（RULESET-*，supersedes 链）
- `schema/epoch.schema.json`：运行纪元（EPOCH-*，H02A 前保持 selected-pending-smoke）
- `schema/external-reference.schema.json`：最小外部引用（X-*）
- `schema/provider.schema.json`：Provider/Judge（P-*/J-*）

## schema 与 validator 的关系

`schema/*.json` 是 JSON Schema 数据格式，只表达单对象结构。跨对象约束（ID 前缀与 kind 一致、owner 唯一性、授权完整性、Trace/Result 关系、supersedes 环、敏感字段、确定性）由 `scripts/harness/validate-contract.js` 的语义检查完成，并以固定错误码输出（如 `EVIDENCE_ROLE`、`OWNER_CONFLICT`、`AUTHORIZED_INCOMPLETE`、`TRACE_INCOMPLETE`、`RESULT_WITHOUT_TRACE`、`SUPERSEDES_CYCLE`、`SENSITIVE_FIELD`、`DUPLICATE_ID`、`EXTERNAL_REFERENCE_FORMAT`、`DETERMINISM_MISMATCH`）。schema 只使用已声明支持的关键字，不通过 `$ref` 引用网络、项目外绝对路径或运行时文件。

## epoch schema v1 → v2 升级说明（P5/H09）

> 批次：P5（H09 DeepSeek 任务级准入）；用户 2026-08-19 裁决同意扩展 `fixtures` 字段。

- **版本**：`epoch.schema.json` 的 `schema_version` 从 `h01-epoch-v1` 升级为 `h01-epoch-v2`；既有字段与 `required` 集合不变，v1 合法实例在 v2 下仍然合法（仅版本号变化）。
- **新增字段**：`fixtures`（可选，数组）。每个元素固定三个字段：
  - `corpus_id`：引用 `tests/harness/fixtures/corpus/corpus.json` 中的 fixture（H04 语料，P5 起每条含 `priority` 分级）；
  - `priority`：`P0` / `P1` / `P2`（fixture 优先级，`P0` 每 fixture 必跑 5 次，`P1`/`P2` 各 3 次）；
  - `required_runs`：正整数，该 fixture 在本 epoch 下的必跑次数（语义约束由 qualify 代码层校验，schema 关键字白名单不含 `minimum`）。
- **用途**：H09 `harness:qualify` 读取 epoch 的 `fixtures` 引用作为准入执行的绑定输入；`qualification-matrix.json` 负责任务族 × 预期档位基准。
- **兼容性**：v2 不改变 H01–H04 既有产物语义；`tests/harness/contracts/fixtures/` 下 4 个 epoch fixture 的 `schema_version` 已同步升级为 v2（valid/epoch.json、invalid/epoch-missing-judge.json、invalid/epoch-sensitive.json、invalid/epoch-callable.json）。

## owner registry 的唯一职责

`owner-registry.json` 只登记 H01 控制面主题（evidence-contract、task-contract、capability-contract、permission-contract、trace-contract、result-contract、checkpoint-contract、ruleset-contract、epoch-contract、external-reference-contract、provider-contract）的唯一 active owner。不登记业务页面、业务事实或 Memory owner。同一 active topic 存在多个 owner 时，validator 输出 `OWNER_CONFLICT` 并列出全部候选 owner 与来源引用。

## Incident / Fixture / Rule Admission 最小引用

Incident、Fixture、Rule Admission、Run、Oracle、Adapter 在 H01 只通过 `external-reference.schema.json` 保存最小引用（ID、kind、locator、来源），不承载对象正文。H01 只校验引用格式；对象是否已存在由 H04/M2 处理。

## 后继责任

- H02：Provider 接口、Runner、Trace 与最小可重放链路。
- H02A：目标模型与独立 Judge 的真实调用探测、smoke、epoch 生成（本批禁止提前调用）。
- H04：Fixture suite 与 Oracle 身份。
- M0：Memory 连续性（独立支线，本目录不消费）。

## 运行 H01 验证

```bash
npm run harness:contracts:validate -- --fixtures tests/harness/contracts/fixtures
node --test tests/harness/contracts/*.test.js
```

第一条输出稳定 JSON 摘要并校验全部正反例；第二条执行 CT-01 至 CT-26 父测试。
