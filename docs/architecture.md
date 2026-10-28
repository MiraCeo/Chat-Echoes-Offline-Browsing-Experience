# 架构说明

[返回 README](../README.md) · [使用指南](usage.md) · [开发指南](development.md)

## 数据源与输出

CEOBE JSON 是规范化数据源。Markdown 和本地 HTML 是两个平级输出，阅读器不把 Markdown 当作聊天的中间数据层。

```text
ChatGPT 分享页面及公开资源
             │
             ▼
       分享归档与结构解析
             │
             ▼
        CEOBE canonical JSON
          ┌──┴─────────┐
          ▼            ▼
     Markdown 导出   typed DOM renderer
                       │
                       ▼
                 本地 HTML 阅读器
```

这样可以在方便导出文本的同时，保留网页阅读所需的角色、消息关系、资源关联、引用和结构化内容。

## 归档与解析

分享链接归档由 `scripts/archive-share.mjs` 协调，Python 分享解析入口为 `scripts/import-chatgpt-share.py`。

每次抓取在 `archive/chatgpt-share/<share-id>/<时间戳>/` 中保存一份独立快照，包含原始响应、抓取记录、`conversation.ceobe.json`、Markdown 副本、资源及导入报告。失败响应也保留用于诊断，不覆盖旧快照。文件夹名即聊天 ID，是删除、导出等操作的安全边界，不会改为按标题命名；`scripts/build-library.mjs` 在每次重建 `archive/library.ceobe.json` 时同步生成 `archive/chatgpt-share/README.md`（`scripts/chat-index-markdown.mjs`），列出标题、ID、最新快照链接、导入时间与轮数，重命名聊天后由 `chat-store.mjs` 刷新；“打开本地文件夹”菜单项通过 `POST /api/chats/open-folder?id=`（`scripts/open-folder-api.mjs`）让本地服务在资源管理器中打开该快照目录，路径须经 realpath 校验位于 `archive/chatgpt-share/<id>/` 之内。

解析器处理分享页面的流式数据块和主载荷，保留消息节点、来源关系、原始指针和附加协议记录；不能把附加 React 记录一概视为异常。循环引用以指向原始槽位的标记表达。

### 完整性有多个维度

- 结构检查关注节点关系、阅读顺序、重复或缺失消息等问题。
- `completeness` 区分结构化载荷与保存页面的可见 DOM 覆盖情况。
- 长对话可能使用虚拟化 DOM；可见节点少不等于 JSON 消息缺失，报告可标记 `partial_virtualized`。
- 资源下载状态由资源记录及 `resource_counts` 表达，结构正常不代表附件齐全。

阅读器从 JSON 重建可见消息，不用保存页面中的 DOM 数量替代消息完整性判断。来源没有提供的内容仍无法保证恢复。

## 档案库与本地元数据

`archive/library.ceobe.json` 记录每条聊天最新可用快照的入口及摘要元数据，不复制正文。历史快照保留在原目录中。

`data/private/` 保存独立于原始聊天的本地管理信息：

- `chats.ceobe.json`：聊天显示名称、置顶等元数据。
- `projects.ceobe.json`：项目名称、图标、颜色、简介、聊天关联，旧 `source_refs` 手动资料引用仍保留，但不再使用或更新。
- 导入与删除任务记录、写入锁和恢复信息。

项目简介只是项目元数据，不进入聊天内容、AI 上下文或文本导出。移动聊天更新项目关联，不移动或改写原始归档正文。

项目“文件”不保存独立关联表。`project-files-data.js` 对资料库资源的 `sources` 与项目 `conversation_ids`、当前聊天目录取交集，保留项目内的来源记录；复用资料库内容 ID 去重。资料索引为每个来源保存文件名、别名和归档时间，避免项目外记录影响项目内的名称、搜索和时间。来源聊天标题从当前聊天目录更新。

`scripts/build-project-sources.mjs` 沿用原构建入口名称，但现在只组装资料库控件、行模板与预览，不再读取官方项目来源模板。`project-sources.js` 沿用原模块名，负责文件标签、URL 兼容和只读刷新；`asset-library.js` 用限定后的资源集合渲染项目文件，同时保持全局资料库行为。页面只发 GET 请求；原 `sources-add`／`sources-remove` 写入动作返回 410，不清理旧字段。

统计不复制附件，不写项目文件关联，不进入聊天 MD 或项目 ZIP。若本地服务不可用，回退为构建时的项目快照并明确提示。

## 页面生成

主要构建入口：

- `scripts/build-library.mjs`：索引归档，生成完整多会话应用。
- `scripts/build-official-replay.mjs`：从指定 CEOBE JSON 生成阅读页面。
- `official-templates/`：可复用页面外壳、消息组件、菜单、布局和本地样式资源。

