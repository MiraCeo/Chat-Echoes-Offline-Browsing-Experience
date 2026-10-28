# 变更记录

按功能域汇总当前版本的能力与修复，逐条历史见 `git log`。本文件描述的是**现在这一版**的状态，不是完整的提交编年史。

## 未发布（1.2 时间模块：时间线 + 时间轴）

### 时间线 / 时间轴

- 时间线内部新增「列表 / 卡片」布局切换：默认列表；卡片为两列网格（窄屏单列），
  每条显示标题、时间范围、轮数，多日会话带逐日进度条，单日显示「当天」；布局选择写入
  `localStorage`，排序和月份分组在两种布局下共用。
- 索引写入构建机的 IANA 时区（`timezone`），列表、卡片和时间轴统一按该时区显示；修复在
  UTC/其它时区浏览器里时间整体偏移、跨天变少，卡片出现 `3/2 天有消息` 的问题。
- 卡片进度只统计当前显示跨度内的已填充日，保证“有消息天数 ≤ 跨度”。
- 侧栏入口从「时间线」改名为「时间」；原来的列表内容保留为「时间线」视图，新增「时间轴」视图，
  页内用两个 tab 切换，状态写入 URL（`?view=axis`）和 `localStorage`。
- 时间轴 = P7 整合体：上方是真实日历缩略图（7px/天、3 条泳道、多色细条、视口框），下方是详情
  （96px/天、白色标题卡、每张卡按日期格前后各 40% 拉伸、3 条泳道）；滚动详情同步视口框，
  点击/拖动缩略图定位详情；视口框支持键盘方向键/Home/End 与 ARIA slider。
- 时间轴使用真实日历 123 天（完整 7–10 月），不是事件日期等距；月份宽度按实际天数。
- 窄屏下缩略图会自动滚到视口框，详情仍横向滚动；页面不横向溢出。
- `test-timeline-browser.mjs` 增加视图切换、时间轴卡/条数量、视口角色、缩略点击定位、窄屏视口可见性。

### 时间线可读性

- 行改为两行式：标题占整行，时间范围与轮数放第二行；标题不再被固定时间列挤压。
- 顶部增加「按首条消息」的排序切换：默认「最新在前」，可切「最早在前」，选择写入 `localStorage`；
  月份与月内条目一起反转。
- 时间统一为 `M月D日 HH:mm`；同日用 `起–止`、跨日用 `→`、跨年带年份；页首与月标题标明本地时间。
- 月份标题吸顶，右侧显示 `N 个会话 · M 轮`；页首显示总会话/总轮数；月内仍按首条消息时间倒序。
- 次级文字对比度从 `#98a2b3` 提升到 `#667085`/`#475467`，正文宽度收到 800px，行距与 hover/focus 调整。
- `test-timeline-browser.mjs` 增加两行结构、统一日期、月统计与 `position: sticky` 断言。

## 1.2.0（2026-10-28）

### 历史档案时间线

- 新增顶层「时间线」页（`replay/timeline.html`）：侧栏入口在「项目」与「更多」之间（时钟图标），
  页面按年/月分组列出会话，显示首→末条可见消息时间与轮数，点击跳到会话并高亮首条消息锚点。
- 构建期 `timeline-index.mjs` 生成 `replay/public/timeline-index.json`：每个会话的首/末可见轮次时间、
  首末锚点消息 ID、可见轮数、按本地日期的轮数；标题仍取 `chats.json`，重命名不用重建。
- 只统计阅读页可见轮次（提问/最终回复/生成图片）；隐藏记录、推理、工具往来不进时间线。时间用消息
  `created_at`（构建机本地时区），`conversation.created_at` 是分享创建时间，仅作辅助。
- 页面骨架由 `build-timeline-page.mjs` 从导入页复制外壳；侧栏入口由 `build-timeline-nav.mjs`
  克隆官方「项目」行插入（每趟构建先清后插，幂等）。装饰指纹把 timeline 归入顶层页：数据没变时
  每趟重做 6/42 页；时间线页每次重建，列表由索引在浏览器渲染，新导入/重命名不用重写其它页。
- 测试：`test-timeline-index.mjs`（可见轮次、锚点、本地日桶、缺时间、空会话、两次构建字节一致）、
  `test-timeline-browser.mjs`（入口位置、当前页标记、月份分组、条目数、跳转与高亮、返回、无横向溢出）；
  `test-sidebar-client-render` 的顶层页上限改为 6；`npm run check` 巡检上限放宽到 60 页。

## 1.1.0（2026-10-28）

### 修复（2026-10-28 实机反馈）

- **扩展「发送到本地 CEOBE」失败**：`/api/archive-package` 原先只导入快照就执行
  `build-library --only <id>`，索引没更新 → “档案库中没有这些会话”。现在导入成功后先全量重建
  （索引 + 页面），生产模式再 `publish`；导入后失败返回 `archived: true` 与“重试只更新页面”，
  不再把 Node 堆栈原样抛给扩展。
