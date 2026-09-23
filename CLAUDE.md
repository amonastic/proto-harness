> 生成自 AGENTS.md，勿单独编辑；修改请改母本后同步。

# Claude 项目入口

- 默认使用中文回复；所有对用户可见回复正文必须以「山」开头，具体口径以 `AGENTS.md` 为准。
- `AGENTS.md` 是本仓库唯一主入口，本文件只做 Claude 工具接入，全部内容让位于 `AGENTS.md`。
- 执行任务时按 `AGENTS.md` 路由到 `harness/`、`DEVELOPMENT.md` 与 `standards/*`，不得把本文件扩写成平行规则。

## 最小读取链

1. `AGENTS.md`（唯一主入口）
2. `harness/00-执行总入口.md`、`harness/01-强制闸门.md`
3. 按任务类型继续读取 `harness/README.md` 的路由表
4. 涉及页面实现时读 `DEVELOPMENT.md`；涉及机检口径时读 `standards/*`

## 工具适配说明

- `docs/skills/` 下的 skills 为通用流程资产；若当前 Claude 工具环境提供原生 skill/plugin 机制，可将其作为 skill 载入，但不得改变其中口径。
- 本文件不承载业务事实、不承载未确认结论；发现本文件与 `AGENTS.md` 冲突时，一律以 `AGENTS.md` 为准。
