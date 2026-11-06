# 后续计划

[项目介绍](README.md) · [使用指南](docs/usage.md) · [开发指南](docs/development.md) · [交接说明](HANDOVER.md) · [变更记录](CHANGELOG.md)

这里只记录**还没做**或**等你决定**的事；已完成的能力、性能数字和踩过的坑在
[HANDOVER](HANDOVER.md) 与 [CHANGELOG](CHANGELOG.md)，不在这里重复。

**版本口径**：**1.2 = 时间模块基础**（时间线 + 时间轴）；**1.3 = 完整 L1–L5 记忆接入**。
当前 package 版本是 `1.3.0`，CHANGELOG 已归并为 1.3.0（2026-11-03）；1.2.2 保留为历史 tag。
`v1.2.1` / `v1.2.2` 已 tag 并 push；`v1.3.0` 已 tag 并 push。
按本地服务口径不创建 GitHub Release 页面。

## 〇、当前工作流（2026-11-02 起）

**内核已交付完整 L1–L5，CEOBE 已完成一次性接入并发布 1.3.0。**

- 数据源已收进 `data/private/memory-kernel/source/`，`npm run memory:import` 完成校验与派生；
- 页面层已完成全局 + 四组记忆库、会话 L1/L2/L4 详情、L5 树和 12 份分册正文；
- 后续只做验收反馈、更新自动化和维护，不再逐层改接口。

## 一、1.2 收尾状态

2026-10-31 验证结果：

- `npm test`：全量通过（含 Turbo 会话切换、记忆 v2 回归）；
- `npm run check`：38 页巡检通过；
- `npm run build`：生产构建通过（性能测试前）；
- 当前档案：31 个会话（gq 10 / g1 7 / g-early 11 / g-oct 3，未分组 0）；1 份 31 会话 archive 基线；
- 性能测试导入的 `6ae5fe47` 已删除，测试产生的 32 会话快照也已清理；
- `v1.2.1` / `v1.2.2` 已推送到 `origin/main`，annotated tag 已推送；
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
- 记忆覆盖层 v2 数据接入：四组 L3/L3.1、全局 L3、31 会话 L1/L2/L4 索引、12 分册和 L5 元数据；
- 记忆页全局 + 四组视图（g1 已改为 01–07，未分组隐藏）；
- 记忆页层级导航条（范围优先，L1–L5 作为详情层）；
- L4 事件树可视化（节点/边、状态颜色、详情、筛选、窄屏列表）；
- 入口收敛：项目页只保留组记忆摘要，时间线移除逐条记忆 chip；
- 记忆页布局清理：去重复 badge/说明行，变更块默认收起并人类可读；
- 单一 `1.2.2` CHANGELOG（1.2.1 保留历史）与 stale 摘要清理：`npm run timeline:summaries:prune`；
- 历史调试材料归档到 `data/private/_attic/2026-11-01`（187 个文件；含日志、截图、一次性脚本、fixture；恢复材料仍保留在 `data/private`）；
- 旧调试/导出/原型产物归档到 `data/private/_attic/2026-11-04`（23 项；`official-dom/6ad4e7d4` 测试快照保留）。

## 二、1.2 发布后待确认

1. **GitHub Release 页面**
   - 不创建。CEOBE 是本地服务，发布以 tag 和 CHANGELOG 为准；
   - `v1.3.0` 已 tag/push，不新建 release 页面。

2. **archive 备份的运维边界**
   - 已增加 `archive:backups`、`archive:restore`、`archive:export`、`archive:prune`；
   - `archive:restore` 的默认 `--build` 路径已有隔离测试：成功写入构建标记，构建失败时会话仍保留；
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
- **记忆 overlay 新鲜度**：已由 `npm run memory:status` 覆盖（1.3.1），
  source 比 view 新时告警，并已接入 `npm run check`（只告警，不改变退出码）。

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

**1.3.0 已发布：完整 L1–L5 记忆接入。**

已完成：

- 四组 L3/L3.1 与全局 L3 数据适配；
- 31 会话 L1/L2/L4 路径校验、索引和详情；
- 12 份 Markdown 分册与 L5 381 节点 / 183 边；
- 记忆页全局 + 四组视图；
- 全局 overview 正文展开；
- L5 只读树与节点来源跳转；
- L4/L5 来源轮次通过 round_map 跳到具体消息并高亮；
- 会话页右上角「本会话记忆」入口；
- 项目页组记忆摘要（组名、覆盖、快照日、主线、入口）；
- 记忆页内搜索（组块、主线、会话 L1/L2/L4、L5、分册、全局项目/冲突）；
- 记忆页层级导航条（范围优先，L1–L5 作为详情层）；
- L4 事件树可视化（节点/边、状态颜色、详情、筛选、窄屏列表）；
- 入口收敛：项目页只保留组记忆摘要，时间线移除逐条记忆 chip；
- 记忆页布局清理：去重复 badge/说明行，变更块默认收起并人类可读；
- 时间线条目「记忆」入口；
- 项目入口改名「组记忆」；
- 420/900/1440 多视口验收（记忆页、项目页、时间线、会话页无横向溢出）；
- 窄屏会话页右下角「本会话记忆」浮动入口；
- 修复 Turbo 跨层级后侧栏聊天链接重复 `/conversations/` 段；
- `npm run memory:status`（archive / source / view / 页面四段对比，`--json` / `--strict`）；
- `npm run memory:checklist`（待补 L1/L2/L4、L3/L3.1、L5、索引、分册；`--stage` 生成 inbox 待办）；
- 记忆页顶部数据生成时间与「记忆可能过期」提示；
- 新鲜度口径抽成 `scripts/memory-freshness.mjs`，CLI 与页面共用。

