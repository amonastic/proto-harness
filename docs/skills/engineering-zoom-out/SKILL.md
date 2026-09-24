---
name: engineering-zoom-out
description: 改动之前，用户要求先理解某个模块、目录、页面族、规则体系、脚本或不熟悉的代码区域时使用。产出相关文件、职责、依赖与风险的简明地图。
---

# Engineering Zoom Out

High-level orientation for unfamiliar parts of this repository. Adapted from `mattpocock/skills` `zoom-out`, with this repo's rule hierarchy first.

## Trigger

用户提出以下问题时使用本 skill：

- "先看看 / 先理解 / zoom out / 整体分析 / 这个模块怎么回事"
- To locate files, page ownership, module boundaries, scripts, standards, or AI rules
- Before changing a page family, workflow, standards file, or automation script

若将有大范围实现且涉及的区域不熟悉，也在动手前使用本 skill。

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