- **`build-library --only` 遇到落后索引**：新增 `indexForOnlyIds()`，索引里没有目标 id 时先重建一次，
  重建后仍没有才报错；`test-only-index.mjs` 锁住“只重建一次、不循环”。
- **扩展导出的 ZIP 只有 15 字节 `[object Object]`**：`chrome.runtime.sendMessage` 是 JSON 序列化，
  `Uint8Array` 会变成普通对象。ZIP 下载改在 popup 内直接抓取并生成；直连发送仍由 Service Worker
  完成，不再跨消息通道传二进制。
- 新增 `test-local-import-package-api.mjs`：验证“先重建再读索引”、导入后失败返回 `archived`、
  生产发布、重试不重复快照、临时 zip 清理。
- 实机那条会话（`6ae173a0…`，标题「提升记忆力训练方法」，30 轮）已通过重跑 `npm run library`
  补进索引并生成页面。第二次直连又新增了一个快照，当前档案 36 会话 / 45 快照 / 15237 消息、41 页；
  索引已重建为指向最新快照（重试产生快照是“只增不改”的预期行为）。
- 实机验证还发现：`5173` 上可能残留**修复前启动的旧 dev server**（Vite 进程），扩展默认连 5173
  会命中旧代码——表现为快照写入了、索引却没刷新。已清理旧进程、重建索引，并在
  `docs/development.md` 的端口一节补了排查方法。

### 采集扩展补齐

- `extension/` 升到 0.5.1（MV3）：popup 增加**直接发送到本地 CEOBE** 与端口探测；分享页
  `chatgpt.com/share/*` 注入「发送到 CEOBE」按钮；没有本地服务时仍可导出 ZIP。
  抓取放在 Service Worker（`background.js`）里，不受分享页 CSP 限制；`zip.js` 是浏览器与 Node
  共用的 STORE ZIP 写出器，`capture.js` 负责抓取／投递／探测。
- 本地服务增加**扩展来源白名单**：只对 `chrome-extension://`／`moz-extension://`／`safari-web-extension://`
  开放跨源，`application/zip` 的 OPTIONS 预检也只对这些来源开放；普通网站仍受同源与
  `sec-fetch-site` 检查保护。`/api/capabilities` 返回 `packageFormat`／`packageVersion` 供扩展自检。
- **采集包版本握手**（`scripts/share-package-format.mjs`）：`capture.json` 带
  `format: "ceobe.capture"` 与 `version: 1`；0.4.x 旧包按 legacy 接受，未知格式或更高版本明确报错，
  不再带着半个包去解码。
- **书签小工具兜底**（`extension/bookmarklet.md`）：打开本地导入页并预填 `?url=`；导入页
  （`link-import.js`）支持该参数。这条路线不跨站 POST，不放宽 CSRF 防护。
- 测试：新增 `scripts/test-share-package.mjs`（ZIP 往返、握手、旧包/未来版本、URL 解析），
  扩展 `test-local-import-api.mjs`（预检、白名单、普通网站仍拒绝），新增
  `test-local-import-package-api.mjs`（采集包导入后重建/发布/归档标记）；均加入 `npm test`。
  端到端实测：扩展来源 `OPTIONS` 204、`POST /api/archive-package` 200 且幂等导入不新增快照、
  非扩展来源 POST 403。扩展 UI 需要手动在 Edge/Chrome 加载 `extension/` 检查。
- 顺带修正 `test-bookmarks-browser.mjs` 的注释位置断言：首页消息可能先有附件卡片（气泡因此下移），
  按真实契约改为“注释从整轮顶端开始、位于气泡右侧、不落到气泡下方”。

### 构建与文档

- **装饰指纹精度修复**：`decoration-plan.mjs` 的共享输入从整份 `replay/projects.html` 改为
  `data/private/projects.ceobe.json`。前者从 `import.html` 改出来、内嵌首页会话那一行，导入新会话
  （换首页）会让 40/40 页全部重做装饰；修复后换首页只重做 5 个顶层页，实测 107–118s → 19–22s，
  35 个会话页字节不变。`DECORATION_VERSION` 升到 2（一次性全量刷新，页面字节不变），
  新增 `scripts/test-decoration-plan.mjs` 锁住精度并已加入 `npm test`。
- **新增 [docs/direction.md](docs/direction.md)**：整理 2026-10-26/27 长对话后半段关于 CEOBE 的方向讨论。
- **MCP 改为已评估、暂不做**：口径见 `TODO.md` 第三节与 `docs/direction.md` 第五节；`docs/ecosystem.md`
  方向 2 同步标注，原方案保留备查。

### 官方格式 JSON 导出