## 九、记忆更新自动化（1.3.x）

当前更新仍是“内核侧模型/子代理更新 source → CEOBE 导入”，以下按优先级排列：

1. **`memory:status`** — 已完成（1.3.1）
   - `npm run memory:status` 对比 archive / source / view / 已发布页面；
   - 报告新会话、已不在 archive 的会话、source 是否比 view 新、页面是否需要重新发布；
   - `--json` 机器可读，`--strict` 过期时退出码 1；`npm run check` 里只告警。

2. **页面过期提示** — 已完成（1.3.1）
   - 记忆页顶部显示 view 生成时间和页面构建时间；
   - source 在 view 之后有更新时显示「记忆可能过期」并给出修复命令。

3. **更新清单** — 已完成（1.3.1）
   - `npm run memory:checklist` 列出待补 L1/L2/L4 的会话、需要更新的 L3/L3.1、
     缺 L5 节点的会话、`ceobe-index` 计数和分册正文；
   - `--stage` 把新会话写成 `data/private/memory-kernel/inbox-staging.json` 待办。

4. **自动 inbox staging** — 已完成最小版本（1.3.1，可选）
   - 只生成待办清单，不生成内容，不自动并入 `input/`；
   - 仍需人工按 RUNBOOK 走 `inbox/` staging。

5. **模型/子代理编排**
   - 由 CEOBE 发起内核更新任务；
   - 需要模型调用、任务队列、校验门和人工复核；
   - 不放进 1.3.0，作为后续独立阶段（1.4）。

6. **L5 边生成辅助**
   - 同一棵树跑 2–3 遍取并集；
   - 人工复核后再并入，不做跨树映射。

参考项目：`getzep/graphiti`、`mem0ai/mem0`、`basicmachines-co/basic-memory`、
`JerryZLiu/Dayflow`、`ActivityWatch/activitywatch`、`syncable-dev/memtrace-public`、
`cyresearch/chatgpt-memory-extraction`。

## 十、记忆内核对照跟进（六个参考项目）

2026-11-04 至 11-05 对照了 `getzep/graphiti`、`microsoft/graphrag`、`mem0ai/mem0`、
`topoteretes/cognee`、`MemTensor/MemOS`、`vectorize-io/hindsight` 六个项目。
完整分析（含总览、对照表、做法、验收、成本、不跟进项和不能动的契约）见
[记忆内核对照跟进](docs/memory-kernel-reference-followups.md)。
**以下不代表已获实施授权。**

**结论**：值得抄的不是图数据库和向量检索，而是六类东西——双时态数据模型、
「重复与矛盾分开判」的判定纪律、层次社区报告、多路检索与 token 效率、
建图/改图分离 + 水位门控、自描述 bundle + MCP、证据计数 + 常驻答案。

**目的校准（2026-11-05）**：CEOBE 不是「只给人看」的档案，消费者有两个——
人（读 L2/L3）和**接手的模型**（读 L4/L5 并需要能查）。最终目的是让下一个模型快速理解我。
因此三处必须改：社区按**事件**聚不按实体聚；检索支持**叙事型**查询；常驻答案写成**传记**不是偏好清单。
详见对照文档第十二节。

### 已完成

- [x] **P0-1 L5 边双时态**（1.3.2）：边扩为 `[from,to,type,valid_at,invalid_at]`，
  节点带 `valid_at` / `invalid_at` / `superseded_by`；导入时推导 + 6 条不变量校验。
- [x] **P0-2 点时间查询 `?as_of=`**（1.3.2）：按本地日历日过滤，标「当时成立、后来被推翻」。
- [x] **P1-0 抽取质量闭环**（1.3.2）：
  - 评测工具 `npm run memory:eval`：自动指标 + 标注评分（核心/支撑/可选召回、精确、类型准确）；
  - 动态上限：`core ≤ 12` / `supporting ≤ 2 × core` / `optional` 不进 L4，体积是结果不是闸门；
  - `r` 允许同轮多节点；节点新增 `w`；§6 改为「L2 定路径，原文定全集」；
  - 试点核心召回 54.5%（旧）→ 72.7%（v2）→ **81.8%（v3）**；
  - g1 全组重抽：249 节点 / 46 条 superseded / core 84。
