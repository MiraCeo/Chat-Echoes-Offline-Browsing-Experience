# 交接说明

> 目的：把当前状态、已做的决定、未完成的工作和验证方式一次说清，便于换人/换会话接手。

## 1. 项目是什么

CEOBE（Chat Echoes Offline Browsing Experience）：把 ChatGPT 的公开分享链接抓成**本地只增不改的档案**，
再用冻结的官方 DOM + DIL 渲染器还原成可离线阅读的页面，支持 Markdown / PDF 导出、项目与书签整理。

**两条硬约束**

1. `archive/` **只增不改**：任何采集、导入、测试都不得覆盖或删除已有快照（用户显式删除会话是唯一例外，需二次确认）。
2. 采集只走**匿名浏览器**，不使用登录态（登录态路线已删除）。

## 2. 当前状态

```
HEAD        （见 git log -1；包含“侧栏客户端渲染”“后处理幂等”“页面装饰指纹”“资源库按页缓存”
             “项目页瘦身”“消息操作裁剪”“附件随页拷贝”“搜索语法与索引标签”“官方格式 JSON 导出”
             “装饰指纹修复/方向记录”“采集扩展补齐与导入链路修复”）
标签        v1.0.0 / v1.0.1 / v1.0.2（本地）
归档        36 个分享会话 / 44 个快照，约 945 MB；chatgpt-web 采集为 0
磁盘        replay/ 约 1.09 GB（页面 + 附件 + 资源库副本）、dist/ 约 731 MB
附件        323 个本地文件（replay/archive-resources 与 public 副本、dist 一致），附件链接 0 失效
页面        41 页；巡检 0 问题；npm test / npm run check / npm run build 全绿
构建        全量约 80–105s（36 页重渲染，4 并发）；数据没变时 13–15s（系统缓存热）/ 23–25s（冷缓存或磁盘繁忙），
             只重做 5/41 页、页面字节不变；换首页或导入后为 5–6/41 页、约 19–25s（修复前为 40/40、107–118s）
删除        重建部分约 15s＋档案复制约 1s（原为 52.5s）；会话页逐字节不变
导出        官方 JSON 65.3 MB（36 会话；可选附件 323 个文件／254.3 MB）；Markdown 走 export:md
扩展        MV3 0.5.1：直连发送、页内按钮、ZIP 兜底、端口探测、采集包 format/version 握手
侧栏        浏览器按 replay/chats.json 渲染；每页只剩“当前会话一行 + 行模板”，不再内嵌全部会话
历史        2026-10-26 做过一次脱敏重写：旧夹具与「测试消息/」「图表/」「文件/」「新界面/」从全部
             历史移除、本机用户名替换为占位；提交时间保持不变，但**旧 SHA 全部失效**
```

> 耗时随机器负载波动：同一份数据在文件缓存热时 13–15s，刚做过大目录复制/杀毒扫描时可能到 23–28s；
> 判断回归请以“步骤拆分”与“页面哈希/字节”为准，不要只看墙钟。

常用命令：

```powershell
npm run dev                 # 自动挑端口（5173 起），打印地址
npm test                    # 单元 + 浏览器测试（需 dev server）
npm run check               # 档案完整性 → PDF 审计 → 全站巡检
npm run library             # 重建阅读页（增量）
npm run build               # 生产构建（会清掉 dist 过期标记）
npm run verify:archive      # 只读检查档案结构
```

## 3. 已经完成的关键能力

- 分享链接归档（`archive-share.mjs`）、批量导入、扩展 ZIP 导入、失败不落盘（`--keep-failed` 才保留）；
- 批量抓取有限流/熔断：1.5s 间隔、每 40 条休息 30s、连续 3 次 429/503 或失败率 ≥60% 停整批，
  前端把未处理的链接留在输入框（`import-throttle.mjs`）；
- 来源通过 `sources/registry.mjs` 分派：归档目录、Python 导入器、URL 与 id 校验都不再写死在调用方；
- 冻结官方 DOM + DIL 渲染（两栏卡片、按钮/单选组中性样式、部分不支持组件不再整条回退）；
- Markdown 导出带时间线（下载通道与新抓取的 `conversation.md`），并升级为 Obsidian-ready：
  frontmatter（title/chat_id/url/project/created/updated/model/tags）、`$`/`$$` 数学、文末 `## Sources`；
  `npm run export:md -- --all --out <目录>` 连同附件一起导出（可选 wikilink）；
