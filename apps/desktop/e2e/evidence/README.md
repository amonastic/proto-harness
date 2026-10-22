# 安装产物端到端验证证据

执行日期：2026-10-22（0.1.4 安装产物）
客户端版本：0.1.4
构建源码提交：`08b0ec86c2327a14758ee5d8f3d41c9fc8d75ada`
安装产物：`apps/desktop/release/Proto-Harness-Agent-0.1.4-arm64.dmg`
DMG SHA-256：`b2a02f2efb0bf4dc8381cc6f43f3bc8974be07aa32d983b3d84f23c072cecc35`
ZIP SHA-256：`ab564f4b4879e4d8a0a7b42ca224ac35ec44b3a894b728fba0aee6cac97ec237`
验证方式：挂载 DMG → 将 `Proto Harness Agent.app` 复制到临时安装目录 → 直接启动安装副本 → 运行 `e2e/journeys.mjs`。
签名状态：ad-hoc 签名，未使用 Developer ID，未公证。
分析来源：本地规则分析（未调用真实模型；模型规格接入用 fake adapter 单测验证）。

## 结果

`summary.json` 记录机器可读结果，全部通过：

```json
{
  "conflict_bound_decision": true,
  "planned_current_separated": true,
  "artifacts_generated": true,
  "delivery_exported": true,
  "restart_resumed": true,
  "git_commit_and_push": true,
  "second_copy_resumed": true,
  "import_source_untouched": true,
  "no_secrets_in_export": true,
  "distinct_requirement_multipage": true,
  "unknown_answer_rebased": true,
  "keep_decision_respected": true,
  "delivery_frozen_on_reexport": true,
  "git_second_commit": true
}
```

单元测试：58 项全部通过，覆盖页面类型推断、模型两页规格进入产物、补答重绑、保留现行规则、交付冻结、并行计划基线、Git 二次提交，以及非破坏导出、展示快照、已应用提案补答、精确提交、字段/设置忠实度和“原型预置密钥 → 导出失败且原导出保留”。

## 0.1.4 本轮复验

- 导出密钥扫描已从只检查 `index.html` 扩展为递归检查临时导出目录中的全部 `.html`、`.json`、`.md`、`.txt`、`.css` 文本产物；扫描发生在原子替换之前，命中后删除临时目录并保留上一次成功导出。
- 新增回归单测：原型预置 `sk-...` 后创建新交付，导出因密钥失败；上一次成功交付的 `index.html`、冻结原型哈希与 `exported` 状态保持不变。
- journey-1 / journey-2 / journey-3 失败时会确保旅程证据目录存在，保存 `failure.png`，并写入 `failure-diagnostics.json`（错误与堆栈、当前 URL、标题、正文摘要、最近 200 条控制台输出）。
- 最终安装副本连续复跑 5 次，均为零失败；单次约 50–52 秒，最终 `summary.json` 取自第 5 次，5 次均未触发等待兜底或输入重填。`stability.json` 记录每次状态、耗时与日志 SHA-256，原始日志在 `stability/run-*.log`。
- 早前一次候选复跑在 journey-2 出现目录输入少最后一个字符；隔离复跑 20 次抽屉循环与 12 次全新启动均输入完整，未发现路由或抽屉重渲染覆盖。E2E 现已对所有关键输入做写入后值断言，异常时重填一次再继续，避免把输入注入抖动误报为业务失败。
- 最终包首次复跑曾在 journey-1 的 `settings-save` 等待超时；失败证据显示设置页 URL、标题与完整正文已经渲染，控制台无错误。隔离验证设置切换 20 次为 25–53ms，按“第二工作副本 → 需求详情 → 设置”复现 15 次为 37–120ms，隐藏/最小化窗口的等待也通过，未发现路由覆盖。E2E 增加 `waitForRendered`：等待超时后直接检查目标 DOM 是否存在，存在则交给后续点击校验可见性，不存在仍按原错误失败。

## 旅程一：新建产品

| 截图 | 覆盖点 |
| --- | --- |
| `journey-1/01-home.png` | 安装版首页、本地分析来源、空产品列表 |
| `journey-1/02-workbench.png` | 新建产品后形成初始基线 |
| `journey-1/03-decision.png` | 需求分析产生的现行规则与新口径冲突，裁决绑定提案 |
| `journey-1/artifacts.png` | 生成 HTML 原型，隔离沙箱预览 |
| `journey-1/css-spec.png` | 类型化 CSS 规范，区分模板默认与声明来源 |
| `journey-1/review.png` | 评审确认 |
| `journey-1/delivered.png` | 固定交付完成，需求状态为已交付 |
| `journey-1/04-git-sync.png` | Git 提交与推送到本地 bare 远端 |
| `journey-1/05-second-copy.png` | 从远端克隆第二工作副本后恢复同一需求 |
| `journey-1/06-settings.png` | 安装版运行环境、安全存储、Git/pen/OpenCode 状态 |
| `journey-1/07-resumed.png` | 关闭客户端后重启，恢复交付与裁决上下文 |

## 旅程二：接入已有项目