- 新增 `npm run export:json`（`scripts/export-conversation-json.mjs` + `scripts/export-json-cli.mjs`）：
  `--all` / `--id` / `--out` / `--no-assets` / `--compact`，产物为 `conversations.json` +
  `attachments/<sha256>.<ext>` + `manifest.json`（独立命令、附件默认复制，按已定口径）。
- 映射：`mapping` 由 `nodes` 生成、`message.content` 原样使用 `content.raw`、`current_node` 可达；
  缺 `nodes` 的旧快照按 `linear_message_ids` 线性重建并标 `ceobe.degraded`；扩展字段 `ceobe` 保存来源、
  线性顺序、隐藏消息、资源本地相对路径与导入报告；`raw_payload` 不导出。
- 确定性：不写墙钟时间、附件内容寻址、同一输入两次导出逐字节一致；`manifest.json` 记录格式版本、
  会话／消息／节点／隐藏消息数、附件复制／缺失／跳过数与 payload 的 sha256。
- 实测（真实档案 36 会话）：`conversations.json` 65.3 MB、消息 11487、节点 11523、隐藏 2796；
  带附件另 254.3 MB／323 个文件（335 条资源去重），整体约 7 秒；155 个资源缺失（未下载）。
- 测试：新增 `scripts/test-export-json.mjs`（mapping 顺序与分支、`content.raw` 逐字节、`current_node` 可达、
  降级分支、附件内容寻址、manifest 计数、`--no-assets`／`--compact`／`--id`、CLI 全流程、两次导出一致），
  已加入 `npm test`。

### 阅读器搜索语法

- 搜索框支持查询语法（`scripts/search-query.mjs`，纯函数，浏览器与 Node 共用）：`"精确短语"`、`-排除`、
  `A/B`（任一）、`title:`、`from:user|gpt`、`has:code|table|image|attachment`、`created:2025-06`
  （支持 `>`／`>=`／`<`／`<=`）与 `messages:>20`（阅读轮数）。同一词内的 `/` 表示任一（含
  `from:`／`has:`／`created:`／`messages:`），词与词之间是“且”；
  `title:` 只筛标题、`from:`／`has:` 只筛正文、只有排除词时不列正文。
- 兼容旧查询：无法识别的 `字段:值`、裸负数（`-1`）、URL 都按普通文本；`\/` 表示字面斜杠。
- `replay/public/search-index.json` 每条 turn 新增 `kinds`（`code`／`table`／`image`／`attachment`／`audio`，
  固定顺序、无标签时为空数组），由阅读页可见内容决定；当前 36 个会话 3098 条 turn 里 729 条带标签
  （表格 332、附件 348、图片 223、代码 109），加 `kinds` 时索引只增约 41 KB（34 会话时 6.96 → 7.01 MB；
  当前 36 会话 7.21 MB）。
- 高亮改为按原文切片：折叠（NFKC + 小写）用逐码点位置映射，全角字母／连字命中时标在原文对应的字上，
  且一条命中里所有出现位置都会高亮；标题与正文都走同一套切片，不解析 HTML。
- 弹窗新增一行语法提示；空结果文案在语法查询时给出可执行建议（去掉 `-排除`、减少 `from:`／`has:` 条件）。
- 测试：新增 `scripts/test-search-query.mjs`（解析／匹配／高亮／兼容性，已进 `npm test`）；
  `test-search-index.mjs` 覆盖 `kinds`；`test-sidebar-controls.mjs` 增加浏览器断言
  （引号短语、`A/B`、排除、`title:`／`from:`／`has:`／`messages:`、空态、原文大小写高亮）。
- 构建：搜索模块按内容哈希复制为 `replay/search-query.<hash>.mjs`，由 `build-sidebar-controls.mjs`
  改写主脚本的 import；同一份数据两次重建，39 页与索引逐字节一致（`chats.json` 的 `generated_at` 除外）。

### 侧栏改为浏览器渲染

- 每个页面只保留“当前会话一行 + `<template id="ceobe-sidebar-chat-row">`”，浏览器按 `replay/chats.json`
  渲染全部会话；内嵌全部会话的 `#ceobe-chat-catalog` 已删除。删除／重命名一个会话不再改写其他页面。
- `sidebar-controls`、`project-detail`、`project-sources` 改为读取 `chats.json`；本地服务不可用时静态清单仍能渲染。
- 修正 `build-chat-organizer` 会删掉承载会话列表的整个分区——任何“不重渲染页面”的重建都会让侧栏列表永久消失。
- 五个后处理步骤改为幂等：`scripts/page-decoration.mjs` 每趟统一清场、资源引用就地更新版本、
  内容没变不写盘。此前每次重建都会重复注入弹窗、模板、样式表与脚本。

### 仓库与许可