- 失效引用说明：沙箱/本机链接标「未归档」、缺失图片占位、缺失附件逐条说明、会话顶部缺口清单、索引「未归档附件」列；
- XLSX 只读预览：合并/样式/数字格式保留，大表截断到 500 行 × 60 列并注明原表规模，点单元格高亮行列、可缩放；
- 构建：增量页面渲染（内容哈希指纹）、五个后处理步骤合并一趟、页面渲染 4 并发；
- 后处理**幂等**：同一份数据重建后页面逐字节一致（`scripts/page-decoration.mjs` 统一清场 + 就地更新资源引用 + 内容没变不写盘）；
- 删除：支持分享与本地采集两种归档、Windows 占用回退（复制 + 剪枝）、写操作不再重建 `dist`（改为标记过期）；
- 侧栏由浏览器渲染：页面里没有全部会话的 `<li>`，也没有 `#ceobe-chat-catalog`；删改一个会话不再改写其他页面；
- 只读回放的界面只保留能用的操作：消息工具条只有「复制（有正文时）+ 更多操作 + 编辑书签」，
  编辑消息／评价回复／分享／切换模型／图片悬浮层都不再渲染（渲染时裁剪，见第 4 节「只读回放的操作裁剪」）；
- 搜索支持语法：`"精确短语"`、`-排除`、`A/B`、`title:`、`from:user|gpt`、`has:code|table|image|attachment`、
  `created:2025-06`（可比较）、`messages:>20`；索引带 `kinds`，高亮按原文切片；旧查询（未知 `字段:值`、
  负数、URL）行为不变。规则在 `scripts/search-query.mjs`，浏览器与 Node 共用；
- 官方格式 JSON 导出：`npm run export:json -- --all --out <目录>`（或 `--id`），产物为
  `conversations.json` + `attachments/<sha256>.<ext>` + `manifest.json`；`mapping` 由 `nodes` 生成、
  `content.raw` 原样透传、缺 `nodes` 时降级为线性 mapping；附件默认复制（`--no-assets` 关闭）；
- 采集扩展 0.5.1：popup 直接发送 + 端口探测、分享页内「发送到 CEOBE」按钮、无服务时导出 ZIP；
  采集包带 `format`/`version` 握手（旧包按 legacy 接受）；书签小工具打开导入页预填链接；
- 资料库可以自建文件夹（当标签用，一条资源可属多个）并上传自己的文件；
  上传字节在 `data/private/library-files/`，不进 `archive/`，任何路径都不删原文件；
- 附件随页拷贝：并行渲染的每一页都写自己会话的附件字节，`replay/archive-resources` 与 `dist` 都是 321 个文件，
  附件链接 0 失效（此前并行渲染只拷第一页，295 条链接里 280 条失效）。

## 4. 侧栏、搜索、导出与构建修复（已完成）

**目标**：新会话的增删不再重写每一页。

**机制**

1. `build-library` 生成 `replay/chats.json`（id / 标题 / 置顶 / 轮数 / 抓取时间 / 来源类型，字段与 `/api/chats` 对齐），
   并复制到 `replay/public/`，所以 `dist/` 里也有一份；
2. `build-official-replay.mjs` 只把**当前会话那一行**写进侧栏（`CEOBE_LEGACY_SIDEBAR=1` 可回到“每页写全部会话”的旧分支做对照）；
3. `build-chat-actions.mjs` 把这一行做成 `<template id="ceobe-sidebar-chat-row">`（去掉标题、活动态、id、置顶/菜单目标）；
4. `chat-actions.js` 先按 `chats.json` 渲染全部行，`/api/chats` 可用时再换成最新数据；
   渲染完成后写 `document.documentElement.dataset.ceobeSidebarChats = 'ready'`（浏览器测试等这个标记）；
5. 原 `#ceobe-chat-catalog`（每页内嵌全部会话 JSON）已删除；`sidebar-controls.js`、`project-detail.js`、
   `project-sources.js` 改为 fetch `chats.json`，服务不可用时用静态清单渲染。

**为什么删除不再改页面**：页面字节只取决于它自己的会话；侧栏、置顶、项目标签、书签入口都在浏览器里完成。

**验收证据**

| 项目 | 结果 |
|---|---|
| 幂等（同一份数据重建两次） | `scripts/test-sidebar-client-render.mjs`：页面逐字节一致 |
| 删除一个会话 | 同一测试：只有被删页面消失；`chats.json` 更新；其余页面哈希不变（`project.html` 内嵌每个会话的预览片段，允许变化） |
| 真实档案 39 页 | 改造前后对比浏览器渲染出的侧栏：行数/顺序/标题/置顶/项目标签完全一致；仅新增当前页 `aria-current="page"`、`data-testid` 改为按行号确定 |
| 生产产物 | `npm run build` + `vite preview`：侧栏可用；拦掉 `/api/chats` 后仅靠 `chats.json` 也能渲染出 34 行 |
| 删除耗时（隔离副本，3 会话） | 2.3s（其中重建 2.2s） |

