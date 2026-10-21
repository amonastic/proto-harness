# 实施决策记录

只记录会影响实现路径、可逆性或交付口径的选择；普通实现细节不在此重复。

## D1 渲染层采用原生 ES Modules，而非 React/TypeScript 构建链

- 决策：Electron 渲染层使用原生 HTML/CSS/ES Modules；业务内核为 Node ESM + JSDoc。
- 理由：方案将 React/TS 列为推荐默认，但本任务要求最小充分实现并交付可安装产物。原生方案不引入 Vite/TS 编译链，安装与打包路径更短，仍可被 Playwright 与 node:test 验证。
- 影响：组件复用依靠模块导出，不依赖框架；若后续需要 React，可替换渲染层而不改内核。
- 可逆性：可逆。

## D2 首版生产运行时选择 OpenAI 兼容 HTTP 适配器

- 决策：实现统一运行时接口，生产适配器为 OpenAI 兼容 `/chat/completions`；不接入 OpenCode。
- 理由：本机未安装 OpenCode，无法验证其版本、权限边界与恢复行为；方案明确允许在必要条件无法满足时切换适配器，且不改变项目数据格式。
- 影响：支持 DeepSeek、OpenAI 兼容网关、Ollama/LM Studio 等；Model 配置保留 baseUrl/model/key。
- 可逆性：可逆；后续实现 OpenCode 适配器即可替换。

## D3 无模型配置时使用本地启发式分析器，并显式标注

- 决策：默认 `local-heuristic`，界面、产物 `source` 字段与交付清单均标注「本地规则分析」；不使用 dry-run 冒充模型。
- 理由：真实模型凭据缺失不构成工程阻塞；两条旅程需要可重复验证。启发式分析只从用户输入与来源材料提取，不生成行业参数。
- 影响：未配置模型时仍可完成完整旅程；分析质量与模型模式不同，文档明确说明。
- 可逆性：可逆。

## D4 文件型项目存储与原子写入

- 决策：实体按 JSON 文件存储；规则修订分文件；写入使用临时文件 + rename；`.runtime` 可重建。
- 理由：符合方案「可读文件为权威记录」；便于 Git、双机与人工审查。
- 影响：索引是派生数据；跨文件变更通过提案与指针更新分步提交。
- 可逆性：可逆。

## D5 打包使用本地 Electron dist + @electron/packager + hdiutil

- 决策：不使用 electron-builder 的远程 Electron 下载；从 `node_modules/electron/dist` 打包，ad-hoc 签名，`hdiutil` 生成 DMG。
- 理由：GitHub 直连受限；本机无 Developer ID。该路径可在无远程二进制下载的情况下生成可安装产物。
- 影响：产物未签名、未公证，首次打开需右键打开或移除隔离属性；不得称为正式发行包。
- 可逆性：可逆；后续有证书时可替换签名步骤。

## D6 pen.dev 只做能力探测与绑定记录

- 决策：不实现真实 MCP 设计操作；设置/交付中显示「未检测到 pen.dev」，任务保留并说明降级。
- 理由：本机无 pen，无法验证文档定位、节点引用与导出；方案要求不将降级结果伪装成已生成设计文件。
- 影响：HTML 主链完整；pen 相关步骤标为未完成。
- 可逆性：可逆。

## D7 验证采用 node:test + Playwright Electron

- 决策：内核与适配器用 node:test；UI 旅程用 `playwright-core` 的 `_electron` 驱动真实 Electron。
- 理由：验证安装前的真实交互与持久化，而不是只测纯函数。
- 影响：E2E 依赖本机图形环境；截图与项目文件共同作为证据。
- 可逆性：可逆。

## D8 应用落位 `apps/desktop`，不修改现有仓库规则与页面

- 决策：新增独立子系统；根 `package.json`、`AGENTS.md`、`harness/`、`standards/`、现有页面均不改。
- 理由：保护既有资产与规则；应用是可独立打包的产品，不是设计稿页面。
- 影响：根仓库的机检命令不覆盖应用；应用有独立测试与打包脚本。
- 可逆性：可逆。
