# Proto Harness Agent 完整首版总任务包

版本：1.0
日期：2026-10-21
依据：`方案/Proto_Harness_Agent_Implementation_Plan_v0.2.md`、`方案/Proto_Harness_Agent_Whitepaper_v0.2.md`
授权：用户 2026-10-21「本次明确授权按方案实施完整首版，包括必要的工程文件、真实客户端功能、交互、测试和打包配置」。

## 1 交付目标

交付一个可安装、可运行的 macOS 客户端。安装后不依赖本仓库开发环境，至少完成两条旅程：

1. 新建产品：建立业务基线、完成首项需求、处理一次规则冲突、生成需求/交互规格/HTML 原型/样式规范、形成交付版本。
2. 接入已有项目：扫描本地目录、提取带来源的候选知识、处理历史口径冲突、基于已有能力提出变更、形成交付版本。

完成定义以安装产物中的实际旅程为准。开发模式跑通、单元测试通过或安装包生成成功，均不单独构成完成。

## 2 范围

### 2.1 必做

| 编号 | 能力 | 交付物 |
| --- | --- | --- |
| E1 | 工程与运行基线 | Electron 主进程、安全 preload、渲染层、本地项目目录、打包脚本 |
| E2 | 业务数据模型 | Product / Endpoint / Evidence / BusinessObject / Capability / Rule / Baseline / Decision / Requirement / Artifact / Delivery 最小 schema 与读写 |
| E3 | 业务大脑 | 上下文选择、适用版本过滤、来源定位、提案、裁决哈希绑定、基线激活、失效标记 |
| E4 | 两种入口 | 新建产品向导、已有项目目录导入、资产扫描、候选知识提取、冲突识别 |
| E5 | 需求工作流 | 需求基线、影响分析、未知项、冲突暂停、纠偏、断点续作、下一步提示 |
| E6 | 设计与规范 | 工具无关交互规格、自包含 HTML 原型、类型化 CSS 规范（声明/模板/静态扫描来源区分）、需求映射 |
| E7 | 交付与同步 | 固定交付清单、静态站导出、资源完整性检查、Git 状态/提交/推送（用户触发） |
| E8 | 运行时 | 单一生产适配器（OpenAI 兼容 HTTP），无配置时本地启发式分析器明确标注来源 |
| E9 | 交付材料 | DMG/ZIP、安装说明、用户手册、数据格式、公开示例、第三方许可说明 |

### 2.2 明确不做

- 云端知识服务、团队权限、实时多人协同、插件市场。
- 任意代码仓库的全自动业务逆向；首版只扫描明确支持的 Markdown / 纯文本 / JSON / HTML / CSS 文本。
- 任意版式 PDF/Word 的 OCR 或完整还原；按证据附件保存。
- pen.dev 的完整双向同步；首版提供能力探测、文档绑定记录与不可用降级，不伪造设计结果。
- 真实签名、公证、自动更新、Mac App Store 分发。缺少签名凭据时只交付本地测试产物。
- 对现有设计仓库页面、迭代索引、快照、规则正文的任何改写。

## 3 工程主线与执行单元

### W1 工程与运行