**页面装饰指纹（删除不再重做未变化的页面）**

`scripts/decoration-plan.mjs` 给每个页面算一个指纹，只让需要重做的页面进入五个后处理步骤：

- 共享输入：装饰口径版本号、渲染器/模板指纹、`replay/projects.html`（内嵌全部项目数据的来源）；
- 每页输入：这一页自己的会话条目（id/标题/page；`index`/`import`/`assets`/`projects`/`project` 用首页会话的那一条）
  加上页面当前字节——页面字节同时包含“渲染结果”和“上一轮装饰结果”，所以重新渲染过、内容变过、
  或有人手改过这一页，都会自动重做；
- 指纹存在 `data/private/decoration-stamps.json`；删除流程会把它复制进暂存目录、构建后再装回来；
- 每趟构建打印 `Decorations: N of M page(s) refreshed`。

实测（真实档案 39 页）：

| 场景 | 结果 |
|---|---|
| 数据没变重建两次 | `Decorations: 5 of 39`（只有每次都要重建的首页/导入/资料库/项目页），**14.1s**；39 页哈希 0 差异 |
| 重命名一个会话 | 只多出那一页：`6 of 39`，页面字节只在该页、`chats.json`、`assets.html` 与 `project.html` 上变化 |
| 删除演练（真实档案，按删除流程复制 archive+replay 后重建） | 档案复制 1.0–1.2s ＋ 暂存重建 **14.9s**，输出与线上页面 **0 差异**（旧日志：重建 52.5s） |
| 隔离副本删除 | 2.6s（重建 2.5s） |

**资源库按页缓存（`build-asset-library` 8.9s → 0.5s）**

- 资源库要扫全部会话：读会话 JSON（2.7s）、解析 34 个页面（4–5s）、把 321 个附件（249 MB）重新写进
  `public/library-assets/`、再复制 156 个预览媒体（65 MB）；
- 现在按“渲染输入指纹”（`data/private/library-stamps.json` 的 `sourceHash:renderer`）缓存两样派生数据：
  每一页的 `resources` 与“附件预览模板文件名”。会话或渲染器没变就直接用缓存，页面不解析、会话 JSON 不读；
- 附件文件名本身就是内容的 sha256（`assets/<sha256>.<ext>`），所以目标文件已存在就跳过读写；
- 索引与预览片段用 `writeIfChanged` 写；缓存存在 `data/private/asset-library-cache.json`，
  删除流程同样把它带进暂存目录并装回来；
- 验证：冷缓存、热缓存、缓存被清空、缓存被写坏四种情况，`assets.html`、`public/assets-index.json`
  与 506 个 `public/library-*` 文件的哈希与改造前**完全一致**；`scripts/test-sidebar-client-render.mjs`
  也覆盖了这四条路径与“删除后资源库索引不再包含被删会话”。

顺带修好：`npm run library -- --only <id>` 以前只渲染不装饰，重建出来的页面会丢掉侧栏/菜单/书签；
现在它会照常过一遍装饰步骤，只处理这一页（其余 38 页字节不变）。

**项目页瘦身与资源副本清理**

- `project.html` 原来内嵌**全部 34 个会话**的预览片段和**整份资源索引**（745 KB）。现在：
  - 预览只给“至少属于一个项目”的会话（7 条），`project-detail` 只读这 7 个会话 JSON（2.1s → 1.5s，无项目时 0.1s）；
  - 资源索引不再内嵌，`project-sources.js` 改为 fetch `./assets-index.json`（与 chats.json 同一套降级逻辑）；
  - 结果：`project.html` 745 KB → **290 KB**；删除/重命名一个**不属于任何项目**的会话不再改动它。
- `public/library-assets`、`library-previews`、`library-media` 里不再被索引引用的旧副本会被清掉
  （只增不减会一直堆到 `dist/` 里）。`archive/` 里的原件不受影响。

**资料库：文件夹当标签，上传不进 archive**

用户定的三条语义：**文件夹当标签**（一条资源可属多个）、**上传不进 `archive/`**、**不删原文件**。

- 数据在 `data/private/library.ceobe.json`（`kind: ceobe.library`，字段 `folders` / `tags` / `uploads`），
  上传字节在 `data/private/library-files/<sha256>.<ext>`；两者都不在 `archive/` 里，档案红线不受影响；
- `scripts/library-store.mjs` 负责存储与 HTTP 接口（`GET /api/library`、`folders`、`tags`、`upload`、
  `uploads/remove`），挂在 `vite.config.mjs` 的 dev 与 preview 上；写入走工作区锁 + 原子替换，
  损坏文件只报错不覆盖；
