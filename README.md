# Chat Echoes: Offline Browsing Experience

**CEOBE**

将 ChatGPT 网页端聊天记录保存到本地，并以熟悉的界面重新阅读。

Save your ChatGPT web conversations locally and revisit them in a familiar interface.

Chat Echoes: Offline Browsing Experience（CEOBE）以保存的 ChatGPT 官方 HTML、CSS 和消息 DOM 为视觉基准，并使用独立、稳定的 CEOBE JSON 保存 conversation 数据。CEOBE 仍是正式名称的自然缩写，也是内部 Schema 与文件格式的稳定标识。

当前已支持分享链接归档、原始响应保留、CEOBE JSON、Markdown 副本、公开附件下载、本地多会话档案库、消息与代码复制、来源面板及对话跳转目录。没有本地语义的官方按钮继续保持静态外观。

文件预览已覆盖 TXT、Markdown、日志、CSV、JSON、DOCX、PDF 和 XLSX：点击附件卡片或文件引用打开，关闭按钮或 Escape 关闭。普通档案构建会直接读取 JSON 中已下载的附件资源，并通过文件 ID、library ID、原始指针和消息关系自动关联卡片与引用。TXT/DOCX 生成本地只读正文，PDF 渲染为页面图片（暂不支持选择文字），XLSX 在官方面板内使用本地只读网格并支持工作表切换。六种官方预览 DOM 与专用 CSS 已进入独立模板包，PDF/XLSX 验收原件位于对应 fixture 的 `preview-inputs/`；构建不再读取根目录 `文件/`。未下载或尚未支持的文件类型仍保留原始档案元数据与下载入口。

综合测试对话中的粘贴文本预览使用 `preview-inputs/粘贴的文本.txt` 补齐正文。该文件是从官方界面复制得到的 374 行恢复文本，不是原始 31,633 字节附件的逐字节副本；原文件保持不变，预览构建只在派生 HTML 中恢复可由官方 DOM 确认的 Gradle 引用块。差异与来源记录在同目录的 `粘贴的文本.provenance.json`。

预览构建使用 Python；TXT 和 DOCX 只依赖标准库，PDF 需要 `pypdfium2`，XLSX 需要 `openpyxl`。脚本优先使用 `CEOBE_PYTHON`，其次系统 Python，最后尝试 Codex 本地运行时。原始附件不会被修改。

## 参考输入与构建依赖

原始 `参考文件/` 目录已在确认无常规构建/运行依赖后删除（460 个文件，约 44.7 MiB）。已在该目录不存在的条件下重新构建，并验证模板、项目简介、ZIP、生产菜单/图片及离线字体和附件预览。

- `official-templates/` 保留脱敏后的官方 DOM、样式、图标和布局基线；`fixtures/` 保留可复现测试输入。二者仍须保留。
- `archive/` 与 `data/private/` 是本地归档、项目元数据及恢复记录，本次没有清理这些数据。
- `npm run library`、`npm run build`、开发/生产服务和常规测试不需要 `参考文件/`。部分历史 `capture-*` 手工采集工具仍使用原始参考路径；若要重新采集模板，需要另行提供获授权的原始网页输入，它们不是正常运行的前置步骤。
- 私人捕获、实际聊天及派生构建输出不纳入 Git 提交。

## 侧栏清理与最近聊天

“下载应用”及账号/Plus 遗留展示已清理；底部只显示静态 CEOBE / 本地归档及 CE 占位头像，不伪装为可用的账号菜单。

收起栏“最近聊天”使用脱敏冻结的官方菜单与行结构，按聊天更新时间显示最多 10 项，支持跳转、置顶和现有更多操作。菜单宽 260px，锚点 right/start 偏移 −4px / −10px，最大高度 50dvh；保留鼠标移出不关闭、Tab 保持、Escape 和外部关闭。服务不可用时标明离线索引。

