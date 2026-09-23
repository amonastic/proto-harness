---
name: design-task-profiles
description: Use when a task is described as 0-1 new feature, pure requirement drawer change, design over check, existing-feature addition, micro-adjustment, regular iteration, or replication change. Applies the matching task profile and constraints.
---

# Design Task Profiles

Task-profile rules for this design稿系统仓库. Use after `AGENTS.md` and before implementation planning.

## Trigger

Use this skill when the user mentions or implies:

- `0-1`、新功能、独立模块
- 纯需求抽屉、只改抽屉、不改页面结构
- `design over`、打标、收口检查
- 既有功能新增、已上线页面新增能力
- 新增规则、追加规则、新增迭代增量（抽屉已有历史说明时自动套版本区块分层）
- 微调、持续修补、未评审页面修补
- 普通迭代、复刻改造、沿用既有页面

Also use it when the task type is unclear and choosing the wrong profile could change version markers, docs scope, or implementation scope.

## Shared Rules

- Start from `AGENTS.md`; read `DEVELOPMENT.md` and `standards/*` only as the task requires.
- Default to static prototype. Keep only page navigation, modal open/close, drawer open/close, and tab switching unless the user explicitly asks for more.
- Drawer wording describes requirements; it does not require implementing real demo functionality.
- Real page content, business modals, business drawers, and requirement drawer bodies must not contain dev notes, test prompts, mock-operation text, or design-only instructions.
- If evidence is missing, mark it as `待确认` instead of inventing a fact.

## Profiles

### 0-1 新功能

- May create a new page or module structure when supported by the requirement.
- Use `md-required` only for large requirements, cross-page work, independent 0-1 modules, or explicit user request; otherwise prefer `drawer-first`.
- Do not implement real business logic, dynamic visibility, realtime validation, mutual disabling, or mock workflows unless explicitly requested.
- Confirm platform, page type, module ownership, and entry relationship before editing.

### 纯需求抽屉

- Only modify requirement drawer content.
- Do not change page structure, business UI, navigation, or interaction code.
- Simple pages use: `页面内容 / 交互规则 / 边界说明`.
- Complex pages use: `核心流程 / 状态与分支 / 字段说明 / 交互规则 / 异常与边界 / 待确认项`.
- Do not add test notes, acceptance criteria, role/entry chapters, or heavy template sections unless explicitly requested.
- Merge into the existing drawer structure; do not create a new tab without evidence.

### design over 检查

- First verify whether the module/page meets `design over` rules.
- Do not directly tag unless the user explicitly allows tagging and the evidence supports it.
- Output: 可打标、暂不可打标、阻塞原因、需补齐项、仓库存量问题、本次新增问题.
- If only small closure work is missing, propose the scope first and wait for confirmation before editing.

### 既有功能新增

- Preserve existing page structure and existing requirement wording.
- Add only the minimum necessary content.
- All new content must use inline version markers when a version is provided:
  - iteration-level: `[本期新增｜202605上]`
  - dated addition: `[本期新增｜202605上｜20260523]`
- Put markers beside concrete fields, rules, states, or boundaries.
- Do not rely on a top summary to carry version meaning.
- Do not create a new tab by default; merge into the existing drawer.
- Field additions go beside `字段说明`; interaction changes go beside `交互规则`; state/boundary changes go beside `异常与边界`.

### 迭代增量 · 需求抽屉版本区块分层（持续迭代页面默认命中）

- When a page's requirement drawer already has historical content and the user asks to add a new rule / iteration increment / new iteration content, automatically apply version-block layering per `standards/doc-spec.json` `versionLayeringRule`; do not wait for the user to repeat the expand/collapse rules.
- Do not ask the user to re-describe the block behavior. Automatically: new iteration block at top, `state: 'current'`, `defaultOpen: true`, badge `当前展开`; historical blocks below, `state: 'history'`, `defaultOpen: false`, badge `历史收起`.
- The current iteration block may only contain this iteration's additions / adjustments / deletions / migrations / renames / field changes / entry changes / permission changes / import-export changes. It must NOT contain unchanged historical flows, old interface chains, old buttons, baseline explanations, or old reference docs.
- Historical requirements and 0-1 baseline stay in their own collapsed block, original wording preserved; do not rewrite or compress them.
- Use `buildVersionedRequirementDoc` structure (`doc-version-block` / `doc-version-block-current` / `doc-version-badge` / `doc-version-body`); do not replace it with plain titles, scattered tags, or disabled gray blocks.
- If the page drawer has no historical version-block structure yet, first convert the existing content into a collapsed historical block, then add the new current iteration block.
- Reference mature examples: `mini-program/main/js/docs.js`, `field-app/main/js/docs.js`, `field-app/station-ops/js/docs.js`, `admin-portal/asset-admin/js/docs.js`.

### 微调

- Treat as continued repair of an unreviewed page.
- Do not write any version marker.
- Do not add test items, acceptance items, dev notes, or version summaries.
- Do not expand the scope into restructuring or new feature work.
- Fix only the explicitly identified issue; list related discoveries as `待确认`.

### 复刻改造

- Declare `clone-source` and `change-type` before editing.
- `safe-add` only allows new fields, new tags, or compact rearrangement without semantic change.
- `safe-add` does not allow adding filters, statistics bars, shortcuts, explanation cards, or new module sections without explicit permission.

## Output

When this skill changes the execution path, state:

```text
任务画像：
适用规则：
不允许做的事：
需要确认：
执行依据：
```
