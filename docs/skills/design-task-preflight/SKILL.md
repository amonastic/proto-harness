---
name: design-task-preflight
description: 在执行任何设计稿、页面、抽屉、需求文档、规则或原型改动之前使用。在改文件之前先识别信息缺口、规则冲突、范围蔓延与执行风险。
---

# Design Task Preflight

Execution gate for this design稿系统仓库. Use this skill after `AGENTS.md` is read and before modifying pages, drawers, docs, scripts, or rules.

## Trigger

用户提出或暗示以下情形时使用本 skill：

- 新增页面、修改页面、微调、既有功能新增、0-1 新功能
- 修改需求抽屉、CSS 规范抽屉、需求文档、页面登记、规则文件
- 复刻改造、`design over` 打标、落文档、执行方案
- "按这个改 / 直接做 / 开始改 / 执行 / 继续"

用户仍处于讨论、评审、方案对比或头脑风暴阶段时，不得改文件。只输出审查结论，等待明确的执行意图。

## Required Checks

1. Classify the task:
   - `0-1 新功能`
   - `既有功能新增`
   - `微调`
   - `纯需求抽屉`
   - `复刻改造`
   - `design over`
   - `普通迭代`
2. Confirm platform and page type when relevant:
   - platform: `web` / `app` / `miniapp`
   - page type: `platform-entry` / `iteration-index` / `portal-index` / `module-page`
   - if adding/copying/replicating a page, classify page placement as `source-page`, `iteration-reference`, or `snapshot`
3. Confirm execution basis:
   - user request in this turn
   - existing page/design稿/code
   - requirement/rule/interface document
   - confirmed mature page `clone-source`
4. Check workspace and relay safety:
   - run or inspect `git status --short` before file execution
   - list target files, existing non-turn changes, and forbidden-to-touch paths
   - if relay docs, previous AI conclusions, executor replies, or old reviews are present, separate them into `用户已确认` / `执行者声称` / `本地已验证` / `未验证` / `已废弃或用户否定`
   - do not treat executor claims or unverified relay content as implementation facts
   - make sure each required file has a one-sentence readback explaining its constraint for this turn; if unreadable, state the failure and fallback
5. Build the new-page and iteration-reference contract when relevant:
   - required when creating a new page, copying a page, making a page visible, adding an index entry, or placing a page in an iteration index
   - decide whether the work is `source-page` or `iteration-reference`; iteration indexes are references/aggregators by default, not source-page authoring locations
   - for a `source-page`, list source path, platform/module index path, source directory group/label, menu/card entry, page section or `href`, `pageNames`, breadcrumb, URL parameter routing, and validation method
   - declare iteration strategy: no iteration reference, current iteration, pending schedule, or historical snapshot; if unclear, ask the user instead of guessing
   - if touching historical iterations, use the Historical Snapshot Gate before editing
   - check directory grouping consistency: group title, item label, iframe comment, `pageNames`, and footer count must not mix iterations such as `202605` with `06上`
6. Build the page adjustment contract when relevant:
   - required when the task touches pages, drawers, requirement descriptions, fields, buttons, states, copy, layout, cross-page synchronization, or replication
   - applies whether the current AI will edit directly or hand off to another executor
   - for each target page, list: target page, current evidence, `clone-source`, `change-type`, items to preserve, additions, deletions/hiding, movement/reordering, copy changes, field/button/state changes, defaults/empty/error states, requirement drawer sync, CSS spec sync, entry closure, forbidden additions, validation method, and open questions
   - if the contract has high-risk open questions, unauthorized deletion, unapproved real interaction, unclear cross-platform wording, or missing `clone-source`, do not edit; ask for review or clarification
   - do not treat "requirement OK", "plan OK", or "can proceed" as permission to edit without a closed page adjustment contract
7. Detect rule conflicts:
   - User asks for real interaction, but repo defaults to static prototype.
   - User asks for a new existing-feature addition but gives no version marker.
   - User asks for replication but no `clone-source` is declared.
   - User says "only drawer/doc" but the requested change implies page structure changes.
   - User says "微调" but the content is actually a feature addition.
   - User asks for `design over`, but required closure evidence is missing.
   - User, relay docs, or a previous AI says the page is `可打标`, but the current turn has not independently re-run `standards/design-over-spec.md`.
   - Page content, business modal copy, requirement drawer, downloadable template, `js/docs.js`, `需求文档.md`, relay docs, or user corrections may describe the same rule differently.
   - A new page was created in an iteration index instead of a source directory without explicit iteration-index governance scope.
   - A source page exists but is not visible in the source directory index.
   - A source page was added but the target iteration reference strategy is unknown.
   - A screenshot replication request lacks a visible-field checklist or tries to override system style without user confirmation.
   - The requirement drawer already contains historical iteration content and this turn adds new iteration copy, but no `doc-version-block` layering is planned. versionLayeringRule auto-applies in this case; do not reuse a pre-analysis contract that skipped drawer structure review. Re-check `standards/doc-spec.json` `versionLayeringRule` / `versionBlockStyleRule` before editing drawer copy.