置顶分组通过 `ceobe.pinned-expanded.v1` 保存折叠偏好，箭头与内容同步，刷新、跳转、聊天重绘均保留；偏好只影响浏览器，不更改聊天数据。验收：`node scripts/test-sidebar-polish.mjs`，写入场景均在内存中拦截，不修改真实数据。

## 聊天转存为 MD

聊天更多菜单提供“转存为 MD”。复用现有 JSON → Markdown 转换，生成单个 UTF-8 的 `当前聊天标题.md`；保留正文、代码、公式、表格和引用排版。图片、附件及普通链接改为可读标签/文字，不复制附件、不生成资源包；代码示例中的链接语法保持原样。

Edge/Chromium 的 localhost 安全上下文优先调用 `showSaveFilePicker()`，可在系统“另存为”中选择名称和位置；不支持时回退为浏览器下载。取消不读取归档、不写文件；写入失败中止文件流并提示。默认文件名处理 Windows 非法字符与保留设备名。

开发与生产预览通过只读 `GET /api/chats/export-md?id=…` 即时读取当前 JSON 和重命名元数据，不修改原始 JSON、历史 Markdown 或附件。纯静态部署没有该接口，会明确提示失败。原有归档副本的默认生成逻辑不变。

验收：`node scripts/test-markdown-export.mjs`、`node scripts/test-markdown-save-browser.mjs`；浏览器测试支持 `CEOBE_TEST_DIST=1`，通过模拟原生文件接口检验写入、取消及失败，并验证真实浏览器下载回退，不操作用户文件。

## 侧栏开关与聊天标题搜索

- 桌面侧栏支持 260px 展开 / 52px 图标栏收起，保留官方已有 DOM 和 Logo；偏好保存在浏览器，刷新、页面跳转及首屏渲染保持一致。
- 搜索覆盖全部本地聊天标题（含置顶和项目内聊天），不搜索正文。使用实时官方搜索弹窗/紧凑聊天行的脱敏模板与冻结 CSS；不展示图片、文档等未实现的筛选。
- 支持最近聊天、中文/大小写/全角匹配、清除、无结果、方向键/Enter 跳转、Tab 焦点约束、Escape/外部点击关闭；每次打开刷新本地索引，服务不可用时明确标注离线索引。
- 已在官方 Windows Edge 实测：`Ctrl+Shift+S` 开关侧栏，`Ctrl+K` 搜索，`Ctrl+Shift+O` 新聊天（本地映射到导入会话，不提交内容）。
- 左上角文字为 CEOBE，链接指向 https://github.com/MiraCeo/Chat-Echoes-Offline-Browsing-Experience；收起侧栏时的 ChatGPT Logo 图形保持不变。
- 回归：`node scripts/test-sidebar-controls.mjs`；生产模式先构建并设 `CEOBE_TEST_DIST=1`。测试仅 GET，搜索测试标题在内存中模拟，不改真实归档。

原侧栏项目行右侧“新项目”按钮复用现有创建弹窗，不触发父级链接导航，也不自动移入当前聊天。项目详情标题支持直接点击重命名。两处入口均支持 Enter/空格与取消后焦点恢复；只读服务仅提示，不提交写入。专项测试：`node scripts/test-project-entry-browser.mjs`，支持 `CEOBE_TEST_DIST=1` 生产模式；创建写入使用内存模拟。

## 阅读顶部、图片与项目 ZIP

阅读顶部“另存为 MD”与聊天菜单共用纯文本导出程序。阅读更多菜单保留官方文件入口、置顶/取消置顶、删除和移至项目（含新建项目）。复用来源面板、聊天与项目接口，文件入口打开面板并聚焦搜索，置顶直接持久化，删除须确认，移动失败可重试，新建后自动移入当前聊天；原有归档项继续移除。专项隔离接口测试：`node scripts/test-reader-actions-browser.mjs`，支持生产模式。阅读输入区不改动；消息操作与书签合并列入 `TODO.md`。