普通正文块使用 Markdown 排版；其他类型的消息和结构化内容按对应 DOM 模板渲染。字体和 SVG sprite 指向本地资源，生产构建同时发布按需加载的预览片段与附件。

`--sample-assets` 仅用于明确的样本演示，允许按样本消息 ID 复用媒体快照；正常归档阅读不会把缺失资源替换成测试样本。

### 正文内联组件

当前官方助手正文把引用等组件直接内嵌在文本里，例如 `<Cite refs={["turn131558view0"]}/>`、`<FileCite ref="turn0file0" line_range_start={49} line_range_end={50}/>`、`<Link url="…" title="…"/>`、`<MemoryCite />`、`<Entity category="software" value="…"/>` 和 `<Chart content={{…}}/>`。这些标记只是文本，旧版本会把它们原样显示出来。

`metadata.genui_components` 为每个内联组件给出字符区间、`safe_urls` 和 `entities` 引用；区间是权威来源，偏移量按 `build-official-replay.mjs` 拼接助手文本的同一规则换算。`scripts/dil-inline-components.mjs` 只做解析、不执行载荷，并沿用冻结的官方模板渲染：

- `cite` 经 `search_result_groups` 的 `turnNNNsearchN` 引用表解析站点名，复用官方网页引用药丸模板；`link` 复用官方修饰链接模板；`file_cite` 从消息附件还原文件名，复用官方文件引用模板。
- 尚无冻结模板的组件降级为可读文本（`MemoryCite` 标为“记忆”，`Entity` 取 `value`，`WritingBlock` 只保留正文），原始标记不会出现在阅读页、复制内容或 Markdown 导出中。
- 缺少 `genui_components` 的抓取按已知标签做保守扫描；普通正文与代码里的同名字符串不受影响。

抓取当前的助手回复同时携带 Markdown 回退文本和 `metadata.model_dil_v2` 生成式 UI 文档。`scripts/dil-document.mjs` 纯解析该文档（提取 `DIL.render(…)`、按载荷自带 `constants` 求值、无 `eval`／`vm`，未知标识符只记录不执行）；`scripts/freeze-dil-templates.mjs` 把匿名快照里官方 DIL 输出的组件外壳冻结进 `official-templates/dil.json`（含固定内层包装与多形态）；`scripts/render-dil.mjs` 用这些外壳把组件树渲染成 DOM。回退规则是分层的：结构类组件按冻结外壳渲染，装饰组件（`icon`／`favicon`）不产出，出现 `visualization` 等无法忠实表示的组件时整条回复退回 Markdown，因此阅读器不会出现半渲染结果。

原始 `参考文件/` 已清理。正常构建只读取冻结模板，不依赖最初保存的参考网页。

## 资源与文件预览

归档流程通过独立匿名浏览器发现公开资源地址。下载限制在已知 OpenAI 资源域名内，逐跳检查重定向，单个资源上限为 100 MiB，并以内容 SHA-256 命名和校验。

资源元数据记录来源指针、消息关联、下载状态、类型和本地路径。阅读器只复制校验通过的本地资源；下载成功与支持预览是两件不同的事。

用户上传的图片沿用官方附件行标记，但改为立即加载并按归档记录的宽高预留占位（官方页面从 CDN 懒加载并依赖解码后的位图定尺寸，本地文件若照搬会在滚动到附近前一直是 0×0，正文随之跳动）。TXT／DOCX 预览生成本地只读正文，PDF 生成页面图片，XLSX 生成只读工作表数据。来源网页引用只保留链接，不递归抓取网站或执行外部应用来补齐内容。

### 测试样本的来源边界

综合测试样本中的 `preview-inputs/粘贴的文本.txt` 是从界面复制恢复的文本，并非原始附件的逐字节副本。具体差异由相邻的 `.provenance.json` 记录；构建中的必要修复只影响派生预览，不改写保存的原件。这类来源说明应保留在 fixture 与技术文档中，而非混入产品介绍。

## 本地服务与写入安全

开发和生产预览均加载本地中间件；纯静态服务没有这些 API。能力探测由 `/api/capabilities` 提供。

主要接口：

| 接口 | 用途 |
|---|---|
| `/api/bookmarks` | 读取书签及目标状态、保存标题与备注、删除书签 |
| `/api/chats` | 聊天元数据与管理操作 |
| `/api/chats/export-md` | 当前聊天的纯文本 Markdown 导出 |
| `/api/projects` | 项目读取与创建 |
| `/api/projects/move` | 更新聊天的项目归属 |
| `/api/projects/action` | 重命名、置顶、简介与删除等项目操作 |
| `/api/library` | 资料库的文件夹（标签）、标签分配与上传记录 |
| `/api/library/folders` | 新建 / 重命名 / 删除文件夹（只动标签，不动文件） |
| `/api/library/tags` | 设置一条资源的文件夹（标签） |
| `/api/library/upload` | 上传文件字节（`application/octet-stream`），写 `data/private/library-files/` |
| `/api/library/uploads/remove` | 移除上传记录（保留磁盘文件） |
| `/api/projects/export-zip` | 项目全部聊天的纯文本 ZIP 导出 |

