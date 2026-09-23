# proto-harness

**面向「目录型设计稿仓库」的治理工作流内核：一套 AI 协作规则 + 可机检的结构化标准 + 零依赖脚本 + 自带虚构示例。**

A governance workflow kernel for directory-based UI prototype repositories: AI collaboration rules, machine-checkable standards, zero-dependency scripts, and a bundled fictional example project.

---

## 这个仓库解决什么问题 / Why

当一个仓库同时承载多端（Web 后台 / App / 小程序）、多迭代、成百上千个 HTML 静态原型时，最常见的问题不是「写页面」，而是：

1. **规则只存在于人的脑子里**：抽屉怎么开、哪些按钮不能加、迭代页能不能写业务——没有可执行的约束。
2. **AI 协作不可控**：AI 改得又快又偏，没有开工闸门、执行依据、越权红线，也没有可验证的交付证据。
3. **入口失控**：新页面写完了但没有挂进源目录菜单、没有登记、没有纳入机检，几个月后没人知道哪些页面是活的。
4. **历史被污染**：历史迭代快照引用着仍在演进的活页面，口径随时漂移。

proto-harness 把这些问题抽象成三层可复用资产：

| 层 | 内容 | 位置 |
| --- | --- | --- |
| 规则层 | AI 主入口、强制闸门、角色路由、任务契约、纠偏与接力 | `AGENTS.md` + `harness/` |
| 标准层 | 页面登记、抽屉结构、页面类型、平台规则、设计 token | `standards/*.json` + `standards/*.md` |
| 工具层 | 机检、登记、缓存刷新、本地服务、搜索索引、脚手架 | `scripts/*` + `assets/*` |

---

## 快速开始 / Quick start

```bash
git clone <this-repo> proto-harness
cd proto-harness

# 环境：Node.js >= 18（无第三方依赖，无需 npm install）

# 1) 机检示例项目（登记 → 样式与结构检查 → 一致性审计）
npm run check:ui

# 2) 本地预览（默认 http://127.0.0.1:18765/）
npm run serve:local
# 打开 index.html 进入示例项目总导航
```

预期输出：

```text
[register-missing] no missing html pages
[register-missing] total registered: 5
[lint-ui] OK (5 pages checked)
[audit-ui] scanned 5 html files
[audit-ui] found 0 issues
```

### 用真实项目接入 / Adopt for your project

1. 复制 `governance.config.example.json` 为 `governance.config.json`，声明你的平台目录（如 `admin-portal` / `field-app`）、迭代目录（如 `迭代索引`）与扫描清单。
2. 用 `npm run scaffold:page` 生成页面骨架，按 `standards/ui-spec.json` 的口径登记。
3. 把 `AGENTS.md` + `harness/` 作为你的 AI 协作规则入口；`standards/*` 作为机检口径。

未提供 `governance.config.json` 时，脚本回退到内置的虚构三端默认值（`admin-portal` / `field-app` / `mini-program`），可直接跑通仓库自带示例。

---

## 示例项目 / Bundled example

仓库自带的示例是**完全虚构**的演示项目（示例数据均为虚构，不含任何真实业务信息）：

| 入口 | 说明 |
| --- | --- |
| `index.html` | 总导航：迭代索引 + 三端示例页入口 |
| `迭代索引/202606下.html` | 迭代索引：只做入口聚合，不写业务 |
| `admin-portal/asset-admin/index.html` | 模块承载页：左侧菜单 + iframe 承载 + `pageNames` 路由 |
| `admin-portal/asset-admin/pages/资产列表.html` | Web 列表页：筛选 + 表格 + 手动需求抽屉 |
| `field-app/main/pages/订单列表.html` | 移动端页：手机模型 + 右侧控制区 + 自动展开抽屉 |
| `mini-program/main/pages/下单.html` | 小程序页：轻量表单 + 底部操作栏 |

「需求文档抽屉」由公共组件 `assets/js/components/doc-panel.js` 提供：页面声明 `window.DocsData` 后，一个按钮即可获得「需求文档 / CSS 规范」双 Tab 抽屉。

---

## 目录结构 / Layout

```text
proto-harness/
├── AGENTS.md              # AI 协作唯一主入口（中文）
├── CLAUDE.md              # Claude 接入入口（指向 AGENTS.md）
├── DEVELOPMENT.md         # 页面实现基线（结构 / 抽屉 / 弹层 / 静态原型）
├── harness/               # AI 执行规则分卷（闸门 / 契约 / 纠偏 / 验证 / 角色 / 风格基线）
├── standards/             # 结构化标准与机检口径（JSON + 说明文档）
├── scripts/               # 零依赖 Node 脚本（机检 / 登记 / 审计 / 服务 / 脚手架）
├── assets/                # 公共 CSS / JS / 字体（抽屉组件、侧栏、搜索索引等）
├── templates/             # 页面与文档模板
├── tests/                 # Node 原生测试（治理机制回归）
├── docs/                  # 命令参考、规则导读、skills
├── governance.config.example.json
└── (示例项目) index.html / 迭代索引/ / admin-portal/ / field-app/ / mini-program/
```

## 常用命令 / Scripts

| 命令 | 作用 |
| --- | --- |
| `npm run check:ui` | 自动登记缺失页面 + `lint:ui` + `audit:ui`（日常主检查） |
| `npm run lint:ui` | 页面结构机检（登记、模板边界、抽屉模式、遮罩） |
| `npm run audit:ui` | 一致性审计（抽屉宽度、状态标签、设计稿文案越界） |
| `npm run register:missing:write` | 把新 HTML 页面自动登记进 `standards/ui-spec.json` |
| `npm run scaffold:page` | 按页面类型生成骨架并登记 |
| `npm run cache:bust:write` | 给 CSS/JS 引用写入内容 hash（部署前执行） |
| `npm run serve:local` | 本地静态服务（默认端口 18765） |
| `npm run check:all` | 全量检查（规则引用 + 机检 + 文档 + 治理审计） |
| `npm run harness:corpus:build` | 生成治理语料（H04 corpus） |
| `npm run harness:h00a:test` | Harness 自检回归测试 |

完整命令表与说明见 [`docs/README.md`](docs/README.md)。

## 规则体系导读 / Reading order

1. **`AGENTS.md`** —— 唯一主入口：握手、状态判定、开工闸门、红线、交付边界。
2. **`harness/`** —— 分卷细则，按任务路由读取（`harness/README.md` 有任务路由表）。
3. **`standards/`** —— 机检口径与结构化标准（页面登记、抽屉结构、平台规则）。
4. **`DEVELOPMENT.md`** —— 页面实现基线（写页面/改页面前读）。
5. **`docs/skills/`** —— 可复用的 AI 工作流 skills（诊断、评审、拆解、收尾）。

---

## 许可 / License

[MIT](LICENSE) © 2026 amonastic。

本仓库包含改编自 MIT 许可开源项目的 skills 与第三方字体/依赖，版权声明与许可条件见 [`NOTICE`](NOTICE)。