- 删除文件夹只删标签；「从资料库移除」只删记录，**磁盘文件保留**（测试里逐条断言过）；
- 构建时 `build-asset-library.mjs` 把 `folders` 挂到每条记录、把上传项并进索引，
  文件夹与标签另写一份 `#ceobe-library-data`；上传副本内容寻址拷进 `public/library-files/`，
  随派生目录一起清理（私有原件不动）；页面再 fetch `/api/library` 覆盖构建快照，服务不在时退回静态只读；
- 界面：文件夹筛选条、`管理文件夹` 对话框（新建/重命名/两次确认删除）、预览窗里的标签开关、
  `上传文件`（多选，文本类直接以 `<pre>` 预览）。

**项目页不再有占位按钮**

`build-project-detail` 先把官方 `main` 里所有 button 设成 `aria-disabled` + 「此功能暂未接入本地项目」，
再由各步骤逐个放开——这是安全网，默认“没接线 = 明显不可用”。实测它最后只剩页头「项目图标」一个，
而图标/颜色编辑早在「显示项目详情 → 项目设置」里实现，于是：

- 页头图标改成 `<span role="img" aria-label="项目图标：<图标名>">`（保留 class、svg、`data-testid`）：
  图标照常显示、不再可点、不再有禁用提示；
- `project-detail.js` 改为用 `[data-testid=project-modal-trigger]` 定位容器并按 `#ceobe-project-icons`
  写中文标签（它原来直接 `box.closest('button')`，改结构时立刻会抛错，已修）；
- 现在全站没有带「此功能暂未接入本地项目」的按钮。

**还没做**

- 顶层 5 页每趟都要重建、因此每趟都要重新装饰（约 1.3s）；评估后认为收益小于风险，暂不处理。

**只读回放的操作裁剪**

归档页不能承诺云端操作。`build-official-replay.mjs` 在渲染每一轮消息后调用 `stripUnsupportedActions()`：

- 以 `[data-testid="copy-turn-action-button"]` 为锚点，工具条只保留复制按钮，其余按钮和“只包着按钮的空 span”删掉
  → 编辑消息、评价回复、分享、切换模型、生成图片的喜欢/不喜欢都不会出现在页面上；
- 生成图片的悬浮层（`[data-testid^="image-gen-overlay"]`）整块删除（编辑图片、分享此图片）；
- 生成图片/图表类回复没有可复制正文（`data-ceobe-copy` 为空串），连复制按钮也不渲染；
  工具条在渲染时打上 `data-ceobe-turn-actions`，书签的「更多操作 / 编辑书签」按这个标记定位，
  所以这类回复的工具条是「更多操作 + 编辑书签」；
- 只删按钮与空 span，绝不碰带正文的兄弟节点；书签的「更多操作 / 编辑书签」由后处理追加到同一工具条。

结果：34 个会话页共 3072 个工具条，3028 个是「复制 + 更多操作 + 编辑书签」、44 个（生成图片/图表回复，
没有可复制正文）是「更多操作 + 编辑书签」；8 个被裁的 `aria-label` 计数为 0；
悬浮层节点为 0；`data-bookmark-unavailable` 与“本地归档不执行…”的说明文案已从代码和页面里删除。
页面里也不再存在“可聚焦但点了没用”的死按钮（每轮 3 个可聚焦按钮全部可用）。

**顺带修掉的构建缺陷**

- **并行渲染漏拷附件**：`archive-resources` 的附件字节原本写在 `--skip-shared-assets` 分支里，只有第一页拷贝，
  其余页面渲染出的附件链接指向不存在的文件（实测 34 页 295 条附件链接、280 条失效）。
  现在每页都写自己会话的附件（内容哈希命名 + `wx` 写入），`replay/archive-resources` 与
  `replay/public/archive-resources` 都是 321 个文件，`dist/` 也带上，失效链接 0；
- **两个并发竞态**：`public/previews` 整目录同步加重试；共享附件的预览数据改成“临时目录（`replay/.preview-tmp/`）+ 原子改名”，
  抢输的进程复用赢家结果，不会再读到写了一半的目录；
- `build-chat-organizer` 的清理会删掉承载 `[data-chat-recent-list]` 的整个分区：任何“不重渲染页面”的重建
  （删除/重命名/置顶）都会让侧栏列表永久消失。现在只清理自己注入的节点；
- 五个后处理步骤此前会重复注入弹窗/模板/样式表/脚本（每重建一次多一份，页面 4.7 MB 大半来自这里）。
  现在由 `clearPageDecorations()` 在每趟构建开头统一清场，各步骤按固定顺序重新注入；
  资源引用用 `placeStylesheet`/`placeScript` 就地更新版本，头部顺序不再漂移；
