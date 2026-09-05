# Chat Export & Offline Browsing Experience

**CEOBE**

将 ChatGPT 网页端聊天记录保存到本地，并以熟悉的界面重新阅读。

Save your ChatGPT web conversations locally and revisit them in a familiar interface.

当前版本以保存的 ChatGPT 官方 HTML、CSS 和消息 DOM 为视觉基准，并使用独立的 CEOBE JSON 保存 conversation 数据。界面按钮暂为静态外观。

已支持测试对话中四个文件的右侧预览：点击附件卡片或文件引用打开，关闭按钮或 Escape 关闭。TXT/DOCX 复用官方正文，PDF 使用原文件渲染的页面图片（暂不支持选择文字），XLSX 在官方面板内使用本地只读网格并支持工作表切换。其他按钮仍不执行操作，未接入通用附件导入。

预览构建需要 Python 的 `pypdfium2` 与 `openpyxl`。脚本优先使用 `CEOBE_PYTHON`，其次系统 Python，最后尝试 Codex 本地运行时。其他环境可安装这两个依赖后设置 `CEOBE_PYTHON`。原始 PDF/XLSX 不会被修改。

## 当前数据流

```text
ChatGPT Share HTML
        ↓
Share Importer
        ↓
CEOBE canonical JSON
        ↓
Official HTML based replay
```

Importer 会保留消息树、角色、原始消息、引用元数据、附件指针、网页来源和结构化图表数据。Markdown 是可读交换格式，不是完整档案的唯一数据源。

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

演示入口才会启用 `--sample-assets`，按消息 ID 复用保存的正文/媒体快照及四个测试附件；普通输入不复用样本正文。官方保存的 HTML/CSS 当前仍作为视觉模板来源，尚未抽取为独立模板包。

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
附加延迟数据块目前原样保留，尚未合并到标准会话字段；报告会明确标记。
报告检查节点关系、重复消息 ID、缺失阅读顺序等结构问题，并列出尚未下载的附件。
归档会开启独立的匿名浏览器，从分享页的公开附件接口解析资源地址，再下载图片和附件。
不读取个人浏览器配置、不要求登录、不保存会话认证头；Windows 默认使用已安装的 Edge，
其他平台需要 `npx playwright install chromium`。可通过 `CEOBE_BROWSER_CHANNEL` 选择其他已安装浏览器。
浏览器不可用或附件不对分享页开放时，仍保留 JSON 和 Markdown，并在报告中记录缺失原因。

下载仅允许已知的 OpenAI 资源域名，逐跳检查重定向，每个资源上限 100 MiB；
使用内容 SHA-256 命名并校验本地文件。`resources` 中保存消息关联、原始指针、下载状态和相对路径。
阅读器仅从本地档案复制校验通过的资源，显示图片并提供文件下载；不会自动补用测试附件。
文件已下载不等于已支持该类型的完整预览，现有样本专用预览不自动套用到任意文件。

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
