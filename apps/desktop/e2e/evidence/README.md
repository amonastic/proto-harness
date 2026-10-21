# 安装产物端到端验证证据

执行日期：2026-10-21（返修版安装产物）
客户端版本：0.1.2
源码提交：`311d18d2fbbf94971e619ffb873eb5a5933d7392`
安装产物：`apps/desktop/release/Proto-Harness-Agent-0.1.2-arm64.dmg`
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

单元测试：52 项全部通过，覆盖页面类型推断、模型两页规格进入产物、补答重绑、保留现行规则、交付冻结、并行计划基线、Git 二次提交，以及本轮新增的非破坏导出、展示快照、已应用提案补答、精确提交和字段/设置忠实度。

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
- Git 预暂存了未勾选文件时，提交只包含勾选且实际有变更的路径。
- 模型三字段全部 `required:true` 时第三项保持必填；设置开关 false 显示关闭，A5 选中 A5；保留现行规则时被否决字段被过滤。

## 重要断言

- 采纳裁决后 `planned` 基线建立，但 `current_baseline_id` 不变。
- 保留现行规则时，生成规格与原型不实现被否决口径；需求文档保留原始输入和裁决记录。
- 补答阻塞问题后，提案以新需求修订重绑，问答进入规则约束与后续规格。
- 页面规格按语义生成；报名需求是第一页表单、第二页列表，第二页不会丢失。
- 交付创建时冻结产物与哈希；修改活产物后重新导出，历史导出字节不变。
- 交付导出包含 `index.html`、`manifest.json`、需求文档、交互规格、原型与 CSS 规范；没有密钥、日志或 `.runtime`。
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
