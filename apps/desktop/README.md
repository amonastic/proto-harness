# Proto Harness Agent 桌面客户端

本地优先的产品 Agent 客户端：业务大脑、需求分析、冲突裁决、HTML 原型、CSS 规范、固定交付与 Git 同步。

## 状态

首版实现基于 `方案/Proto_Harness_Agent_Implementation_Plan_v0.2.md`，是独立 Electron 应用，不修改仓库既有设计稿页面、迭代索引、`AGENTS.md`、`harness/`、`standards/` 或根 `package.json`。

已验证：

- 46 项内核与适配器单元测试通过。
- Playwright Electron 跑通三条旅程：新建产品、接入已有项目，以及不使用取件码示例的「活动报名」需求；覆盖表单 + 管理列表双页生成、补答后重绑提案、保留现行规则、交付冻结、Git 二次提交、重启恢复、第二工作副本、导入来源未修改与导出无密钥。
- 打包产物从 DMG 安装副本启动并再次跑通三条旅程（见 `e2e/evidence/` 与最终交付报告）。

未验证/未完成：

- 真实模型服务的线上调用（无凭据）；适配器已用本地 mock HTTP 验证结构、鉴权、错误路径。
- pen.dev 的真实 .pen 操作；首版仅探测应用，不伪造成已生成设计。
- OpenCode 集成；首版生产运行时为 OpenAI 兼容 HTTP。
- Apple Developer ID 签名与公证；当前为 ad-hoc 签名的本地测试产物。
- Intel Mac 构建与系统级安装验证。

## 开发

```bash
cd apps/desktop
npm install
npm start
```

依赖：macOS 13+ arm64、Node 20+（开发）。应用运行不依赖开发机器的 Node 或仓库脚本。

## 验证

```bash
cd apps/desktop
npm test            # 46 项内核 + 适配器单元测试
npm run e2e         # Playwright Electron 两条旅程；证据写入 e2e/evidence/
npm run e2e:packaged # 使用 release/ 下的安装产物运行同样旅程
```

E2E 使用临时项目目录，不会修改示例项目；会创建本地 bare Git 远端验证提交与推送。

## 打包

```bash
cd apps/desktop
npm run package       # .app + .dmg + .zip + build-info.json
npm run package:dir   # 只生成 .app
```

产物在 `release/`。脚本使用本地 `node_modules/electron/dist` 生成 Electron zip 缓存，避免运行时远程下载；随后 ad-hoc 签名并用 `hdiutil` 生成 DMG。

正式分发需要 Developer ID 与公证凭据，并替换签名步骤。当前产物不得描述为已签名公证的正式发行包。

## 架构

```text
apps/desktop/
  electron/        主进程、IPC、安全 preload、设置与 Keychain
  renderer/        原生 ES Modules 界面
  e2e/             Playwright Electron 旅程与证据
  docs/            用户手册、数据格式、第三方说明
packages/core/     业务内核：存储、上下文、裁决、工作流、导入、产物、交付、Git
packages/runtime-adapter/  OpenAI 兼容适配器与本地启发式分析器
examples/existing-project/ 公开示例（接入旅程）
```

安全边界：

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 渲染层只通过白名单 IPC 调用主进程。
- 项目 API Key 只存系统安全存储。
- 生成的原型在隔离 iframe 中预览，不获得桌面能力。
- 权威写入只经业务内核；模型与工具不能绕过裁决。

## 已知边界

- 本地规则分析是启发式，不是模型；界面与产物会标注来源。
- 没有模型凭据时仍可完成完整流程，但分析质量与模型模式不同。
- 交付创建时会冻结产物副本与哈希；后续修改活产物不会改变历史交付。创建时绑定当前 Git 提交，未提交时会记录警告。
- 本地规格生成根据需求语义选择表单、列表、看板、设置、概览或详情，并支持多页；模型规格已接入生成主链，失败时会回退本地并显示警告。
- pen.dev 仅探测；HTML 与静态交付是基础通道。
- macOS 安装包未公证，首次打开可能需要右键打开或移除 quarantine。

## 文档

- [用户手册](docs/user-guide.md)
- [数据格式](docs/data-format.md)
- [第三方说明](docs/third-party.md)
- [总任务包](docs/00-total-task-package.md)
- [契约](docs/01-contracts.md)
- [执行前检查](docs/02-preflight.md)
- [实施决策](docs/03-decisions.md)
