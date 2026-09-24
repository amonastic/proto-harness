---
name: engineering-plan-grill
description: 在执行前对需求、实现方案、页面改动、规则变更或 AI 工作流做压力测试时使用。提出针对性问题，对照仓库规则与现有页面，产出已确认的决策；讨论期间不改文件。
---

# Engineering Plan Grill

Plan stress-testing adapted from `mattpocock/skills` `grill-with-docs`. In this repo, discussion and review phases must not modify files.

## Trigger

用户要求以下事项时使用本 skill：

- 评审方案、对比方案、讨论需求、先问清楚
- Validate a page/drawer/rule/script change before implementation
- Clarify domain terms, page behavior, acceptance scope, or AI workflow changes

## Process

1. Read the relevant rule entry.
   Start from `AGENTS.md`, then branch to `DEVELOPMENT.md` or `standards/*` only when needed.
2. Check existing evidence.
   Use existing pages, design稿,需求文档,规则文档,接口文档, or confirmed clone source.
3. Ask one focused question at a time when user input is needed.
   If code or docs can answer it, inspect them instead.
4. Challenge fuzzy terms.
   Replace vague wording with repository terms: page type, platform, module, drawer-first, md-required, clone-source, change-type, design over.
5. Separate decisions from assumptions.
   Use `已确认`, `执行依据`, `待确认`, and `推断`.
6. Only write after explicit execution intent.

## Output During Discussion

Use this structure:

- 需求理解
- 影响范围
- 执行方案
- 风险与边界
- 待确认项

## Repo Boundaries

- Do not create ADRs or `CONTEXT.md` automatically.
- Do not update requirement docs during discussion.
- Do not add interactions, testing items, or acceptance items unless explicitly allowed.
- For visual masking requests, stop after locating scope and proposing a plan; wait for confirmation.
