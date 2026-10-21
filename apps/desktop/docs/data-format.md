# Proto Harness Agent 数据格式

版本：`pha-project-v1`
原则：可读文件是权威记录；索引与日志可从项目文件重建；模型不直接写权威记录。

## 1 目录

```text
<project>/
  project.json
  brain/
    evidence/<EVIDENCE-ID>.json
    objects/<OBJECT-ID>.json
    capabilities/<CAPABILITY-ID>.json
    rules/<RULE-ID>/r-<revision>.json
    rules/<RULE-ID>/index.json
    baselines/<BASELINE-ID>.json
    decisions/<DECISION-ID>.json
    import-report.json          # 接入项目时生成
    asset-map.json              # 接入项目的文件/页面映射
  requirements/<REQ-ID>/
    requirement.json
    proposal.json
    analysis.json
    analysis-resolved.json       # 裁决后的生成口径
    analysis-source.json
    history/r-<revision>.json
    requirement.md
    interaction-spec.json
    artifacts/prototype.html
    artifacts/css-spec.json
    artifacts/mapping.json
    artifacts/spec-generation.json
  design/
    source-css-spec.json        # 导入来源的静态扫描声明值
  deliveries/<DELIVERY-ID>/
    delivery.json
    manifest.json
    frozen/                     # 创建交付时冻结的产物副本
    export/                     # 从 frozen 生成的静态交付站
  .runtime/                     # 不进入 Git，可删除重建
```

所有项目内引用使用相对项目根的 POSIX 路径。项目外来源记录相对来源、绝对定位与 `portable: false`。

## 2 核心实体

### project.json

```json
{
  "schema_version": "pha-project-v1",
  "id": "PRODUCT-...",
  "name": "社区驿站取件",
  "goal": "...",
  "audience": "...",
  "constraints": ["..."],
  "endpoints": [{"id": "EP-...", "name": "作业端 App", "role": "门店店员", "platform": "App"}],
  "current_baseline_id": "BASELINE-...",
  "source_roots": [{"path": "/absolute/source", "portable": false}],
  "open_questions": [],
  "created_at": "...",
  "updated_at": "...",
  "revision": 1
}
```

### Rule

```json
{
  "schema_version": "pha-rule-v1",
  "id": "RULE-PICKUP-REOPEN-...",
  "product_id": "PRODUCT-...",
  "revision": 2,
  "topic": "取件码开柜规则",
  "statement": "同一取件码在 2 分钟内可重复开柜，不改变订单状态。",
  "scope": "作业端 App",
  "knowledge_status": "confirmed",
  "effective_state": "planned",
  "baseline_id": "BASELINE-...",
  "constraints": ["生效条件：..."],
  "evidence_refs": ["EVID-..."],
  "decision_ref": "DECISION-...",
  "supersedes": {"id": "RULE-...", "revision": 1},
  "created_at": "..."
}
```

- `knowledge_status`：`candidate` / `confirmed` / `superseded`
- `effective_state`：`planned` / `current` / `retired`
- 规则修订按文件保存，不覆盖旧裁决依据。

### Baseline

```json
{
  "schema_version": "pha-baseline-v1",
  "id": "BASELINE-...",
  "status": "planned",
  "rule_refs": [{"id": "RULE-...", "revision": 2}],
  "capability_refs": [{"id": "CAP-...", "revision": 1}],
  "formed_by": "decision",
  "activated_at": null,
  "notes": "..."
}
```

`status`：`draft` / `current` / `planned` / `retired`。同一时间只有一个 `current`。切换当前基线后，被引用的规则修订变为 `current`，不再引用的旧修订变为 `retired`。

### Requirement

```json
{
  "schema_version": "pha-requirement-v1",
  "id": "REQ-...",
  "title": "...",
  "goal": "...",
  "raw_input": "...",
  "baseline_id": "BASELINE-...",
  "status": "awaiting_decision",
  "scope": {"in_scope": [], "out_of_scope": []},
  "impact": {"actual": [], "verify": [], "keep": []},
  "unknowns": [{"id": "U-...", "question": "...", "blocking": true, "answer": ""}],
  "acceptance": [],
  "rule_refs": [],
  "artifact_refs": [],
  "analysis_source": "local-heuristic",
  "next_step": "处理业务裁决",
  "revision": 3,
  "checkpoints": [{"at": "...", "from": "analyzing", "to": "awaiting_decision", "summary": "..."}]
}
```

`status`：`draft` / `analyzing` / `awaiting_decision` / `analyzed` / `generating` / `generated` / `reviewed` / `delivered` / `blocked`。

### Proposal 与 Decision

提案包含 `base_revision`、`base_baseline_id`、`changes`、`reason`、`evidence_refs`、`conflicts` 与 `proposal_hash`。哈希只覆盖不可变内容；状态字段变化不影响绑定。

裁决保存 `proposal_hash`、`base_revision`、`chosen`、`reason`、`confirmed_by`、`confirmed_at`、`applied_at` 与 `result`。应用前重新校验哈希、需求修订、提案基准基线与该基线中的规则修订；不一致返回 `STALE_PROPOSAL`。

补答阻塞未知项时，提案会把已确认问答写入 `confirmed_answers` 与规则约束，并以新的需求修订重绑 `base_revision`/`proposal_hash`，避免正常补答被误判为版本漂移。规则修订校验以提案基准基线为准，其他计划基线中的新版本不会阻塞基于现行基线的需求。

### Artifact

```json
{
  "type": "prototype",
  "path": "requirements/REQ-.../artifacts/prototype.html",
  "provider": "local-heuristic",
  "provider_revision": "content-hash",
  "state": "draft",
  "rule_refs": [{"id": "RULE-...", "revision": 2}]
}
```

`state`：`draft` / `needs_review` / `reviewed` / `stale`。规则变化时，受影响产物标记为 `stale`，阻止直接交付。

交互规格页面新增 `type`：`form` / `list` / `board` / `settings` / `dashboard` / `detail`，并可用 `fields`、`columns`、`board_columns`、`groups`、`metrics`、`sections` 表达对应页面结构。`spec-generation.json` 记录本次规格来自模型还是本地回退，以及页数。

### Delivery

`delivery.json` 保存需求修订、基线、规则引用、产物引用、manifest、来源提交、状态与警告。创建交付时，产物会复制到 `deliveries/<id>/frozen/`；`manifest.json` 保存每个文件的原始路径、`frozen_path`、大小与 SHA-256。导出只读取冻结副本并校验哈希，活产物后续变化不会影响历史交付；缺失或篡改冻结内容会阻止导出。

## 3 来源与可迁移性

- 项目内文件使用相对路径。
- 导入来源记录相对路径、绝对路径与 `portable: false`；跨设备时绝对路径无效，需要重新选择来源。
- 证据保留采集时的内容摘要与段落定位；Git 提交不等于业务已确认。
- 导入过程不执行来源脚本，不改写来源目录。

## 4 运行目录

`.runtime/` 包含：

- `index.json`：规则、需求、产物、交付计数；
- `activity.jsonl`：操作记录；
- `model-errors/<timestamp>.json`：模型失败摘要与原始输出。

`.runtime/` 默认加入项目 `.gitignore`，可安全删除后由内核重建。

## 5 迁移

- 每个文件带 `schema_version`。读取到未知主版本时拒绝打开，不静默覆盖。
- 迁移应先备份项目目录，再写入新格式，并保留原文件。
- 当前首版只使用 `pha-*-v1`；没有需要迁移的历史格式。
- 升级客户端不应改变业务 ID、裁决理由与交付固定版本。
