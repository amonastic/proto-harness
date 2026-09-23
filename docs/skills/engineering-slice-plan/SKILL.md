---
name: engineering-slice-plan
description: Use when breaking a large requirement, PRD, page redesign, rule update, or governance task into executable slices. Produce thin, independently verifiable tasks aligned with this repo's static prototype and documentation rules.
---

# Engineering Slice Plan

Task decomposition adapted from `mattpocock/skills` `to-issues`. This repo does not default to publishing GitHub issues; produce an executable task list unless the user asks for issue creation.

## Trigger

Use this skill when the user asks to:

- 拆任务、拆 issue、拆迭代、落执行计划
- Convert a requirement, plan, or review result into implementation steps
- Split work across pages, drawers, docs, standards, scripts, registration, and verification

## Principles

- Prefer thin vertical slices that are independently checkable.
- Each slice should include all necessary page/doc/register/verification work for that narrow path.
- Keep `drawer-first` as the default for ordinary iteration pages.
- Use `md-required` only when the user requires it, the demand is large/cross-page, or the module is 0-1.
- Do not add new interactions, prompts, tests, or acceptance criteria unless allowed by the user or existing docs.

## Output Shape

For each slice, provide:

- **Title**
- **Type**: AFK-ready / needs-human-confirmation
- **Files or modules**
- **Execution basis**
- **Done when**
- **Blocked by**

Then ask for approval if the user has not already asked to execute.

## Publishing

- Do not create GitHub issues by default.
- If the user asks for issues, first confirm the tracker and label rules.
- If local markdown tasks are preferred, place them only after the user confirms the path.
