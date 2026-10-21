# 第三方组件与许可说明

Proto Harness Agent 源码采用 MIT 许可（见仓库根目录 `LICENSE`）。安装包包含以下运行时组件：

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| Electron | 45.0.0 | MIT | macOS 桌面运行时 |
| Chromium | 随 Electron | BSD 等开源许可 | 渲染引擎；完整许可见 Electron 包内 `LICENSES.chromium.html` |
| Node.js | 随 Electron | MIT | 主进程运行时 |

开发与验证工具（不随安装包提供）：

| 组件 | 版本 | 许可 | 用途 |
| --- | --- | --- | --- |
| @electron/packager | 20.3.0 | BSD-2-Clause | 本地打包 |
| playwright-core | 1.64.1 | Apache-2.0 | Electron E2E 验证 |

其他说明：

- 运行时没有第三方 npm 依赖；业务内核与运行时适配器为本项目代码。
- 界面使用系统字体与自绘 SVG 图标，不包含第三方字体或图标库。
- 示例项目 `examples/existing-project` 为本项目编写的公开示例，不含真实客户资料。
- pen.dev 是用户自行安装和授权的外部产品；本项目不随包分发 pen.dev，也不包含其代码。首版仅探测应用是否存在，不执行设计操作。
- OpenAI 兼容模型服务由用户自行配置；模型服务的使用条款、费用与数据处理方式以服务提供方为准。
- Git 为系统工具，不随包分发。

Electron 的完整许可证文本位于安装包内 `Contents/Resources/ELECTRON-LICENSE.txt`；Chromium 的许可证文本位于 `Contents/Resources/LICENSES.chromium.html`。如进行正式分发，应随发布物保留这两份文件。
