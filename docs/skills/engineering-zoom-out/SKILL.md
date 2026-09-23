---
name: engineering-zoom-out
description: Use when the user asks to understand a module, directory, page set, rule system, script, or unfamiliar code area before making changes. Produce a concise map of relevant files, responsibilities, dependencies, and risks.
---

# Engineering Zoom Out

High-level orientation for unfamiliar parts of this repository. Adapted from `mattpocock/skills` `zoom-out`, with this repo's rule hierarchy first.

## Trigger

Use this skill when the user asks:

- "先看看 / 先理解 / zoom out / 整体分析 / 这个模块怎么回事"
- To locate files, page ownership, module boundaries, scripts, standards, or AI rules
- Before changing a page family, workflow, standards file, or automation script

Also use before major implementation if the affected area is unfamiliar.

## Output Shape

Keep it concise and evidence-based:

- **Scope**: directories/files inspected
- **Map**: relevant modules/pages/scripts and what each does
- **Flow**: how data, navigation, validation, or rules connect
- **Constraints**: rules from `AGENTS.md`, `DEVELOPMENT.md`, or `standards/*`
- **Risks**: likely blast radius and uncertain points
- **Next step**: recommended execution path or questions

## Rules

- Read `AGENTS.md` first.
- If the task is about project structure or file locating, use `project-overview`.
- If the task is about AI rules or skills, use `ai-context`.
- Do not default into a single module unless the user named it or the current task directly depends on it.
- Mark unsupported conclusions as `待确认 / 推断 / 现有文档未确认`.