8. Build the uncertainty and decision gate when relevant:
   - required when deciding whether to execute, upgrade harness rules, tag `design over`, add pages, inherit old conclusions, touch global resources, or handle multi-page/multi-platform work
   - list unknowns by type: technical unknown, business wording unknown, page placement unknown, historical relay unknown, user-decision unknown
   - classify the decision as `可逆`, `半可逆`, or `高污染或不可逆`
   - every unknown type must be filled as `无`, `已确认：依据`, `未确认：处理方式`, or `阻断：原因`; blank fields and vague values like "handled" or "ok" fail the gate
   - for `可逆` decisions, still fill the uncertainty ledger and scope cutting matrix; use the smallest safe patch and verify it
   - for `半可逆` decisions, require a page adjustment contract or rule-write admission before editing
   - for `高污染或不可逆` decisions, default to `需用户确认后执行`; output risks, alternatives, and user confirmation points, and do not edit unless the user explicitly authorizes this turn and no blocking unknown remains
   - produce a scope cutting matrix: must-do, defer, explicitly not-do, user-decision-needed, forbidden AI expansion, smallest validation slice
   - forbidden AI expansion must be copied into the startup forbidden scope and reported as untouched in the final response
   - the smallest validation slice must name a concrete file, page, docId, command, DOM assertion target, or rule section; vague "small scope validation" is not valid
   - if information can be found in local files, pages, rules, or commands, inspect those before asking the user
   - if an unknown affects fields, states, permissions, entries, historical snapshots, global resources, or `design over`, block execution until confirmed or scoped out
9. Detect missing information:
   - field names, state flow, platform, page entry, source directory, iteration reference strategy, version, date, clone source, interaction boundary, whether prompts/tests/acceptance items are allowed
   - for `design over`: whether a wording consistency matrix is required; if required, which sources must be checked
10. Detect scope creep:
   - adding filters, statistics bars, shortcuts, explanation cards, or new sections without authorization
   - writing requirement notes into real page content
   - implementing drawer requirement wording as real demo logic
   - rewriting or restructuring existing content without explicit permission
   - cleaning old directory groups, renaming old pages, or reordering iteration menus without a dedicated governance task
   - adding fields from a screenshot without listing how each visible field is retained, merged, renamed, or excluded

## Design Over Gate

When the task involves `design over`,打标, 可打标, 收口, or design-over relay work:

- Do not inherit `可打标` from relay docs, previous AI conclusions, audit summaries, or old review notes.
- Re-read `standards/design-over-spec.md` and decide the conclusion in the current turn.
- Before editing, output whether a wording consistency matrix is required.
- The matrix is required whenever the page has any of: real page copy, business modal copy, import/download template, xlsx/csv headers, requirement drawer, CSS spec tab, standalone `js/docs.js`, `需求文档.md`, relay docs, or explicit user corrections.
- If required, list the exact sources to compare before editing.
- If any user-confirmed rule conflicts with old page/template/drawer copy, mark the old copy as a blocking issue and fix all affected sources or keep the conclusion as `不可打标`.

## Historical Snapshot Gate

改动任何历史迭代或快照相关内容之前，先过本闸门：

- Trigger when modifying `迭代索引/*.html`, `迭代索引/snapshots/**`, running `npm run cache:bust:write`, or touching a source page that is referenced by historical iteration pages.
- Treat historical snapshots as higher priority than the current business request. If pollution is found, stop the current business work and report the snapshot issue first.
- Before editing, list a snapshot protection matrix:
  - target iteration: latest or historical
  - iframe source type: live source page or `snapshots/{迭代}/`
  - snapshot path and whether the file exists
  - frozen docs source: local `docs.js` / `doc-panel.js` or other stable source
  - metadata: `snapshot-of`, `snapshot-iteration`, `snapshot-date`
  - resource existence: local HTML/CSS/JS/images/templates used by the snapshot
  - index consistency: menu `data-page`, iframe `page-*`, `pageNames`
  - footer count: `共 N 个页面` vs menu `data-page` count
- `cache:bust:write` is only allowed to update local version query strings. It must not change iframe targets, `docId`, docs source, menu structure, or snapshot semantics.
- For snapshot governance tasks, plan to run `npm run audit:snapshots`; run `npm run audit:snapshots:all` when the task is explicitly about full historical debt.

## Screenshot Replication Gate

用户提供截图、或要求按截图复刻/还原时，先过本闸门：

- Declare the screenshot as `visual clone-source`, then decide whether it is a repository page, online page, external/competitor page, rough annotation, or unknown source.
- Before editing, produce a matrix with:
  - screenshot-direct items: layout order, visible fields, button count/copy, labels, list columns, form items, visible business copy
  - system-adapted items: spacing, typography, colors, icons, density, drawers, right-side controls, responsive behavior
  - not-a-fact items: APIs, permissions, state flows, formulas, data source, true interaction logic
  - open questions
- Every visible field/button/label must be marked as keep, merge, rename, or exclude with reason. Do not summarize omissions as "replicated from screenshot".
- Unless the user explicitly asks for 1:1 visual copy, preserve the screenshot information structure while adapting visuals to the current platform style.

## Output

Use this structure before execution:

```text
## 执行前审查

结论：可直接执行 / 需用户确认后执行 / 暂不能执行
任务类型：
平台与页面类型：
执行依据：
已读取规则：
读后回执：
脏工作区检查：
接力材料分层：
新增页面与目录引用契约：
源目录入口闭环：
迭代引用策略：
页面调整契约：
抽屉版本区块检查（已有历史内容 + 新增迭代 → 必须 doc-version-block 分层）：
复用页面 clone-source：
change-type：
截图复刻矩阵：
是否继承历史 design over 结论：
是否需要口径一致性矩阵：
矩阵核对来源：
历史快照保护矩阵：
不确定性台账：
决策类型：
范围裁剪矩阵：
最小验证切片：
闸门空跑检查：

发现的缺口：
发现的冲突：
越界风险：
建议默认口径：
需要用户确认的问题：
下一步执行方案：
```

提问要聚焦。答案能在现有文件里查到的，先查文件，不要反问用户。