写入由工作区锁协调，项目存储使用原子文件替换。简介保存携带旧值以检测并发冲突，避免静默覆盖其他窗口的更新。

### 浏览器扩展与采集包

- `extension/` 是 MV3：`zip.js` 写 STORE ZIP、`capture.js` 负责匿名抓取／投递／端口探测、`background.js`
  是 Service Worker 消息路由，`popup` 与内容脚本是两个入口；抓取放在扩展上下文里，不受分享页 CSP 限制；
- 本地服务对 `/api/archive-package`、`/api/archive-share`、`/api/capabilities` 增加扩展 scheme 白名单
  （`chrome-extension://`／`moz-extension://`／`safari-web-extension://`）。`application/zip` 的 OPTIONS
  预检只对这些来源开放；普通网站仍按同源与 `sec-fetch-site` 拒绝；
- 采集包契约在 `scripts/share-package-format.mjs`：`capture.json` 的 `format: "ceobe.capture"` 与
  `version: 1`；旧包（没有字段）按 legacy 接受，未来版本明确报错。`/api/capabilities` 返回同样的
  `packageFormat`／`packageVersion` 供扩展自检；
- `/api/archive-package` 的顺序是“导入快照 → 全量重建索引与页面 → 生产模式发布 → 返回索引条目”；
  导入后失败会返回 `archived: true` 与“重试只更新页面”，避免让调用方误以为需要重新抓取；
- 导入仍走归档守卫与 Python importer，扩展不写 `archive/`；附件由本地管线发现与下载。

聊天删除会先在私有工作目录准备剩余档案和新页面，再切换；遇到可正常处理的异常可回滚。符号链接、目录联接和不明确的跨归档资源关系会触发保护，而不是猜测删除范围。

生产导入先保存归档，再构建并发布页面。二者不是一笔统一事务：发布失败不会删除已保存归档，后续重试可只做发布。旧哈希资源会保留，以兼容已经打开的页面。

