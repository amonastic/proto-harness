# H09 DeepSeek Adapter（P5，人读说明）

> 批次：P5（H09 DeepSeek 任务级准入，第一个模型子包）
>
> 授权原话（用户 2026-08-19）："产出 P5 任务包"、"只关注 DeepSeek"
>
> 机器契约：`harness/engineering/adapters/deepseek.json`

## 定位

H09 按主任务包第 20 章分为按模型独立的子包；P5 只交付 DeepSeek。本 adapter 只处理宿主工具语法、上下文编排、输出结构和错误映射，**不改变事实、授权、禁止项、P0 与完成标准**。LongCat / GLM / Codex 留 P6+，P5 不实现、不预留骨架。

## 复用关系

- 执行端复用 P1/H02A 已验证的 `scripts/harness/providers/execution-runtime.js`（`createExecutionRuntime`，provider_id `P-DEEPSEEK-V4-FLASH`，官方 API `deepseek-chat`）。
- 判定复用统一 provider 协议（`scripts/harness/lib/runner/protocol.js` 的 request/result 结构）与 P2/H04 的 fixture 格式（`tests/harness/fixtures/corpus/corpus.json`）。
- 接口契约以 P1 实际实现为准：`describe()` / `config()` / `buildContextId()` / `call({runId, taskId, prompt})`（P5 任务包 §8.2 提及的 `createSession()/executeStep()/judge()` 与 P1 实际接口不一致，以实际产物为准，见交付记录）。

## 配置

| 环境变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | 无 | 缺失时 `call()` 抛 `H02A_EXECUTION_API_KEY_MISSING`，qualify 拒绝运行 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | 官方端点 |
| `DEEPSEEK_MODEL_ID` | 否 | `deepseek-chat` | 官方 chat 端点模型 ID（"v4 flash" 为产品称呼） |

## 错误映射（四类）

| 分类 | 判定信号 | 处理 |
| --- | --- | --- |
| `api_failure` | key 缺失、HTTP 401/429/5xx、网络超时（30s）、`H02A_EXECUTION_CALL_FAILED` | qualify 记录为失败；按 `--retry <N>` 重试 API 层失败，超过阈值输出诊断并暂停 |
| `model_refusal` | 空完成、content policy 拒绝、choices 为空 | 记录为失败（模型端拒绝，不重试） |
| `format_error` | 输出无法解析为 verdict JSON / 缺 `verdict` 字段 | 记录为失败（格式错误） |
| `semantic_failure` | 输出可解析但 verdict 与 `fixture.expected.verdict` 不一致 | 记录为失败（语义失败，违反 fixture 预期） |

## 准入语义（harness:qualify）

1. 从 `tests/harness/epochs/qualification-matrix.json` 读取任务族（初始全部预期档位 `L2`，用户 2026-08-19 裁决方案 A）。
2. 从 corpus.json 按 `scenario_type`（任务族）与 `priority` 选取 fixture：`P0` 每族最多 5 个（每 fixture 跑 5 次）、`P1` 最多 3 个（3 次）、`P2` 最多 3 个（3 次）。
3. 模型对每个 fixture 输出 verdict JSON（`{"verdict":"pass"|"fail","reason":"..."}`），与 `fixture.expected.verdict` 比对判定通过/失败。
4. 档位分配（§5.3 + 用户裁决）：

| 档位 | 条件 | 权限 |
| --- | --- | --- |
| `L0` | P0 任一失败（同一 fixture 连续失败 2 次立即判定并停止该族） | 明确拒绝该任务族 |
| `L1` | P0 全通过，P1 任一失败 | 只读观察（shadow observe） |
| `L2` | P0+P1 全通过，P2 任一失败；或族内无 P2 fixture（2026-08-19 用户裁决，保守停 L2） | 受限写入（需人工审阅） |
| `L3` | P0+P1 全通过，P2 2/3 通过 | 保守推断档位 |
| `L4` | P0+P1+P2 全通过 | 真实写入仓库（repo-write） |

5. 产物：`.harness-runtime/qualification/deepseek.json`（任务族 × 档位矩阵，gitignored）。

## 使用

```bash
# 真实准入（需要 DEEPSEEK_API_KEY）
npm run harness:qualify -- --provider deepseek \
  --matrix tests/harness/epochs/qualification-matrix.json \
  --out .harness-runtime/qualification/deepseek.json

# 链路验证（本地合成 provider，不读 key，产物标记 dry_run: true）
npm run harness:qualify -- --provider deepseek \
  --matrix tests/harness/epochs/qualification-matrix.json \
  --out .harness-runtime/qualification/deepseek.json --dry-run
```

## 边界

- P5 只实现 DeepSeek；`--provider` 传其他模型名直接拒绝（未实现，不静默）。
- 准入矩阵是准入判定输入，不是 H11 正式切换；`L3/L4` 组合进入切换清单需 H11 单独授权。
- 测试通过 `fetchImpl` 注入 / local-fixture adapter 覆盖，不依赖真实 API key。
