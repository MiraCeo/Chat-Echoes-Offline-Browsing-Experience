# 同类项目与后续方向

2026-10-27 在 GitHub 上做了一轮同类项目调研（`gh search repos`，6 组关键词、36 个仓库，重点读了 8 个的
README）。这里记录**调研结论、可以借的设计、以及已经定下来的四个后续方向**，供接手的人直接开工。
决策人是项目作者；下面标注"已批准"的表示口径已定、只差实现。

## 一、生态地图

| 类别 | 代表项目 | 规模 / 许可 / 最近更新 | 与本项目的关系 |
|---|---|---|---|
| 导出器（会话 → MD/JSON/PNG/HTML） | [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter) | 2834★ / MIT / 2026-10-17 | 这个生态的事实标准；格式最全 |
| | [ryanschiang/chatgpt-export](https://github.com/ryanschiang/chatgpt-export)、[yaph/chatgpt-export](https://github.com/yaph/chatgpt-export) | 196★ / 130★ / MIT | 单会话导出、书签小工具 |
| 官方 export ZIP 转换器 | [mohamed-chs/convoviz](https://github.com/mohamed-chs/convoviz) | 888★ / MIT / 2026-10-23 | 输出约定最讲究，可对照 |
| | [anfedoro/ptha](https://github.com/anfedoro/ptha) | 2★ / MIT | 本地档案的 **MCP server** |
| | [scubanarc/chatgpt-to-open-webui](https://github.com/scubanarc/chatgpt-to-open-webui) | 42★ | 官方 JSON → Open-WebUI 导入 |
| 查看器（export → 本地网页） | [SimonWaldherr/chatgpt-archive-viewer](https://github.com/SimonWaldherr/chatgpt-archive-viewer) | 11★ / 2026-09-01 | **单文件 HTML + 强搜索语法** |
| | [daogu-ai/chatgpt-viewer](https://github.com/daogu-ai/chatgpt-viewer)、[jamesmoore/chatgpt-archive-tools](https://github.com/jamesmoore/chatgpt-archive-tools) | 3★ / 7★ | 同类，功能更薄 |
| 分享链接直接抓（本项目路线） | [vl3c/ChatPeek](https://github.com/vl3c/ChatPeek) | 20★ / 2026-10-14 | 最接近；ChatGPT + Claude、429 重试、附件下载 |
| | [Harshk133/chat2readme](https://github.com/Harshk133/chat2readme)（18★）、[hummbugg/chatgpt-conversation-bridge](https://github.com/hummbugg/chatgpt-conversation-bridge)（13★，转 DOCX 续聊）、[LindsayB610/chatgpt-thread-exporter](https://github.com/LindsayB610/chatgpt-thread-exporter)（1★） | — | 都是"一条链接 → 一个文件"，无档案、无阅读器 |
| 登录态抓取（本项目红线外） | [treexxeexx/chatgpt-archive](https://github.com/treexxeexx/chatgpt-archive)（1★）、inkstone（GPL-3.0） | — | 有 DAG 与增量思路，但必须登录 |

**本项目的定位**：分享链接路线里唯一做「完整档案（原始页面 + 结构化载荷 + 资源状态）+ 冻结官方 DOM 阅读器 +
只增不改 + 增量构建」的。ChatPeek 是最强的同类，但它只输出 Markdown，不保留页面外观、不建档案、不处理分支。

## 二、可以借的设计（按性价比）

1. **搜索语法**（archive-viewer）：`"精确短语"`、`-排除`、`A/B`（任一）、`title:`、`from:user|assistant`、
   `has:code|image|audio|attachment`、`created:2025-06`、`messages:>20`。→ 见下面"方向 1"。
2. **多格式 JSON 导出**（pionxzh：官方 / TavernAI / Ooba）：本项目只需官方格式。→ 见"方向 3"。
3. **DAG 全量导出**（convoviz `--branches active|full`）：本项目存了完整 `nodes`，但只导线性路径。
4. **Obsidian 约定**（convoviz）：YAML frontmatter、改标题后把原标题写进 `aliases`、reasoning 用可折叠 callout。
   本项目已有 frontmatter，缺 `aliases` 与思考过程折叠。
5. **Canvas 文档单独落文件**（convoviz）：把 canvas 产出的 `.py`/`.html` 存成独立文件。
6. **自包含单文件 HTML**（archive-viewer）：本项目单文件 HTML 导出还是实验性（见 `TODO.md` 已知限制）。
7. **MCP server**（ptha：`search_archive` 工具）：→ 见"方向 2"。
8. **一键捕获**（生态标配是扩展/书签小工具）：本项目已有 `extension/`，缺直连与页面内入口。→ 见"方向 4"。

## 三、不要学

- **登录态 / cookie 抓取**（treexxeexx、inkstone）：与匿名红线冲突，也有 ToS 风险；
- **用官方 API token 直连**：与"离线档案"的定位冲突，且不稳定；
- **直接抄 GPL 代码**（inkstone 是 GPL-3.0，本项目 MIT）：只借思路；
- **托管镜像/代理站**（`chatgpt-share-web` 那类）：与归档无关。

## 四、已定的四个后续方向

### 方向 1：阅读器搜索语法（已批准，待开工）

- 现状：`replay/public/search-index.json`（6.8 MB / 34 会话），每条 turn 只有
  `message_id, role, order, text`；标题来自 catalog；搜索是纯子串匹配；
- 要做：查询解析（引号短语、`-` 排除、`/` 任一、`title:`、`from:`、`created:`、`messages:`），
  以及给索引加 `kinds`（code/table/image/attachment）以支持 `has:`（一次性重建，体积 +1–2 MB）；
- 验收：解析器单测（`test-search-query.mjs`）+ 浏览器测试（输入语法 → 命中数、命中高亮、空结果文案）；
- 成本：约 1 天。

### 方向 2：档案 MCP server（已批准，待开工）

- 只读 stdio server，数据源直接读 `archive/`（`library.ceobe.json` + `conversation.ceobe.json`），不写、不联网；
- 工具草案：`search_conversations(query, limit)`、`list_conversations()`、`read_conversation(id|title, range?)`、
  `archive_stats()`；
- 参考实现：`anfedoro/ptha`（Python，MCP + 确定性索引）；本项目更适合用 Node 的 MCP SDK 写一个 `scripts/mcp-server.mjs`；
- 验收：单测直接调用工具函数 + 一个 stdio 冒烟测试（发 JSON-RPC 帧、断言返回）；
- 成本：约 1–2 天。

### 方向 3：官方格式 JSON 导出（方案已定，两个小决定待确认）

**为什么便宜**：档案里的 `nodes`（真实会话 727 个节点，`{id, parent_id, children, message_id, raw}`）与官方
`mapping` 一一对应；`messages[*].content.raw` 就是 OpenAI 内容对象；`current_node_id` 对应 `current_node`。

字段映射（第一版）：

| 官方字段 | 本项目来源 |
|---|---|
| `title` / `create_time` / `update_time` / `conversation_id` | `title` / `created_at` / `updated_at` / `id` |
| `current_node` | `current_node_id` |
| `mapping[node].{id,parent,children}` | `nodes[*].{id,parent_id,children}` |
| `mapping[node].message` | `messages[message_id]`：`id/author.role/create_time/content(←content.raw)/status/end_turn/recipient/metadata` |
| `moderation_results` / `plugin_ids` | `[]` / `null` |
| `ceobe`（扩展字段） | `source`（url/captured_at）、`linear_message_ids`、`resources`（本地相对路径）、`import_report`、隐藏消息清单 |

保真原则：`content.raw` 原样透传（不做 LaTeX/Markdown 改写）；不伪造 `file-service://` id；
隐藏消息保留并标记；不导出 `raw_payload`；`nodes` 缺失的旧快照回退成线性 mapping 并标注 `ceobe.degraded`。

命令与产物（建议）：

```powershell
npm run export:json -- --all --out <目录> [--no-assets] [--compact]
npm run export:json -- --id <share-id> --out <目录>
```

`conversations.json`（`--all` 为数组）+ `attachments/<sha>.<ext>` + `manifest.json`（格式版本、条数、缺附件数）。

验收：`test-export-json.mjs` 断言 `mapping` 重建顺序 == `linear_message_ids`、`content.raw` 逐字节一致、
`current_node` 可达；缺 `nodes` 的快照走降级分支；同一输入导出两次逐字节一致；
可选交叉验证：把产物喂给 `convoviz` 或 `chatgpt-to-open-webui` 看能否解析。

待确认的两个小决定：① 独立命令 `export:json`（建议）还是并入 `export:md --format json`；
② 附件默认是否复制进 `attachments/`（建议默认复制，`--no-assets` 关闭）。成本约 0.5–1 天。

### 方向 4：采集扩展的生态补齐（已确认要做，优先级最低）

现状：`extension/`（MV3 v0.4.1）只做匿名抓取——popup 粘贴分享链接 → `raw/share.html` + `capture.json` →
导出 `ceobe-capture-*.zip` → 拖进导入页（或 `scripts/import-share-package.mjs`）。

| 缺口 | 补齐动作 | 成本 |
|---|---|---|
| ① 下载 + 手动拖拽（两跳） | 扩展直接 `POST http://127.0.0.1:5173/api/archive-package`，服务端加扩展来源白名单，结果回显 popup | 0.5 天 |
| ② 得先复制链接（三步） | 在 `chatgpt.com/share/*` 注入"发送到 CEOBE"按钮（content script） | 0.5 天 |
| ③ 采集包无版本握手 | ZIP 里加 `format`/`version`，服务端校验并给明确报错，写进文档 | 0.5 天 |
| ④ 不装扩展没有一键入口 | 书签小工具兜底（`javascript:` 发 POST） | 0.5 天 |
| ⑤ 只有 ChatGPT | 见 `TODO.md`：多站点需要素材，暂缓 | — |

①+② 是体验分水岭（四步 → 一步），③ 是让第三方能自己写扩展的契约。

## 五、明确不做

- **Claude 分享适配**：2026-10-27 定案——作者暂无 Claude 使用需求，也无法提供后续研发所需的样本素材，
  因此**明确不考虑**（不是"待素材"）。技术上可行（ChatPeek 的 README 称 `claude.ai/share/…` 内嵌公开 JSON
  快照），若将来口径变化再重开。

## 六、调研方法与复现

调研用 `gh search repos <query> --sort stars --limit 10 --json …` 做（关键词：`chatgpt export`、`chatgpt archive`、
`chatgpt conversation backup`、`chatgpt offline reader`、`chatgpt markdown export`、`chatgpt share link`、
`chatgpt viewer`、`chat archive local`、`chatgpt branch conversation`、`llm chat export markdown`、
`chatgpt share link archive`、`claude share export`、`gemini conversation export`、`chatgpt to obsidian`、
`ai chat history archive`、`chatgpt single html archive`），README 用
`gh api -H "Accept: application/vnd.github.raw" repos/<owner>/<repo>/readme` 读取。
星数与更新时间是 2026-10-27 的快照，复核时请重新查询。
