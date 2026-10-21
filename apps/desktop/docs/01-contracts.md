# Proto Harness Agent 首版契约

版本：1.0
适用范围：`apps/desktop`、`packages/core`、`packages/runtime-adapter`
原则：权威记录在项目文件；界面只经 IPC 调用内核；模型只能产生候选，不能直接写权威记录。

## 1 项目目录契约

```text
<project-root>/
  project.json                     # Product + Endpoint + 当前基线指针 + 迁移版本
  brain/
    evidence/<EVIDENCE-ID>.json
    objects/<OBJECT-ID>.json
    capabilities/<CAPABILITY-ID>.json
    rules/<RULE-ID>/r-<revision>.json
    rules/<RULE-ID>/index.json     # 修订列表与最新修订
    baselines/<BASELINE-ID>.json
    decisions/<DECISION-ID>.json
  requirements/<REQ-ID>/
    requirement.json               # 权威任务状态与需求基线
    proposal.json                  # 最近一次待裁决提案（可无）
    history/r-<revision>.json      # 任务状态历史
    requirement.md
    interaction-spec.json
    artifacts/<artifact files>
  design/tokens.json               # 声明型设计 token（可无）
  artifacts/<ARTIFACT-ID>/...      # 通用产物（原型等）
  deliveries/<DELIVERY-ID>/
    delivery.json
    manifest.json
    export/                        # 静态交付站
  .runtime/                        # 不进入 Git、可重建
    index.json
    activity.jsonl
    model-errors/<timestamp>.json
```

路径规则：

- 所有项目内引用使用相对项目根的 POSIX 路径；外部材料记录绝对路径 + `portable: false`。
- 写入使用 `临时文件 + rename`；跨文件变更先写提案，再校验，再落新版本，最后更新指针。
- `.runtime` 可从项目文件重建；删除不损坏业务记录。

## 2 实体契约

所有实体含 `schema_version`、`id`、`created_at`、`updated_at`。可修订实体含 `revision`。

| 实体 | 必需字段 | 说明 |
| --- | --- | --- |
| Product | id, name, goal, audience, constraints[], endpoints[], current_baseline_id | `project.json` 根 |
| Endpoint | id, product_id, name, role, platform, ui_standard | 端与角色 |
| Evidence | id, product_id, source_type, source_ref, locator, content_hash, captured_at, raw_excerpt | `raw_state` 只记录采集时状态 |
| BusinessObject | id, product_id, name, key_fields[], relations[], evidence_refs[] | 对象不直接等同页面字段 |
| Capability | id, product_id, name, goal, object_refs[], rule_refs[], preconditions[], exceptions[], dependency_refs[], endpoint_refs[], evidence_refs[] | 能力卡保存当前有效定义 |
| Rule | id, product_id, revision, statement, scope, knowledge_status, effective_state, baseline_id, constraints[], evidence_refs[], decision_ref, supersedes | 修订按文件保存 |
| Baseline | id, product_id, name, status, rule_refs[{id,revision}], capability_refs[{id,revision}], formed_by, activated_at, evidence_refs[] | `draft`/`current`/`planned`/`retired` |
| Decision | id, product_id, proposal_hash, base_revision, chosen, reason, confirmed_by, confirmed_at, applied_at, result | 绑定具体提案 |
| Requirement | id, product_id, title, goal, scope, baseline_id, status, impact, unknowns[], acceptance[], rule_refs[], artifact_refs[], next_step, revision, checkpoints[] | 唯一权威任务状态 |
| Artifact | id, requirement_id, type, path, version, rule_refs[], state, provider, provider_revision | 需求文档/交互规格/原型/CSS 规范/映射 |
| Delivery | id, product_id, requirement_id, requirement_revision, baseline_id, rule_refs[], artifact_refs[], manifest, status, source_commit | 固定版本 |

### 2.1 状态

- Rule.knowledge_status：`candidate` | `confirmed` | `superseded`
- Rule.effective_state：`planned` | `current` | `retired`
- Baseline.status：`draft` | `current` | `planned` | `retired`
- Requirement.status：`draft` | `analyzing` | `awaiting_decision` | `analyzed` | `generating` | `reviewed` | `delivered` | `blocked`
- Artifact.state：`draft` | `needs_review` | `reviewed` | `stale`
- Delivery.status：`draft` | `exported` | `failed`

