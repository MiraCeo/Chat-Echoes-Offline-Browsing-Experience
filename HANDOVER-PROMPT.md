# 交接 Prompt（可直接粘给新的会话/同事）

你在维护一个叫 **CEOBE** 的本地项目（路径：D:\CEOBE），它把 ChatGPT 公开分享链接抓成本地只增不改的
档案，再用冻结的官方 DOM + DIL 渲染器还原成离线阅读页，并支持 Markdown / PDF 导出、项目与书签。

先读这些文件，再动手：

1. `HANDOVER.md` —— 当前状态、能力清单、已知问题、过程记录（**先读这个**）；
2. `TODO.md` —— 还没做的事，以及等你决定的两个方向（资料库文件夹语义、XLSX 交互范围）；
3. `docs/development.md` —— 构建流程、每页产物与并发渲染的坑、端口、发布前检查、测试怎么选；
4. `CHANGELOG.md` —— 已交付内容；`docs/usage.md` / `docs/architecture.md` 是面向使用与数据流的说明。

## 两条红线（违反即回退）

- `archive/` **只增不改**：采集、导入、测试都不得覆盖或删除已有快照；只有用户在界面上显式删除会话是例外；
- 采集只用**匿名浏览器**，不得使用登录态。

## 当前状态（截至 `git log -1`）

已经全部完成，不要再重做：侧栏客户端渲染（删除会话不再改写其他页面）、页面装饰指纹、资源库按页缓存、
后处理幂等、项目页瘦身、消息级操作裁剪（编辑/评价/分享/切换模型与图片悬浮层都不再渲染）、
附件随页拷贝（`archive-resources` 321 个文件、链接 0 失效）、项目页图标改为非交互容器。

基线：34 个分享会话 / 42 个快照 / 14704 条消息、39 页巡检 0 问题；
`npm test`、`npm run check`、`npm run build` 全绿；数据没变时重建 13–15s、只重做 5/39 页、页面字节不变。

## 当前任务（按优先级）

1. `TODO.md` 第一节的两项需要用户先给口径再动手：**资料库文件夹管理/上传**、**XLSX 交互预览**；
2. **README 截图**：可以用隔离夹具造演示数据生成，不必等用户提供素材；
3. 其余都是“已定案/已知限制”，不要自行开工。

## 工作方式要求

- 改动后必须给证据：`npm test`、`npm run check`、以及针对性的逐字节/哈希对比；
- 改构建脚本时，先取“旧逻辑”快照 → 用新逻辑重建 → 逐字节比对；页面哈希与字节比墙钟时间可靠；
- 每页自己的产物（附件字节等）**不能**放进 `--skip-shared-assets` 分支（会只有第一页写）；
  共享目录的整目录同步要容忍并发，参见 `docs/development.md` 的「每页自己的产物与并行渲染」；
- 遇到 Windows 文件占用（`EPERM`/`EBUSY`），先停 dev server 再重建；
- 不要为了消除提示去删 `data/private/mutation.lock` 或 `delete-jobs`（锁已支持自愈，删除任务有 journal）；
- **不要把 `archive/` 或 `data/private/` 用 junction/symlink 接进会被递归删除的目录或 git 工作树**：
  `git worktree remove --force` 会穿过 junction 把真实档案删空（2026-10-24 发生过一次，已从备份恢复）；
  隔离测试请真实复制需要的部分，参考 `scripts/test-sidebar-client-render.mjs`；
- 单页刷新用 `node scripts/build-library.mjs --only <id>`，全量用 `npm run library`。

## 常用命令

```powershell
npm run dev            # 自动挑端口（5173 起）并打印地址；浏览器测试需要它常驻
npm test               # 单元 + 浏览器测试（需要 dev server）
npm run check          # 档案完整性 → PDF 审计 → 全站巡检
npm run library        # 重建阅读页（增量）
npm run build          # 生产构建（会清 dist 过期标记）
npm run verify:archive # 只读检查档案结构
```

完成任何一项后，请更新 `HANDOVER.md` 的“当前状态”与 `TODO.md` 的对应条目，并在提交信息里写清
改了什么、怎么验证的、还剩什么。文档尽量保持“只说现状、不复述历史”——历史归 `CHANGELOG.md` 与本文件的提交记录。
