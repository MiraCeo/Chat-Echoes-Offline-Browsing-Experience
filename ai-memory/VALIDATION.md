# 校验规则

`validate-output.mjs` 是零依赖的最终闸门。它不替代 AI 自检，但会拒绝不符合契约的输出。

## 运行

```powershell
node validate-output.mjs --input input --output output
```

示例：

```powershell
node validate-output.mjs --input examples/input --output examples/output
```

退出码 `0` 表示全部通过；`1` 表示有错误。

## 会检查什么

Manifest：

- `kind` 是 `ceobe.memory-input`；
- `schema_version` 是 `1.0.0`；
- 每个会话有 id、`last_message_id`、`source_hash`、`file`；
- id 不重复。

输出：

- manifest 里每个 id 都有 `<id>.json`；
- JSON 可解析，`id` 和 manifest 一致；
- `status` 是 `fresh` 或 `failed`；
- `source.last_message_id` 与 `source_hash` 原样匹配；
- `generator.model` / `prompt_version` / `run_id` 非空；
- `generated_at` 可解析。

`fresh` 额外检查：

- `summary` 非空、≤160 字；
- `tags` 3–6 个，每个 2–16 字、不重复；
- `error` 应为空。

`failed` 额外检查：

- `error` 非空、≤200 字。

## 警告

- manifest 之外的输出文件；
- `fresh` 但 `error` 非空。

警告不算失败，但应该在交接前看一下。

## 不检查什么

- 摘要质量；
- tag 是否准确；
- 是否编造事实；
- 模型/prompt 是否合理。

这些仍需人工抽查或独立评估。
