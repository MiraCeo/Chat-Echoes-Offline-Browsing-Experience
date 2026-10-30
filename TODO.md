# 后续计划

[项目介绍](README.md) · [使用指南](docs/usage.md) · [开发指南](docs/development.md) · [交接说明](HANDOVER.md) · [变更记录](CHANGELOG.md)

这里只记录**还没做**或**等你决定**的事；已完成的能力、性能数字和踩过的坑在
[HANDOVER](HANDOVER.md) 与 [CHANGELOG](CHANGELOG.md)，不在这里重复。

**版本口径**：**1.2 = 时间模块基础**（时间线 + 时间轴）；**1.3 = AI 整理与事件线**。
当前 package 版本是 `1.2.0`，CHANGELOG 已归并为单一的 `1.2.0（2026-10-30）`；
还差 tag / push / 正式发布。

## 一、1.2 收尾状态

2026-10-30 验证结果：

- `npm test`：全量通过（含 Turbo 会话切换回归）；
- `npm run check`：40 页巡检通过；
- `npm run build`：生产构建通过；
- 当前档案：34 个会话；stale 摘要已清理到 34 条，源文件与 `replay/public` 一致；
- 最新提交以 `git log -1` 为准。

已完成但不需要再列进待办：

- 时间线列表/卡片、时间轴缩略/详情；
- 224px 卡片、4 行摘要、模型右上、tag 摘要后、单行底栏、三档活跃颜色；
- 真实 `timeline-summaries.json` 接入；
- 删除硬链接 stage + replay 逐文件增量提交；
- 每次删除前的 archive 硬链接快照 + `npm run archive:backup`；
- 会话→会话 Turbo 持久侧栏；
- 单一 `1.2.0` CHANGELOG 与 stale 摘要清理：`npm run timeline:summaries:prune`。

## 二、1.2 发布前需要你确认

1. **tag / push**
   - 本地 `main` 领先 `origin/main`，提交尚未推送；
   - 发布收尾需要决定是否打 tag、是否 push。

2. **archive 备份的运维边界**
   - 当前每次删除生成一份完整硬链接快照，不自动清理；
   - 目前只有 1 份基线快照；没有列表/恢复 CLI、没有保留策略；
   - 硬链接只防误删，不防磁盘损坏；需要把 `archive-backups` 复制到异盘/外部介质。

3. **Turbo 的已知边界**
   - 首次打开页面仍会先显示静态一行，再加载完整目录；
   - 从时间线等顶层页第一次进入会话仍是整页加载；
   - 当前只接管会话页之间的链接；
   - 需要决定这些作为 1.2 已知限制，还是发布前继续补首屏缓存/跨层级归一化。

## 三、1.2 后已确认的优化（不阻塞发布）

- **首屏目录缓存/skeleton**：消除首次打开以及顶层页→会话的一行闪烁；
- **Turbo 跨目录扩展**：统一侧栏绝对链接后，覆盖时间线→会话；
- **删除/导入构建性能**：当前导入完整构建约 103.7s，删除构建 23–35s；
  下一步是合并装饰步骤或做增量导入/原地 delta 构建；
- **备份运维**：增加快照列表、恢复命令、保留策略和异盘复制提示；
- **摘要自动 prune**：删除/导入后清理不再存在的会话摘要。

## 四、已评估、暂不做

- **档案 MCP server**：`export:json` 与 `search-index.json` 已覆盖跨工具访问，
  真正缺的是检索质量与时间线；将来有检索/记忆内核后再做只读薄适配层；
- **顶层 5 页每趟都重建**：给 builder 加输入指纹收益小于风险；
- **`bookmarks` 步骤未并入统一后处理缓存**：收益约 5 秒，且可能改变 SVG 转义；
- **内联附件引用胶囊**：保留现状，不进 Tab 序、无点击行为。

## 五、明确不做

- 云端共享、AI 记忆服务端、AI 续聊；登录态采集路线；
- Claude 分享适配（没有需求/样本，不是待素材）；
- 把附件资源打进 MD 导出；
- 把本地项目简介当 AI 指令或混入聊天导出；
- 把原始参考网页或私人捕获重新引入构建依赖；
- 手机版 PDF 应用内入口；
- 官方 Export Data 导入（交付方式只有邮件）。

## 六、已定案（只记录，不需要动作）

- **DIL 控件外观**：维持方案 B，纯图标按钮 `:empty` 隐藏；
- **`MemoryCite` / `writing_block`**：匿名分享页不渲染，维持纯文本降级；
- **外观漂移**：维持局部冻结基线；
- **项目页图标**：非交互容器，修改走项目设置；
- **书签面板/离屏旁注**：维持现有停靠与视口附近布局策略；
- **资料库语义**：文件夹当标签用、上传文件不进 `archive/`、任何路径不删原文件。

## 七、已知限制

- 部分分享资源 unresolved；正文中指向作者本机图片的引用永远拿不到字节；
- 单文件 HTML 导出仍实验性，图片不内嵌；
- 生产 HTML 引用带哈希资源，裸路径命中 SPA 回退；
- Windows 保留端口可能让 5173 绑定失败；
- 删除仍约 30–43s，主要成本是整库构建（stage 复制已降到 5s 左右）；
- Turbo 只覆盖会话→会话；首次页面与顶层页→会话仍整页加载；
- archive 快照是硬链接，不替代异盘备份，也不会自动清理。

## 八、1.3 候选（未批准）

按依赖顺序：

1. **事件时间线**：从聊天整理带 `occurred_at` / `recorded_at` / `sources` / `status` / `confidence` 的事件，
   与档案时间线共用时间轴；先做数据契约和只读视图；
2. **会话内事件树**：语义话题节点，`parent_id/children`，`spans[]` 支持不连续消息，
   `links[]` 表达跨会话关联；
3. **长期记忆/事实层**：带 `valid_at/invalid_at` 的事实，与事件树互相反哺；
4. **跨聊天事件树**：先只给“建议续接”，不自动合并；
5. **MCP 薄适配层**：等检索/记忆内核出现后再做。

参考项目：`getzep/graphiti`、`mem0ai/mem0`、`basicmachines-co/basic-memory`、
`JerryZLiu/Dayflow`、`ActivityWatch/activitywatch`、`syncable-dev/memtrace-public`、
`cyresearch/chatgpt-memory-extraction`。

---

所有新增写入测试继续使用隔离数据。`archive/` 是只增不改的原始档案；删除项目保留聊天，
聊天永久删除必须保留确认、恢复快照和 journal。**本文列出的待办不代表已获实施授权。**

**不要把 `archive/` 或 `data/private/` 用 junction/symlink 接进会被递归删除的临时目录或 git 工作树**：
Windows 上 `git worktree remove --force` 会穿过 junction 把真实档案删空（2026-10-24 发生过一次）。
隔离测试请真实复制需要的部分，参考 `scripts/test-sidebar-client-render.mjs`。
