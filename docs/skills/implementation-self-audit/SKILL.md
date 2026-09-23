---
name: implementation-self-audit
description: Use after modifying pages, drawers, requirement docs, rules, scripts, or prototype files. Verify scope, static-prototype boundaries, version markers, drawer rules, commands, and new-vs-existing issues before final response.
---

# Implementation Self Audit

Completion gate for this design稿系统仓库. Use this skill after edits and before the final response.

## Trigger

Use this skill after any change to:

- HTML/CSS/JS prototype pages
- requirement drawers or CSS specification drawers
- `需求文档.md` or module docs
- `AGENTS.md`, `DEVELOPMENT.md`, `standards/*`, scripts, templates, or skill files
- page registration, iteration index, or `design over` state

## Checks

1. Scope control:
   - Were only declared files changed?
   - Were unrelated user changes preserved?
   - Did the patch avoid broad rewrite unless explicitly requested?
   - Did the final diff avoid reverting, overwriting, or tidying pre-existing non-turn changes?
   - If the workspace was dirty before execution, were target files and forbidden-to-touch paths reported?
   - If relay docs, previous AI conclusions, executor replies, or old reviews were used, were they separated into `用户已确认` / `执行者声称` / `本地已验证` / `未验证` / `已废弃或用户否定` before implementation?
   - Stop and fix before final if executor claims or unverified relay content were written as page, drawer, interface, permission, or `design over` facts.
   - If the task touched pages, drawers, requirement descriptions, fields, buttons, states, copy, layout, cross-page synchronization, or replication, was a page adjustment contract produced before editing?
   - If the task created, copied, replicated, surfaced, or iteration-linked a page, was a new-page and iteration-reference contract produced before editing?
   - Stop and fix before final if the implementation added fields, entries, states, interactions, explanation cards, test items, acceptance items, or drawer content outside the page adjustment contract.
   - Stop and report before final if any contracted item was not implemented or not verified.
   - Stop and report before final if a source page was added but no source directory entry or explicit "do not link source directory" decision exists.
   - Stop and report before final if an iteration reference was added without a declared iteration strategy, or if a historical iteration references a live source page.
2. Static prototype boundary:
   - Only page navigation, modal open/close, drawer open/close, and tab switching were added or preserved by default.
   - No unauthorized mutual disabling, dynamic visibility, realtime validation, dependent state switching, or mock business logic was added.
3. Page/document boundary:
   - No requirement notes, version summaries, dev notes, test prompts, mock-operation text, scene switchers, or design-only controls were placed inside real page content, business modals, business drawers, or requirement drawer body.
4. Drawer and doc rules:
   - Drawer-first vs `md-required` choice matches repo rules.
   - Requirement drawer structure is light unless complexity requires otherwise.
   - CSS specification drawer remains available when required.
   - If requirement drawer content was changed, the final content was checked against the declared mature source, not only against whether the drawer opens.
   - Shell integration and content structure are reported separately: `doc-panel.js`, `DocPanel.toggle/autoShow`, button position, and drawer width do not prove the requirement drawer body is compliant.
   - No executor notes, testing prompts, development notes, prototype-only limits, or debugging remarks were placed inside the requirement drawer body.
   - For multi-platform versions of one requirement, the drawer section skeleton is consistent across platforms unless a concrete platform difference is stated.
5. Existing-feature addition rules:
   - New content has inline version markers when required.
   - Existing entries remain intact.
   - New markers are beside concrete fields/rules/boundaries, not only in a top summary.
6. Micro-adjustment rules:
   - No version marker was added for unreviewed-page micro-adjustments.
7. Replication and baseline:
   - `clone-source` and `change-type` were declared when required.
   - `safe-add` did not sneak in new filters, statistics bars, shortcuts, explanation cards, or sections.
   - For screenshot replication, the visible field/button/label matrix was checked, and each visible item was kept, merged, renamed, or excluded with a reason.
   - Screenshot visuals were adapted to the current platform style unless the user explicitly approved 1:1 visual copying.
8. Validation:
   - Run the narrowest relevant command, usually the read-only `npm run check:ui:readonly`; use `npm run check:ui` only when page registration write-back is explicitly needed.
   - Run `npm run audit:docs` when md requirement docs or doc audit rules are involved.
   - Distinguish new issues from existing repository issues.
   - For `design over`, verify the conclusion was not inherited from relay docs or a previous AI result; it must be re-evaluated in the current turn.
   - If a wording consistency matrix was required, verify all matrix sources were checked: page copy, business modal copy, templates/xlsx/csv headers, requirement drawer, CSS spec tab, standalone docs data, relay docs, and user corrections as applicable.
   - Stop and fix before final if any user-confirmed field, required/optional flag, default value, failure rule, empty-value rule, follow-up chain, or confirmed non-requirement still conflicts across page/template/drawer/docs.
9. Entry visibility:
   - If a page was added, repaired, or made visible to developers, confirm it is reachable from its intended platform/module/iteration entry.
   - For iframe-based index pages, verify nav item, page section/iframe, `pageNames`, and URL parameter routing are all present.
   - For module index pages, verify module navigation links and target pages both exist.
   - Do not treat `standards/ui-spec.json` registration or iteration-index presence as proof that the platform directory entry is visible.
   - If a source page was added, confirm the source directory group and item label match the declared iteration; do not leave `202606上` items inside a `202605` group.
   - If the page is not linked to an iteration, final response must say "not linked to iteration" and provide the basis or pending user decision.
   - If an iteration reference was added, confirm whether it points to a live source page for the latest iteration or a frozen `snapshots/{迭代}/` file for historical iterations.
