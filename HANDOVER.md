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
HEAD        （见 git log -1）
标签        v1.0.0 / v1.0.1 / v1.0.2（本地）
归档        35 个分享会话 / 43 个快照，约 928 MB；chatgpt-web 采集为 0
页面        39 页，巡检 0 问题
构建        全量约 70–110s（4 并发）；未变更页面不重渲染
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
- 删除：支持分享与本地采集两种归档、Windows 占用回退（复制 + 剪枝）、写操作不再重建 `dist`（改为标记过期）。

## 4. 正在进行：侧栏客户端渲染（未完成）

**目标**：删除会话时不再重写每一页（现状约 80 秒，其中后处理 52s + `replay/` 620MB 复制 28s）。

**已完成**：`build-library` 生成 `replay/chats.json`（id / 标题 / 置顶 / 轮数 / 抓取时间 / 来源类型），
浏览器可直接取（`/chats.json` 已验证 200）。

**集成点**：`scripts/build-official-replay.mjs` 第 668–694 行目前把示例侧栏替换成全部会话列表。

**试点结论（已回退）**：把列表改成"单条模板 + 客户端按 chats.json 渲染 + 后处理转 `<template>`"后，
浏览器实测能渲染出全部会话（35 行，含置顶区重复的一行），页面体积略降；
但 `scripts/test-library-browser.mjs` 失败（断言在 56 行），且即使回退后该测试仍失败——说明它**与本次改动无关**，
是一个既有问题（详见下节）。试点改动已整体回退，未提交。

**下一步建议**

1. 先修 `test-library-browser.mjs` 的既有失败（第 56 行，`37px` vs `0px`，涉及侧栏折叠高度）；
2. 再做侧栏客户端化，依赖清单见 `TODO.md`「架构改造：侧栏客户端渲染」：
   `chat-actions`（置顶按钮/项目标签/`#ceobe-chat-catalog`）、`chat-menu`、`chat-organizer`、
   `sidebar-controls`、`bookmarks` 五处装饰都要改成客户端事件委托；
3. 注意 `#ceobe-chat-catalog` 目前把全部会话 JSON 内嵌进每一页——不解决它，删除仍会改动所有页面；
4. 验收：删除一个会话后 `replay/conversations/*.html` 哈希不变，只有 `chats.json`、索引与被删页变化。

## 5. 已知问题

- `scripts/test-library-browser.mjs` 第 56 行断言失败（`37px` vs `0px`），回退后仍复现，属既有问题，待定位；
- 删除会话仍需约 80 秒（见第 4 节），且要求 dev server 不占用目录的旧限制已被"复制回退"绕过；
- 官方安全检查拦下的资源匿名拿不到，缺口清单里标「获取失败」；
- 指向作者本机的图片永远没有字节，显示「图片未归档」占位；
- 单文件 HTML 导出仍是实验性（助手侧图片未内嵌）。

## 6. 文档索引

- [使用指南](docs/usage.md) · [开发指南](docs/development.md) · [架构说明](docs/architecture.md)
- [变更记录](CHANGELOG.md) · [后续计划](TODO.md)
- 构建细节：`docs/development.md` 的「发布前检查」与「端口」两节。