- 页面内容没变就不写盘（`writeIfChanged`），删除时不再重写全部页面（现在单页约 1.7 MB）。

**阅读器搜索语法（本轮完成）**

`scripts/search-query.mjs` 把查询解析成标题词、正文词、排除词与 `title:`／`from:`／`has:`／`created:`／
`messages:` 条件（纯函数、无 DOM，浏览器与 Node 共用，后面做 MCP server 时直接复用）。
`sidebar-controls.js` 只负责取数、渲染与键盘行为；`search-index.mjs` 给每条 turn 附加 `kinds`
（code/table/image/attachment/audio），`has:` 只看这个标签。构建时模块按内容哈希复制成
`replay/search-query.<hash>.mjs`，并改写主脚本里的 import（页面无 CSP，按模块加载）。

实测与验收：

| 项目 | 结果 |
|---|---|
| 索引规模 | 3098 条 turn、729 条带 kinds（表格 332、附件 348、图片 223、代码 109）；34 会话加 kinds 时 6.96 → 7.01 MB（+41 KB），当前 36 会话 7.21 MB |
| 同数据两次重建 | 41 页与 `search-index.json` 逐字节一致；第二次 `Decorations: 5 of 41`；只有 `chats.json` 的 `generated_at` 不同 |
| 解析器单测 | `scripts/test-search-query.mjs`：引号短语、排除、A/B、字段与比较符、折叠/高亮切片、旧查询兼容 |
| 浏览器测试 | `scripts/test-sidebar-controls.mjs` 追加语法断言并通过：命中数、原文大小写高亮、空态文案 |

语义要点（改之前先看 `docs/development.md` 的「搜索语法与正文索引标签」）：正项是“且”；`title:` 只筛标题、
`from:`／`has:` 只筛正文；只有排除词时只筛标题；无法识别的 `字段:值`、裸负数、URL 都按普通文本。

**官方格式 JSON 导出（本轮完成）**

`scripts/export-conversation-json.mjs` 是纯映射：`mapping` 由归档 `nodes` 生成（`{id,parent,children,message}`），
消息字段取规范化记录、`content` 直接引用 `content.raw`；`current_node` 优先 `current_node_id`，不可达时退回线性
路径末节点并标 `ceobe.current_node_repaired`；缺 `nodes` 的旧快照按 `linear_message_ids` 生成线性 mapping 并标
`ceobe.degraded`。`scripts/export-json-cli.mjs` 负责选会话、复制附件（内容 SHA-256 命名、同内容去重）、
写 `conversations.json` 与 `manifest.json`；不写墙钟时间，同一输入两次导出逐字节一致。
单个 `--id` 写对象，`--all`／多个 `--id` 写数组。

实测与验收：

| 项目 | 结果 |
|---|---|
| 真实档案 36 会话 | `conversations.json` 65.3 MB、消息 11487、节点 11523、隐藏 2796；约 6 秒（`--no-assets`） |
| 附件 | 334 条资源 → 323 个文件／254.3 MB，约 7 秒；154 个缺失（未下载） |
| 逐条校验 | 11523 个节点、11487 条消息的 `content.raw`／`author`／`metadata` 与归档逐字段一致；`current_node` 回溯顺序 36/36 等于 `linear_message_ids` |
| 确定性 | 真实档案导出两次，`conversations.json` 与 `manifest.json` 均逐字节一致；清单 sha256 与 payload 相符 |
| 单测 | `scripts/test-export-json.mjs`（顺序/分支、降级、附件、清单、`--no-assets`/`--compact`/`--id`、CLI 全流程），已进 `npm test` |

口径要点：`raw_payload` 与原始 HTML 不导出，因此 JSON 导出**不能替代归档备份**；缺失附件只计数、不伪造
`file-service://` 链接；重命名过的聊天用当前显示标题，原标题写进 `ceobe.original_title`。

**装饰指纹精度修复（本轮完成）**

- **现象**：导入一个新会话后重建 118s，日志 `Decorations: 40 of 40`（本应只有 5 个顶层页 + 新页）。
- **根因**：`replay/projects.html`（以及 `project.html`）从 `import.html` 改出来，内嵌着首页会话那一行
  （标题、链接、置顶/菜单文案）。导入会换首页 → projects.html 字节变化 → `decoration-plan.mjs` 把整份
  projects.html 当全站共享输入 → 所有页面的装饰指纹一起失效。装饰是幂等的，所以那次 107s 里页面字节
  一个都没变，纯属重做。
- **修复**：共享输入改成 `data/private/projects.ceobe.json`（其他页面真正依赖的项目数据）；
  `DECORATION_VERSION` 升到 2 做一次性全量刷新（页面字节不变）。
