# 更新队列：把「加一个会话」拆成机械步骤和判断步骤

> 2026-11-12 起。目标是把人工介入从「改 6 个文件 + 派 5 个子代理」降到「跑 1 条命令 + 派 3 个子代理」。

## 现状：一次更新要动多少东西

补 3 个会话（08 / 09 / 10）时，实际动作：

| 步骤 | 谁做 | 次数 |
|---|---|---|
| 导入会话（`archive-share`） | 脚本 | 3 |
| 复制到 `inbox/conversations` | 手工 | 3 |
| 写 `inbox/manifest.json` | 手工 | 3 |
| L1 抽取 | 子代理 | 3 |
| L2 抽取 | 子代理 | 3 |
| L4 抽取 | 子代理 | 3 |
| 写 `overlay/archive-map.json` | 手工 | 3 |
| 写 `ceobe-index.json` | 手工 | 3 |
| 更新 `l3-g1` / `l3.1-g1` / `l3-global` coverage | 手工 | 3 |
| L5 组内归并 | 子代理 | 1 |
| L5 全局归并 | 子代理 | 1 |
| 分册更新 | 子代理 | 1 |
| profile 重写 | 子代理 | 1 |
| `memory:import` / `library` / 测试 | 脚本 | 1 |

**手工动作约 20 次**，其中 15 次是「写 JSON 字段」这种机械活。

## 分类：哪些能自动

| 类别 | 步骤 | 能自动吗 |
|---|---|---|
| **机械** | 复制会话、写 manifest / archive-map / ceobe-index、更新 L3 coverage、导入、构建 | ✅ 全自动 |
| **判断** | L1 / L2 / L4 抽取、L5 归并、分册、profile | ❌ 要 LLM |

关键判断：**L5 归并算判断，不算机械**。因为「两个节点是不是同一件事」需要语义判断，脚本做不了。

## 设计

```
npm run memory:queue               # 检测 + 生成工单（只读）
npm run memory:queue -- --apply    # 执行机械步骤（stage + register）
npm run memory:queue -- --prompts  # 把判断步骤写成可直接派发的提示词
npm run memory:queue -- --verify   # 检查判断步骤的产物是否齐全、是否过校验器
npm run memory:queue -- --finalize # 判断步骤完成后收尾（import + library）
```

### `--plan`（默认）

1. 跑 `collectMemoryStatus` + `collectMemoryChecklist`，找出新会话、缺层、L5 缺口、索引问题。
2. 生成工单 `data/private/memory-kernel/queue.json`：

```json
{
  "sessions": [
    {
      "id": "...", "short": "...", "title": "...", "group": "g1", "rounds": 124,
      "tasks": [
        { "id": "l1", "input": "inbox/conversations/<id>.md", "output": "inbox/output/<id>.json", "prompt": "PROMPT.md", "validator": "validate-output.mjs" },
        { "id": "l2", ... },
        { "id": "l4", ... }
      ]
    }
  ],
  "merges": [
    { "id": "l5-group", "input": "global/l5-g1.json", "output": "global/l5-g1.json", "prompt": "PROMPT-L5.md" },
    { "id": "l5-global", ... }
  ],
  "docs": [
    { "id": "threads", "note": "把新会话补进受影响的分册" },
    { "id": "profile", "note": "重跑 memory:profile --assemble，再让子代理重写" }
  ]
}
```

### `--apply`

执行机械步骤：

1. **stage**：复制 `conversation.md` 到 `inbox/conversations/<id>.md`，写 `inbox/manifest.json`（含 `source_hash` = 会话原文的 SHA-256、`last_message_id` = `linear_message_ids` 末条）。
2. **register**：写 `archive-map.json`、`ceobe-index.json`，重算 `counts` 与 `rounds_by_group`，更新 `l3-<group>` / `l3.1-<group>` / `l3-global` 的 coverage。

**所有计数一律从 `sessions` 重算**，不手改——这是上次 `rounds 123 → 124` 那种漏项的根因。

### `--finalize`

跑 `memory:import` + `library`，然后 `npm test` 验证。

### `--prompts`

把工单里的每个判断步骤写成一份可直接派发的提示词，落在
`data/private/memory-kernel/queue-prompts/`：

```
<short>-l1.md / <short>-l2.md / <short>-l4.md
l5-group.md / l5-global.md
threads.md / profile.md
```

每份都写清输入路径、输出路径、提示词、校验器和该层的硬约束。派发时直接读文件，不用现写。

### `--verify`

检查判断步骤的产物：

- 缺文件 → 列出来；
- 有文件 → 跑对应校验器（`validate-output` / `validate-memory` / `validate-events`）；
- 归并树 → 检查文件存在。

有缺项或校验失败时退出码 1，可以接在 CI 里。

## 人工还剩什么

| 步骤 | 为什么不能自动 |
|---|---|
| L1 / L2 / L4 | 要读原文、判断什么重要 |
| L5 归并 | 「是不是同一件事」要语义判断 |
| 分册 | 要判断「哪一步改了方向」 |
| profile | 要判断「什么值得写进一页纸」 |

**从 20 次降到 5 次**：1 条 `--apply` + 3 次子代理派发（L1/L2、L4、L5）+ 1 次分册/profile。

## 已知边界

1. **`source_hash` 必须是会话原文的哈希**，不是 L2 的。L1/L2/L4 三处的 `source_hash` 都要和 manifest 一致，否则 `validate-output` / `validate-memory` / `validate-events` 全报错。
2. **协议 2 的会话没有真实时间戳**，`first` / `last` 从 L2 frontmatter 读（子代理推断的日期），不是 archive 的 `created_at`。
3. **`--apply` 不写 L3/L3.1 的正文**（threads / blocks），只写 coverage。正文要人写。
4. **L5 归并的工单不指定「合并哪几组」**——那是判断，工单只给输入输出和提示词。

## 验收

`scripts/test-memory-queue.mjs` 用最小 fixture 验证：

- `plan()` 检测到新会话，生成 3 个抽取任务 + 2 个归并任务 + 2 个文档任务；
- `stage()` 复制会话、写 manifest（`source_hash` 格式、`last_message_id`、`rounds`）；
- `register()` 写 archive-map / ceobe-index / L3 coverage，计数从 sessions 重算。
