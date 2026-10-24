# 开发指南

[返回 README](../README.md) · [使用指南](usage.md) · [架构说明](architecture.md)

本页依次：本地开发（含端口被占用时的处理）→ 构建与预览 → 打印（PDF）样式约束 → 数据边界 → 测试 → 维护与提交。

## 本地开发

运行环境和首次安装步骤见[使用指南](usage.md)。使用真实档案开发时，先完成备份。

```powershell
npm run library
npm run dev -- --host 127.0.0.1 --port 5173
```

`library` 生成页面，`dev` 服务现有页面；只重启开发服务不会自动重新生成 HTML。修改构建脚本或模板后需要重新生成，修改运行时 JS／CSS 也可能需要经过对应构建器的复制与指纹步骤。

不要与导入、删除等写入任务并发手动构建。服务使用 `scripts/workspace-mutation.mjs` 协调写入；维护脚本若修改派生工作区，也应遵守同一约定。

### 端口被系统占用时

`npm run dev` 现在会自己找端口：从 **5173** 开始向上探测，跳过被占用或被系统保留的端口，打印实际地址，例如：

```
端口 5173 不可用（被占用或被系统保留），改用 5250。
本地服务：http://127.0.0.1:5250/
```

- 想固定端口：`CEOBE_PORT=5400 npm run dev`（PowerShell 用 `$env:CEOBE_PORT=5400`）；
- 组件结构正确但排版塌陷（无间距、无对齐、宽高为 0）：先确认冻结包是否缺组件样式表，见[架构说明](architecture.md#组件样式与冻结包的边界)，不要先改渲染器。
- 原因通常是 Windows 把一段端口列进了保留区，可用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查看；
- 探针会真的尝试 bind 一次，因此 EACCES（保留端口）也能被跳过，而不只是 EADDRINUSE。

## 构建与预览

- `npm run build` 输出到 `dist/`（`--emptyOutDir`，会重建整个目录）；
- 构建后 HTML 引用的是**带哈希的**资源（`/assets/print-<hash>.css`、`/assets/link-import-<hash>.js`），
  直接请求不带哈希的旧路径会命中 SPA 回退、返回 `index.html`——这是预期行为，不是资源缺失；
- `npm run preview` 默认端口是 **4173**（`npm run dev` 才是 5173），检查生产产物时别打错端口。

### 侧栏由浏览器渲染

- `build-library` 产出 `replay/chats.json`（并复制到 `replay/public/`，所以 `dist/chats.json` 也有），
  字段与 `/api/chats` 对齐（id、标题、置顶、轮数、时间、来源）；
- 每个页面只写当前会话一行 + `<template id="ceobe-sidebar-chat-row">`；`chat-actions.js` 先按 `chats.json`
  渲染，`/api/chats` 可用时再换成最新数据。渲染完成后页面会设置
  `document.documentElement.dataset.ceobeSidebarChats = 'ready'`，浏览器测试等这个标记再数行数；
- 因此**删除/重命名一个会话不会改写其他页面**；`scripts/test-sidebar-client-render.mjs` 用逐字节哈希守住这一点；
- 想回到“每页写入全部会话”的旧行为做对照：`CEOBE_LEGACY_SIDEBAR=1 npm run library`（只用于逐字节比对，不要长期开启）；
- 后处理步骤必须**幂等**：`scripts/page-decoration.mjs` 的 `clearPageDecorations()` 在每趟构建开头统一清场，
  资源引用用 `placeStylesheet`/`placeScript` 就地更新版本，`writeIfChanged` 在内容没变时不写盘。
  新增后处理步骤时照这个模式写，否则每次重建都会重复注入节点、页面体积持续增长。

### 页面装饰指纹

没有变化的页面不该被重新装饰——这是删除/重命名一个会话仍然要几十秒的主要原因。

- `scripts/decoration-plan.mjs` 给每个页面算指纹：`装饰口径版本号 + 渲染器与模板指纹 + replay/projects.html +
  这一页的会话条目（id/标题/page；顶层页面用首页会话）+ 页面当前字节`；
- 页面字节同时包含“渲染结果”和“上一轮装饰结果”，因此重新渲染过、会话内容变了、或有人手改过这一页，
  都会自动重做；指纹存在 `data/private/decoration-stamps.json`，删除流程会把它带进暂存目录再装回来；
- 五个装饰步骤都接受可选的页面清单（`buildChatMenu(root, library, pageCache, pages)` 等），
  清单之外的页面不会被解析、也不会被写盘；构建日志会打印 `Decorations: N of M page(s) refreshed`；
- 新增“会影响页面字节”的全局输入时，必须加进 `decoration-plan.mjs` 的共享输入（例如项目清单），
  否则改它之后页面不会刷新；改装饰口径（不是脚本内容）时把 `DECORATION_VERSION` 加一；
- `npm run library -- --only <id>` 会渲染并装饰指定的页面，其余页面不动。

### 资源库按页缓存

`build-asset-library` 原来每次都会读 34 个会话 JSON、解析 34 个页面、把 321 个附件（249 MB）重新复制进
`public/library-assets/`。现在它按“渲染输入指纹”（`data/private/library-stamps.json` 里的
`sourceHash:renderer`）缓存两样派生数据：

- 每个会话的 `resources` 列表——命中时不再读会话 JSON；
- 每个页面能提供的“附件预览模板文件名”——命中时不再解析页面。

缓存写在 `data/private/asset-library-cache.json`（`version` 变化或文件损坏时自动全部重算）；
附件文件名本身就是内容的 sha256（`assets/<sha256>.<ext>`），所以目标文件已存在就跳过读写；
`assets-index.json` 与预览片段用 `writeIfChanged`。删除流程会把这个缓存一起复制进暂存目录并装回来，
所以删除重建也是冷启动以下的 0.5s 级。

新增会改变“页面能提供什么”的渲染输入时，要注意这个缓存是按 `library-stamps.json` 的指纹失效的；
如果新输入不在渲染指纹里，请把它并进渲染指纹或给缓存加版本号。

## 打印（PDF）样式约束

- 打印规则写在 `official-templates/assets/print.css`（`media="print"`），屏幕渲染不受影响；
- **改规则要对着真实 DOM 改**：代码块是官方 CodeMirror 结构，内容宽度来自 `min-content`，只改 `width` 无效，必须放开 `min-width` 并让 `.cm-line` 折行；
- 页眉页脚（`127.0.0.1` 地址）由**浏览器打印对话框**控制，CSS 无法去除；需要干净 PDF 就用 `npm run export:pdf`（Playwright，`displayHeaderFooter: false`）；
- 宽表格在版心内换行、图片限高 210mm、代码块 `break-inside: avoid`，这些都已在 print.css 中；新增规则时优先复用这些选择器，避免再写一套。
- 导出脚本是 `scripts/export-conversation-pdf.mjs`（`--id` / `--all` / `--mobile` / `--document`）；`--document` 的首页页眉与每页页码由 `scripts/pdf-stamp.py`（PyMuPDF）在**导出后盖章**——版式留白落在页面边距之外，DOM 里画不进去，负边距也会被外壳夹住。

## 代码与数据边界

- `src/`：导入解析等核心逻辑。
- `scripts/`：归档、构建、客户端、中间件及测试入口。
- `official-templates/`：脱敏冻结的 UI、样式、图标和布局基线。
- `fixtures/`：可复现的测试资料及必要的来源说明。
- `samples/`：最小输入示例与演示数据。
- `archive/`、`data/private/`、`attachments/private/`：实际本地数据，不作为提交素材。
- `replay/`、`dist/`：派生产物，不作为源数据。

原始 `参考文件/` 已经删除，并通过无该目录的构建与生产离线回归。不要重新把私人参考目录引入运行或测试依赖。

部分历史 `capture-*` 工具仍假定有特定原始输入。它们用于手工模板迁移，不是正常构建的前置步骤；重新运行前需要重新提供获授权的参考网页。

## 测试策略

### 基础回归

```powershell
npm test
```

这会运行 Python 与 Node 测试，并执行样本回放和档案库构建，**会更改派生页面**。不要在用户导入或删除期间运行，优先使用独立工作副本。真实分享链接归档不应作为无条件测试步骤。

针对模板和渲染的轻量检查：

```powershell
node scripts/test-official-template-package.mjs
node scripts/test-reader-rendering.mjs
node scripts/test-official-citations.mjs
node scripts/test-genui-inline-components.mjs
node scripts/test-copy-content.mjs
```

### 按功能选择测试

| 范围 | 主要入口（位于 `scripts/`） |
|---|---|
| 书签与个人备注 | `test-bookmarks-store.mjs`、`test-bookmarks-browser.mjs`；聊天删除整体验证另见 `test-chat-actions-store.mjs` |
| 正文内联组件（引用／文件／链接） | `test-genui-inline-components.mjs`：解析 `metadata.genui_components` 的字符区间与无元数据时的标记扫描、官方引用模板渲染、无模板组件的降级，以及复制／导出文本不含原始标记 |
| 官方 DOM 快照工具 | `test-official-dom-snapshot.mjs`：输出目录约束（拒绝 `archive/` 与 `data/private/` 之外）、结构签名不含正文、样式族配对、类漂移分类、离线 `--compare-only` 与无参数拒绝执行 |
| 归档只增不改 | `test-archive-guard.mjs`：写入前 dry-run 计划、路径必须落在 `<归档根>/<会话 ID>/<时间戳>`、拒绝覆盖既有快照、符号链接不得把写入带出归档目录，以及采集入口确实调用了守卫 |
| DIL 生成式 UI 文档 | `test-dil-document.mjs`：`model_dil_v2` 载荷的表达式提取、常量／映射／三元／模板字符串／hooks 求值、组件标识符，以及未知标识符只记录不执行 |
| DIL 组件外壳冻结 | `test-dil-templates.mjs`：外壳只保留标签／类／枚举属性（丢弃正文、id、行内样式、资源 URL）、固定内层包装收成 slot、同组件多形态收集、样式表归属判定、`--report` 只读且无参数拒绝执行 |
| DIL 组件树渲染 | `test-render-dil.mjs`：按 props 选外壳形态（`title` 尺寸、`table-cell` 表头、`box` 方向）、内联格式、引用解析与降级、装饰组件不产出、未知组件上报以触发 Markdown 回退、正文转义 |
| 导入页 UI | `test-import-ui-browser.mjs`：采集包入口默认收起、展开出现上传区且尺寸合理、拖入高亮可撤销、导入说明可折叠、分享链接入口仍在、无横向溢出与 `pageerror`；需要本地服务（`CEOBE_TEST_URL` 可覆盖地址） |
| 全站巡检 | `npm run test:web`（`test-web-health.mjs`）：逐页检查控制台错误、HTTP 失败、破图与横向溢出；需要本地服务，输出 JSON 问题清单，发现问题时退出码为 1 |
| 档案完整性 | `npm run verify:archive`：逐个快照检查原始载荷是否在、canonical 是否可解析、必需字段是否齐全、每个消息是否都有节点、是否只有一个根节点；有问题退出码为 1 |
| 一次跑完 | `npm run check`：先校验档案完整性，再审计已导出的 PDF（越界即失败），最后巡检全站页面；巡检查询本地服务，所以需要先 `npm run dev` |
| 交互冒烟 | `test-app-smoke.mjs`：快捷键与鼠标切换侧栏、资料库搜索命中、资料库筛选（全部/图片/文件）计数一致、项目新建对话框可开可关；官方外壳会拦截指针，测试对折叠控件改用 DOM click |
| 打印样式 | `test-print-styles.mjs`：`@page` A4、懒加载占位图隐藏（在构建器里注入）、CodeMirror `min-width`、代码折行、分享按钮隐藏、中文字体栈、`media="print"` 链接 |
| Web 采集转换（路线已结束，转换器保留） | `test-convert-web-capture.mjs`：会话响应挑选（优先会话载荷）、按 `create_time` 排序、线性节点链、隐藏记录保留但不可见、DIL 与附件指针保留、`usable_linear` 明确标注、导入目标仍过归档守卫 |
| 聊天操作 | `test-chat-actions-store.mjs`、`test-chat-actions-browser.mjs` |
| 阅读更多 | `test-reader-actions-browser.mjs` |
| 从聊天打开本地文件夹 | `test-open-folder-api.mjs`（服务端：POST／同源／ID／路径包含检查，打开动作为注入桩，不会启动资源管理器）、`test-open-folder-browser.mjs`（两处菜单；浏览器内拦截 POST，不打开任何窗口、不写入数据） |
| 归档标题索引 `archive/chatgpt-share/README.md` | `test-chat-index-markdown.mjs`；临时目录内生成，验证转义、快照链接与重命名后刷新 |
| 项目管理与入口 | `test-project-actions-store.mjs`、`test-project-actions-browser.mjs`、`test-project-entry-browser.mjs` |
| 项目简介 | `test-project-description.mjs`、`test-project-description-browser.mjs` |
| 已有项目图标／颜色 | `test-project-appearance.mjs`、`test-project-appearance-browser.mjs` |
| 项目文件（沿用原 sources 测试文件名） | `test-project-sources.mjs`、`test-project-sources-browser.mjs`、`test-project-sources-template.mjs` |
| MD／ZIP 导出 | `test-markdown-export.mjs`、`test-markdown-save-browser.mjs`、`test-project-export.mjs` |
| 菜单、图片与导出界面 | `test-reader-ui-browser.mjs`、`test-project-more.mjs` |
| 项目内置顶与标题空间 | `test-project-pinned-browser.mjs` |
| 响应式书签、最近聊天键盘及项目提示 | `test-ui-followups-browser.mjs`；支持 `CEOBE_TEST_DIST=1` 和 `CEOBE_TEST_HEADED=1`，书签为内存夹具、API 只读 |
| 连续调整宽度、离屏旁注与精确跳转 | `test-bookmark-resize-browser.mjs`（`npm run test:bookmarks:browser`）；在临时目录构建隔离副本（`bookmark-browser-fixture.mjs` + `fixtures/browser/bookmark-conversations.mjs`，100／500 条消息、20／100 条书签），不依赖本地 5173，不读写使用者归档；支持 `CEOBE_TEST_DIST=1` 与 `CEOBE_TEST_HEADED=1`，检查布局／样式重算次数、懒滚动、精确跳转与面板开关 |
| 阅读边缘：书签面板停靠与上次阅读位置 | `test-reader-margin-browser.mjs`（`npm run test:reader-margins`）；在临时目录构建隔离副本（同一夹具，120／60 条消息、24／12 条书签），检查 1440→420 各宽度下展开或收起面板都不移动、不压缩正文，留白足够时停靠在正文左侧、不足时改为短浮层且点击别处即收起，空列表收缩为一行提示，以及按聊天恢复阅读位置的精确跳转、从头阅读、清除与只保存 ID＋偏移；全程只读 GET，不依赖本地 5173，不读写使用者归档；支持 `CEOBE_TEST_DIST=1` 与 `CEOBE_TEST_HEADED=1` |
| 侧栏、搜索与整理 | `test-sidebar-controls.mjs`（标题与正文搜索、片段高亮、页内精确跳转与跨页哈希跳转，新查询把结果列表送回顶部、后台刷新保留焦点与位置；正文索引和 `/api/chats` 均为只读夹具）、`test-search-index.mjs`（索引只含可见提问／回复／代码，排除推理、隐藏上下文、引用与附件名）、`test-sidebar-polish.mjs`、`test-chat-organizer.mjs` |
| 侧栏客户端渲染（删除不改页面） | `test-sidebar-client-render.mjs`：在临时目录真实复制运行时 + 三份夹具会话，跑真实构建与真实删除流程；断言“数据不变时重建逐字节一致”“删除一个会话后其余页面哈希不变、只有被删页面消失”“页面里没有 `#ceobe-chat-catalog`、保留一行静态回退与行模板”。不读写使用者归档 |
| 导入与发布 | `test-local-import-api.mjs`、`test-production-import.mjs`、`test-link-import-browser.mjs` |
| 离线资源 | `test-offline-resources.mjs` |

例如：

书签存储与聊天删除路径也可一次运行：`npm run test:bookmarks`。浏览器测试仍需本地 5173 或 `CEOBE_TEST_DIST=1`。

```powershell
node scripts/test-project-description.mjs
node scripts/test-project-description-browser.mjs
```

浏览器测试默认连接本地 5173 服务。当前测试通常使用已安装的 Edge，并且部分场景依赖档案库中有聊天、附件或项目；请先阅读相应测试的前置条件，不假定所有脚本都能在空工作区独立执行。

### 生产预览回归

支持生产模式的浏览器测试会自行启动并关闭临时预览服务：

```powershell
npm run library
npm run build
$env:CEOBE_TEST_DIST = '1'
node scripts/test-reader-ui-browser.mjs
node scripts/test-project-description-browser.mjs
node scripts/test-offline-resources.mjs
Remove-Item Env:CEOBE_TEST_DIST
```

`test-offline-resources.mjs` 阻断外部网络，检查字体、按需附件预览、图片与运行时错误。仅检查页面能打开，不足以证明离线可用。

## 写入测试必须隔离

- 创建、重命名、移动、置顶、简介保存和删除测试，应使用临时存储或明确的内存 API 拦截。
- 对真实档案的 UI 验证默认只读；检查前后数据是否变化。
- 永久删除测试必须验证保留对象和失败路径，不能在个人归档上演练。
- **不要把 `archive/`、`data/private/` 用 junction／符号链接接进任何会被递归删除的目录**
  （临时目录、`git worktree` 等）：Windows 上 `git worktree remove --force` 会穿过 junction，
  把真实档案删空（本项目已发生过一次，见 `HANDOVER.md` 第 8 节）。隔离副本放在 `data/private/` 下
  （Node 会沿目录树找到真实 `node_modules`），真实复制 `official-templates`／`official-assets`／
  `node_modules/katex`，不要建任何联接；参考 `scripts/test-sidebar-client-render.mjs`。
- 真实分享链接导入仅通过显式配置启用，例如 `CEOBE_TEST_SHARE_URL`；不要默认联网归档。
- 异常锁和恢复目录不是缓存，不应未经核查清除。

原生保存接口桩用于验证建议文件名、内容、取消与失败路径；浏览器下载回退另行验证。它们不能替代实际 Windows 保存窗口的目录、权限和覆盖操作验收；该项人工验收已完成，见 `TODO.md`。

## 界面与模板维护

界面以获授权的官方 DOM 与样式为基线，不凭截图重新设计一套近似控件。

1. 将官方页面作为一次明确的迁移输入，默认仅查看、导航与捕获，不提交远端写入。迁移输入可以是保存页，也可以先用 `scripts/capture-official-dom.mjs` 确认差异；两者都只用匿名浏览器，不使用登录态。
2. 去除个人名称、实际内容、认证信息、临时资源地址与无效状态。
3. 把所需模板、样式和图标冻结到独立包中；禁止构建读取私人捕获目录。
4. 确认图标、字体、预览片段等资源均可本地解析，再对照行为与计算样式。
5. 同时验证开发和生产构建，尤其注意嵌套页面路径、按需资源及脚本依赖链。

模板提取入口 `npm run extract:templates` 用于校验和整理独立包，不应恢复对已删除参考目录的永久依赖。

#### 迁移清单

一次迁移按下列顺序走，每一步都能单独验证：

1. **取证**：`node scripts/capture-official-dom.mjs --url <分享链接>`（或 `--saved <已保存页面目录>`）。只允许独立匿名浏览器，不使用登录态；产物只落 `data/private/official-dom/`。先读 `report.md`：哪些冻结组件类已不再被定义、各样式族选择器重合度与 token 变化、DIL／展开控件等探针结果。
2. **定范围**：重合度高、只有个别类消失时按定点迁移，不发起整体再冻结。
3. **脱敏**：去掉正文、个人名称、id、行内样式、资源地址与失效状态。DIL 组件外壳由 `scripts/freeze-dil-templates.mjs` 自动完成这一步，并复制定义类的样式表。
4. **冻结**：模板写进 `official-templates/`（`templates.json`／`shell.html`／`dil.json` 与 `assets/`）并同步 manifest；禁止构建读取私人捕获目录。
5. **验证**：先跑轻量回归（`test-official-template-package.mjs`、`test-render-dil.mjs`、`test-reader-rendering.mjs`），再用 `npm run library -- --only <id>` 只重建受影响的会话页做对照，最后跑生产预览回归。

`capture-*` 系列脚本用于手工迁移：它们读取**已保存的官方页面及其同目录资源**，不会自行联网，也不接受 URL；需要新输入时先按第 1 步取证或自行保存页面。

### 隔离夹具与端口

浏览器测试必须使用隔离夹具（临时目录 + 临时或内存存储），不得读写使用者的归档。需要随机端口时用 `scripts/test-server-port.mjs` 的 `freePort()` 或 `isolatedServerOptions()`：Vite 把 `port: 0` 视为 falsy 并回退到默认 5173，直接写 `port: 0` 并没有隔离效果。

### 官方 DOM 快照与差异

`scripts/capture-official-dom.mjs` 是显式调用的维护工具，用来确认官方页面相对冻结模板包发生了什么变化。它不参与 `npm run library`、`npm run build` 或 `npm test`，也不被任何构建步骤读取。

```powershell
node scripts/capture-official-dom.mjs --url <分享链接> [--label <名称>]
node scripts/capture-official-dom.mjs --saved <已保存页面目录> [--label <名称>]
node scripts/capture-official-dom.mjs --compare-only <快照目录>
```

- **只使用独立匿名浏览器上下文**：不读取个人浏览器配置、cookie 或登录态。登录态才能看到的界面（例如记忆芯片）不作为捕获来源，取不到就维持降级。
- 产物（静态响应、渲染后 DOM、样式表、截图、`report.json` 与 `report.md`）只写入 `data/private/official-dom/`；脚本会拒绝写入 `archive/` 或 `data/private/` 之外的路径。这些文件含聊天内容，不提交、不外传。
- 报告只统计结构与样式：冻结模板组件类中有哪些已不再被当前样式定义（区分“本页加载的界面”和“本页未加载的界面”）、各样式族的选择器重合度与设计 token 变化、以及 DIL、展开控件等组件标记探针。
- `--compare-only` 对既有快照离线重算报告，便于同一份快照对照不同冻结包版本；无参数执行会直接失败，避免误触发联网采集。

### DIL 组件外壳冻结

`scripts/freeze-dil-templates.mjs` 把快照里官方 DIL 输出的组件外壳冻结进模板包（迁移第 3 步）：

```powershell
node scripts/freeze-dil-templates.mjs --snapshot data/private/official-dom/<label> [--label <名称>]
node scripts/freeze-dil-templates.mjs --report data/private/official-dom/<label>
```

- 每个组件保留**多种形态**（`title` 会按尺寸渲染成 `h1`／`h2`，`table-cell` 是 `th` 或 `td`），只收标签、类和枚举属性；正文、`id`、行内样式、`href`／`src` 与 aria 文本一律丢弃，渲染时由解析出的组件树补齐。
- 同时把定义这些类的样式表复制进 `official-templates/assets/`，并在 `official-templates/dil.json` 里记录来源与未找到归属的类；`--report` 只打印不写入。

DOM 经多次序列化时使用 `scripts/serialize-html.mjs` 的处理，避免空 SVG `title`／`desc` 自闭合形式导致后续 HTML 解析吞掉图表。字体本地化应在页面构建末尾执行。

写入链接属性时使用 `setAttribute('href', …)`，不要用 linkedom 的 `element.href = …`：该 setter 会对值执行 `decodeURI`，来源 URL 中合法的 `%01` 之类转义会被还原成控制字符，Vite 在开发与构建时都会以 parse5 解析错误拒绝整页。`build-official-replay.mjs` 在写出页面前调用 `assertHtmlSerializable` 作为最后一道防线，出现此类字符时构建失败而不是生成无法打开的页面；`test-sources-panel.mjs` 覆盖这一回归。

书签存储测试覆盖稳定 ID、合并回复、版本与书签 ID 的并发校验、损坏数据保护，以及删除构建失败／切换中途失败后的回滚。浏览器测试拦截全部书签写入，默认验证开发服务；设置 `CEOBE_TEST_DIST=1` 可验证生产构建。不要用真实备注做测试数据。

### 视觉与交互回归

书签布局将 resize 与 ResizeObserver 通知合并到同一个动画帧，先读取几何再批量写入变化；只测量视口附近消息，避免读取离屏子节点时强制渲染 `content-visibility:auto` 内容。稳定消息别名映射按页面生命周期缓存，书签记录与消息 DOM 不做裁剪；精确跳转仍启用完整高度布局。无附件聊天也应使用公共阅读器的离屏渲染规则。

连续缩放回归优先限制布局及样式重算次数，避免用受机器负载影响的固定毫秒阈值；墙钟耗时作为对照记录。

既有桌面基线主要为 1092×935 或 1028×908 CSS 像素，DPR 1.5。尺寸和锚点基线应以对应冻结模板、布局元数据与专项测试为准，而不是不断复制到 README。

除外观外，还应覆盖键盘导航、Tab／Escape、取消后的焦点恢复、菜单翻转与短视口滚动。不要通过强制点击绕过真实用户无法命中的按钮来宣称修复成功。

## 发布前检查

收尾时按顺序跑一遍，全部通过再打标签或分发：

```powershell
npm test                # 单元 + 浏览器测试（含导入页、交互冒烟、打印样式、表格渲染）
npm run check           # 档案完整性 → PDF 审计 → 全站 33 页巡检（需本地服务）
npm run build           # 生产构建到 dist/
npm run preview         # 另起端口（默认 4173）检查生产产物
```

- `check` 里的巡检查询本地服务，先 `npm run dev`（会自动选端口）；
- 构建产物引用带哈希的资源，别拿不带哈希的旧路径判断"资源缺失"；
- `archive/` 只增不改，任何检查都不应写入它；`verify:archive` 只读。

## 提交与文档

提交前核对：

```powershell
git diff --check
git status --short
git diff --cached --stat
```

不要批量加入真实聊天、私人参考网页、截图中的敏感信息、认证信息或派生构建结果。检查新文件，不要只依赖 `.gitignore`。

文档分工：

- README 介绍项目、提供一条主要启动路径，并说明关键边界。
- 使用指南解释用户操作；架构和开发指南解释实现与维护。
- TODO 只记录未完成或待确认事项；完成记录保留在 Git 历史与相应技术说明中。
- 首页截图使用实际界面，并在发布前检查聊天标题、链接和正文中的隐私。
- 巡检会统计页面上**未渲染的 DIL 标记**（`dil-markup`）：跳过脚本、样式与代码块，只认带属性的标记；
  出现即说明某条 Markdown 回退路径漏了剥离，先查 `build-official-replay.mjs` 与目录预览的剥离逻辑。
