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
| `npm run audit:export-stale` | 需求导出包过期审计：扫 `需求导出/` 下预生成文件的 `source-iteration` / `source-group` 头注释，找回分组源页面并判断是否已过期 |
| `npm run check:governance` | 快照 + 版本标记治理检查（= `audit:snapshots` → `audit:version-tags`） |

快照审计的两个变体：

| 命令 | 作用 |
| --- | --- |
| `npm run audit:snapshots` | 窄扫：只查 `governance.config.json` 的 `snapshotAudit` 保护清单与当前迭代 |
| `npm run audit:snapshots:all` | 全量扫历史债务，即 `audit-iteration-snapshots.js --all`；扫描根取 `allTargets`，为空时回退到 `platforms` + `iterationDir` + `doc` + `standards` |
| `npm run audit:iteration-snapshots` | `audit:snapshots` 的同义别名，仅为兼容旧引用，行为完全一致 |


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
| `npm run convert:docx -- <in.md> [out.docx]` | Markdown → DOCX。**唯一需要第三方依赖的命令**（`docx`，声明在 `optionalDependencies`），使用前先 `npm install`；其余命令全部零依赖 |

### 本地服务

| 命令 | 作用 |
| --- | --- |
| `npm run serve:local` | 本地静态服务，默认 <http://127.0.0.1:18765/>；可用 `node scripts/serve-local.js <port>` 指定端口 |

### Harness 治理机制

按用途分组。`H0x` / `P8` 等是治理机制自身的编号，保留在命令名里便于对账。

规则与证据校验：

| 命令 | 作用 |
| --- | --- |
| `npm run harness:h00a:validate` | H00A 规则/证据校验；支持 `--mode frozen\|current-drift` 与 `--fail-on-drift` |
| `npm run harness:h00a:drift` | 同上，同一脚本的别名，用于「跑漂移检查」这一意图的可读写法 |
| `npm run harness:h00a:capture-debt` | 采集校验债基线到 `tests/harness/baselines/validation-debt.json` |
| `npm run harness:h00a:compare` | 与基线比对，产出差异报告并落盘 |
| `npm run harness:baseline` | 采集 H00B 基线清单。会在「运行时输出被 git 跟踪」时直接报错退出，避免把产物误提交 |
| `npm run harness:contracts:validate` | H01 契约校验（schema + `tests/harness/contracts/fixtures/`） |

语料与运行包：

| 命令 | 作用 |
| --- | --- |
| `npm run harness:corpus:build` | 扫描仓库结构生成治理语料，写入 `tests/harness/fixtures/corpus/corpus.json` |
| `npm run harness:oracle:validate` | 语料 oracle 校验（每条 fixture 的 `expected.verdict` 是否与校验器实际判定一致） |
| `npm run harness:pack` | H05 运行包编译器：语料 fixture + 契约引用 + provider 模板 → 自包含运行包 JSON |
| `npm run harness:pack:run -- --pack <path>` | H05 运行包执行适配层（AFK 执行者入口） |

执行、准入与恢复：

| 命令 | 作用 |
| --- | --- |
| `npm run harness:run -- --task\|--workflow\|--fixture` | P8/P9 统一任务入口。`--task` / `--workflow` 走新链路，`--fixture` 转发给 H02 Runner |
| `npm run harness:run:h02 -- --fixture <path>` | H02 Runner 直连入口，可加 `--seed` `--run-id` `--out-dir` `--resume-from`；产物写 `.harness-runtime/runner/<run_id>.{trace,result,checkpoint}.json`。退出码 `0` 执行完成（含 FAILED/INCOMPLETE 结果）、`2` 拒绝执行、`3` 内部错误 |
| `npm run harness:qualify` | 准入矩阵运行，产出各任务族档位 |
| `npm run harness:shadow` | 影子对比运行（provider 结论与语料期望对账） |
| `npm run harness:cutover` | 新旧链路切换前检查：依赖文件齐备性 + `AGENTS.md` diff 计划 + smoke 命令清单 |
| `npm run harness:capability:doctor` | H06 能力探测：读 `tests/harness/capabilities/test-manifest.json`，输出 ready 判定。注意 capability 就绪 ≠ permission 已授权，后者由 `permission-guard.js` 承担 |
| `npm run harness:recover -- --checkpoint <id> --fixture <path>` | H07 跨会话恢复；可加 `--permission` `--message`，或 `--snapshot-baseline` 补建 dirty 基线 |

测试子集（改到对应模块时跑，比全量快）：