- 仓库按 **MIT** 公开（新增 `LICENSE`，`package.json` 的 `license` 字段同步；`private: true` 保留，只用于挡 `npm publish`）。
- **测试夹具脱敏**：`fixtures/` 里的会话去掉了本机绝对路径、Windows 用户名、真实附件与真实分享 id；
  那份含 81 名学生姓名/学号的表格换成了同形状的合成数据，11 MB 的真实 PDF 换成了 7 页示例；
  真实分享 id 旋转成中性 id，无法再从仓库拼回原链接。改动依据与新的字节数记进
  `preview-inputs/粘贴的文本.provenance.json` 的 `redaction` 字段。
- `official-templates/templates.json` 里夹带的一段 writing-block 正文（含同一批路径）一并脱敏。
- 依赖本地档案的两项检查改为自足或不误报：`verify:official-dom` 缺页时用夹具自行构建并跳过未归档字节的断言；
  `test-archived-file-previews.mjs` 按标题在本地档案里找会话，找不到就明确跳过。
- README 增加「许可与素材来源」：说明代码许可以及 `official-templates/`、`official-assets/` 不属于 MIT 授权，
  并声明与 OpenAI 无隶属关系。
- **历史脱敏重写（2026-10-26）**：仓库此前是公开的，历史里还留着脱敏前的旧夹具与早先保存的页面
  （`测试消息/`、`图表/`、`文件/`、`新界面/`）。现在这些路径已从**全部历史**移除，
  `12782` / `KeJianBa` 等字样也替换为占位；提交数与作者/提交时间保持不变，但**所有旧 SHA 失效**
  （正文里不再引用旧 hash）。历史里的旧对象在 GitHub 侧仍可能被缓存一段时间，
  需要彻底清除时只能让 GitHub 回收或删库重建。

### 文档

- **远端仓库已删除重建**：脱敏前的旧提交与旧文件（真实 PDF、学生名单、原始对话）在 GitHub 上一律 404；
  新仓库沿用同一 URL、原描述与 PUBLIC 可见性、默认分支 `main`。本地随后删掉了 `pre-rewrite.bundle`
  与两个 `refs/codex/*` 检查点并 `gc`（`.git` 17.28 MiB → 3.77 MiB），只保留
  `data/private/clean-backup.bundle` 作为干净历史的还原点。
- **新增 [docs/ecosystem.md](docs/ecosystem.md)**：GitHub 同类项目调研（36 个仓库）、可借鉴的设计与
  “不要学”的清单，以及四个已批准方向（搜索语法、JSON 导出、MCP、扩展补齐）的口径与验收方式；
  `TODO.md` 增加“已批准、待开工”一节、Claude 分享适配标为明确不做，`HANDOVER-PROMPT.md` 同步重写，
  新的会话可以直接按这两份文件接手。
- README 增加四张界面截图（阅读页、资料库、项目页、导入页），全部来自 `scripts/make-readme-fixture.mjs`
  生成的隔离演示夹具（三段合成对话 + 一个项目 + 一条书签 + 三个附件），不含任何真实聊天；
  `scripts/shoot-readme.mjs` 负责起静态服务（带最小 API 桩）并截图到 `docs/assets/`。

### 抓取与来源

- **批量抓取限流/熔断**：两次抓取至少间隔 1.5s、每 40 条休息 30s、最多 1000 次；
  连续 3 次 429/503 或最近 10 条失败率 ≥60% 时停掉整批，接口返回 `429 + stop + Retry-After`，
  前端提示「批量导入已暂停」并把**未处理的链接留在输入框**。被限流的那条不留空快照，
  导入任务记为 `capture-failed` 以便原样重试；普通失败仍是 500（可重试）。
- **站点适配层**：新增 `scripts/sources/registry.mjs`，`archive-share.mjs` 与 `local-import-api.mjs`
  改为通过注册表分派（来源、归档目录、Python 导入器、URL 校验、严格 id 校验）；
  目前只有 `chatgpt-share`，加 Claude 等站点只需登记一个 descriptor + 一个导入器。
- 测试：`test-import-throttle.mjs`、`test-import-throttle-api.mjs`、`test-sources-registry.mjs`
  已加入 `npm test`；`test-link-import-browser.mjs` 补了“暂停整批并保留链接”的浏览器断言。

### 导出

- **Markdown 变 Obsidian-ready**（下载通道与 CLI）：文件头加 YAML frontmatter
  （`title / chat_id / url / project / created / updated / model / tags`，只写已知字段）；
  公式从 `\( \)`/`\[ \]` 转成 `$…$`/`$$…$$`（代码块与行内代码不动、货币 `$` 转义）；
  文末自动生成 `## Sources`（网页引用去重后编号）。
- **新增 `npm run export:md`**：`--all` / `--id <会话>` + `--out <目录>`，写 `<标题>.md` 并把附件复制进
  `<out>/attachments/`，正文链接改成相对路径；`--link-style wikilink` 输出 `![[文件名]]`；
  同名附件内容不同时自动加内容哈希后缀；`--no-assets` 等价纯文本导出。只读 `archive/`，只写 `--out`。
