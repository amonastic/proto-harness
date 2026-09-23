---
name: engineering-diagnose
description: Use when investigating bugs, broken pages, failing validation scripts, UI audit failures, build errors, performance regressions, or any user report that something is wrong. Establish a reproducible feedback loop before changing files.
---

# Engineering Diagnose

Disciplined debugging for this design稿系统仓库. Adapted from `mattpocock/skills` `diagnose`, with this repo's `AGENTS.md` rules taking priority.

## Trigger

Use this skill when the user says or implies:

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

If the user is still discussing or reviewing, do not edit. Output understanding, impact, plan, and questions.

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