正文图片使用官方黑色遮罩查看器，按原图比例限制在 90vw × 85vh 内，支持关闭按钮、Escape、点击遮罩及焦点恢复；点击图片本身不关闭。不添加官方未出现的缩放、下载或切图工具栏，仅打开本地图片。

项目分享替换为“另存为 ZIP”，使用 `GET /api/projects/export-zip?id=…` 读取项目全部聊天。生成 `项目名称.zip`，内部为当前 `聊天标题.md`，重复文件名自动编号（大小写和 Unicode 兼容规范化冲突也会处理），只含纯文本 Markdown、不含附件。优先原生保存对话框，取消不发导出请求，不支持原生接口时回退浏览器下载。空项目生成合法空 ZIP；成员缺失则拒绝生成残缺包。当前标准 ZIP 限制为 65,535 个文件、200 MiB 未压缩文本，不修改原始归档。

验收入口：`node scripts/test-project-export.mjs`（隔离目录、Python zipfile 独立校验 ZIP/CRC/UTF-8）与 `node scripts/test-reader-ui-browser.mjs`（开发与 `CEOBE_TEST_DIST=1` 生产模式；原生保存接口桩、取消/回退、菜单/设置打开、图片比例/键盘/遮罩）。实际 Windows 保存窗口仍由用户最终验收。

## 项目更多菜单与本地管理

项目菜单定位已按用户提供的 `项目菜单定位.json` 冻结：相对按钮左侧 −14px、相对按钮底部 −4px，参考菜单 158×253。构建和运行仅读冻结数据；焦点移到页面其他控件时关闭，聊天子菜单内部切换不关闭主菜单。原始参考目录已清理，定位基线保存在冻结模板中。

侧栏与项目顶部使用各自脱敏冻结的官方菜单：侧栏保留完整六项，顶部为“项目设置、置顶项目”。重命名、置顶/取消置顶、主页跳转与删除仍使用已有本地逻辑；删除只移除项目及关联，所有聊天、附件和历史归档保留。

项目侧栏六项菜单和顶部两项菜单全部保留。项目设置的“指令”改为本地“项目简介”，移除记忆和库访问权限。简介为最多 4000 个字符的纯文本，旧项目默认显示为空；点击“保存简介”后持久化，关闭或 Esc 放弃未保存修改。保存失败保留草稿，检测其他窗口的并发修改并拒绝直接覆盖。简介仅存项目元数据，不参与 AI，也不写入聊天 Markdown 或项目 ZIP。名称仍通过侧栏菜单或详情标题修改；图标/颜色选择器仍仅预览，删除仍保留全部聊天。

简介通过既有 `POST /api/projects/action` 的 `description` 操作保存（`description` 与 `previousDescription`），沿用工作区锁和原子文件替换。测试入口：`test-project-description.mjs`、`test-project-description-browser.mjs`；写入均在隔离存储中，浏览器测试支持生产模式。

验收：`node scripts/test-project-more.mjs`，以及构建后的 `CEOBE_TEST_DIST=1` 生产预览测试；菜单布局测试禁止 POST 并比较真实数据不变；新增 `test-project-actions-store.mjs` 在临时目录验证保存与保留归档，`test-project-actions-browser.mjs` 在内存中拦截全部修改，支持生产模式。

## 侧栏整理聊天

“最近”标题栏使用冻结的官方展开/收起 DOM，右侧撰写入口进入导入页。“整理聊天”菜单支持按列表或按项目：按项目时显示项目分组及未归属聊天；项目可展开实际关联会话，空项目使用官方“暂无项目聊天”占位。项目行右侧编辑图标进入 `project.html?id=…`；项目更多支持本地重命名、置顶和保留聊天的项目删除，分享改为 ZIP，设置支持本地简介保存，图标/颜色仍仅预览。置顶区独立保留，置顶会话也可从其所属项目访问。

