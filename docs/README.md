# 文档索引

本目录承载命令参考、规则体系导读与可复用工作流资产。

- [`skills/`](skills/) —— 可复用的 AI 工作流 skills（诊断、评审、拆解、收尾等），含来源与许可声明。

## 命令参考

环境：Node.js >= 18，零第三方依赖（无需 `npm install`）。

### 日常主检查

| 命令 | 作用 | 何时用 |
| --- | --- | --- |
| `npm run check:ui` | 自动登记缺失页面 → `lint:ui` → `audit:ui` | 每次页面改动后 |
| `npm run check:ui:readonly` | 同上但不写入登记（CI 友好） | CI / 只想检查时 |
| `npm run check:all` | 规则引用 + 机检 + 文档审计 + 导出审计 + 治理审计 | 大版本收口 |

### 机检与审计

| 命令 | 作用 |
| --- | --- |
| `npm run lint:ui` | 页面结构机检：登记闭环、模板边界（导航/无导航）、抽屉模式（手动/自动展开）、阻塞式遮罩 |
| `npm run audit:ui` | 一致性审计：抽屉宽度分布、状态标签采样、设计稿控制文案越界，输出 `一致性审计报告.md` |
| `npm run audit:docs` | 需求文档与抽屉内容审计 |
| `npm run audit:snapshots` | 迭代快照安全审计（历史页是否引用活页、快照是否缺元信息） |
| `npm run audit:version-tags` | 版本标记口径审计 |
| `npm run audit:rules` | 规则文件引用与登记审计 |
| `npm run audit:rules-usage` | 规则引用频率审计（周志） |
| `npm run check:governance` | 快照 + 版本标记治理检查 |

### 登记与生成

| 命令 | 作用 |
| --- | --- |
| `npm run register:missing` | 扫描未登记的 HTML 页面（只报告） |
| `npm run register:missing:write` | 将未登记页面写入 `standards/ui-spec.json` |
| `npm run scaffold:page` | 按页面类型生成骨架（`--type module-page --out "path" --register-only`） |
| `npm run annotate:type` / `annotate:type:write` | 为页面追加 `template-type` 注释 |
| `npm run cache:bust` / `cache:bust:write` | 为 CSS/JS 引用写入内容 hash（检测 / 实际写入） |
| `npm run extract:css` | 抽取页面私有 CSS |
| `npm run export:requirement` | 按需求分组导出自包含 HTML |

### 本地服务

| 命令 | 作用 |
| --- | --- |
| `npm run serve:local` | 本地静态服务，默认 <http://127.0.0.1:18765/>；可用 `node scripts/serve-local.js <port>` 指定端口 |

### Harness 治理机制

| 命令 | 作用 |
| --- | --- |
| `npm run harness:h00a:validate` | H00A 规则/证据校验 |
| `npm run harness:h00a:test` | H00A 回归测试 |
| `npm run harness:h00b:test` | H00B 基线回归测试 |
| `npm run harness:contracts:validate` | H01 契约校验（schema + fixtures） |
| `npm run harness:corpus:build` | 生成治理语料（从仓库结构抽取 fixture） |
| `npm run harness:oracle:validate` | 语料 oracle 校验 |
| `npm run harness:qualify` | 准入矩阵运行 |
| `npm run harness:cutover` | 新旧链路切换检查 |
| `npm run harness:shadow` | 影子对比运行 |

## 规则体系导读

```text
用户消息
   │
   ▼
AGENTS.md ── 状态判定（分析 / 讨论 / 执行 / 排障 / 治理）
   │            ├─ 授权词表（standards/授权词表.md）
   │            ├─ 开工声明 + 执行依据 + 红线（T0 / T-1）
   │            └─ 角色路由（harness/20 + harness/roles/）
   ▼
harness/00~05,10 ── 分卷细则
   ├─ 01 强制闸门：每轮执行前后
   ├─ 02 纠偏与接力：被否定口径、跨会话事故
   ├─ 03 任务契约：页面调整契约、目录引用契约
   ├─ 04 规则准入与治理：规则写入、冷宫、skill 路由
   ├─ 05 验证与交付：验证命令、提交推送边界
   └─ 10 页面与抽屉执行：成熟基准、组件路由、专项分流
   ▼
DEVELOPMENT.md ── 页面实现基线（结构 / 抽屉 / 弹层 / 静态原型）
   ▼
standards/ ── 结构化机检口径
   ├─ ui-spec.json：页面登记与机检清单
   ├─ doc-spec.json：需求抽屉与文档结构
   ├─ page-baseline-spec.json：页面保护与复刻边界
   ├─ page-type-guide.md：页面类型与导航判断
   └─ design-over-spec.md：收口验收口径
```

## 常见工作流

### 新增一个页面

```bash
npm run scaffold:page -- --type module-page --out "admin-portal/asset-admin/pages/资产列表.html"
# 填写页面内容与 DocsData 抽屉数据
npm run check:ui           # 登记 + 机检 + 审计
npm run cache:bust:write   # 刷新资源 hash
node scripts/cache-bust-html.js   # 应输出 Would update 0
```

### 接入自己的项目

1. `cp governance.config.example.json governance.config.json`
2. 修改 `platforms`（平台目录）、`iterationDir`（迭代目录）、`moduleRoots`、`excludedDirs`
3. `npm run check:ui` 看当前存量问题；按报告逐项收敛
4. 用 `AGENTS.md` + `harness/` 作为 AI 协作入口

### 历史快照

历史迭代只允许引用冻结快照：将当期页面复制到快照目录，补齐 `snapshot-of` / `snapshot-iteration` / `snapshot-date` 元信息，并同时冻结其私有 JS/CSS 与抽屉数据源；`npm run audit:snapshots` 检查污染。