- **证据**：换首页 40/40 → 5/40，107.7s / 118s → 19.1–22.2s，35 个会话页逐字节不变；
  `scripts/test-decoration-plan.mjs` 锁住精度（换首页只动 5 个顶层页、项目数据变化才全量、单页改动
  只重做该页、指纹损坏回退全量），已加入 `npm test`。

**采集扩展补齐（本轮完成）**

- `extension/` 0.5.1（MV3）：`zip.js`（浏览器与 Node 共用的 STORE ZIP 写出）、`capture.js`
  （匿名抓取／投递／端口探测）、`background.js`（Service Worker 消息路由）、popup 直接发送与 ZIP 导出、
  `content.js/css` 分享页内按钮；抓取在扩展上下文里做，不受页面 CSP 限制；
- **ZIP 在 popup 内生成**：`chrome.runtime.sendMessage` 是 JSON 序列化，把 `Uint8Array` 传给 popup
  会变成普通对象、Blob 退化成 `[object Object]`（实机导出的 15 字节坏包）。直连发送仍由 Service Worker
  完成，二进制不跨消息通道；
- `/api/archive-package` 导入成功后**先全量重建**（索引 + 页面），生产模式再 `publish`；导入后失败返回
  `archived: true` 与“重试只更新页面”，扩展会显示对应提示；
- `build-library --only` 遇到落后索引（刚导入的新快照）会先重建一次索引再渲染，不再报
  “档案库中没有这些会话”；
- 本地服务只对扩展 scheme 开放跨源（`chrome-extension://`／`moz-extension://`／
  `safari-web-extension://`），`application/zip` 的 OPTIONS 预检同样只对这些来源开放；普通网站仍被
  同源与 `sec-fetch-site` 检查拒绝；`/api/capabilities` 返回 `packageFormat`／`packageVersion`；
- 采集包契约（`scripts/share-package-format.mjs`）：`capture.json` 带 `format: ceobe.capture` 与
  `version: 1`；旧包按 legacy 接受，未知格式或更高版本明确报错；
- 书签小工具（`extension/bookmarklet.md`）打开 `import.html?url=<分享链接>`，导入页会预填并校验；
  这条路线不跨站 POST，不放宽 CSRF；
- 验证：`test-share-package.mjs`（ZIP 往返、握手、URL 解析，扩展写出的 ZIP 也通过 Python `zipfile`
  读取）、`test-local-import-api.mjs`（扩展预检/白名单、普通网站仍 403）、
  `test-local-import-package-api.mjs`（重建顺序、归档标记、发布、临时包清理）、
  `test-only-index.mjs`（落后索引只重建一次）；均进 `npm test`。实机故障（`6ae173a0…`）已复现并修复，
  该会话已补进索引与页面。**扩展 UI（popup、页内按钮）本轮没有在真实浏览器里加载验收**，
  只做了语法检查与契约测试；发布前需在 Edge/Chrome 手动加载 `extension/` 走一遍。

## 5. 已知问题

- 删除会话仍不是“秒级”：重建约 15s，另有档案复制与安装回写；页面本身已经不再重写（见第 4 节）；
- 导入仍包含匿名解析/下载资源与重建。本次导入 118s 里约 90s 是全量装饰（根因已修：换首页 40/40 → 5/40、
  107–118s → 19–22s）；修复后的新导入尚未重新计时，预计仍在几十秒量级；
- 扩展 UI（popup、分享页按钮）本轮没有在真实浏览器里加载验收，只做了语法检查与契约测试；
  发布前需在 Edge/Chrome 手动加载 `extension/` 走一遍；
- 并行渲染带附件的新会话时，共享预览目录偶发一次 `ENOENT: chmod ... pdf-page-N.png`（2026-10-28 出现一次，
  重跑 `npm run library` 即通过）；尚未定位到具体竞态，若复现再查 `build-file-previews` 的共享预览同步；
- 书签小工具的端口默认写死 5173；`npm run dev` 换端口时需要手改书签地址；
- 扩展白名单按 scheme 放行：本机已安装的任意扩展都能请求本地服务（浏览器的内网请求里无法区分具体扩展），
  属于本机信任边界；直连发送依赖本地服务，纯静态部署只能用 ZIP 或书签小工具；
- 官方安全检查拦下的资源匿名拿不到，缺口清单里标「获取失败」；
- 指向作者本机的图片永远没有字节，显示「图片未归档」占位；
- 单文件 HTML 导出仍是实验性（助手侧图片未内嵌）；
- 正文里的内联附件引用胶囊（554 个，其中 211 个因为附件未归档只显示「附件」）保留为引用标记，
  它们内部是 `tabindex="-1"` 的按钮（不进 Tab 序、点了没行为）；按用户决定暂不改（方案 A）；