模式、分组收起与项目展开状态保存在当前浏览器 `localStorage` 的 `ceobe.chat-organization.v1` 中，不更改归档或项目关联；浏览器禁止存储时当前页面仍可操作。支持键盘、Esc、点击外部关闭菜单。冻结资源 `chat-organizer.json` 由“最近／整理聊天／按项目／项目展开”参考显式捕获，普通构建不读取参考目录。测试：`node scripts/test-chat-organizer.mjs`，以及构建后的 `CEOBE_TEST_DIST=1` 生产预览验收。

## 侧栏聊天的项目归属

有项目归属的聊天标题后显示官方小号灰字项目名（冻结 `sidebar-project-label.json`），无归属不占位。首页、项目页及阅读页共享相同 DOM，构建首屏和浏览器动态更新一致；移至项目、新建并移入、项目内导入和窗口重新聚焦时同步，原始归档不变。验收：`node scripts/test-sidebar-project-label.mjs`，构建后可用 `CEOBE_TEST_DIST=1` 测试生产预览。

## 项目详情与项目内导入

从项目列表点击项目，或聚焦行后按 Enter/空格，打开 `project.html?id=<本地项目ID>`。页面复用冻结的 `official-templates/project-detail.json`，仅加载当前项目关联的本地会话；摘要来自最后一条可见用户消息，日期使用会话更新时间（缺失时回退到创建/归档时间）。会话行可打开阅读页，“更多”复用已有聊天操作，并同步侧栏及项目列表。

顶部官方 Composer 改为分享链接导入，复用现有校验、纯文本粘贴、忙碌与结果提示。导入前验证项目，归档成功后独占关联到当前项目；关联失败时当前页重试复用已归档结果，不重复导入。同一标签页的 sessionStorage 保存请求标识，服务在 `data/private/import-jobs/` 保存状态；刷新后重试可复用已完成归档，不再次抓取。成功完成后清除当前请求标识，后续主动导入可创建新版本。新导入会话摘要在刷新页面后读取重建快照。`npm run dev` 与本地 `npm run preview` 均支持导入。生产导入先保存归档并更新阅读器，再在临时目录构建和切换 `dist`；构建失败保留旧生产页面，重试只发布、不重复抓取。项目分享已替换为纯文本 MD 的 ZIP 导出，项目设置支持本地简介保存；项目来源标签及已有项目的图标/颜色编辑仍未接入。

验收：`node scripts/test-project-detail.mjs`，以及构建后的 `$env:CEOBE_TEST_DIST='1'; node scripts/test-project-detail.mjs`（PowerShell）。实际“测试”项目只执行 GET；改名、置顶、删除取消、项目导入及关联失败重试均拦截到内存测试数据。包含官方标题/Composer/标签/列表的尺寸与关键计算样式对照（1092×935，DPR 1.5）。参考捕获仅由显式 `capture-project-detail.mjs` 读取参考目录，普通构建不依赖该目录。

## 当前数据流

```text
ChatGPT Share HTML
        ↓
Share Importer
        ↓
CEOBE canonical JSON
       ↙  ↘
Markdown   Official HTML based replay
export     (typed DOM renderer)
```

CEOBE JSON 是唯一规范化数据源。Importer 会保留消息树、角色、原始消息、引用元数据、附件指针、网页来源和结构化图表数据。Markdown 与离线 HTML 是两个平级输出端：Markdown 是便于传递的有损副本；HTML renderer 直接读取 JSON 中带类型的消息和内容块，只有普通正文块进入 Markdown 排版，不以 Markdown 作为 conversation 的中间数据层。

## 本地运行模式与离线资源

