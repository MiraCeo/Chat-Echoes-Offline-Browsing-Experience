# Chat Echoes: Offline Browsing Experience

**CEOBE**

将 ChatGPT 网页端聊天记录保存到本地，并以熟悉的界面重新阅读。

Save your ChatGPT web conversations locally and revisit them in a familiar interface.

Chat Echoes: Offline Browsing Experience（CEOBE）以保存的 ChatGPT 官方 HTML、CSS 和消息 DOM 为视觉基准，并使用独立、稳定的 CEOBE JSON 保存 conversation 数据。CEOBE 仍是正式名称的自然缩写，也是内部 Schema 与文件格式的稳定标识。

当前已支持分享链接归档、原始响应保留、CEOBE JSON、Markdown 副本、公开附件下载、本地多会话档案库、消息与代码复制、来源面板及对话跳转目录。没有本地语义的官方按钮继续保持静态外观。

文件预览已覆盖 TXT、Markdown、日志、CSV、JSON、DOCX、PDF 和 XLSX：点击附件卡片或文件引用打开，关闭按钮或 Escape 关闭。普通档案构建会直接读取 JSON 中已下载的附件资源，并通过文件 ID、library ID、原始指针和消息关系自动关联卡片与引用。TXT/DOCX 生成本地只读正文，PDF 渲染为页面图片（暂不支持选择文字），XLSX 在官方面板内使用本地只读网格并支持工作表切换。六种官方预览 DOM 与专用 CSS 已进入独立模板包，PDF/XLSX 验收原件位于对应 fixture 的 `preview-inputs/`；构建不再读取根目录 `文件/`。未下载或尚未支持的文件类型仍保留原始档案元数据与下载入口。

综合测试对话中的粘贴文本预览使用 `preview-inputs/粘贴的文本.txt` 补齐正文。该文件是从官方界面复制得到的 374 行恢复文本，不是原始 31,633 字节附件的逐字节副本；原文件保持不变，预览构建只在派生 HTML 中恢复可由官方 DOM 确认的 Gradle 引用块。差异与来源记录在同目录的 `粘贴的文本.provenance.json`。

预览构建使用 Python；TXT 和 DOCX 只依赖标准库，PDF 需要 `pypdfium2`，XLSX 需要 `openpyxl`。脚本优先使用 `CEOBE_PYTHON`，其次系统 Python，最后尝试 Codex 本地运行时。原始附件不会被修改。

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

## 本地附件资料库

`npm run library` 同时生成 `replay/assets.html`，可从侧栏“资料库”进入。页面沿用冻结的官方资料库列表模板，数据来自各会话最新可用归档的 `resources`，不读取 `参考文件/`。

支持按文件名或来源会话搜索、全部／图片／文件分类、名称／归档时间／大小排序，以及预览、下载和返回来源会话。相同内容按 SHA-256 去重并保留来源；下载前在构建阶段校验原文件。未保存资源仅保留记录，不伪造预览；不支持预览的本地文件仍可下载。时间列明确使用本地归档时间，而非推测原文件修改时间。

第一阶段仅提供列表浏览，不实现文件夹管理、上传、新建或删除。资料库页面、下载资源及预览片段纳入生产构建，可用静态 HTTP 服务离线阅读。

浏览器回归：开发服务启动后运行 `node scripts/test-asset-library-browser.mjs`。执行 `npm run build` 后设置 `CEOBE_TEST_DIST=1`，同一脚本会通过浏览器请求拦截直接加载 `dist/` 进行静态产物验证，无需另启预览服务。