锁文件和恢复日志的操作注意事项见[使用指南](usage.md#异常退出后提示工作区正在写入)。

## 书签与独立备注

`bookmark-targets.mjs` 复用规范化消息投影，为可见回复块选择稳定的规范化消息 ID。临时 `ceobe-replay-turn-N` 只用于渲染，不能作为书签键。被合并展示的助手记录通过原消息 ID 集合解析到包含它的回复块；消息不再展示时返回缺失状态，禁止邻近位置回退。

`bookmark-store.mjs` 在私有文件中保存书签 ID、聊天／消息 ID、标题、备注、创建时摘要、角色、时间与版本；每个聊天／消息组合唯一。标题和备注不写回规范化聊天，列表使用当前聊天标题。JSON 同源写入受工作区锁与原子替换保护，更新须匹配书签 ID 和版本，避免并发覆盖以及删除后重建的旧版本误写。格式损坏、未知 schema、符号链接或未完成任务不会触发清空重建。

永久删除聊天时，书签清理与归档、项目关联、派生页面进入同一个暂存／备份／日志切换流程；删除项目不清理书签。构建只注入原消息的定位数据，不嵌入个人书签和备注，因此静态 HTML 不提供书签快照。

`build-bookmarks.mjs` 复用冻结菜单与资料库弹窗外壳；`bookmarks.js` 提供「更多操作／编辑书签」入口、正文左侧可收起的非模态当前列表、全局列表和独立备注编辑窗。没有本地含义的官方消息操作（编辑消息、评价、单条分享、切换模型、图片悬浮层）在渲染阶段就被裁掉，页面上不存在这些按钮，也不会调用云端服务。

## 全文搜索

`search-index.mjs` 在 `npm run library` 时为每个可见回复块生成一条记录（`replay/public/search-index.json`），键为与书签相同的规范化消息 ID，文本来自 `bookmark-targets.mjs` 的同一投影（提问与最终回复的 `text`／`code` 块），不含推理、隐藏上下文、引用、工具往来和附件名；索引不保存标题，标题始终取自当前目录（`/api/chats` 或页面快照），重命名无需重建。搜索弹窗（`sidebar-controls.js`）首次打开时按需加载索引并在浏览器内匹配（与标题相同的 NFKC 折叠），正文命中只对目录中存在的聊天生成，链接为 `conversations/<id>.html#bookmark=<message_id>`；当前页命中改为触发 `ceobe:jump-message`，由 `bookmarks.js` 复用精确定位，不重新加载页面。索引缺失或损坏时退回仅按标题搜索。

### 搜索语法与类型标签

`scripts/search-query.mjs` 是纯函数层（无 DOM）：把查询解析成标题词、正文词、排除词与 `title:`／`from:`／`has:`／`created:`／`messages:` 条件，并给出聊天级过滤、正文级过滤与高亮切片。阅读器弹窗与将来的档案 MCP server 共用同一份规则，避免两处口径漂移。构建时该模块按内容哈希落盘（`replay/search-query.<hash>.mjs`），由 `build-sidebar-controls.mjs` 改写主脚本里的 import 说明符；页面没有 CSP，`.mjs` 按模块加载。

索引的每条 turn 另带 `kinds`（`code`／`table`／`image`／`attachment`／`audio`，固定顺序，无标签时是空数组），只描述阅读页真的显示出来的内容：代码块、Markdown 表格（索引文本已折叠换行，表格按分隔行形态识别）、图片附件与正文 `![]()`、任何附件。`has:` 只依赖这个标签；旧索引没有 `kinds` 时 `has:` 不命中，状态文字会提示重建。

高亮按原文切片：折叠（NFKC + 小写）用逐码点映射，命中位置能映回原文偏移，因此全角字母、连字与大小写混用也能标在正确的字上；标题与正文片段都按此切片渲染，不解析 HTML。只有负向词时只筛标题列表，不会把整库正文都列成命中。

## 导出与备份的区别

文本导出复用 JSON → Markdown 转换器。图片、附件与普通资源链接降为可读文字，代码示例中的链接语法不改写。

项目 ZIP 收集项目关联的聊天，并按当前标题生成唯一文件名；不加入附件、项目简介或书签备注。完整消息关系、历史版本和资源仍以归档数据为准，因此 MD／ZIP 不能替代备份。

### 官方格式 JSON 导出

`export-conversation-json.mjs` 把 canonical JSON 映射回官方 `conversations.json` 形状：`mapping` 由 `nodes`
生成（`{id, parent, children, message}`），消息字段取规范化记录，`content` 直接引用 `content.raw`（原样透传）；
`current_node` 优先用 `current_node_id`，不可达时退回线性路径末节点并标 `ceobe.current_node_repaired`。
缺 `nodes` 的旧快照按 `linear_message_ids` 生成线性 mapping 并标 `ceobe.degraded`。扩展字段 `ceobe` 保存来源、
线性消息顺序、隐藏消息、资源本地相对路径与导入报告；`raw_payload` 不进入产物。

`export-json-cli.mjs` 负责文件与确定性：附件按内容 SHA-256 命名（同内容去重），`manifest.json` 不含墙钟时间，
同一输入两次导出逐字节一致；`--no-assets` 只关闭复制，`--compact` 输出单行。单个 `--id` 写对象，`--all`／多个
`--id` 写数组。它只读 `archive/`，不修改档案；缺失附件只计数，不伪造链接。

## 组件样式与冻结包的边界

冻结包（`official-templates/`）只保存**外壳 DOM 与类名**，不保存组件自己的样式表。页面能画出结构，但
`display`、方向、对齐、尺寸可能全部缺失——2026-10-21 之前 DIL 的模型卡片就是因此纵向堆叠的。

### 遇到"结构对、排版塌"时

先查样式规则在不在包里，再动渲染器。判断方法：在 `official-templates/assets/*.css` 里搜组件类名
（如 `.oIb9lq_Box`），若只找到变量赋值（`--w-box-flex-in-row:1 1 0%`）却没有任何消费它的规则
（`flex:var(--w-box-flex-in-row)`），缺的就是样式表。

### 补齐方式

1. 用 `capture-official-dom.mjs` 匿名抓取包含该组件的分享页；
2. 快照会把页面加载的**全部样式表**存到 `data/private/official-dom/<label>/css/`；
3. 从中只抽取相关规则，写成一个独立文件挂到 `shell.html`，不要整包引入；
4. 重建后按截图 + `npm test` + `npm run check` 验证。

已按此补齐的案例：`assets/box-layout.css`（47 条规则，源自 `chart-hxo96mku.css`，驱动 DIL 的 `box`/`row`
排版与两栏卡片）。

### 明确不做的项

- DIL 的推理折叠块（「思考了 1m 30s」）按用户要求**不做**；
- `button` / `radio-group` 的官方外观依赖主题 token 层（`--button-size` 等）。**已按方案 B 处理**：
  `assets/dil-controls.css` 只在控件自身作用域内定义一组中性 token 与兜底属性，不引入官方 root 变量；
  纯图标按钮（图标是装饰节点，已按规则丢弃）会变成空胶囊，因此 `:empty` 时隐藏。