- **开发服务**：`npm run dev`，支持导入、聊天/项目管理与 MD/项目 ZIP 转存。
- **本地生产服务**：`npm run library` → `npm run build` → `npm run preview`，默认仅监听 127.0.0.1；同样支持上述操作，导入后新页面无需重启即可打开。
- **纯静态部署**：只提供构建时的阅读快照及已打包附件；没有本地 API，导入禁用并明确提示。项目写入与 MD 即时转存也需要本地服务。
- 导入入口通过只读 `/api/capabilities` 判断能力。请求标识和服务端记录防止失败重试重复抓取；进程异常中断后的 `mutation.lock` 或 `capturing` 状态需要人工核查，不自动解除不明状态。
- 生产发布保留旧哈希资源以兼容已打开页面；不要在本地操作期间另行执行手动构建。归档与生产页面发布不是一笔可回滚的事务：发布失败不会删除已保存的归档。
- 冻结 CSS 的 KaTeX CDN 文件名映射到本地安装的 KaTeX 字体；已保存的 OpenAI Sans 也仅从本地读取。按需预览片段、图片与 sprite 均随静态构建发布，不依赖外网。
- 验收：`test-local-import-api.mjs`、`test-production-import.mjs`（隔离目录内真实构建/发布）、`test-offline-resources.mjs`（阻断外网，开发及生产验证字体和附件）。本地导入仍需联网读取用户提供的公开分享链接，离线仅指已归档内容的阅读。

## 本地运行

```powershell
npm install
npm run replay -- --input path/to/conversation.ceobe.json
npm run dev
```

`replay` 读取指定 JSON；`dev` 和 `build` 只使用刚生成的页面，不会重置到测试样本。`samples/independent-conversation.json` 是最小阅读字段示例（不是完整归档）。空对话也可生成。暂未关联的附件显示明确提示。

保留原综合测试对话及四个文件预览的演示入口：

```powershell
npm run replay:sample
npm run dev
```

演示入口才会启用 `--sample-assets`，按消息 ID 复用保存的正文/媒体快照及测试附件；普通输入不复用样本正文。正常 renderer 只读取冻结的 `official-templates/` 页面外壳、消息组件和 CSS；`npm run extract:templates` 也只校验并整理这个独立模板包，不再读取初次抽取时使用的原始保存页面。未来适配新版 ChatGPT UI 时，应把新页面作为一次明确的模板迁移输入，而不是重新引入永久运行时依赖。

构建当前生成页面：

```powershell
npm run build
```

运行 importer 与生成页面的回归测试：

```powershell
npm test
```

## 导入保存的 Share HTML

直接归档公开分享链接：

```powershell
npm run archive:share -- https://chatgpt.com/share/<share-id>
```

每次抓取创建独立的 `archive/chatgpt-share/<share-id>/<时间戳>/`，保存原始响应
`raw/share.html`、抓取记录 `capture.json`、`conversation.ceobe.json`、纯文本
`conversation.md`、`assets/` 和 `import-report.json`。失败响应及解析错误也保留供检查，不覆盖旧快照。该目录默认被 Git 忽略。
命令需要 Node.js 和 Python；可使用 `CEOBE_PYTHON` 指定 Python。

JSON 现保留全部 `streamController.enqueue` 数据块和主载荷的完整解码结果，
包括原始阅读顺序条目及外围页面字段。循环引用使用指向原始槽位的标记表示。
附加 React 协议记录原样保留，不会仅因其存在而把结构正常的 conversation 判为异常。
报告检查节点关系、重复消息 ID、缺失阅读顺序等结构问题，并列出尚未下载的附件。
`completeness` 会分别记录结构化载荷和保存页面可见 DOM 的覆盖情况。浏览器为长对话虚拟化 DOM 时，报告会标记 `partial_virtualized`；可见 DOM 从不作为消息完整性的依据，离线 HTML 始终从规范化 JSON 重建。
归档会开启独立的匿名浏览器，从分享页的公开附件接口解析资源地址，再下载图片和附件。
不读取个人浏览器配置、不要求登录、不保存会话认证头；Windows 默认使用已安装的 Edge，
其他平台需要 `npx playwright install chromium`。可通过 `CEOBE_BROWSER_CHANNEL` 选择其他已安装浏览器。
浏览器不可用或附件不对分享页开放时，仍保留 JSON 和 Markdown，并在报告中记录缺失原因。