- `has:` 依赖正文索引里的 `kinds`：升级后要重建一次阅读页（`npm run library`）才会命中；
  旧索引缺标签时状态文字会提示，其余语法不受影响；
- 搜索的 `created:` 按阅读器所在时区的日历年/月/日比较；同一份档案在不同时区的机器上可能相差一天；
- `export:json` 不导出 `raw_payload` 与原始 HTML，缺失附件只计数、不补链接，因此它是“可移植的文本 + 已归档
  附件”，不能替代 `archive/` 备份；单个 `--id` 写对象、`--all`／多个 `--id` 写数组，消费方需要判断。

**已解决（保留记录）**

- 泄漏面收尾：分享链接实测已失效（同账号另两条仍能匿名访问 19/32 轮，排除“站点收紧”）；
  GitHub 仓库已删除重建，旧提交与旧文件在远端一律 404（API 422、raw 404），新仓库沿用同一 URL/描述/可见性与 `main`；
  本地又删掉 `pre-rewrite.bundle`（sha256 `673ae98…`）与两个 `refs/codex/*` 检查点并 `gc`：
  `.git` 从 17.28 MiB 降到 3.77 MiB，真实 PDF（`d782a2f2`）与名单（`c0021087`）对象已不可读，
  只留 `data/private/clean-backup.bundle` 作为干净历史的还原点；
- 测试腐化（历史）：`test-clipboard-browser` 依赖“首页含代码块/表格”（首页是图表会话）、
  `test-library-browser` 的悬停详情，都已按当前行为修正；
- `test-bookmarks-browser.mjs` 自书签面板停靠后失效：overlay 面板“点外面就收起”的守卫把编辑器弹窗也当成了外面，
  点「取消」会连列表一起关掉。现在 `!editor.contains(e.target)` 把编辑器排除在外（取消回到列表），
  在正文里点一下仍会收起面板；测试里把“目录跳转后面板还在”改成按 overlay 契约容忍收起，已加进 `npm test`；
- `test-chat-actions-store.mjs` 原本断言删除后 `dist/index.html` 存在，与 `eeedad0`「写操作不再重建 dist」冲突；
  已改为断言 `replay` 干净、`dist` 保持原样并写入 `data/private/dist-stale.json`；
- 生成图片/图表类回复没有可复制正文，复制按钮却是空的（`data-ceobe-copy` 空串，19 页共 44 个）：
  现在这类回复不渲染复制按钮，工具条改由 `data-ceobe-turn-actions` 标记定位书签按钮；
- `test-ui-followups-browser.mjs` 390px：断言的是**离屏**标注。书签标注只为视口附近的会话算布局，
  缩窄后离屏标注保留旧决策、进入视口才重算；测试改为先滚进视口再测量（同时验证重算），全宽度通过；
- `test-project-detail.mjs`：项目页 composer 里原本注入「上传采集包」与批量导入提示，而这两者在项目页
  并不生效（`/api/archive-package` 没有项目语义、批量导入会被拒绝），还把 composer 撑高 61px。
  现在它们只在「导入会话」页出现，项目页 composer 回到官方 52px、tablist 回到 260px，测试通过
  （`project import association + retry without duplicate archive` 仍然覆盖逐条导入进项目）。

## 6. 文档索引

- [项目介绍](README.md) · [使用指南](docs/usage.md) · [开发指南](docs/development.md) · [架构说明](docs/architecture.md)
- [变更记录](CHANGELOG.md) · [后续计划](TODO.md) · [同类项目与后续方向](docs/ecosystem.md) · [产品方向记录](docs/direction.md) · [交接 Prompt](HANDOVER-PROMPT.md)（可直接粘给新的会话）
- 构建细节：`docs/development.md` 的「发布前检查」「端口」「写入测试必须隔离」三节；
  "为什么慢 / 为什么回退"的过程记录在本文件第 7 节。

## 7. 过程记录：为什么慢、为什么两次都回退

### 7.1 删除与导入的实测构成

| 操作 | 总耗时 | 拆分 |
|---|---|---|
| 导入一个 16 轮会话 | 92.2s / 100.4s（两次） | 抓取+解码+匿名浏览器解析附件+下载约 20–30s，其余是档案库重建 |
| 删除同一个会话 | 79.4s / 83.8s（两次） | 日志拆分：`took 80.4s (rebuild 52.5s)` |

删除的 52s 重建里没有多少“画页面”：页面按内容哈希指纹跳过渲染，主要花在
后处理步骤扫全部页面刷新侧栏/菜单/书签（约 25s）、资源库与索引（约 10s），
以及约 28s 是 `replay/`（620 MB）复制进暂存目录再复制回来。

