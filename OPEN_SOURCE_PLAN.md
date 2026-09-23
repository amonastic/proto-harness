# proto-harness 开源发布推进计划

> 创建日期：2026-09-23
> 审查修订：2026-09-23（修正事实错误、补充遗漏项）
> 目标：将内部项目的治理工作流内核打磨为可独立使用的开源工具 v0.1.0

---

## Phase 0：发布阻塞项（P0）

> 执行进度（2026-09-24）：0.1 / 0.2 / 0.3 / 0.4 已完成并在 clean checkout 验证全绿。
> **0.5 脱敏：跟踪文件识别词已清零**（36 个文件、约 928 处，纯词替换）。
> **步骤 4（历史重写）未做** —— 旧名仍留在提交 `1a0e234`（521 处），工作区干净不等于历史干净。详见 §0.5。

### 0.1 package.json 修正 ✅ 已完成
- [x] 移除 `"private": true"`
- [x] 补全 `homepage`、`bugs`、`engines`（`>=18`）
- [x] **移除幽灵依赖 `puppeteer`**：实证全仓库无任何 `require`/`import`（仅 `schema-validate.js:5` 一句注释提及）
- [x] **`docx` 移入 `optionalDependencies` + 新增 `convert:docx` 脚本入口**（采用原计划选项 a，非破坏性）
- [x] `scripts/harness/lib/schema-validate.js` 注释已改写：说明只在 `optionalDependencies` 声明 `docx`（供 `convert-md-to-docx.js` 使用），并去掉对已删除的迁移验证测试的引用
- [ ] README "零依赖"表述精确化：核心机检链路零依赖（实证：本机无 `node_modules` 仍跑通 `check:ui`）；仅 `convert:docx` 需 `npm install`

### 0.2 修复测试环境假设（H10A-07）✅ 已完成
- [x] `tests/harness/shadow/runner.test.js` — 用例改为**自行制造** dirty 前提（写入未被 gitignore 的探针文件 `harness-dirty-probe.tmp`，`finally` 清理），不再断言外部工作区恰好 dirty
- 验证：真·clean checkout（`git status --short` 为空）下 `H10A-07` 由 ❌ 转 ✅，10/10 pass，探针无残留；本地 dirty 状态同样 10/10

### 0.3 GitHub Actions CI ✅ 已完成
- [x] 新建 `.github/workflows/ci.yml`：push to main + PR，Node 矩阵 18 / 20 / 22
- [x] 步骤：checkout → `npm run check:ui:readonly` → `node --test` → 收尾断言工作区未被改动
- 关键取舍：
  - **不跑 `npm install`** —— 仓库无 lockfile（`npm ci` 会直接失败），且核心链路实证零依赖
  - 用 `node --test`（无参自动发现）而非 `node --test 'tests/harness/**/*.test.js'` —— `node --test` 的 glob 支持是 Node 21+ 才有，18/20 下带 glob 的写法会把模式当成路径。已实测无参形式在本仓库发现同样 `321 tests`，且不误扫 `tests/harness` 以外的目录
  - 收尾 `git diff --quiet` + untracked 断言：守住本轮修掉的那类缺陷（用例依赖外部工作区状态）
- 验证：YAML 经 ruby/psych 解析通过（5 steps、矩阵正确）；收尾断言在 clean clone 上彩排 PASS
- ⚠️ 未验证项：Node 18 / 20 实际运行结果本机无法复现（只有 v24），**首次 push 后以 CI 真实输出为准**

### 0.4 `.gitignore` 的 `memory/` 误吞必需测试 ✅ 已按选项 (b) 处置
- [x] `scripts/harness/cutover.js` 移除 `add('迁移验证测试（P10.3）', ...)` 依赖项：16 项 → 15 项，仍满足 `P11.2` 的 `checks.length >= 15`
- [x] 全仓确认 `migration-validation` / `P10.3` 仅被 `cutover.js` 一处引用，无其它悬挂引用
- [x] 本地文件**移出仓库而非销毁** → `~/Downloads/.proto-harness-quarantine/migration-validation.test.js`（含 11 处业务名，不宜留在仓库内；要彻底销毁由你确认后再删）
- [x] 空的 `tests/harness/memory/` 目录已删
- 验证：`dependencyCheck()` → `checks: 15, ok: true, failed: []`；`tests/harness/smoke/` 4/4 pass
- [x] `.gitignore:16` 已改为 `/memory/`（根锚定）。实测本仓库不存在根级 `memory/`，改动无副作用，只消除「任意层级同名目录被静默吞掉」这一类隐患。

