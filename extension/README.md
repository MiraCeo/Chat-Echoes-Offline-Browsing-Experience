# CEOBE 采集扩展（暂停）

状态：**未达成目标，暂停**。不要把它当成可用功能。

## 结论

目标是"不建分享链接也能结构化采集会话"。实际验证结果：

- 页面确实会请求 `GET /backend-api/conversations/<id>`，首屏是 `?num_turns=10`（16 条消息）；
- 更早的消息由页面在**真实用户滚动**时请求：`?before=<游标>&num_turns=10`（实测 200 / 558 KB / 71 条）；
- **程序化设置 `scrollTop` 不会触发该懒加载**，所以在扩展里自动滚动始终只能拿到首屏；
- 若要求用户手动滚到顶再导出，体验与可靠性都不如**分享链接归档**（后者已稳定、有测试、可复现）。

因此：无分享链接时的采集"顺手可得"这个前提不成立，本线暂停。

## 仍然有价值的产出（已并入主项目）

- `scripts/convert-web-capture.mjs`：把 `conversations` 接口响应（含分页并集、每页重叠）转成 CEOBE canonical JSON，标注 `usable_linear`。
- `scripts/import-web-capture.mjs`：转换 → 归档守卫 → `archive/chatgpt-web/<id>/<时间戳>/`。
- `scripts/convert-web-capture`/`import-web-capture` 可直接用于**官方 Export Data** 或其他来源的同类载荷。

## 若要重开这条线

唯一有希望的方向不是滚动，而是：从页面 React fiber 上读取消息对象（本目录 0.1 诊断版提供过 props 探针），或改用官方 Export Data 的整账号导出。两者都应在写采集逻辑前先证明"一条命令拿到全部消息"。