下载仅允许已知的 OpenAI 资源域名，逐跳检查重定向，每个资源上限 100 MiB；
使用内容 SHA-256 命名并校验本地文件。`resources` 中保存消息关联、原始指针、下载状态和相对路径。
阅读器仅从本地档案复制校验通过的资源，显示图片并提供文件下载；不会自动补用测试附件。
文件已下载不等于已支持该类型的完整预览；受支持类型会按归档资源元数据自动生成预览，不再依赖测试文件名。

Markdown 输出当前阅读分支的 User/Assistant 正文、代码、公式、引用和图表数据表；
完整消息树及内部记录仍以 JSON 为准。引用网页仅保留链接，不递归抓取网站。
“结构检查通过”不等于完整离线归档：分享页未提供的内容无法恢复，外部应用运行脚本不作为附件下载。
资源状态以 `resource_counts` 和 `resources` 为准，`assets` 是导入阶段的原始资源发现记录。

阅读新档案可运行：

```powershell
npm run replay -- --input archive/chatgpt-share/<share-id>/<时间戳>/conversation.ceobe.json
npm run dev
```

## 本地档案库

每次 `archive:share` 成功后会自动更新档案索引并重建本地阅读器。索引位于
`archive/library.ceobe.json`，它只记录会话标题、来源、最新可用抓取、消息数量、
资源状态和页面入口，不复制会话正文。相同分享链接存在多次抓取时，库中默认使用
最新一份可正常读取的 `conversation.ceobe.json`；历史抓取不会被删除。

已有档案发生变化后，也可以手动重建：

```powershell
npm run library
npm run dev
```

左侧“最近”列表会显示所有已归档会话，点击后切换到各自的静态离线页面。
默认首页是最近归档的会话；也可以指定首页：

```powershell
npm run library -- --select <share-id>
```

生产构建会同时包含首页、全部 `conversations/*.html`、共享界面资源及所有已下载附件：

```powershell
npm run build
npm run preview
```

在开发或预览服务运行时，可用 `npm run verify:library` 验证侧栏切换；通过
`CEOBE_TEST_URL` 可以指定非默认地址。

也可以继续导入已有本地 HTML：

```powershell
python scripts/import-chatgpt-share.py <share.html> --output <conversation.ceobe.json>
```

仓库中的验收样本位于 `fixtures/chatgpt-share/6a9849f6-3bec-83ee-b032-618d95fc0917/`。原始 `share.html` 保留不变，生成的 `conversation.ceobe.json` 供 renderer 和测试使用。

## 本地项目

侧栏“项目”进入 `projects.html`。支持创建、名称搜索、30 个图标、预设颜色与自定义十六进制颜色。名称去除首尾空格，不区分大小写检查同名。列表不混入参考页面示例数据。

在 `npm run dev` 或 `npm run preview` 服务中，项目通过同源 `/api/projects` 保存到 `data/private/projects.ceobe.json`（已忽略 Git），刷新和服务重启不会丢失。请勿删除该文件；单个本地服务负责写入，不建议多个服务同时写同一数据文件。纯静态 HTTP 部署只读构建快照并禁用新建；`npm run library` 刷新快照，然后 `npm run build` 生成发布文件。

支持项目详情、聊天所属项目关联、项目重命名、置顶及删除（保留聊天）。暂不支持项目附件管理、云端共享或 AI 记忆。“与你共享”显示明确的未支持提示。

聊天旁的省略号沿用冻结的官方两层菜单。“移至项目”每次展开读取 `/api/projects`，与项目页同步真实项目名称、图标和颜色。选择项目通过 `/api/projects/move` 将聊天 ID 保存到项目的 `conversation_ids`，同一聊天仅关联一个项目，重复移动不会重复记录；原始聊天归档不改动。子菜单中的“新项目”直接打开与项目页共用的创建弹窗，创建后自动关联当前聊天；关联失败时明确提示，重试不会重复创建。聊天支持行内重命名（Enter/失焦保存，Esc 取消）、置顶/取消置顶（无需确认）和经确认后永久删除。“归档”菜单项已按要求移除；聊天“分享”已替换为“转存为 MD”，只保存单个无附件依赖的文本文件。

