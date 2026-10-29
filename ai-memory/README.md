# CEOBE AI 记忆内核（文件包）

这是一个**不启服务**的 AI 记忆总结内核：

- 一份复杂 `PROMPT.md`；
- 一套输入/输出文件契约；
- 一个零依赖校验器；
- 一组合成示例。

它不直接连接 CEOBE，不读取 `archive/`，也不写 `replay/`。由外部 AI（带文件读写能力）读取 `input/`，把结果写到 `output/`；CEOBE 之后再把 `output/` 接回。

## 目录

```text
ai-memory/
  PROMPT.md                  # 交给 AI 的主提示词
  README.md
  VALIDATION.md              # 校验规则
  validate-output.mjs        # 零依赖校验器
  schema/
    input.schema.json
    output.schema.json
  examples/
    input/
      manifest.json
      conversations/example-conversation.md
    output/
      example-conversation.json
  input/                     # 实际输入，gitignore
  output/                    # 实际输出，gitignore
```

## 工作流

```text
1. 把 CEOBE 导出的 manifest + conversation Markdown 放进 input/
2. 让 AI 按 PROMPT.md 读取 input/，逐会话写入 output/<id>.json
3. 运行：
   node validate-output.mjs --input input --output output
4. 把 output/ 交回 CEOBE，由 CEOBE 导入为 timeline-summaries.json
```

## 输入约定

- `input/manifest.json`：会话列表、标题、首末时间、轮次、`last_message_id`、`source_hash`、文件名。
- `input/conversations/<id>.md`：一个会话一个 Markdown 文件，YAML frontmatter + 用户/助手可见消息。
- 不包含隐藏记录、推理、工具往来；附件正文默认不导出。

## 输出约定

- 一个会话一个 `output/<id>.json`；
- 摘要和 tag 必须是同一条记录；
- 必须回显 `last_message_id` 与 `source_hash`；
- `status` 只能是 `fresh` 或 `failed`；
- 失败写 `error`，不要写空文件；
- 允许部分成功；校验器会报告缺失条目。

## 迁移到其他工作区

把整个 `ai-memory/` 目录复制走即可。只需要 Node.js（校验器无第三方依赖），不需要 CEOBE 的构建链。

迁移后：

1. 用 `examples/` 先跑通一次校验：
   ```powershell
   node validate-output.mjs --input examples/input --output examples/output
   ```
2. 用真实 `input/` 替换示例；
3. 让接手模型读 `PROMPT.md`，按目录约定执行；
4. 把 `output/` 和校验结果一起带回来。

## 版本

- 文件包版本：`0.1.0`
- 输入契约：`ceobe.memory-input` / `1.0.0`
- 输出契约：`ceobe.timeline-summaries` / `1.0.0`

`PROMPT.md` 里固定了 `prompt_version`，修改提示词时请同步改它，方便以后追溯。

## 不做什么

- 不启 HTTP 服务；
- 不建数据库；
- 不鉴权、不部署；
- 不读写 CEOBE 的 `archive/`；
- 不直接写 `replay/`；
- 不把摘要/tag 写回原始聊天 JSON。

这是有意为之：AI 内核只做“文件 → 总结 → 文件”，CEOBE 负责校验和展示。