- 目标模块：`apps/desktop/electron`、`apps/desktop/renderer`、`apps/desktop/package.json`。
- 输入：方案技术推荐、本机 macOS 26.6.2 arm64、Node 24。
- 输出：可 `npm start` 启动的 Electron 应用；`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 保留：仓库既有静态资产、治理脚本、`package.json` 根脚本。
- 禁止：把 Node 能力暴露给渲染层；允许渲染层直接读任意文件。

### W2 业务内核

- 目标模块：`packages/core/src`。
- 输入：项目目录、用户操作、运行时结构化结果。
- 输出：实体 CRUD、原子写入、索引重建、上下文解析、提案/裁决、基线、需求状态机、导入、产物、交付、Git。
- 保留：`standards/requirement-baseline-schema.json` 的字段语义；可增量扩展，不推翻已有字段。
- 禁止：业务内核直接调用模型；模型不得直接写权威记录。

### W3 运行时适配

- 目标模块：`packages/runtime-adapter/src`。
- 输出：统一接口 `analyzeProduct`、`analyzeRequirement`、`proposeKnowledge`、`generateInteractionSpec`；OpenAI 兼容适配器；本地启发式适配器。
- 决策：OpenCode 未安装、协议与权限行为无法在本环境验证，首版不接入；保留适配器边界。详见 `03-decisions.md`。
- 禁止：把模型原始输出直接写入规则或基线；结构校验失败时静默截断。

### W4 客户端界面与 IPC

- 目标模块：`apps/desktop/electron`、`apps/desktop/renderer`。
- 页面：我的产品、工作台、业务大脑、需求与设计、交付记录、设置；新建/接入/需求/裁决/导出流程。
- 约束：所有权威写入经 IPC 进入内核；渲染层只持有展示数据和临时表单状态。
- 交互授权：用户明确要求真实客户端功能与交互，本轮允许实现真实功能，不按静态原型边界裁剪。

### W5 验证

- 目标模块：`packages/core/test`、`packages/runtime-adapter/test`、`apps/desktop/e2e`。
- 单元测试：实体版本、哈希绑定、基准冲突、基线切换、上下文过滤、导入解析、冲突识别、交付清单、资源校验。
- E2E：两条完整旅程 + 重启恢复 + 交付导出 + Git 状态；截图存 `apps/desktop/e2e/evidence/`。
- 禁止：用 dry-run、mock 模型结果冒充真实模型调用；测试证据必须注明分析来源。

### W6 打包与安装

- 目标模块：`apps/desktop/scripts/package.mjs`。
- 输出：`apps/desktop/release/Proto Harness Agent-darwin-arm64/Proto Harness Agent.app`、`.dmg`、`.zip`。
- 方式：使用 `node_modules/electron/dist` 本地运行时，`@electron/packager` 生成 .app，`codesign --sign -` 做 ad-hoc 签名，`hdiutil` 生成 DMG。
- 边界：无 Apple Developer ID，不做公证；安装说明必须写明 Gatekeeper 处理方式，不得表述为正式签名发行。

### W7 文档与收尾

- 输出：`apps/desktop/README.md`、`docs/user-guide.md`、`docs/data-format.md`、`docs/third-party.md`、示例项目。
- 自审：范围、禁止范围、验证结果、未完成项、风险。

## 4 行为与恢复

| 行为 | 成功路径 | 失败路径 |
| --- | --- | --- |
| 新建产品 | 产品/端写入 `project.json`，候选知识进入 `brain/*`，基线 `draft/current` | 输入不足时保留草稿并列出未知项，不伪造基线 |
| 接入项目 | 扫描清单、证据、候选规则、冲突写入项目；原目录只读 | 不支持格式跳过并报告；不可读路径明确失败 |
| 提案 | 生成 `proposal_hash` 与 `base_revision`，等待裁决 | 基准变化时哈希校验失败，重新展示提案 |
| 裁决 | 绑定哈希与基准写入 Decision，更新规则版本与基线 | 重复裁决返回既有结果，不重复写入 |
| 生成产物 | 交互规格、需求文档、HTML 原型、CSS 规范、映射写入 `requirements/<id>` | 生成失败保留需求状态与错误摘要，不标记交付 |
| 交付 | 固定清单写入 `deliveries/<id>` 并导出静态站 | 资源缺失阻止完成并列出缺失项 |
| 重启恢复 | 从 `requirements/<id>/requirement.json` 恢复步骤、裁决与下一步 | 损坏文件报告路径，不自动覆盖 |
| Git 同步 | 展示脏文件，用户选择提交范围与推送 | 冲突/无远端/凭据缺失显示原因，不强制推送 |
| 外部工具不可用 | pen.dev 探测结果写入交付风险，HTML 主链继续 | 不生成伪 .pen 文件或伪成功记录 |

## 5 安装与发布

- 支持环境：macOS 13+，Apple Silicon（本机验证 macOS 26.6.2 arm64）。Intel 未验证。
- 运行依赖：Electron 运行时随包提供；模型为可选外部服务；Git 使用系统 `git`；pen.dev 可选。
- 构建：`cd apps/desktop && npm install && npm run package`。
- 产物：`release/` 下 .app、.dmg、.zip；构建元数据写入 `release/build-info.json`。
- 签名责任：正式分发需发布负责人提供 Developer ID Application 证书与公证凭据；本任务无凭据，只做 ad-hoc 签名和本机安装验证。

## 6 验证与证据

| 场景 | 执行单元 | 通过条件 | 证据 |
| --- | --- | --- | --- |
| 新建产品完整旅程 | W4/W5 | 基线→需求→冲突裁决→产物→交付全链完成 | E2E 截图 + 项目文件 + 交付目录 |
| 接入已有项目旅程 | W4/W5 | 扫描→候选/冲突→裁决→需求→产物→交付 | E2E 截图 + 扫描报告 |
| 裁决绑定 | W2/W5 | 哈希/基准不一致时拒绝应用 | 单元测试 |
| 重启恢复 | W2/W5 | 重启后任务、裁决、下一步仍在 | E2E 重启断言 |
| planned/current 分离 | W2/W5 | 新基线不覆盖当前基线 | 单元测试 + 大脑界面 |
| 交付资源完整性 | W2/W5 | 缺资源阻止交付；完整时导出可打开 | 单元测试 + 导出文件 |
| 安装产物 | W6 | 从 .app 启动并完成一次真实操作 | 启动截图/日志 |
| 不同需求生成不同页面 | W4/W5 | 报名生成表单+管理列表；工单生成看板；打印设置生成设置页 | 单元测试 + journey-3 截图 |
| 补答/保留现行规则 | W2/W5 | 补答后提案重绑可裁决；保留规则时产物不实现被否决口径 | 单元测试 + journey-3 截图 |
| 历史交付冻结与非破坏导出 | W2/W5 | 修改活产物后历史导出字节不变；旧格式拒绝重导时保留原导出；基线激活后展示快照不变 | 单元测试 + journey-3 UI 验证 |
| 已应用提案补答 | W2/W5 | 事后补答不重开提案、不改变基线、不报 STALE | 单元测试 |
| Git 精确提交 | W2/W5 | 预暂存的未勾选文件不进入提交 | 单元测试 |
| 规格忠实度 | W3/W5 | 显式 required、设置开关值与选项默认值不被模板覆盖 | 单元测试 |
| 并行计划基线 | W2/W5 | 计划基线不阻塞基于现行基线的另一项需求 | 单元测试 |
| Git 二次提交 | W2/W5 | 提交后再次修改首个文件，路径解析正确且可再次提交 | 单元测试 + journey-3 截图 |
| 模型适配器 | W3/W5 | 本地 mock HTTP 服务返回结构化结果并可解析；模型规格两页进入产物；无 key 时不冒充模型 | 单元测试 + 设置界面截图 |

未完成项与风险在最终交付中逐条列出，不自行签收。

## 7 依赖顺序

W1 → W2 → W3 → W4 → W5 → W6 → W7。W4 可在 W2 接口稳定后并行；W6 在 W1 完成即可提前验证打包链路。

## 8 现有资产复用声明

- 复用 `standards/requirement-baseline-schema.json` 的字段语义作为需求输入契约参考。
- 复用现有业务外脑「按任务输入匹配、带来源」的产品思路，不直接依赖其外部目录。
- 复用单 HTML 导出「固定版本、资源内联/完整」的交付目标，不复制其页面 DOM 抓取实现。
- 不修改、不移动、不重建现有静态页面与治理脚本。
