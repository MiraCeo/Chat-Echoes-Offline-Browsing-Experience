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
HEAD        （见 git log -1；包含“侧栏客户端渲染”“后处理幂等”“页面装饰指纹”）
标签        v1.0.0 / v1.0.1 / v1.0.2（本地）
归档        34 个分享会话 / 42 个快照，约 900 MB；chatgpt-web 采集为 0
页面        39 页；巡检 0 问题；npm test / npm run check / npm run build 全绿
构建        全量约 95–105s（34 页重渲染，4 并发）；数据没变时约 24s，且只重做 5/39 页、页面字节不变
删除        重建部分约 23s＋档案复制约 1s（原为 52.5s）；会话页逐字节不变
侧栏        浏览器按 replay/chats.json 渲染；每页只剩“当前会话一行 + 行模板”，不再内嵌全部会话
```

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
- 冻结官方 DOM + DIL 渲染（两栏卡片、按钮/单选组中性样式、部分不支持组件不再整条回退）；
- Markdown 导出带时间线（下载通道与新抓取的 `conversation.md`）；
- 失效引用说明：沙箱/本机链接标「未归档」、缺失图片占位、缺失附件逐条说明、会话顶部缺口清单、索引「未归档附件」列；
- 构建：增量页面渲染（内容哈希指纹）、五个后处理步骤合并一趟、页面渲染 4 并发；
- 后处理**幂等**：同一份数据重建后页面逐字节一致（`scripts/page-decoration.mjs` 统一清场 + 就地更新资源引用 + 内容没变不写盘）；
- 删除：支持分享与本地采集两种归档、Windows 占用回退（复制 + 剪枝）、写操作不再重建 `dist`（改为标记过期）；
- 侧栏由浏览器渲染：页面里没有全部会话的 `<li>`，也没有 `#ceobe-chat-catalog`；删改一个会话不再改写其他页面。

## 4. 侧栏客户端渲染（已完成）

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
| 数据没变重建两次 | `Decorations: 5 of 39`（只有每次都要重建的首页/导入/资料库/项目页），24.1s；39 页哈希 0 差异 |
| 重命名一个会话 | 只多出那一页：`6 of 39`，页面字节只在该页与 `chats.json` 上变化 |
| 删除演练（真实档案，按删除流程复制 archive+replay 后重建） | 档案复制 1.0s ＋ 暂存重建 **22.9s**，输出与线上页面 **0 差异**（旧日志：重建 52.5s） |
| 隔离副本删除 | 2.3s（重建 2.2s） |

顺带修好：`npm run library -- --only <id>` 以前只渲染不装饰，重建出来的页面会丢掉侧栏/菜单/书签；
现在它会照常过一遍装饰步骤，只处理这一页（其余 38 页字节不变）。

**还剩什么**

- 暂存重建里最大的一项是 `build-asset-library`（约 8–9s，逐页扫描资源），其次是搜索索引与项目页（各约 2.5s）；
  资源库可以按页面内容哈希做缓存；
- 顶层 5 页每趟都要重建、因此每趟都要重新装饰（约 1.3s），影响不大；
- `project.html` 内嵌每个会话的预览片段，删除会话后它一定会变，可考虑改为按需加载。

**顺带修掉的构建缺陷**

- `build-chat-organizer` 的清理会删掉承载 `[data-chat-recent-list]` 的整个分区：任何“不重渲染页面”的重建
  （删除/重命名/置顶）都会让侧栏列表永久消失。现在只清理自己注入的节点；
- 五个后处理步骤此前会重复注入弹窗/模板/样式表/脚本（每重建一次多一份，页面 4.7 MB 大半来自这里）。
  现在由 `clearPageDecorations()` 在每趟构建开头统一清场，各步骤按固定顺序重新注入；
  资源引用用 `placeStylesheet`/`placeScript` 就地更新版本，头部顺序不再漂移；
- 页面内容没变就不写盘（`writeIfChanged`），删除时不再重写 39×4 MB。

## 5. 已知问题

- `scripts/test-ui-followups-browser.mjs` 在 390px 宽度断言失败（书签标注 `x=-20` 越出视口）。
  已在干净 HEAD 工作树上复现，**不是本版改动引入**；
- `scripts/test-project-detail.mjs` 的几何对比失败：项目页 composer 里多了
  `link-import.js` 注入的「上传采集包 .zip」块（约 61px），把 tablist 从 260px 推到 321px，
  而冻结参考里没有这块。`link-import.js`、`build-import-page.mjs` 与
  `official-templates/project-detail.json` 本版都没有改，属既有分歧；两个测试都不在 `npm test` 里；
- `scripts/test-chat-actions-store.mjs` 原本断言删除后 `dist/index.html` 存在，与 `440cc8e`「写操作不再重建 dist」冲突；
  已改为断言 `replay` 干净、`dist` 保持原样并写入 `data/private/dist-stale.json`；
- 删除会话仍不是“秒级”：重建约 23s（其中资源库 8–9s、搜索索引与项目页各约 2.5s），
  另有档案复制与安装回写；页面本身已经不再重写（见第 4 节）；
- 官方安全检查拦下的资源匿名拿不到，缺口清单里标「获取失败」；
- 指向作者本机的图片永远没有字节，显示「图片未归档」占位；
- 单文件 HTML 导出仍是实验性（助手侧图片未内嵌）。

## 6. 文档索引

- [使用指南](docs/usage.md) · [开发指南](docs/development.md) · [架构说明](docs/architecture.md)
- [变更记录](CHANGELOG.md) · [后续计划](TODO.md)
- 构建细节：`docs/development.md` 的「发布前检查」「端口」「写入测试必须隔离」三节。

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

提交：`9a82631`、`86e43c1`、`440cc8e`、`614c363`、`97cd790`。

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
