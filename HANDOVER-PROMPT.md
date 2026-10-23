# 交接 Prompt（可直接粘给新的会话/同事）

你在维护一个叫 **CEOBE** 的本地项目（路径：D:\CEOBE），它把 ChatGPT 公开分享链接抓成本地只增不改的
档案，再用冻结的官方 DOM + DIL 渲染器还原成离线阅读页，并支持 Markdown / PDF 导出、项目与书签。

先读这些文件，再动手：

1. `HANDOVER.md` —— 当前状态、未完成工作、已知问题（**先读这个**）；
2. `TODO.md` —— 待办与"架构改造：侧栏客户端渲染"的分步计划；
3. `docs/development.md` —— 构建、端口、发布前检查；
4. `CHANGELOG.md` —— 已发布内容。

## 两条红线（违反即回退）

- `archive/` **只增不改**：采集、导入、测试都不得覆盖或删除已有快照；只有用户在界面上显式删除会话是例外；
- 采集只用**匿名浏览器**，不得使用登录态。

## 当前任务（按优先级）

1. 修 `scripts/test-library-browser.mjs` 第 56 行的既有失败（断言 `37px` vs `0px`，与侧栏折叠高度有关；
   注意：把侧栏客户端化的试点回退后该失败仍存在，所以它和那个改造无关）；
2. 继续"侧栏客户端渲染"改造，让**删除会话不再重写每一页**：
   - 已完成：`build-library` 生成 `replay/chats.json`（id/标题/置顶/轮数/抓取时间/来源类型）；
   - 集成点：`scripts/build-official-replay.mjs` 第 668–694 行（目前把示例侧栏替换成全部会话）；
   - 必须先解决：`#ceobe-chat-catalog` 仍把全部会话 JSON 内嵌进每页；
   - 需要迁移的五处构建期装饰：`chat-actions`（置顶按钮/项目标签/目录数据）、`chat-menu`、`chat-organizer`、
     `sidebar-controls`、`bookmarks`；
   - 验收标准：删除一个会话后 `replay/conversations/*.html` 哈希不变，只有 `chats.json`、索引与被删页变化；
     现状删除约 80 秒（后处理 52s + `replay/` 620MB 复制 28s）。

## 工作方式要求

- 改动后必须给证据：`npm test`、`npm run check`、以及针对性的逐字节/哈希对比；
- 每次改构建脚本，先用"未启用新逻辑的构建取快照 → 新逻辑构建 → 逐字节比对"验证输出一致；
- 遇到 Windows 文件占用（`EPERM`/`EBUSY`），先停 dev server 再重建，不要在占用状态下硬跑；
- 不要为了消除提示去删 `data/private/mutation.lock` 或 `delete-jobs`（锁已支持自愈，删除任务有 journal）；
- 单页刷新用 `node scripts/build-library.mjs --only <id>`，全量用 `npm run library`。

## 常用命令

```powershell
npm run dev            # 自动挑端口并打印地址
npm test               # 单元 + 浏览器测试（需要 dev server）
npm run check          # 档案完整性 → PDF 审计 → 全站巡检
npm run library        # 重建阅读页（增量）
npm run build          # 生产构建（会清 dist 过期标记）
npm run verify:archive # 只读检查档案结构
```

完成任何一项后，请更新 `HANDOVER.md` 的"当前状态"与 `TODO.md` 的对应条目，并在提交信息里写清
改了什么、怎么验证的、还剩什么。