### 0.5 全量脱敏 ✅ 已完成（跟踪文件识别词归零）

初判「3 个文件 7 处」严重低估。全量扫描实测：**36 个跟踪文件**、约 **928 处**命中，
其中 `tests/harness/fixtures/corpus/corpus.json` 一个文件占 664 处。
`git log --all -S` 确认业务名仅由 `1a0e234` 引入，`6a26387` 干净。

**扫描时确立的判据（值得留给后来人）**：命中的词要分两类，不能一刀切替换 ——

- ✅ **不指向特定公司的通用域词，保留**：仓库自带虚构示例页本来就在用 `一号站点`、`示例用户 A`、`AS-2026-0001` 这类占位词，它们不是泄露；连这类词一起批量改掉，只会让示例变怪异
- ⛔ **构成原项目模块清单的词组与目录名，替换**：多个平台后台专名 + 其目录名 + 特定端名 + 特定权限页名，组合起来可识别

**处置过程中的两个判断修正**（都记下来避免重犯）：

1. 原计划「用 `harness:corpus:build` 重生成 corpus 一步消掉 664 处」实测**不可行**：它会把 corpus 从 46 个 fixture 塌成 1 个，因为仓库自带的虚构示例只有 1 个模块入口页。清零了泄露但打掉 6 个任务族的覆盖面，而治理机制的测试覆盖面正是本项目的产品本身。故改为就地虚构改名。
2. 初判「真实业务名仅 3 个文件」来自我只 grep 了项目名而没 grep 业务内容 —— 审查方法本身有缺陷，范围必须用穷举扫描确定，不能用一次抽样确定。

**遗留（未完成，不阻塞发布）**：`corpus.json` 现在是一份自洽的合成夹具，但与当前仓库结构不符（引用 8 个不存在的页面路径）。它因此**无法由 `harness:corpus:build` 复现**；要恢复可复现性，需先扩充虚构示例（新增模块页 + 菜单登记），属独立任务。

4. 全量复扫确认零命中后，再一次性重写本地历史（把 `1a0e234` 重做为无业务名的初始提交）

### 0.6 测试套件环境耦合 ✅ 已解决
- 三个互相冲突的用例中，`H10A-07` 由 0.2 修复、`P11.2` 由 0.4 修复
- `H10C-01`（本地 ❌ / clean ✔）在 0.2 + 0.4 落地后转为稳定通过，但**未单独定位根因**：它的失败依赖 `.harness-runtime/` 既有残留，属状态耦合类，与另两个同因
- 复现验证（决定性）：
  - 本地：`node --test` → `321 tests / 282 pass / 0 fail / 39 skipped`，EXIT=0
  - **clean clone（`git status` 为空）连续两次全量** → 两次均 `321 / 282 / 0 fail`，EXIT=0，跑完工作区仍 clean
  - `node --test` 无参自动发现 → 同样 `321 / 282 / 0 fail`


### 0.7 脱敏后的两项遗留

**(a) 本文件自身曾是最后一个泄露源 —— 已清除**
它作为脱敏记录曾逐字抄了原词。原项目本体已在仓库外单独归档，映射关系对本仓库无价值，
故对照表与原词引用已全部改写成不含识别词的表述。**跟踪文件 + 未跟踪文件复扫均为零命中。**

留一条给后来人：审计类文档天然会抄写敏感原文，**它自己也要纳入脱敏扫描范围**，否则「脱敏完成」的结论会被自己的记录打穿。

**(b) 测试竞态已定位并可复现（存量缺陷，非本轮引入）**

根因：`tests/harness/shadow/runner.test.js` 与 `tests/harness/shadow/parallel.test.js` 共享
`.harness-runtime/shadow/<provider>/<family>` 状态（都用 `deepseek` + `entry-defect`），
而前者在 `finally` 里对同一路径做 `fs.rmSync(..., {recursive:true})`。Node 测试默认按文件并发，于是并跑时互相删目录。

