# 时间线摘要契约（1.2 骨架）

状态：**只搭骨架，不生成摘要**。1.2 的时间模块保持确定性；摘要能力留到 1.3。

## 数据文件

页面会尝试读取可选文件：

```text
replay/public/timeline-summaries.json
```

文件不存在、返回非 200、或格式不合法时：**不显示摘要，也不显示占位**。

```json
{
  "schema_version": "1.0.0",
  "kind": "ceobe.timeline-summaries",
  "conversations": {
    "<conversation-id>": {
      "summary": "一段 1–2 行的中文摘要。",
      "status": "fresh",
      "source": {
        "last_message_id": "<生成摘要时该会话的最后一条可见消息 id>"
      },
      "generator": {
        "model": "future-model",
        "prompt_version": "future-prompt-version"
      },
      "generated_at": "2026-10-28T00:00:00Z"
    }
  }
}
```

## 渲染规则

1. 只渲染 `status === "fresh"` 的条目；
2. `source.last_message_id` 与会话当前 `last_message_id` 不一致时**不渲染**（视为过期）；
3. 摘要只出现在**卡片视图**，列表与时间轴暂不渲染；
4. 摘要节点为 `.ceobe-timeline-card-summary`，最多两行，带 `data-ai-summary`；
5. 无摘要时卡片不新增空节点、不增加固定高度；
6. 1.2 不调用模型、不生成摘要、不把摘要写入 `timeline-index.json`。

## 1.3 要补的能力

- 生成 pipeline、模型/提示词版本；
- `stale` / `failed` 的界面状态与重生成；
- 列表悬停/详情弹层；
- 批量/增量生成、成本与失败重试；
- 本地/云端与隐私 opt-in；
- 摘要质量与人工纠错。

## 测试

`test-timeline-browser.mjs` 在浏览器端拦截 `timeline-summaries.json`，注入三条 fixture：

- `fresh` + 源匹配：显示；
- `stale`：不显示；
- `fresh` + `last_message_id` 不匹配：不显示。

测试不依赖真实模型，也不向仓库写入假摘要。