- 归档快照里的 `conversation.md` 口径不变（不加 frontmatter），避免改动既有快照语义。
- 测试：`test-markdown-vault.mjs`（纯函数）、`test-export-markdown-cli.mjs`（CLI 全流程）、
  `test-markdown-export.mjs` 扩充为“下载通道带 frontmatter/数学”的断言。

### 表格预览

- **大表截断**：XLSX 只读预览最多渲染 500 行 × 60 列（`CEOBE_SHEET_MAX_ROWS` / `CEOBE_SHEET_MAX_COLS` 可调），
  超出时表格上方注明“仅预览前 N 行 × M 列（原表 X 行 × Y 列），完整内容请下载原文件”，资料库不再被大表拖慢。
- **读得更顺手**：点单元格高亮所在行与列（再点取消），预览右上角新增 50%–200% 缩放条（重置回 100%）；
  原表里隐藏的行列照常显示但变淡并带提示。
- 单元格与表头带 `data-col`（真实列序号），合并单元格也能对上行列高亮。
- 修复：`build-file-previews` 在“首页没有任何附件”时会跳过共享脚本复制，导致 `file-previews.js` / `sheet-grid.js`
  没有更新（预览里的表格增强失效）。共享脚本现在在函数开头复制。
- 测试：`test-sheet-table.mjs` 扩充（隐藏/截断/列序号）、新增 `test-sheet-truncation.mjs`（真跑 Python 截断 700 行）、
  `test-sheet-grid-browser.mjs`（会话页与资料库两处入口的选中与缩放）。

### 资料库

- **文件夹当标签**：资料库可以新建、重命名、删除文件夹；一条资源可以同时在多个文件夹里（标签，不是真实目录）。
  文件夹条上点一下只看该文件夹，搜索也会匹配文件夹名。删除文件夹只删标签，不删资源、不删文件。
- **上传自己的文件**：一次可选多个；文本类（Markdown/TXT/CSV/JSON…）在预览窗直接显示内容，图片直接显示，
  其他类型提供下载；同一份内容按 sha256 去重，只留一条记录。
- 上传的字节写 `data/private/library-files/`，**不进 `archive/`**（那里只放采集来的原始档案）；
  「从资料库移除」只删记录（两次确认），磁盘文件保留——资源库不删原文件。
- 数据存在 `data/private/library.ceobe.json`（`kind: ceobe.library`）；接口 `GET /api/library`、
  `POST /api/library/folders|tags|upload|uploads/remove`，开发与生产预览都加载。
- 构建把文件夹、标签与上传项写进 `assets-index.json` / `#ceobe-assets-data`，并单独写入 `#ceobe-library-data`；
  上传副本按内容寻址拷进 `public/library-files/`，不再被引用的副本随构建清理（私有原件不动）。
  纯静态页面因此仍能按文件夹筛选，只是不能编辑。
- 测试：`test-library-store.mjs`、`test-library-api.mjs`、`test-library-ui-browser.mjs` 均已加入 `npm test`。

### 构建

- **页面装饰指纹**：`scripts/decoration-plan.mjs` 按“渲染器/模板 + 项目清单 + 该页会话条目 + 页面字节”算指纹
  （`data/private/decoration-stamps.json`），只把需要重做的页面交给五个后处理步骤。没有变化的页面
  不再被解析、也不再被写盘。
  - 真实档案数据没变时重建：`Decorations: 5 of 39`、39 页哈希 0 差异（此前每趟都要重做全部页面）；
  - 重命名一个会话只多重做那一页；删除一个会话不会重做任何会话页。
- **资源库按页缓存**：`build-asset-library` 按“渲染输入指纹”（会话内容 + 渲染器）缓存每页的资源列表与
  附件预览模板名，命中时不再解析页面、不再读会话 JSON；附件文件名是内容 sha256，目标文件已存在就跳过
  249 MB 的重新拷贝。索引与预览片段改为内容没变不写盘。
  - 资源库步骤 8.9s → **0.5s**；没有变化的重建 24s → **14.1s**；删除演练的暂存重建 23–26s → **14.9s**（旧日志 52.5s）；
  - 冷缓存、热缓存、缓存清空、缓存损坏四种情况的产出（`assets.html`、`assets-index.json`、506 个
    `public/library-*` 文件）与改造前逐字节一致；
  - 缓存存在 `data/private/asset-library-cache.json`，删除流程会把它带进暂存目录并装回来。
- **项目页瘦身**：`project.html` 不再内嵌全部会话的预览片段与整份资源索引——
  预览只给“至少属于一个项目”的会话，资源索引由 `project-sources.js` 改为 fetch `./assets-index.json`。
  页面 745 KB → **290 KB**；`project-detail` 步骤 2.1s → 1.5s（无项目时 0.1s）；
  删除或重命名一个不属于任何项目的会话，不再改动 `project.html`。