复现与归因证据：
- 两文件并跑（本机工作副本）→ `H10C-01` 挂
- **在未改名的原始提交 `1a0e234` 的独立 clone 上并跑同一对文件 → 挂 3 个**（`H10A-03`、`H10A-07`、`H10C-01`）
  —— 证明与脱敏改名无关，是存量竞态
- 单文件跑两次 → 均 9/9 pass；说明只在并跑时触发
- `node --test --test-concurrency=1` 全量连跑 **3 次** → 均 `321 / 282 pass / 0 fail`，EXIT=0

已落地的护栏：CI 用 `--test-concurrency=1`，并在 workflow 里注明这是临时护栏不是设计。
根治待办：给每个测试文件独立 runtime 命名空间（需改 `scripts/harness/lib/shadow/`，属 harness 区，单独授权）。
`CONTRIBUTING.md` 里让用户跑 `node --test 'tests/harness/**/*.test.js'` 会同时踩中 glob（Node 21+ 才支持）和这个竞态，Phase 1 需一并修。

## Phase 1：文档完善（P1，预计 1.5 天）

### 1.1 docs/README.md 命令参考补全
- [ ] 当前 47 个 npm scripts 中缺 17 个文档，需逐一补齐或标注为别名：
  - 需补文档：`harness:baseline`、`harness:recover`、`harness:pack`、`harness:pack:run`、`harness:capability:doctor`、`harness:run`、`harness:run:h02`、`harness:trace:validate`、`harness:validators:test`、`harness:provider:doctor`、`harness:provider:smoke`、`audit:export-stale`、`harness:h00a:capture-debt`、`harness:h00a:compare`
  - 可标为别名：`audit:snapshots:all`（= `audit:snapshots --all`）、`harness:h00a:drift`（= `harness:h00a:validate`）、`audit:iteration-snapshots`（= `audit:snapshots`）

### 1.2 governance.config.example.json 注释改进
- [ ] 已有 `_doc` 单行总注释覆盖所有字段；改为字段级行内注释提升可读性
- [ ] 补充最小接入 walkthrough（与 docs/README.md "接入自己的项目" 段落交叉引用）

### 1.3 templates/ 使用说明
- [ ] 新建 `templates/README.md`，说明 8 个模板的用途、参数、使用方式
- [ ] 从主 README 或 docs/README.md 链接过去

### 1.4 DEVELOPMENT.md 开源适配审查
- [ ] 确认无内部路径、内部工具链引用、真实业务术语残留
- [ ] 确认所有示例路径指向仓库内虚构目录

### 1.5 清理本地 `.harness-runtime/` 残留（P1，非 P0）
- [x] `.harness-runtime/` 已 gitignore，不进入仓库；`git status --ignored` 复核过，除它以外没有被误吞的应跟踪内容
- [ ] **仍未清**：`.harness-runtime/tasks/` 里有 2 个**文件名**含旧业务名（一对 `REQ-*.json` / `UI-*.html`）。它们不进仓库，风险面是**截图与录屏** —— Phase 2 要做 README 截图，届时桌面可见区域可能把它们带出去
- [ ] 处置：做截图前先清 `.harness-runtime/`（它会由测试重新生成，删了无损），或在虚拟环境/干净 clone 里截图

## Phase 2：发布体验优化（P2，预计 1.5 天）

- [ ] **README 增加效果截图/GIF**
  - 至少包含：示例项目总导航页、列表页 + 需求抽屉展开、移动端手机模型效果
  - 图片放 `docs/images/`
- [ ] **CHANGELOG.md**
  - v0.1.0 初始版本说明：包含什么、不包含什么、已知限制
- [ ] **README 英文版增强**
  - 当前英文段落较薄，补充 Why / What's included / How it works 的英文正文
- [ ] **GitHub repo meta**
  - Description、Topics/tags、Social preview image
  - Issue templates（Bug report / Feature request / Question）
  - PR template

## Phase 3：长期健康度（P3，持续）

