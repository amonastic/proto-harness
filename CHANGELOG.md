# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.1.0

首个公开版本。从内部设计稿仓库抽出的治理工作流内核，示例项目为完全虚构内容。

### 新增

**规则层**

- `AGENTS.md` 作为 AI 协作唯一主入口：对话握手、执行状态判定、开工闸门、交付边界、高风险红线（T0 未授权重构 / T-1 历史快照不可污染）。
- `harness/` 分卷细则：`00` 执行总入口、`01` 强制闸门（29 条 + 三级分级表）、`02` 纠偏与接力、`03` 任务契约、`04` 规则准入与治理、`05` 验证与交付、`10` 页面与抽屉执行、`20` 协作 Prompt 模板；配套 4 个角色正文与 8 份专项规则。
- `docs/skills/` 9 个可复用工作流 skill（诊断、放大视角、方案质询、任务拆解、开工前审查、实现后自查、独立判断、任务画像、知识收尾）。

**标准层**

- `standards/` 结构化机检口径：页面登记 `ui-spec.json`、抽屉结构 `doc-spec.json`、页面保护与复刻边界 `page-baseline-spec.json`、平台规则、设计 token、规则映射 `rule-map.json`、授权词表。

**工具层**

- `scripts/` 零第三方依赖的 Node 治理脚本：结构机检 `lint-ui`、一致性审计 `audit-ui`、页面自动登记、脚手架、缓存 hash 刷新、本地静态服务、搜索索引、需求分组导出、快照与版本标记治理审计。
- Harness 治理机制自身的一整套链路：契约校验、语料构建与 oracle、准入矩阵、影子对比、能力探测、跨会话恢复、切换检查。
- `assets/js/components/doc-panel.js` 需求文档抽屉组件：页面声明 `window.DocsData` 后一个按钮即得「需求文档 / CSS 规范」双 Tab 抽屉。

**示例与验证**

- 三端虚构示例项目：`admin-portal/`（Web 模块页 + 列表页）、`field-app/`（移动端手机模型 + 右侧控制区）、`mini-program/`（小程序页），以及 `迭代索引/` 与根总导航。
- `tests/harness/` Node 原生测试 321 项（282 执行 / 39 跳过），覆盖治理机制自身行为回归。
- GitHub Actions CI：Node 18 / 20 / 22 矩阵，跑 `check:ui:readonly` 与全量测试，并在收尾断言「一次验证运行不得改动受跟踪文件」。

### 设计取舍

- **核心链路零第三方依赖**：`npm install` 不是使用本项目的前置步骤。唯一的可选依赖 `docx` 声明在 `optionalDependencies`，只服务于 `npm run convert:docx`。
- **不提供部署与上传能力**：本仓库不含部署配置、服务器地址或上传脚本；分发与缓存策略由使用方环境自持。
- **不设 `files` 白名单**：`npm pack --dry-run` 实测收录 325 项、约 951 kB，无运行时目录与敏感文件。测试、示例与标准都是这个内核的交付物，白名单只会造成遗漏，因此刻意不加。


### 已知限制

- `node --test` 的 glob 形式自 Node 21 起才支持；CI 与文档统一使用无参自动发现，以兼容 Node 18 / 20。
- `tests/harness/fixtures/corpus/corpus.json` 是一份**自洽的合成夹具**，不是从当前仓库扫描得到的产物：它引用了 8 个本仓库并不存在的页面路径，因此 `npm run harness:corpus:build` 无法复现它（重跑会塌成 1 个 fixture）。要恢复可复现性，需要先扩充虚构示例的模块数量。
- `assets/css/font-awesome.min.css` 有 7 个字体 URL 指向未打包文件，加载时产生控制台 404；图标渲染不受影响（`font-awesome-local.css` 定义了同一批字体族）。详见 [`NOTICE`](NOTICE)。
- `harness/rules/Web后台风格基线.md` 描述的多个后台目录在示例中并不存在，属于文档超前于示例内容。
- 需求导出（`export:requirement`）、`docx` 转换等能力面向特定目录约定，接入自有项目时需按 `governance.config.json` 重新声明范围。
