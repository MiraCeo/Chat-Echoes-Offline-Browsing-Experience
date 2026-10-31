# 后续计划

[项目介绍](README.md) · [使用指南](docs/usage.md) · [开发指南](docs/development.md) · [交接说明](HANDOVER.md) · [变更记录](CHANGELOG.md)

这里只记录**还没做**或**等你决定**的事；已完成的能力、性能数字和踩过的坑在
[HANDOVER](HANDOVER.md) 与 [CHANGELOG](CHANGELOG.md)，不在这里重复。

**版本口径**：**1.2 = 时间模块基础**（时间线 + 时间轴）；**1.3 = AI 整理与事件线**。
当前 package 版本是 `1.2.2`，CHANGELOG 已归并为 1.2.2（2026-10-31）；1.2.1 保留为历史 tag。
`v1.2.1` 已 tag 并 push；`1.2.2` 目前只在本地，未 tag、未 push。
按本地服务口径不创建 GitHub Release 页面。

## 〇、当前工作流（2026-10-31 起）

**记忆内核先完成完整的 L1–L5，再一次性接入 CEOBE；不再逐层拆开交付。**

- 项目记忆、L3.1 页面、项目跳转和 overlay 适配**冻结**，保留当前只读预览，不继续单独演进；
- 内核完成 L1–L5 后，按一份统一包直接接入，不在中间层反复改接口；
- 在冻结期间，CEOBE 只做与记忆无关的工程、备份、性能、文档和发布项；
- 现有 `docs/memory-kernel-l3-contract.md` 是 L3/L3.1 的临时桥接契约，不是最终全量接入契约。

## 一、1.2 收尾状态

2026-10-31 验证结果：

- `npm test`：全量通过（含 Turbo 会话切换、记忆 v2 回归）；
- `npm run check`：38 页巡检通过；
- `npm run build`：生产构建通过（性能测试前）；
- 当前档案：31 个会话（gq 10 / g1 6 / 未分组 15）；1 份 31 会话 archive 基线；
- 性能测试导入的 `6ae5fe47` 已删除，测试产生的 32 会话快照也已清理；
- `v1.2.1` 已推送到 `origin/main`，annotated tag 已推送；`1.2.2` 工程修复版只在本地，未 tag、未 push；
- 最新提交以 `git log -1` 为准。

已完成但不需要再列进待办：

- 时间线列表/卡片、时间轴缩略/详情；
- 224px 卡片、4 行摘要、模型右上、tag 摘要后、单行底栏、三档活跃颜色；
- 真实 `timeline-summaries.json` 接入；
- 删除硬链接 stage + replay 逐文件增量提交；
- 每次删除前的 archive 硬链接快照 + `npm run archive:backup`；
- 快照列表、单会话恢复、异盘导出 CLI；
- 本地页面 Turbo 持久侧栏（会话、导入、资料库、项目、时间、记忆），侧栏链接/图标已绝对化；
- 首屏 8 行（窄屏 6 行）sidebar skeleton，数据到达后替换；
- 记忆覆盖层 v2 接入：L3.1 四块、主线、theme、delta、ungrouped；
- 单一 `1.2.2` CHANGELOG（1.2.1 保留历史）与 stale 摘要清理：`npm run timeline:summaries:prune`。

## 二、1.2 发布后待确认

1. **GitHub Release 页面**
   - 不创建。CEOBE 是本地服务，发布以 tag 和 CHANGELOG 为准；
   - 本轮 1.3 记忆接入尚未定版本，不新建 release/tag。

2. **archive 备份的运维边界**
   - 已增加 `archive:backups`、`archive:restore`、`archive:export`、`archive:prune`；
   - 当前 31 会话基线已导出到 `E:\CEOBE_backup\archive-2026-10-31`，31 会话 / 622 个 archive 文件 / 约 960 MB；38 个 `conversation.ceobe.json` 已做 SHA-256 比对；
   - E 是另一块内置卷，不是异地介质；仍建议定期复制到外置硬盘或 NAS；
   - `archive:prune` 默认只预览，`--confirm` 才删除；当前没有自动定时清理。

3. **Turbo 的已知边界**
   - 首次打开页面仍会先显示骨架，再加载完整目录；
   - 页面级脚本通过 `?turbo=N` 重新初始化，但不是完整的 Turbo Drive 自动接管；
   - 这些作为已知限制，后续再做首屏缓存/更细的导航状态保留。

## 三、1.2 后已确认的优化（不阻塞发布）

- **删除/导入性能**：删除 stage 已把 conversations/previews 改为硬链接 + 原子写；
  优化后真实删除 API 17.9s、服务日志 15.2s（prepare 1.5s + build 12.8s）；
  资源基准（隔离 capture）：
  - 大链接：263 消息、10 个资源（下载 7,179,470 bytes）、capture 30.0s；
    资源 URL 解析 20.8s，真正下载仅 6.6s；
  - 小链接：8 消息、0 资源，skip 浏览器解析后 capture 1.0s（此前 12.5s）；
  导入后的整库重建在暖缓存下约 14.2s，剩余成本是资源解析、页面装饰和索引；
- **备份运维**：保留策略、定期异盘复制、恢复后校验；
- **摘要自动 prune**：删除/导入后清理不再存在的会话摘要；
- **记忆 overlay 新鲜度**：把 `memory:overlay` 纳入检查，overlay 比 view 新时给出告警。

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
- 删除 stage 准备约 1.5s；优化后真实删除 API 17.9s，冷构建仍可能到 45s；
- Turbo 覆盖本地页面；首次页面加载仍显示骨架；
- archive 快照是硬链接，不替代异盘备份，也不会自动清理。

## 八、1.3 状态

**项目记忆相关已冻结**：当前只有 L3.1 只读预览（两组 L3 覆盖层、5 条主线、theme、delta、未分组降级），不继续扩展。
等内核完整 L1–L5 交付后，再统一做一次 CEOBE 接入；事件时间线、会话内事件树、长期事实层、跨聊天事件树均不在当前阶段单独开工。

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