10. Manual upload delivery:
   - If the project is updated online by manually uploading files, list every changed file required for the online environment.
   - If requirement drawers or descriptions are loaded from `js/docs.js` or another separate resource, list that file separately.
   - Distinguish “fixed locally” from “effective online after upload.”
11. Historical snapshot completion gate:
    - If `迭代索引/*.html`, `迭代索引/snapshots/**`, cache-bust output, or a source page referenced by historical iterations was changed, run `npm run audit:snapshots`.
    - For dedicated snapshot governance work, also run `npm run audit:snapshots:all` or report why the full debt scan was not run.
    - Stop and fix before final if a touched historical iteration still iframes a live source page instead of `snapshots/{迭代}/`.
    - Stop and fix before final if a touched snapshot lacks `snapshot-of`, `snapshot-iteration`, or `snapshot-date`.
    - Stop and fix before final if a touched snapshot still reads mutable three-end `js/docs.js` or `js/doc-panel.js` for requirement content.
    - Stop and fix before final if menu `data-page`, iframe `page-*`, `pageNames`, or footer page count is inconsistent in a touched iteration index.
    - Final response must list touched historical snapshot files and frozen docs dependencies when historical snapshots are involved.
12. Requirement drawer hard failures:
    - Stop and fix before final if any target drawer still has only bare `h3 + ul + table` while the mature source uses rule cards or structured tables.
    - Stop and fix before final if the drawer body contains implementation-only phrases such as "不实现真实上传", "只展示步骤头", "测试提示", "开发备注", "模拟操作", or "仅设计稿可见".
    - Stop and fix before final if old or abandoned requirement wording is repeatedly negated instead of stating the current valid rule.
    - Stop and fix before final if a field-dense three-column table uses equal/default widths so the first field-name column is too wide or the third input-limit/explanation column is squeezed; require semantic column widths, nowrap first column, wider explanation column, or convert to rule cards / `doc-rule-line`.
    - Stop and fix before final if the final response says "抽屉样式已修复" but only the shell integration was changed.
13. Requirement drawer business completeness:
    - Stop and fix before final if filters, form fields, import fields, or switches lack default values.
    - Stop and fix before final if a checkbox-style control is single-choice in business behavior but the drawer does not state that distinction.
    - Stop and fix before final if long text fields lack max length, overflow display, hover tooltip, or copy behavior where the requirement has confirmed it.
    - Stop and fix before final if duplicate validation or permission scope uses an unsupported scope such as merchant/site/account/company without evidence.
    - Stop and fix before final if cancel/delete/disable actions lack a concise second-confirmation requirement.
    - Stop and fix before final if required operation logs lack timestamp source, operation content, account source, display location, or action-column behavior.
    - Stop and fix before final if current-package marker removal and backend rule cancellation are mixed into one ambiguous rule.
    - Stop and fix before final if filter sections add filler query columns such as "query by this field" for every field instead of only controls, defaults, input limits, data source, reset, and empty-result behavior.
    - Stop and fix before final if the drawer invents nonexistent default values, default pricing, default amounts, default brands, or reverse wording such as "does not apply default pricing" where the confirmed rule is only "blank".
    - Stop and fix before final if list-field sections include validation, required/optional, import failure, duplicate detection, follow-up-chain, or pricing rules that belong in form/import/action sections.
14. Design over hard gate:
    - Stop and fix before final if `可打标` is based on a relay handoff, old review conclusion, or previous AI statement instead of current verification.
    - Stop and fix before final if the page has import/download/template/modal/drawer/docs content but no wording consistency matrix was performed.
    - Stop and fix before final if a confirmed user correction remains as `待确认`, or if a user-rejected capability remains in any page/template/drawer/docs source.
    - Stop and fix before final if template headers, visible instructions, and requirement drawer disagree on field order, required marks, default values, failure handling, or empty-value behavior.

## Final Report

Use this structure when relevant:

```text
## 完成后自查

修改范围是否符合声明：
是否保留已有非本轮改动：
读后回执是否完成：
接力材料是否已分层：
是否把未验证接力内容写成事实：
页面调整契约是否完成：
新增页面与目录引用契约是否完成：
源目录入口闭环是否完成：
迭代引用策略是否明确：
契约覆盖项：
契约外新增项：
契约未覆盖项：
是否存在未授权新增：
文档/抽屉是否符合规则：
抽屉外壳与正文结构是否分别自查：
是否命中需求抽屉硬失败项：
业务规则完整性是否符合抽屉硬控：
是否重新执行 design over 判断：
口径一致性矩阵是否完成：
页面/弹窗/模板/抽屉/文档是否一致：
版本标记是否正确：
截图复刻矩阵是否核对：
静态原型边界是否遵守：
历史快照保护是否通过：
触达的历史快照文件：
冻结的需求说明依赖：
已运行命令：
本次新增问题：
仓库存量问题：
未运行检查项及原因：
线上手动上传清单：
待确认项：
```

If a violation is found, fix it before final whenever feasible. If it cannot be fixed safely, report the blocker clearly.