重命名和置顶保存在 `data/private/chats.ceobe.json`，不修改捕获的原始 HTML；构建与运行时读取这些本地显示元数据。永久删除会删除该聊天全部归档版本、阅读页面及项目关联，并重建 `replay/` 和 `dist/` 以清除旧的派生副本；其他聊天的独立附件副本保留。遇到符号链接/目录联接或跨归档附件路径时拒绝删除，不猜测共享资源归属。

删除先在私有目录准备剩余档案及新页面，构建成功后再切换文件；正常异常可回滚。导入、项目写入和聊天写入使用同一工作区锁。请勿在操作期间手动运行构建或关闭本地服务。若进程/系统中断，`data/private/mutation.lock` 与 `data/private/delete-jobs/*/journal.json` 用于排查恢复；存在未完成任务时后续写入会被拒绝，不能未经核查直接删除锁或恢复目录。

新增测试：`node scripts/test-chat-actions-store.mjs`（真实隔离重建、全部版本删除、共享副本保留、失败保护及最后一条聊天）；`node scripts/test-chat-actions-browser.mjs`（官方编辑/确认 DOM 交互、置顶、新建与自动关联），后者支持 `CEOBE_TEST_DIST=1`。所有写入/删除验收均使用临时档案。

菜单测试：`node scripts/test-chat-menu.mjs`；设置 `CEOBE_TEST_DIST=1` 测试生产预览。测试读取真实项目名称验证同步，所有移动写入均隔离到临时目录。

菜单模板 v2 保存完整 `data-radix-popper-content-wrapper`、原始类名/内联样式、子菜单内层包装和分隔线；相对位置取自用户提供的定位 JSON。`chat-menu.css` 不覆盖菜单/触发按钮的尺寸、间距、圆角、阴影、颜色或悬停样式。普通构建不依赖参考目录。

结构/样式验收：`node scripts/test-chat-menu-visual.mjs`，同样支持 `CEOBE_TEST_DIST=1`。独立加载冻结的官方 DOM/CSS（保留样式加载顺序和 UTF-8），逐项比较层级、类名、计算样式、分隔线、相对尺寸与锚点偏移。基线为 1092×935、DPR 1.5；只验证已提供的桌面 bottom/start 主菜单和 right/start 子菜单状态，不声称还原未提供的移动端或翻转状态。用户最终视觉验收仍待完成。

浏览器验收：`node scripts/test-projects-page.mjs`；构建后设置 `CEOBE_TEST_DIST=1` 可测试实际 Vite preview。测试使用临时存储，不写入真实项目数据。普通构建只依赖冻结模板，不读取参考文件夹。

## 本地附件资料库

`npm run library` 同时生成 `replay/assets.html`，可从侧栏“资料库”进入。页面沿用冻结的官方资料库列表模板，数据来自各会话最新可用归档的 `resources`，不读取 `参考文件/`。

支持按文件名或来源会话搜索、全部／图片／文件分类、名称／归档时间／大小排序，以及预览、下载和返回来源会话。相同内容按 SHA-256 去重并保留来源；下载前在构建阶段校验原文件。未保存资源仅保留记录，不伪造预览；不支持预览的本地文件仍可下载。时间列明确使用本地归档时间，而非推测原文件修改时间。

第一阶段仅提供列表浏览，不实现文件夹管理、上传、新建或删除。资料库页面、下载资源及预览片段纳入生产构建，可用静态 HTTP 服务离线阅读。

浏览器回归：开发服务启动后运行 `node scripts/test-asset-library-browser.mjs`。执行 `npm run build` 后设置 `CEOBE_TEST_DIST=1`，同一脚本会通过浏览器请求拦截直接加载 `dist/` 进行静态产物验证，无需另启预览服务。