| 截图 | 覆盖点 |
| --- | --- |
| `journey-2/01-import-scan.png` | 扫描示例项目，识别历史/当前口径冲突 |
| `journey-2/02-workbench.png` | 导入后形成当前基线与历史替代记录 |
| `journey-2/03-brain-rules.png` | 规则、状态、修订与结构化来源 |
| `journey-2/04-decision.png` | 基于已有规则的迭代产生冲突 |
| `journey-2/artifacts.png` | 生成带来源 CSS 声明的需求与设计产物 |
| `journey-2/css-spec.png` | 来源 CSS 声明值与模板默认值并列展示 |
| `journey-2/review.png` | 评审确认 |
| `journey-2/delivered.png` | 交付导出 |

来源示例目录在导入前后做了 SHA-256 树对比，保持完全一致。

## 旅程三：不同真实需求、补答与保留现行规则

| 截图 | 覆盖点 |
| --- | --- |
| `journey-3/01-a-form-list.png` | 「活动报名」需求生成表单页，字段包含姓名/部门/联系方式 |
| `journey-3/02-a-management.png` | 同一需求生成第二页管理列表，页面页签切换后可见 |
| `journey-3/03-a-review.png` / `03-a-delivered.png` | 报名需求评审与交付 |
| `journey-3/04-a-frozen-reexport.png` | 修改活原型后重新导出，历史交付内容哈希不变 |
| `journey-3/05-b-blocked.png` | 冲突需求因缺少时间窗口进入阻塞未知项 |
| `journey-3/06-b-keep-decision.png` | 补答后提案重绑成功，进入裁决而非“版本已变化” |
| `journey-3/07-b-keep-artifacts.png` | 选择保留现行规则后，产物标题为「按现行规则处理」，并显示未采纳口径 |
| `journey-3/08-b-review.png` / `08-b-delivered.png` | 保留现行规则的产物评审与交付 |
| `journey-3/09-git-recommit.png` | 首次提交后修改首个文件并再次提交成功 |

旅程三与取件码示例无关；它验证了表单 + 管理列表双页、补答重绑、保留现行规则、交付冻结和 Git 二次提交。

## 数据边界回归单测

本轮单独覆盖了以下正常分支，避免只依赖界面旅程：

- 旧格式交付拒绝重导时，原有 `export/index.html` 与 `exported` 状态保留。
- 基线从 planned 激活为 current 后重导历史交付，静态站仍显示交付时的 planned 快照。
- 已应用提案在事后补答非阻塞问题时保持 applied，不改变 planned 基线，不产生 `STALE_PROPOSAL`。
- 应用内历史交付列表使用交付时的需求/基线快照，不随当前记录漂移。
- Git 预暂存了未勾选文件时，提交只包含勾选且实际有变更的路径。
- 模型三字段全部 `required:true` 时第三项保持必填；设置开关 false 显示关闭，A5 选中 A5；fields-only 设置保留 value；重复 page id 去重。
- keep 裁决的字段过滤覆盖 settings groups、list/board columns 与 demo rows 键。
- 0.1.1 形态（有 frozen_path、无 display_snapshot）交付拒绝重导并保留原导出；应用内列表使用冻结标题或旧版占位。
- 原型预置 `sk-...` 后创建的新交付导出失败，错误详情列出命中的文本产物；此前成功导出的 `index.html`、冻结原型哈希与 `exported` 状态不变。
- 已应用提案补答进入 resolved acceptance/core_flows，现有 artifacts 标记 stale；generated/reviewed 回到 analyzed 重新生成，delivered 保持冻结。
- Git 重命名提交同时包含旧/新路径，未选暂存文件仍隔离。

## 重要断言

- 采纳裁决后 `planned` 基线建立，但 `current_baseline_id` 不变。
- 保留现行规则时，生成规格与原型不实现被否决口径；需求文档保留原始输入和裁决记录。
- 补答阻塞问题后，提案以新需求修订重绑，问答进入规则约束与后续规格。
- 页面规格按语义生成；报名需求是第一页表单、第二页列表，第二页不会丢失。
- 交付创建时冻结产物与哈希；修改活产物后重新导出，历史导出字节不变。
- 交付导出包含 `index.html`、`manifest.json`、需求文档、交互规格、原型与 CSS 规范；没有密钥、日志或 `.runtime`。
- 导出前会递归扫描临时目录的全部 HTML / JSON / Markdown / 文本 / CSS 产物；任一文件命中疑似密钥即停止，且不替换上一次成功导出。
- 计划基线不阻塞另一项仍基于现行规则的需求（单测覆盖）。
- Git 状态使用 NUL 分隔路径解析，提交后再次修改首个文件仍可正常提交。

## 复现

```bash
cd apps/desktop
npm test
npm run package
# 方式一：直接使用 release 下的 .app
npm run e2e:packaged
# 方式二：挂载 DMG，复制 .app 到临时目录，再以 PHA_E2E_BINARY 指向安装副本运行
```

注意：`summary.json` 中的临时项目路径在执行结束后可能已不存在；`project-snapshot/` 保留了关键业务文件与交付冻结副本。真实模型调用未在本证据中验证，因为本机没有可用模型凭据；两页模型规格由本地 mock adapter 单测验证并进入生成主链。