- [ ] **npm publish 干跑验证**
  - `npm pack` 检查包内容，确认无遗漏文件、无敏感文件
  - 添加 `files` 字段白名单到 package.json
- [ ] **License compliance 复查**
  - NOTICE 中的第三方资源版本是否与 assets/ 实际文件一致
  - Tailwind CDN build 产物的许可兼容性确认
- [ ] **用户接入反馈收集**
  - 首批外部用户试用后收集痛点
  - 根据反馈迭代 v0.2.0

---

## 时间估算（2026-09-24 按实证修订）

| Phase | 工作量 | 状态 |
| --- | --- | --- |
| 0.1 package.json | 0.2 天 | ✅ |
| 0.2 测试环境耦合（H10A-07） | 0.3 天 | ✅ |
| 0.3 GitHub Actions CI | 0.3 天 | ✅（含竞态护栏） |
| 0.4 gitignore 误吞必需测试 | 0.2 天 | ✅ |
| 0.5 步骤 1-3：全量虚构化 | 已完成 | ✅ 跟踪文件零命中 |
| **0.5 步骤 4：历史重写** | 0.3 天 | ⛔ 等 §0.7(a) 决策 |
| 0.7(b) shadow 测试竞态根治 | 0.5-1 天 | 待办（已加护栏，不阻塞发布） |
| Phase 1 文档完善 | 1.5 天 | 未开始 |
| Phase 2 发布体验 | 1.5 天 | 未开始 |
| Phase 3 长期健康度 | 持续 | — |

**发布只剩两步**：处置 `OPEN_SOURCE_PLAN.md` → 重写本地历史；然后进 Phase 1。

---

## 风险与注意事项

1. **历史仍未清（唯一发布阻塞）**：工作区跟踪文件识别词已归零，但提交 `1a0e234` 里仍有 **521 处**旧名 —— `git log --all -S` 可查。删文件、改文件都不影响已提交的对象；推送时历史对象会一并上传，别人能翻出第一次提交的原始内容。经核实本仓库**没有 remote、没有 upstream**（`git remote -v` 为空），`package.json` / README 里的 GitHub 地址只是预填 —— **这是历史重写成本最低的一次机会，必须在首次 push 之前做**。
2. **规则文档引用幻影模块（未修，属正确性缺陷）**：`harness/rules/Web后台风格基线.md` 描述三个 Web 后台及其主题色，但对应目录在本仓库不存在；`corpus.json` 抽样的 8 个页面路径同样不存在。改名只解决了识别性，没解决「新人照文档走不通」。需在 Phase 1 一并处理。
3. **`corpus.json` 与仓库结构不符（未修）**：它现在是一份自洽的合成夹具，不再是原项目快照，但引用了不存在的页面，且无法由 `harness:corpus:build` 复现（重生成会塌成 1 个 fixture）。要恢复可复现需先扩充虚构示例。
4. ~~`.gitignore` 的 `memory/` 未根锚定~~ ✅ 已改为 `/memory/`。
5. **Node 18 / 20 CI 未经本机验证**：本机只有 v24。已改用 v18 起即支持的 `node --test` 无参自动发现规避 glob 兼容问题，并加 `--test-concurrency=1` 护栏；真实结果仍以首次 CI 运行为准。
6. **测试竞态（已定位，未根治）**：根因是 `shadow/runner.test.js` 与 `shadow/parallel.test.js` 共享 `.harness-runtime/shadow/<provider>/<family>` 并在 `finally` 互删。已用串行护栏挡住，并在 `CONTRIBUTING.md` 写明「`--test-concurrency=1` 是必需项」与不要改用 glob 的原因；根治仍需给每个测试文件独立 runtime 命名空间（动 `scripts/harness/lib/`），未完成。
7. ~~`schema-validate.js` 注释失真~~ ✅ 已修。
8. **"零依赖"表述**：核心链路实证零依赖（无 `node_modules` 可跑通 `check:ui`），但 `convert:docx` 需安装 `docx`；README 需精确区分，并写明 CI 不跑 install 的理由。
9. **本地运行时残留**：`.harness-runtime/tasks/` 有 2 个文件名含旧业务名，不进仓库但可能进截图，见 §1.5。