- **资源副本清理**：`public/library-assets`、`library-previews`、`library-media` 里不再被索引引用的旧文件会在
  构建末尾删除（`archive/` 里的原件不受影响）。
- `npm run library -- --only <id>` 现在会在渲染之后照常装饰这一页。此前它只渲染不装饰，
  重建出来的页面会丢掉侧栏、菜单与书签入口。

### 修复

- **书签面板：取消编辑后回到列表**。overlay 模式的面板有一条“点外面就收起”的守卫，编辑器是另一个弹窗，
  点「取消」被当成了“点正文”，于是连列表一起关掉。现在编辑器被排除在外；在正文里点一下仍会收起面板
  （原有契约不变）。`test-bookmarks-browser.mjs` 因此重新变绿，并加进了 `npm test`；
  test 里另外补了一处容忍：目录跳转属于正文操作，overlay 面板会被收起，不再假设它一定还开着。
- **项目页不再有占位按钮**：页头「项目图标」原本是官方按钮（点击会打开我们没有接的图标/颜色菜单），
  还带着「此功能暂未接入本地项目」的禁用提示。现在它是 `<span role="img" aria-label="项目图标：<图标名>">`：
  图标照常显示、不再可点，改图标与颜色继续走「显示项目详情 → 项目设置」（`project-appearance.js`）。
  `project-detail.js` 同步改为按 `[data-testid=project-modal-trigger]` 定位这个容器（不再假设它是 `button`），
  并按 `#ceobe-project-icons` 给出中文标签；`build-project-detail` 的“全量禁用 + 逐个放开”保留为安全网。
  全站已没有带该提示的按钮。
- **并行渲染漏拷附件**：`archive-resources` 的附件字节原本写在 `--skip-shared-assets` 分支里，只有第一页会拷贝，
  其余页面渲染出来的附件链接指向不存在的文件（实测 34 页共 295 条附件链接，**280 条失效**）。
  现在每个页面进程都写自己会话的附件（按内容哈希命名，`wx` 写入避免并发截断）：
  `replay/archive-resources` 与 `replay/public/archive-resources` 都是 **321 个文件**，`dist/` 同样带上，失效链接 **0** 条。
- **并行渲染的两个竞态**：`public/previews` 整目录同步在并发下偶发 `EBUSY`（现在短暂重试）；
  共享附件的预览数据改为“临时目录 + 原子改名”，抢输的进程直接复用赢家结果
  （此前会读到写了一半的文件，或在整目录同步时报 `ENOENT`）。临时目录放在 `replay/.preview-tmp/`，
  不再落进会被整目录复制的 `previews/`。
- **空的复制按钮不再渲染**：生成图片/图表类回复没有可复制正文（`data-ceobe-copy` 为空串，19 个会话页共 44 个），
  之前点了复制不到东西。现在这类回复不渲染复制按钮；工具条在渲染时打 `data-ceobe-turn-actions`，
  书签的「更多操作 / 编辑书签」按标记定位，所以它们的工具条是「更多操作 + 编辑书签」。
- **项目页 composer 只保留逐条导入**：「上传采集包 .zip」与批量导入提示原本也注入到项目页 composer，
  但这两条路径在项目页并不生效（`/api/archive-package` 不带项目语义，导进来的会话不会进本项目；
  批量导入会被明确拒绝）。现在它们只在「导入会话」页出现，项目页 composer 回到官方的 52px，
  `test-project-detail.mjs` 的几何对比通过；逐条粘贴分享链接导入并移入项目的行为不变。
- **只读回放不再出现云端操作**：消息工具条里的「编辑消息 / 评价回复 / 分享 / 切换模型」、
  生成图片的「喜欢 / 不喜欢」以及图片悬浮层（「编辑图片 / 分享此图片」）不再渲染；
  工具条只剩复制（有正文时）+ 更多操作 + 编辑书签。渲染时以复制按钮为锚点裁剪，只删按钮和“只包着按钮的空 span”，
  不会碰正文；图片悬浮层整块删除。`data-bookmark-unavailable` 标记与“本地归档不执行…”的点击说明一并移除。
- `test-clipboard-browser.mjs` 改为在确实含代码块/表格的会话页上验证复制，并跳过生成图片回复的空复制按钮
  （首页是图表会话，旧的 `pre button[data-ceobe-copy]` 在现有档案里已不存在）。
- `test-ui-followups-browser.mjs` 的 390px 断言改为先滚动到视口内再测量：书签标注只为视口附近的会话
  计算布局，离屏标注会保留上一次宽度的决策（进入视口时重算），旧断言比较的是用户看不到的状态。
- `test-library-browser.mjs` 第 56 行的既有失败：悬停到没有回复文本的目录项时，上一条的详情卡在展开状态（37px）。
  `prompt-rail.js` 现在会收起旧详情，测试改为对比“带详情”的条目，并补了一条“悬停无详情条目应收起”的回归断言。
