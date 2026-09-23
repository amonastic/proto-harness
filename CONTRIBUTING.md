# 贡献指南（简版）

## 提交前必须执行

```bash
# 页面/组件/示例相关改动
npm run check:ui

# 治理机制与脚本改动
node --test --test-concurrency=1
node --check <改动过的脚本>

# 缓存刷新（会改动 HTML 中 CSS/JS 引用 hash）
npm run cache:bust:write
node scripts/cache-bust-html.js   # 复跑，应输出 Would update 0 HTML file(s)
```

`--test-concurrency=1` 是必需项，不是加速选项：`tests/harness/shadow/` 下多个用例文件共享
`.harness-runtime/shadow/<provider>/<family>` 产物并互相清理，并发跑会随机失败。
同理不要改写成 `node --test 'tests/**/*.test.js'` 这类 glob 形式 —— `node --test` 的 glob 支持自 Node 21 起才有，
而无参自动发现自 Node 18 起可用，且与本仓库 CI 的调用方式保持一致。

## 改动边界

- **不提交真实业务内容**：本仓库只接受通用机制、虚构示例与规则文档；任何真实业务名称、页面数据、截图、接口地址、账号信息都会被拒绝。
- **不做未授权重构**：大范围调整先开 issue 说明涉及文件、替换内容、原因与风险。
- **规则文件改动需同步**：修改 `harness/` 或 `standards/` 下的规则时，同步检查 `standards/rule-map.json` 的登记与引用关系。
- **新增页面**：必须登记进 `standards/ui-spec.json`（`npm run register:missing:write`）并纳入机检；新增入口必须补菜单、承载区与 `pageNames` 映射（见 `DEVELOPMENT.md` 的入口注册闭环）。
- **示例目录**：`admin-portal/`、`field-app/`、`mini-program/`、`迭代索引/` 为虚构示例项目，改动它们等同于改动示例文档，保持虚构、无真实信息。

## Pull Request

- 描述包含：改了什么、为什么、如何验证（贴出命令与关键输出）。
- 涉及规则口径变更时，列出受影响的规则文件与迁移说明。
- 一个 PR 只做一件事；机制改动与示例内容改动分开提交。

## 许可

- 贡献即同意以 [MIT](LICENSE) 许可发布。
- 引入第三方资源（字体、图标、代码、文档）时，必须更新 [`NOTICE`](NOTICE)，注明来源与许可；来源不明或许可不兼容的资源不得引入。