| 命令 | 作用 |
| --- | --- |
| `npm run harness:h00a:test` | H00A 回归测试 |
| `npm run harness:h00b:test` | H00B 基线回归测试 |
| `npm run harness:trace:validate` | H02 Runner trace 回归（`tests/harness/runner/`） |
| `npm run harness:validators:test` | 校验器回归（`tests/harness/validators/`） |
| `npm run harness:provider:doctor` | provider 冒烟测试里 `--test-name-pattern=doctor` 的子集 |
| `npm run harness:provider:smoke` | 同上，取 `smoke` 子集 |

> 全量回归请用 `node --test --test-concurrency=1`（原因见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)）。


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

```bash
cp governance.config.example.json governance.config.json
npm run check:ui          # 看当前存量问题，按报告逐项收敛
```

然后把 `AGENTS.md` + `harness/` 作为 AI 协作入口，`standards/*` 作为机检口径。

#### 配置字段

| 字段 | 类型 | 作用 | 留空时的行为 |
| --- | --- | --- | --- |
| `version` | number | 配置结构版本，当前为 `1` | — |
| `platforms` | array | 各端平台根目录。每项 `{ key, root, label }`，**`key` 只接受 `web` / `app` / `miniapp`** | 用内置虚构三端（`admin-portal` / `field-app` / `mini-program`） |
| `iterationDir` | string | 迭代索引目录，只做入口聚合不写业务 | `迭代索引` |
| `scratchDir` | string | 零散设计目录，**不参与受管页面判定**，也不要求返回入口与抽屉 | `零散设计` |
| `moduleRoots` | array | 参与搜索索引的子模块清单 | 空数组 = 按 `platforms` 自动发现一级子目录 |
| `docsDirs` | array | 额外的 `docs.js` 所在目录 | 空数组 = 按 `moduleRoots` 自动发现 `js/docs.js` |
| `scopedTargets` | array | `audit:version-tags` 的默认窄扫清单 | 空 = 走内置窄扫口径 |
| `allTargets` | array | `audit:version-tags --all` 的全量扫描根 | 空数组 = `platforms` + `iterationDir` + `doc` + `standards` |
| `snapshotAudit.protectedPages` / `.protectedIds` | array | 历史快照审计的保护页与保护 id | 空 = 只跑通用快照污染规则 |
| `excludedDirs` | array | 扫描时额外排除的顶层目录名 | 空 = 只排除内置项 |
| `businessBrain` | object | 「业务外脑」—— 供需求判断阶段加载的领域知识入口 | 见下 |

#### `businessBrain` 是可选的

`root`（默认 `doc/business-brain`）、`coreFiles`（两个入口文件名）、`capabilityDir`（能力卡子目录）、`keywords`（追加命中关键词）。

本仓库**不附带**业务外脑内容，默认路径下没有文件。加载器对此是优雅降级：读不到的文件记进 `warnings`、对应字段返回空串，不报错、不中断。因此不配置也能跑通全部命令；配置了才会启用「按业务外脑判断需求归属与能力命中」这条链路。`coreFiles` 的默认文件名只是占位示例，接入时改成你自己文档的入口文件名。

只写其中一两个子字段是安全的（已实测）：加载器对 `root` / `coreFiles` / `capabilityDir` / `keywords` 逐个带内置兜底，不会因为缺项而崩。


#### 两个容易踩的合并语义

- 配置是**浅合并**：只覆盖你写了的顶层字段。要改 `platforms` 必须整组写全，写半截不会与默认值逐项拼接。
- JSON 解析失败时脚本会打印 `[governance-config] 解析失败，回退内置默认` 然后**整份回退**到默认值 —— 也就是机检范围会悄悄变成虚构三端。接入后第一件事是确认 `npm run check:ui` 扫到的页面数量与你预期一致。
- 该文件必须是**合法 JSON**：示例文件把字段说明集中在顶部 `_doc` 字段里，而不是用 `//` 注释（`//` 会让 `JSON.parse` 直接失败）。
- `governance.config.json` **默认纳入版本控制**（本仓库不忽略它）。这是有意的：机检范围必须对全团队和 CI 保持一致，每人一份本地配置会导致「我这儿绿、你那儿红」。只有当你的配置里含环境相关信息时才考虑忽略。


### 历史快照

历史迭代只允许引用冻结快照：将当期页面复制到快照目录，补齐 `snapshot-of` / `snapshot-iteration` / `snapshot-date` 元信息，并同时冻结其私有 JS/CSS 与抽屉数据源；`npm run audit:snapshots` 检查污染。