规则是否确认、适用哪个基线、是否已交付必须分开记录。生成交付包不自动把 `planned` 改为 `current`。

## 3 上下文契约

`resolveContext({ projectId, requirementId?, baselineId?, query?, budgetChars? })` 返回：

```json
{
  "baseline": {"id": "...", "status": "current"},
  "rules": [{"id": "...", "revision": 2, "statement": "...", "effective_state": "current", "evidence_refs": []}],
  "capabilities": [],
  "evidence": [],
  "history": [{"id": "...", "status": "superseded", "reason": "..."}],
  "unknowns": [],
  "warnings": []
}
```

过滤顺序：产品范围 → 基线引用与生效状态 → 对象/能力关系 → 任务查询相关性。预算不足时优先保留直接规则与冲突证据，并返回 `warnings` 说明遗漏范围。

## 4 提案与裁决契约

```json
{
  "proposal": {
    "id": "PROPOSAL-...",
    "product_id": "...",
    "requirement_id": "...",
    "base_revision": 3,
    "base_baseline_id": "BASELINE-...",
    "changes": [{"kind": "rule.revise", "rule_id": "...", "from_revision": 2, "statement": "...", "scope": "...", "effective_state": "planned"}],
    "reason": "...",
    "evidence_refs": [],
    "impact": {"actual": [], "verify": [], "keep": []},
    "proposal_hash": "sha256(canonical(proposal without hash))"
  }
}
```

- `recordDecision(proposal, chosen, reason)` 再次读取提案并校验 hash 与 base revision；不一致返回 `STALE_PROPOSAL`。
- `applyDecision(decisionId)` 幂等：已应用返回既有结果，不产生第二份修订。
- 应用顺序：校验 → 写新规则修订 → 写决策 → 更新基线引用 → 标记受影响产物 `stale`。
- 同一规则出现不同业务裁决时不自动合并；界面必须重新展示冲突。

## 5 需求工作流契约

```text
draft -> analyzing -> (awaiting_decision -> analyzed) -> generating -> reviewed -> delivered
```

- 每次状态变更追加 `checkpoints[]`：`{at, from, to, summary}`，并写 `history/r-<revision>.json`。
- `next_step` 由内核计算，界面只展示，不在渲染层推断。
- 未知项：`{id, question, why_blocking, owner, answer, blocking}`；阻塞未知项存在时不得进入 `generating`。
- 纠偏：新提案经裁决后，旧结论标记 `superseded`，受影响 Artifact 标 `stale`，要求重新生成/核对。

## 6 运行时适配契约

```ts
interface RuntimeAdapter {
  id: string;
  label: string;
  describe(): { kind: 'openai-compatible' | 'local-heuristic' | 'external'; model: string | null; configured: boolean };
  analyzeProduct(input): Promise<ProductAnalysis>;
  analyzeRequirement(input): Promise<RequirementAnalysis>;
  proposeKnowledge(input): Promise<KnowledgeProposal[]>;
  generateInteractionSpec(input): Promise<InteractionSpec>;
}
```

- 所有返回先经过内核结构校验；失败写入 `.runtime/model-errors/<timestamp>.json`，任务保留 `blocked` 或回退到本地分析器并标注。
- 模型原始输出完整保存；界面摘要不得来自截断后的 200 字符。
- API Key 只存 Electron `safeStorage`（Keychain），不写项目文件、日志、导出包。
- 本地启发式分析器输出必须带 `source: "local-heuristic"`，界面显示「本地规则分析」。
- 首版生产适配器：OpenAI 兼容 `/chat/completions`；OpenCode 未验证，不接入。

## 7 产物契约

### 7.1 交互规格

```json
{
  "schema_version": "interaction-spec-v1",
  "requirement_id": "REQ-...",
  "baseline_id": "BASELINE-...",
  "source": "local-heuristic | model:<id>",
  "pages": [{
    "id": "PAGE-...",
    "name": "...",
    "responsibility": "...",
    "entry_conditions": [],
    "roles": [],
    "components": [],
    "states": [{"name": "空态", "behavior": "..."}],
    "fields": [],
    "behaviors": [],
    "feedback": [],
    "exceptions": [],
    "design_constraints": [],
    "acceptance_refs": []
  }]
}
```

