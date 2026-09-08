# Chat Echoes: Offline Browsing Experience

**CEOBE**

将 ChatGPT 网页端聊天记录保存到本地，并以熟悉的界面重新阅读。

Save your ChatGPT web conversations locally and revisit them in a familiar interface.

Chat Echoes: Offline Browsing Experience（CEOBE）以保存的 ChatGPT 官方 HTML、CSS 和消息 DOM 为视觉基准，并使用独立、稳定的 CEOBE JSON 保存 conversation 数据。CEOBE 仍是正式名称的自然缩写，也是内部 Schema 与文件格式的稳定标识。

当前已支持分享链接归档、原始响应保留、CEOBE JSON、Markdown 副本、公开附件下载、本地多会话档案库、消息与代码复制、来源面板及对话跳转目录。没有本地语义的官方按钮继续保持静态外观。

文件预览已覆盖 TXT、Markdown、日志、CSV、JSON、DOCX、PDF 和 XLSX：点击附件卡片或文件引用打开，关闭按钮或 Escape 关闭。普通档案构建会直接读取 JSON 中已下载的附件资源，并通过文件 ID、library ID、原始指针和消息关系自动关联卡片与引用。TXT/DOCX 生成本地只读正文，PDF 渲染为页面图片（暂不支持选择文字），XLSX 在官方面板内使用本地只读网格并支持工作表切换。六种官方预览 DOM 与专用 CSS 已进入独立模板包，PDF/XLSX 验收原件位于对应 fixture 的 `preview-inputs/`；构建不再读取根目录 `文件/`。未下载或尚未支持的文件类型仍保留原始档案元数据与下载入口。

综合测试对话中的粘贴文本预览使用 `preview-inputs/粘贴的文本.txt` 补齐正文。该文件是从官方界面复制得到的 374 行恢复文本，不是原始 31,633 字节附件的逐字节副本；原文件保持不变，预览构建只在派生 HTML 中恢复可由官方 DOM 确认的 Gradle 引用块。差异与来源记录在同目录的 `粘贴的文本.provenance.json`。

预览构建使用 Python；TXT 和 DOCX 只依赖标准库，PDF 需要 `pypdfium2`，XLSX 需要 `openpyxl`。脚本优先使用 `CEOBE_PYTHON`，其次系统 Python，最后尝试 Codex 本地运行时。原始附件不会被修改。

## 项目更多菜单（界面预览）

项目菜单定位已按用户提供的 `项目菜单定位.json` 冻结：相对按钮左侧 −14px、相对按钮底部 −4px，参考菜单 158×253。构建和运行仅读冻结数据；焦点移到页面其他控件时关闭，聊天子菜单内部切换不关闭主菜单。原始参考清理仅完成评估，未执行删除。

侧栏项目行及项目详情页的更多按钮复用 `project-more.json` 中冻结的官方主菜单，包含分享项目、重命名项目、项目设置、项目主页、置顶项目和删除项目。已确认的项目主页直接跳转；其余项只显示“尚未接入功能”，不提交写入、不启用项目删除，也不会误用聊天删除弹窗。支持悬停、键盘、Esc/外部关闭及焦点返回。点击后的子界面/弹窗尚缺对应官方捕获，未自行设计。

验收：`node scripts/test-project-more.mjs`，以及构建后的 `CEOBE_TEST_DIST=1` 生产预览测试；所有菜单测试禁止 POST 并比较真实项目数据前后不变。

## 侧栏整理聊天

“最近”标题栏使用冻结的官方展开/收起 DOM，右侧撰写入口进入导入页。“整理聊天”菜单支持按列表或按项目：按项目时显示项目分组及未归属聊天；项目可展开实际关联会话，空项目使用官方“暂无项目聊天”占位。项目行右侧编辑图标进入 `project.html?id=…`；项目更多目前仅提供官方菜单预览，未确定的操作不接入。置顶区独立保留，置顶会话也可从其所属项目访问。

模式、分组收起与项目展开状态保存在当前浏览器 `localStorage` 的 `ceobe.chat-organization.v1` 中，不更改归档或项目关联；浏览器禁止存储时当前页面仍可操作。支持键盘、Esc、点击外部关闭菜单。冻结资源 `chat-organizer.json` 由“最近／整理聊天／按项目／项目展开”参考显式捕获，普通构建不读取参考目录。测试：`node scripts/test-chat-organizer.mjs`，以及构建后的 `CEOBE_TEST_DIST=1` 生产预览验收。

## 侧栏聊天的项目归属

有项目归属的聊天标题后显示官方小号灰字项目名（冻结 `sidebar-project-label.json`），无归属不占位。首页、项目页及阅读页共享相同 DOM，构建首屏和浏览器动态更新一致；移至项目、新建并移入、项目内导入和窗口重新聚焦时同步，原始归档不变。验收：`node scripts/test-sidebar-project-label.mjs`，构建后可用 `CEOBE_TEST_DIST=1` 测试生产预览。

## 项目详情与项目内导入

从项目列表点击项目，或聚焦行后按 Enter/空格，打开 `project.html?id=<本地项目ID>`。页面复用冻结的 `official-templates/project-detail.json`，仅加载当前项目关联的本地会话；摘要来自最后一条可见用户消息，日期使用会话更新时间（缺失时回退到创建/归档时间）。会话行可打开阅读页，“更多”复用已有聊天操作，并同步侧栏及项目列表。

顶部官方 Composer 改为分享链接导入，复用现有校验、纯文本粘贴、忙碌与结果提示。导入前验证项目，归档成功后独占关联到当前项目；关联失败时当前页重试复用已归档结果，不重复导入。关闭/刷新页面会失去这个内存重试结果，可通过聊天菜单移入已归档会话。新导入会话摘要在刷新页面后读取重建快照。导入仍仅由 `npm run dev` 提供，生产预览可阅读/管理项目，但不提供分享抓取接口。项目分享、来源标签和项目设置保持静态，未擅自扩展。

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

支持项目元数据与聊天所属项目的本地关联；暂不支持项目详情浏览、附件关联、编辑、删除、云端共享或 AI 记忆。“与你共享”显示明确的未支持提示。

聊天旁的省略号沿用冻结的官方两层菜单。“移至项目”每次展开读取 `/api/projects`，与项目页同步真实项目名称、图标和颜色。选择项目通过 `/api/projects/move` 将聊天 ID 保存到项目的 `conversation_ids`，同一聊天仅关联一个项目，重复移动不会重复记录；原始聊天归档不改动。子菜单中的“新项目”直接打开与项目页共用的创建弹窗，创建后自动关联当前聊天；关联失败时明确提示，重试不会重复创建。聊天支持行内重命名（Enter/失焦保存，Esc 取消）、置顶/取消置顶（无需确认）和经确认后永久删除。“归档”菜单项已按要求移除，分享暂缓。

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
