---
name: engineering-diagnose
description: 排查缺陷、页面异常、校验脚本失败、UI 审计失败、构建报错、性能回退，或用户报告任何不对劲的情况时使用。改文件之前先建立可复现的反馈回路。
---

# Engineering Diagnose

Disciplined debugging for this design稿系统仓库. Adapted from `mattpocock/skills` `diagnose`, with this repo's `AGENTS.md` rules taking priority.

## Trigger

用户说出或暗示以下内容时使用本 skill：

- 页面异常、打不开、样式错位、交互不生效
- `npm run lint:ui`、`audit:ui`、`check:ui`、`audit:docs`、`check:all` 失败
- 脚本、登记、机检、构建、性能、浏览器控制台报错
- "debug / diagnose / 定位 / 排查 / 为什么失败"

## Required Start

Before editing, state:

- Files you expect to inspect or change
- Rule files already read
- Reused mature page, if a page/drawer/CSS/header/level/close-button change is involved
- Execution basis
- Whether this turn may add interactions, prompts, tests, or acceptance items

用户仍处于讨论或评审阶段时，不得改文件。只输出理解、影响范围、计划与待确认项。

## Loop

1. Build a feedback loop first.
   Prefer the narrowest runnable signal: existing npm command, one script invocation, browser reproduction, DOM assertion, or screenshot comparison.
2. Reproduce the reported symptom.
   Confirm it matches the user's issue, not a nearby failure.
3. Form 3-5 ranked hypotheses.
   Each hypothesis must predict what evidence would confirm or falsify it.
4. Instrument minimally.
   Use targeted checks. Temporary debug markers must be searchable and removed before final.
5. Fix only the confirmed cause.
   Keep the patch minimal and protect unrelated user changes.
6. Verify with the original feedback loop.
   Report commands run and any residual risk.

## Repo-Specific Signals

Use these when relevant:

- `npm run lint:ui`
- `npm run audit:ui`
- `npm run check:ui`
- `npm run audit:docs`
- `npm run check:all`
- Specific scaffold/register commands only when the task touches registration or generated page structure

## Boundaries

- Do not invent business rules to make a test pass.
- Do not add mock business logic unless the user explicitly asks.
- Do not rewrite whole pages or scripts unless the user explicitly asks for a rewrite.
- For page/drawer/CSS/header/level/close-button work, declare `clone-source` before editing.