### 7.2 HTML 原型

- 自包含单 HTML；不引用外部网络资源；不携带密钥、日志、绝对路径。
- 页面标注「交互原型 · 演示数据」，不宣称后端已完成。
- 支持演示数据与主要状态；至少覆盖主路径 + 一个空/异常状态。
- 由交互规格生成，不从固定配置名单硬编码页面。

### 7.3 CSS 规范

```json
{"kind":"color","value":"#1F6F5C","usage":"主操作按钮","component_id":"COMPONENT-...","state":"default","origin":"declared","source_ref":"design/tokens.json"}
```

`origin`：`declared`（用户/项目声明）、`template`（模板默认）、`computed`（真实浏览器计算结果）。首版只声明 `declared` / `template` / 静态扫描结果（静态扫描必须额外标 `extraction: "static-scan"`，不得冒充 computed）。

### 7.4 交付

`delivery.json` + `manifest.json` + `export/index.html` + 需求文档与原型。导出前校验：所有 manifest 路径存在、无密钥/日志/`.runtime`、需求与规则版本一致。缺资源时 Delivery 为 `failed` 并列出缺失项。

## 8 导入契约

- 支持：`.md`、`.txt`、`.json`、`.html`、`.css`，单文件 ≤ 2 MB，最多 4000 个文件。
- 跳过：`node_modules`、`.git`、`dist`、`build`、`.runtime`、二进制与未知格式。
- Markdown 可识别可选 frontmatter：`rule_key`、`status`、`date`、`title`。
- 每个证据保存：相对路径、段落/标题定位、内容 hash、采集时间、原文摘要。
- 冲突识别：同 `rule_key` 且内容/状态不同；无 `rule_key` 时用标题归一化 + 主题词 + 矛盾词（必须/不得/仅/可）启发式，标为 `heuristic`，不得当作业务事实。
- 导入不修改原目录；不执行任何脚本。

## 9 IPC 契约

渲染层通过 `window.pha.*` 调用；所有方法返回 `{ok: true, data}` 或 `{ok: false, error: {code, message, details?}}`。

```text
settings.get / settings.update / settings.testModel
projects.list / projects.create / projects.open / projects.remove
projects.importScan / projects.importApply
brain.overview / brain.list / brain.get / brain.propose / brain.decide / brain.activateBaseline
requirements.list / requirements.create / requirements.analyze / requirements.generate / requirements.get
deliveries.list / deliveries.create / deliveries.export
git.status / git.commit / git.push
dialog.pickDirectory / dialog.pickFiles / shell.openPath / shell.openExternal
```

安全约束：

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 所有路径参数必须是绝对路径或项目内相对路径；项目外路径必须来自系统文件选择器或已登记来源。
- 渲染层不能传任意命令；Git 只通过内核固定参数执行。
- 预览 HTML 使用 `sandbox="allow-scripts"` 的 iframe/srcdoc，不获得桌面能力。

## 10 Git 契约

- 只读状态：`git status --porcelain=v1`、`git diff --stat`、`git rev-parse --abbrev-ref HEAD`、`git remote -v`。
- 提交：仅提交用户勾选的项目文件；提交信息由用户输入或内核生成含需求 ID 的默认值。
- 推送：只在用户点击后执行；显示远端、分支、ahead/behind；失败保留提交并报告原因。
- 禁止：force push、reset --hard、clean -f、修改 git config。

## 11 错误码

`INVALID_INPUT`、`NOT_FOUND`、`PATH_OUTSIDE_PROJECT`、`STALE_PROPOSAL`、`BASELINE_invalid`、`MISSING_RESOURCE`、`RUNTIME_NOT_CONFIGURED`、`RUNTIME_FAILED`、`GIT_FAILED`、`UNSUPPORTED_FORMAT`、`BLOCKING_UNKNOWN`、`DELIVERY_INCOMPLETE`。

界面必须展示错误码与可执行下一步，不得只显示「失败」。
