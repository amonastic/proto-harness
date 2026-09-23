# Skills 索引

本目录收纳可复用的 AI 工作流 skills。每个 skill 是一个目录，内含 `SKILL.md`（结构：frontmatter 的 `name` / `description` + 正文）。

## 随仓库提供的 skills

| Skill | 触发场景 | 边界 |
| --- | --- | --- |
| [`independent-judgment`](independent-judgment/SKILL.md) | 判断需求、方案、规则口径、取舍 | 先查前提、冲突与证据，不顺着用户话术下结论 |
| [`design-task-profiles`](design-task-profiles/SKILL.md) | 任务画像：0-1 / 纯抽屉 / design over / 既有功能新增 / 微调 / 复刻改造 | 套用对应画像，控制版本标记、抽屉范围与收口边界 |
| [`design-task-preflight`](design-task-preflight/SKILL.md) | 页面、抽屉、文档、规则、脚本修改前 | 先查任务类型、依据、缺口、冲突、越界风险，再决定能否动手 |
| [`implementation-self-audit`](implementation-self-audit/SKILL.md) | 执行修改完成后、最终回复前 | 自查范围、静态原型边界、版本标记、抽屉规则、校验结果 |
| [`engineering-diagnose`](engineering-diagnose/SKILL.md) | bug、页面异常、脚本或机检失败、性能回退 | 先建立可复现反馈环，再最小修改 |
| [`engineering-zoom-out`](engineering-zoom-out/SKILL.md) | 陌生模块、页面族、规则体系、脚本链路的上层理解 | 输出结构图与依据，不默认深入单模块 |
| [`engineering-plan-grill`](engineering-plan-grill/SKILL.md) | 方案评审、需求质询、执行前确认 | 讨论态不改文件，结论必须标依据 |
| [`engineering-slice-plan`](engineering-slice-plan/SKILL.md) | 拆任务、拆 issue、拆迭代、拆执行包 | 默认只输出任务拆分，不创建 issue |
| [`neat-freak`](neat-freak/SKILL.md) | 实现后的知识收尾：代码 / 文档 / 规则 / 记忆对齐 | 只在用户明确要求收尾时写入，普通「整理一下」只做只读审计 |

## 未随仓库提供的 skills

以下 skill 在部分私有环境中被规则引用，但来源与许可未在本仓库核实，**不随仓库分发**；如你的环境已合法持有，可自行安装到工具适配层：

- `design-taste-frontend`：前端视觉方向与反模板化设计检查
- `ui-ux-pro-max`：可检索的 UI/UX 设计数据库

## 来源与许可

部分 skill 改编自以下 MIT 许可项目（版权归原作者，许可条款见 [`NOTICE`](../../NOTICE)）：

- [mattpocock/skills](https://github.com/mattpocock/skills)（`Copyright (c) 2026 Matt Pocock`）：engineering 系列与任务画像系列沿用其工程化思路并按本仓库规则改造。
- [KKKKhazix/khazix-skills](https://github.com/KKKKhazix/khazix-skills)（`Copyright (c) 2026 数字生命卡兹克`）：`neat-freak` 基于其 v3.0 思路适配。

## 在工具环境中的使用方式

- **支持 Agent Skills 标准的工具**（Claude Code、Codex、CodeBuddy 等）：把需要的 skill 目录复制或软链到对应工具的技能目录（如 `.claude/skills/`、`.codex/skills/`）。
- **不支持 skill 机制的工具**：直接把对应 `SKILL.md` 作为提示词载入；口径与边界以正文为准。
- skill 只提供流程与检查框架，不构成文件修改授权；是否允许改文件仍按 `AGENTS.md` 与 `standards/授权词表.md` 判断。