- [x] **g1 L5 归并 + 页面接入**：249 → 241 节点（97%）、112 条边、5 条跨会话 superseded；
  `memory.html?group=g1` 按主线分组显示。
- [x] **内核快照机制**：`npm run kernel:snapshot` 把内核源快照到
  `data/private/archive-backups/kernel-<时间戳>/`，带 manifest（文件数 / 字节数 / 关键文件哈希）；
  支持 `--list` / `--restore <name>`（恢复前自动留 pre-restore）/ `--keep <n>`。

### 待做（按目的重排，2026-11-05）

- [x] **P1-4a 实体合并**：`npm run memory:entities`，注册表内合并 + L4 实体对齐 + 自动登记；
  g1 实测 243 → 288 条（45 条登记、15 条可映射），「秋 → 内推人」别名合并后 287 条。
- [x] **P1-4b 事件候选生成**：`npm run memory:candidates`，纯机械、不调 LLM；
  g1 249 节点 → 1123 对候选（strong 389），覆盖已知 12 对合并中的 10 对。
- [x] **P1-4c 事件判定**：`npm run memory:judge`，候选拆批交子代理判「重复 / 矛盾」两个独立问题；
  g1 161 对 → 合并 13 / 推翻 5 / 存疑 3，已知 12 对合并全部覆盖（11 yes + 1 unsure）。
- [x] **P1-4d 补边 + 冲突复核**：`npm run memory:apply` 把判定写回 L5——合并节点
  （`src` 并集、重要度取最高）、补 `superseded` 边、存疑项写进 `review.json`；
  g1 实测 241 → 239 节点、112 → 111 边，校验 PASS；幂等（已合并的对跳过）。
- [x] **P1-2 社区报告 + L3.1 常驻答案**：`npm run memory:communities` 按事件切社区
  （连通分量 + 主线 + 时间，g1 239 节点 → 26 个社区）；27 份社区报告由子代理写成；
  `npm run memory:profile` 汇总成 `memory-profile.md`（四块 + 主线 + 未决 + 社区报告，
  每条带出处），`--check` 校验结构。
- [x] **P1-3 检索**：`npm run memory:search` 构建期生成 `memory-search.json`
  （BM25 倒排 + 实体索引 + 时间信号），记忆页按三路 RRF 融合排序；
  g1 实测 941 条文档 / 11.5k 词 / 189 个实体，索引 783 KB；索引缺失时回退子串匹配。
- [x] **P2-3 导出 / MCP**：`npm run memory:export` 导出自描述记忆包（manifest + README +
  profile / l5 / communities / entities / search / images 六层，`--layers` 可选）；
  `npm run memory:mcp` 起只读 MCP 服务（stdio JSON-RPC），四个工具
  `search` / `get` / `list` / `dump`。
- [x] **L5 信念化**：节点加 `support`（来源数 / 会话数）和 `refined`（证据时间线），
  导入时从 `src` 和 `superseded` 边推导；组内 L5 无 `ts` 时用「会话首条时间 + 轮次偏移 +
  L4 节点号」补出；记忆页显示「支持：N 个来源 · M 个会话」。
- [ ] **P2-1 实体反向索引**（1.4）：从实体查到它出现在哪些事件里（「关于 TourGrid 我知道什么」）；
  与 episode 反向索引（`cited_by`）同批做。
- [ ] **P2-2 分册可再生成**（1.4）：分册正文 = 成员节点时间轴 + 摘要，人工编辑作 overlay。

> 「模型交接层」不是新增的第 8 项，是 P1-2 / P1-3 / P2-3 的共同目标：
> 一页纸（profile）+ 一个索引（index）+ 一个查询入口（MCP）。

### 暂缓

- 另外三组（gq / g-early / g-oct）重抽——等框架定稿后一起做；
- 1.4 的模型/子代理编排——依赖精修层和更新队列。

**不跟进**：图数据库、向量库、Postgres、摄入期向量化、查询期调 LLM、
无人工复核的自动失效、云端租户/计费/遥测（理由见对照文档各节）。

**不能动**：`outcome` 四值、`preferred` 只表事实版本、双观察保留、冲突不自动关闭、
L1 契约一行不改、任何自动产出都要过人工复核门。

---

所有新增写入测试继续使用隔离数据。`archive/` 是只增不改的原始档案；删除项目保留聊天，
聊天永久删除必须保留确认、恢复快照和 journal。**本文列出的待办不代表已获实施授权。**

**不要把 `archive/` 或 `data/private/` 用 junction/symlink 接进会被递归删除的临时目录或 git 工作树**：
Windows 上 `git worktree remove --force` 会穿过 junction 把真实档案删空（2026-10-24 发生过一次）。
隔离测试请真实复制需要的部分，参考 `scripts/test-sidebar-client-render.mjs`。
