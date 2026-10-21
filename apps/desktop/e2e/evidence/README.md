# 安装产物端到端验证证据

执行日期：2026-10-21（安装产物由提交 `8cefc82` 构建）
源码提交：`8cefc826dce3f28ce654e8726fad72095f477598`
安装产物：`apps/desktop/release/Proto-Harness-Agent-0.1.0-arm64.dmg`
验证方式：挂载 DMG → 将 `Proto Harness Agent.app` 复制到临时安装目录 → 直接启动安装副本 → 运行 `e2e/journeys.mjs`。
签名状态：ad-hoc 签名，未使用 Developer ID，未公证。
分析来源：本地规则分析（未调用真实模型；模型适配器另有 mock HTTP 单测）。

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
  "no_secrets_in_export": true
}
```

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

项目快照位于 `journey-1/project-snapshot/`，包含基线、裁决、需求、交互规格、原型、CSS 规范、交付清单与导出首页。

## 旅程二：接入已有项目

| 截图 | 覆盖点 |
| --- | --- |
| `journey-2/01-import-scan.png` | 扫描示例项目，识别 1 组历史/当前口径冲突 |
| `journey-2/02-workbench.png` | 导入后形成当前基线与历史替代记录 |
| `journey-2/03-brain-rules.png` | 规则、状态、修订与结构化来源 |
| `journey-2/04-decision.png` | 基于已有规则的迭代产生冲突 |
| `journey-2/artifacts.png` | 生成带来源 CSS 声明的需求与设计产物 |
| `journey-2/css-spec.png` | 来源 CSS 声明值与模板默认值并列展示 |
| `journey-2/review.png` | 评审确认 |
| `journey-2/delivered.png` | 交付导出 |

项目快照位于 `journey-2/project-snapshot/`。验证同时比对了来源示例目录的 SHA-256 树，确认导入前后完全一致。

## 重要断言

- 采纳裁决后 `planned` 基线建立，但 `current_baseline_id` 不变。
- 需求固定使用计划基线，交付清单包含 5 项产物与规则版本。
- 交付导出包含 `index.html`、`manifest.json`、需求文档、交互规格、原型与 CSS 规范；没有密钥、日志或 `.runtime`。
- 未提交时交付会记录“未绑定 Git 提交”警告；本次旅程在交付后完成提交与推送，并验证远端 `refs/heads/main`。
- 第二工作副本从远端克隆后可直接恢复需求与交付。
- 导入规则修订后仍能解析到来源证据，需求上下文显示“来源证据”而非空列表。

## 复现

```bash
cd apps/desktop
npm test
npm run package
# 方式一：直接使用 release 下的 .app
npm run e2e:packaged
# 方式二：挂载 DMG，复制 .app 到临时目录，再以 PHA_E2E_BINARY 指向安装副本运行
```

注意：`summary.json` 中的临时项目路径在执行结束后可能已不存在；`project-snapshot/` 保留了关键业务文件。真实模型调用未在本证据中验证，因为本机没有可用模型凭据。