**根因**：每个页面内嵌完整侧栏与菜单（单页 4.5–4.7 MB），删除一个会话＝所有页面都变。

### 7.2 尝试一：合并后处理遍历（成功一半）

六个后处理步骤合并成“一页只解析一次、写一次”（`scripts/page-cache.mjs`），
每次合并都用“未缓存构建取快照 → 缓存构建 → 41 页逐字节比对”验证。
`bookmarks` 没有合并：它写入的页面里 SVG `<title>` 内容在“同 DOM 多次解析”时会从 `&lt;desc&gt;` 变回 `<desc>`。
后处理合计 70.2s → 51.3s，但全量构建墙钟几乎不变（137.7s vs 135.5s）；随后用 4 并发把全量重建从 111.9s 压到 70.9s。

提交：`6806777`、`4d1eaf9`、`33362a3`、`6a9622a`、`6f595a5`。

### 7.3 尝试二：侧栏客户端渲染（本轮完成）

第一次试点把“单条模板 + 客户端渲染”做出来后整体回退，原因是 `test-library-browser.mjs`
第 56 行失败。本轮定位到那是**另一个**问题（见下），并按 TODO 的依赖清单把五处装饰都迁到了客户端/幂等化，
最终以“删除后页面哈希不变”的自动化测试收尾。

### 7.4 第 56 行失败的真正原因（本轮修复）

`test-library-browser.mjs` 断言“悬停另一个目录项后，文件类的详情收起来”。实际失败在
`prompt-rail.js` 的 `showDetail()`：悬停到**没有回复文本**的条目（本会话前几轮只生成了图片）时直接 return，
上一条的详情就永远展开着，高度停在 37px。修复两处：

1. `prompt-rail.js`：悬停到没有详情的条目也要收起上一条（不再留一个卡住的展开面板）；
2. `test-library-browser.mjs`：对比用的条目改为“带详情的条目”，并新增“悬停无详情条目应收起”的断言。

这与侧栏折叠高度无关（首版记录的猜测不成立）。

### 7.5 删除链路上修的四个旧坑

1. 本地采集会话（`archive/chatgpt-web/<id>`）原本删不掉，接口却返回 200 —— 现在两个归档根都会查；
2. dev server 占用 `replay/` 导致 rename EPERM —— 现在回退为“复制 + 剪枝”；
3. 索引里没有归档目录的残留条目会拒绝整个删除 —— 现在按残留处理；
4. 删除时整库从零重建 —— 现在复用 `replay/`、`dist/`（后改为只标记过期）与构建指纹，
   指纹从 mtime 改为**文件内容哈希**。

这几步对应的提交见 git log（2026-10-26 历史脱敏重写后，旧 SHA 已全部失效，正文不再引用具体 hash）。

## 8. 事故记录：一次验证把 archive/ 清空了（已恢复）

- **经过**：为了确认 `test-ui-followups-browser.mjs` 的 390px 失败是不是既有问题，我用
  `git worktree add D:\CEOBE-head HEAD` 检出 HEAD，并把 `archive/`、`node_modules/` 以 **junction** 接进工作树。
  验证结束后 `git worktree remove --force` 在 Windows 上**跟随了 junction**，把真实的 `D:\CEOBE\archive` 内容删空。
- **恢复**：从 `D:\CEOBE_backup\archive`（用户自己的备份，35 会话 / 43 快照）整份恢复，
  再删掉用户在界面上早已删除的那一条（`6a9c1dbd…`“FPGA 入门竞赛选择”）与备份里才有的 `chatgpt-web` 目录，
  使结果与事故前的状态一致：**34 会话 / 42 快照**。
- **证据**：`npm run verify:archive` → 34/42、14704 条消息、396 个已下载资源（与事故前同一次检查完全一致）；
  重新生成的 `archive/library.ceobe.json` 与事故前 `dist/library.ceobe.json` 逐字段比对 **0 差异**
  （标题、来源、抓取时间、消息/轮次计数、资源计数、快照路径全部相同）。
- **教训（务必遵守）**：不要用 junction/symlink 把 `archive/`、`data/private/` 接进任何临时目录或 git 工作树，
  尤其是之后要递归删除的目录（git 在 Windows 上会穿过去）。隔离测试应当**真实复制**需要的部分，并把副本放在
  `data/private/` 下（Node 会沿目录树找到真实 `node_modules`）；参考 `scripts/test-sidebar-client-render.mjs`：
  复制 `official-templates`、`official-assets` 与 `node_modules/katex`，全程不建任何联接。
