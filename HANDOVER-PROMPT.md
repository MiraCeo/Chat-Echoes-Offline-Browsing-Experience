# 交接 Prompt（可直接粘给新的会话/同事）

你在维护一个叫 **CEOBE** 的本地项目（路径：D:\CEOBE），它把 ChatGPT 公开分享链接抓成本地只增不改的
档案，再用冻结的官方 DOM + DIL 渲染器还原成离线阅读页，并支持 Markdown / PDF / JSON 导出、项目、书签与资料库。

先读这些文件，再动手：

1. `HANDOVER.md` —— 当前状态、能力清单、已知问题、过程记录（**先读这个**）；
2. `TODO.md` —— 还没做的事：第二节当前为空（时间线 v1 已随 1.2.0 交付）；第一/三/四节是待拍板、
   已评估与明确不做的范围，别自己开工；
3. `docs/ecosystem.md` —— 同类项目调研（36 个仓库）、可借的设计、四个方向的完整口径与验收方式
   （MCP 已改为“已评估、暂不做”）；
4. `docs/direction.md` —— 2026-10-28 的方向讨论：两种记忆、两种时间线、数据契约、AI 模块的位置；
   时间线 v1 已交付（1.2.0），其余（事件/观点时间线、长期记忆）仍未批准；
5. `docs/development.md` —— 构建流程、每页产物与并发渲染的坑、装饰指纹的共享输入、端口、发布前检查、测试怎么选；
6. `CHANGELOG.md` —— 已交付内容；`docs/usage.md` / `docs/architecture.md` 是面向使用与数据流的说明。

## 两条红线（违反即回退）

- `archive/` **只增不改**：采集、导入、测试都不得覆盖或删除已有快照；只有用户在界面上显式删除会话是例外；
- 采集只用**匿名浏览器**，不得使用登录态（Claude 分享适配已定案“明确不做”，别再提议）。

## 当前状态（截至 `git log -1`）

已完成、不要再重做：侧栏客户端渲染（删除会话不再改写其他页面）、页面装饰指纹、资源库按页缓存、后处理幂等、
项目页瘦身、消息级操作裁剪、附件随页拷贝（`archive-resources` 321 个文件、链接 0 失效）、
Markdown 导出升级为 Obsidian-ready（frontmatter/`$` 数学/`## Sources`）+ `npm run export:md` 连附件、
XLSX 只读预览（大表截断 500×60、点选高亮行列、缩放、隐藏行列标灰）、批量抓取限流熔断、
来源适配层 `scripts/sources/registry.mjs`、书签 overlay 面板“取消回到列表”修复（浏览器测试已进 `npm test`）、
**阅读器搜索语法**（`scripts/search-query.mjs`：引号短语、`-排除`、`A/B`、`title:`、`from:`、`has:`、
`created:`、`messages:`；索引带 `kinds`；解析器单测 `test-search-query.mjs` 已进 `npm test`）、
**官方格式 JSON 导出**（`npm run export:json`：`mapping` 由 `nodes` 生成、`content.raw` 原样透传、
缺 `nodes` 降级、附件内容寻址、两次导出逐字节一致；单测 `test-export-json.mjs` 已进 `npm test`）、
**装饰指纹精度修复**（共享输入改为项目数据文件；换首页 40/40 → 5/40、107–118s → 19–22s；
`test-decoration-plan.mjs` 已进 `npm test`）、
**采集扩展补齐**（0.5.1：直连发送、页内按钮、端口探测、ZIP 兜底；`format`/`version` 握手；
书签小工具打开导入页预填；`test-share-package.mjs` 与扩展的 `test-local-import-api.mjs` 已进 `npm test`；
**实机修复**：采集包导入后先全量重建索引/页面再返回、失败返回 `archived` 标记、`build-library --only`
落后索引时自动重建一次、ZIP 改在 popup 内生成；`test-local-import-package-api.mjs`、
`test-only-index.mjs` 已进 `npm test`；popup/页内按钮仍需手动在浏览器验收）、
**时间线 / 时间轴**（1.2 时间模块：`timeline-index.json` 构建期索引；侧栏「时间」；页内「时间线」列表 +
「时间轴」真实日历缩略/详情，视图状态 `?view=axis` + `localStorage`；`test-timeline-index.mjs` 与
`test-timeline-browser.mjs` 已进 `npm test`）、
**方向记录与 MCP 归档**（`docs/direction.md`；MCP 已评估、暂不做）、
README 四张脱敏截图（`scripts/make-readme-fixture.mjs` + `scripts/shoot-readme.mjs`）、
远端仓库删库重建 + 本地旧对象清理（`pre-rewrite.bundle` 与 `refs/codex/*` 已删，`.git` 3.77 MiB）。

基线：36 个分享会话 / 45 个快照 / 15237 条消息、42 页巡检 0 问题；
`npm test`（含书签与表格两套浏览器测试）、`npm run check`、`npm run build` 全绿；
数据没变时重建 13–17s、只重做 6/42 页、页面字节不变；换首页 6/42、约 20–24s。

## 当前任务（口径见 `TODO.md` 与 `docs/direction.md`）

**暂无已批准、待开工项。** 时间线/时间轴已作为 **1.2 时间模块**接入正式页面（列表 + 缩略/详情）。
1.3 才推进 AI 整理与事件线；后续候选（事件／观点时间线、长期记忆、数据契约收尾）仍未批准，
见 `docs/direction.md`；MCP 已评估、暂不做。

其余条目（已定案、已知限制）不要自行开工。

## 工作方式要求

- 改动后必须给证据：`npm test`、`npm run check`、以及针对性的逐字节/哈希对比；
- 改构建脚本时，先取“旧逻辑”快照 → 用新逻辑重建 → 逐字节比对；页面哈希与字节比墙钟时间可靠；
- 每页自己的产物（附件字节等）**不能**放进 `--skip-shared-assets` 分支（会只有第一页写）；
  共享目录的整目录同步要容忍并发，参见 `docs/development.md` 的「每页自己的产物与并行渲染」；
  `build-file-previews` 的共享脚本复制必须在“没有附件就提前返回”之前，否则首页没有附件时不会更新；
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
npm run export:md      # 导出 Markdown（--all / --id <会话> / --out <目录>）
npm run export:json    # 导出官方格式 JSON（--all / --id <会话> / --out <目录> [--no-assets] [--compact]）
```

完成任何一项后，请更新 `HANDOVER.md` 的“当前状态”、`TODO.md` 的对应条目与 `CHANGELOG.md`，
并在提交信息里写清改了什么、怎么验证的、还剩什么。文档尽量保持“只说现状、不复述历史”——
历史归 `CHANGELOG.md` 与提交记录。