- `test-chat-actions-store.mjs` 不再断言删除后 `dist/index.html` 存在（`eeedad0` 起写操作只标记 `dist` 过期）。
- `build-chat-actions` 的置顶按钮 `aria-label` 改为只取档案标题：此前它读取 anchor 上已有的 `aria-label`，
  同一页“首次装饰”和“再次装饰”结果不同，重新渲染后页面就会变。

### 验证

- `npm test` exit 0，含新增的 `scripts/test-sidebar-client-render.mjs`：同一数据重建两次逐字节一致、
  未变化的页面不重新装饰；重命名只重做那一页；删除一个会话后其余会话页哈希不变、只有被删页面消失、`chats.json` 更新。
- `npm run check` exit 0：34 个分享会话 / 42 快照 / 14704 条消息、PDF 零越界、巡检 39 页 0 问题。
- `npm run build` exit 0；`vite preview` 下侧栏正常，拦掉 `/api/chats` 后仅靠 `chats.json` 也能渲染出 34 行。

## v1.0.2（2026-10-22）

### DIL 渲染

- 少量不支持的组件不再让整条回答退回 Markdown：卡片、按钮等结构得以保留。
- 补齐 `box`/`row` 的布局样式（从官方分享页抽取 47 条规则），模型卡片恢复「左说明 + 右 32B/容量」两栏。
- `button` / `radio-group` 按官方结构渲染，并在控件作用域内提供中性 token（方案 B）；单选组补空心圆标记。
- 载荷里双重转义的 `\uXXXX` 文本会被还原（正文、复制、DIL 文本三处），不再出现 `u63a8u8350…`。

### Markdown 导出

- 「另存为 MD」与下载通道输出时间线：`*2026-10-22 12:57:28 · 第 1 段 / 共 9 段*`；同一天只写一次日期；助手正文标题降两级；去掉尾随段号。
- 新抓取的 `conversation.md` 同格式；已有快照保持不变。

### 失效引用的说明

- 沙箱/本机路径链接标为不可用：`aria-disabled`、移出 Tab 序、灰色文字 + 可见的「（未归档）」。
- 一次贴多张图时不再整批丢失（按模板张数分块）；缺失的图片显示占位卡并注明文件与原因。
- 只有资源记录、没有附件卡片的缺失文件（文本 / 视频 / 被安全策略拦下）逐条说明。
- 每个有缺口的会话顶部新增可折叠的「本会话有 N 个附件未随分享提供」清单；归档索引新增「未归档附件」列。

### 构建

- 页面渲染改为 4 并发工作池（`CEOBE_PAGE_WORKERS` 可调），全量重建 111.9s → 70.9s。
- 未变更的会话页不再重渲染（按 canonical 内容 + 渲染器指纹判断）。
- `chat-menu`、`chat-actions`、`chat-organizer`、`sidebar-controls`、`reader-ui` 合并为一趟页面遍历，一页只解析一次、统一写盘；`CEOBE_NO_CACHE=1` 可退回逐步骤模式做逐字节对照。
- 全站巡检新增 `dil-markup` 检查：页面上残留未渲染的 DIL 标记会直接报错。

### 修复

- 被强杀的进程留下的 `mutation.lock` 会自愈（持有者 pid 不存在即接管），不再永久阻塞创建项目。
- 多个构建步骤重复追加样式表/脚本/数据块导致页面随构建膨胀的问题，随合并改造一并收敛。

### 验证

- `npm test` exit 0；`npm run check` exit 0（35 个分享 / 43 快照、PDF 零越界、巡检 0 问题）。

## v1.0.1（2026-10-21）

- **瞬时网络错误自动重试**：抓取 `chatgpt.com` 时遇到 `ECONNRESET`/`ETIMEDOUT` 一类的传输层断开，最多重试 3 次（1s、2s 退避），不再让一次抖动废掉整条导入。
- **导入失败原因可见**：服务端改为从子进程日志里挑出真正的原因行（fetch 错误、Traceback 或最后一行）返回，批量面板同时显示服务端原文与 HTTP 状态；此前无论什么原因都只回一句通用提示。

验证：两条此前失败的分享链接（`6ad8c78c…`、`6ad8c7bf…`）重新抓取均成功，分别得到 151 条与 20 条消息。

## v1.0.0（2026-10-21）

首个可用版本：本地归档、离线阅读、Markdown 与 PDF 导出、批量导入与完整的自检工具。

### 采集与导入

- 分享链接归档：抓取原始页面 → 解码为 canonical → 渲染阅读页，全程走归档守卫（`archive/` 只增不改）。
- **批量导入**：导入页可一次粘贴多条分享链接（每行一条），自动去重、逐条导入，单条失败不中断，结束汇总成功/失败。
- 浏览器扩展：分享链接 → `raw/share.html` + `capture.json` 的 ZIP；ZIP 可直接拖到导入页，或 `npm run import:share-package -- --input <zip>`。
- 失败的抓取默认**不落盘**（连空的会话目录一起删除），排查时用 `--keep-failed` 保留原始页面与 `import-error.txt`。
- 登录态采集路线已移除（页面只在真实用户滚动时分页，程序化滚动无效；详见 `extension/README.md`）。

### 阅读与整理

- 官方 DOM 冻结模板（33 个）+ DIL 生成式 UI 外壳（22 个组件），无法忠实表示的组件整条回退 Markdown。
- 用户消息按 Markdown 渲染（还原归档转义与行尾反斜杠）；无法归档的图片显示「图片未归档」占位并保留 alt。
- 资料库：**列表 / 网格**切换（记在本机）、来源会话与保存状态筛选，可与类型筛选、搜索叠加。
- 附件预览：TXT / MD / 日志 / CSV / JSON / DOCX / PDF / XLSX；XLSX 支持合并单元格、数字格式、冻结表头与行号列、选区复制为 TSV。

### 导出

- Markdown：每段末尾输出「（第 N 段对话，共 M 段）」。
- PDF：`npm run export:pdf -- --id <id>`
  - A4（无页眉页脚、黑体、表格与代码折行）；
  - `--mobile` 手机尺寸 100×178mm；
  - `--mobile --document` 文档版式（用户消息左对齐、去气泡、隐藏聊天装饰），并在导出后盖章：首页标题+日期页眉、每页 `N / 总数` 页码；
  - `--all` 批量、`--limit`、`--force`；`npm run audit:pdf` 自检两个 PDF 目录。
- 单文件 HTML：实验性保留，未上入口菜单。

### 工程与验证

- `npm run dev` **自动选端口**：从 5173 起逐个真实 bind，跳过被占用或被系统保留的端口，打印实际地址；`CEOBE_PORT` 可固定。
- `npm run check`：档案完整性 → PDF 审计 → 全站巡检，一条命令跑完。
- `npm run verify:archive`：逐快照检查原始载荷、canonical 字段、消息与节点一致性、唯一根节点。
- `npm run test:web`：33 页逐页检查控制台错误、HTTP 失败、断链、破图、横向溢出、重复 id、alt 文本。
- 单页构建若会清空整个 `replay/` 会**拒绝执行**（`--preserve-output` / `--allow-wipe`）。
- 测试链覆盖：导入页 UI、交互冒烟、打印样式、表格渲染、Web 采集转换、归档守卫、DIL 解析与渲染等。

### 修复

| 问题 | 根因与处理 |
|---|---|
| 代码块长行在纸上被裁 | CodeMirror 内容宽度来自 `min-content`，只改 `width` 无效；放开 `min-width` 并让行折行 |
| 打印中文回退新宋体 | `print.css` 显式指定黑体族 |
| PDF 页眉印出 `127.0.0.1` | 来自浏览器打印对话框；改用 Playwright 导出（`displayHeaderFooter: false`） |
| 用户消息里的文档显示成源码 | 归档做了 Markdown 转义且换行写成行尾反斜杠，渲染前需还原 |
| 破图 | 缺失资源 → 占位块；有资源 id 且本地有文件的改写真实地址；懒加载空图隐藏 |
| 失败抓取在档案里留下空壳 | 改为先取页面再建目录，失败时删除快照与空会话目录 |
| 误删整个 `replay/` | 单页构建前检查输出目录，非空则拒绝执行 |
| 手机版留白过大 | `@page` 边距从 16/14mm 收紧到 5mm，页数 337 → 272 |
| 网格视图串版 | 表格行不能靠 CSS 改造，改走独立卡片渲染 |

### 已知限制

- 官方安全检查拦下的资源（`safety_check_failed`）匿名无法获取，报告如实记为 unresolved。
- 会话正文里指向作者本机的图片（`图片/…`、`*_files/…`）永远拿不到字节，阅读时显示占位。
- 生产构建的 HTML 引用**带哈希**的资源路径；请求不带哈希的旧路径会命中 SPA 回退，属预期。
- 官方的数据导出只提供"发邮件"一种交付方式；若账号邮箱不可用，导出包拿不到，Export Data 导入无从做起。
- 单文件 HTML 导出：助手侧图片未内嵌、大会话体积偏大。

### 验证基线

| 命令 | 当前结果 |
|---|---|
| `npm test` | exit 0（含 22 个浏览器测试） |
| `npm run check` | exit 0：28 个分享 / 35 个快照 / 11505 条消息、PDF 两个目录零越界、33 页巡检零问题 |
| `npm run build` | exit 0，`dist/` 约 1020 个文件 |
| `npm run preview` + 巡检 | 33 页 / 0 问题 |
