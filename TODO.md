# CEOBE TODO

## 官方 HTML 视觉还原

- [x] 补齐 ChatGPT 页面引用的官方 SVG sprite 资源，并将 `/cdn/assets/...` 改写为本地路径。
- [x] 以保存的官方 HTML、DOM 层级和 CSS 为视觉实现主体，不再手写近似版 ChatGPT 界面。
- [x] 合并顶部、中部、底部三份 HTML 中捕获到的官方 message DOM 模板。
- [x] 让 HTML renderer 直接读取 CEOBE JSON 的 typed messages；仅在普通正文块内部使用 Markdown 排版。
- [x] 保留官方侧栏、顶部区域、Composer、消息操作区等组件的静态外观；第一阶段不实现按钮功能。
- [x] 为 Markdown 补齐 LaTeX、软换行、代码高亮、表格和结构化图表的静态渲染。
- [x] 以 ChatGPT Share HTML 中的引用元数据恢复网页引用与文件引用的精确挂载位置；Markdown 仅作为有损后备来源。
- [x] 建立 Share HTML → CEOBE JSON importer，保留完整消息节点、元数据、引用、附件指针和结构化 `genui` 图表。
- [x] 将重建消息中的文件/网页引用标签替换为官方 HTML 克隆的 DOM，移除近似标签 CSS；保留元数据供详情使用。
- [x] 接入官方右侧文件预览面板：附件卡片/文件引用打开，关闭按钮/Escape 关闭；网页引用仍直接链接来源网页。
- [x] TXT、DOCX 使用保存的官方正文 DOM；PDF 从原文件生成全部 7 页；XLSX 读取两张工作表并支持切换。
- [x] 粘贴文本使用保存的官方弹窗正文，从附件卡片及引用打开；支持内部滚动、关闭和 Escape，不套用右侧文件面板。
- [x] 根据“粘贴的文本2”区分入口：附件卡片打开弹窗，正文引用打开官方右侧代码预览。
- [x] 以用户提供的 374 行剪贴板恢复文本补齐粘贴文本预览；原文原样保存，预览层恢复可确认的 Gradle 引用块，并明确记录它不是 31,633 字节原附件的逐字节副本。
- [ ] 用户视觉验收文件预览。XLSX 正文是本地只读网格，不是官方 Canvas 引擎；暂不支持单元格编辑、选择和公式计算。
- [x] 将四个测试文件的显式映射推广为通用附件解析与预览；按资源 ID、library ID、指针及 MIME/扩展名自动关联，未提供原文件的引用保留元数据但不伪造预览。

## 长对话归档

- [x] 阅读器接收 `--input`，移除固定消息数量/turn 编号，默认按 JSON 重建正文；样本资源仅通过显式演示入口使用。
- [x] 将 Markdown 与 HTML 拆为两个平级输出端；HTML 路径不再消费 Markdown 导出投影。
- [x] 从 typed HTML view 逐项恢复分支来源、停止思考、图片生成、结构化图表、表格和上传附件的官方 DOM。
- [x] 从保存页面中抽取独立官方视觉模板包；普通 renderer 不再依赖“测试消息/图表/新界面”源目录。
- [x] 将六种样本文件预览 DOM 与专用 CSS 迁入模板包，去除 `--sample-assets` 对“文件”源目录的依赖。
- [x] 将已下载的 PDF、DOCX、XLSX 和 TXT 归档资源按 JSON 元数据自动接入官方预览 DOM。

- [x] 处理 ChatGPT 长对话的虚拟化渲染：分别审计结构化载荷与可见 DOM，HTML renderer 永远从规范化 JSON 重建全部可见 turns。
- [ ] 研究保存前自动滚动整个 conversation、分段捕获 DOM 或从其他数据源补齐全部 turns 的方案。
- [x] 无论 HTML 中存在多少已渲染消息，都不得将其误判为完整 conversation；JSON 独立记录 structured payload 与 rendered DOM 的完整性状态。

## 测试样本

- [x] 建立包含文本、Markdown、代码、表格、图片、附件、引用、公式、超长 User 消息及工具结果的官方 ChatGPT 测试 conversation。
- [ ] 同时保存该测试 conversation 的 Markdown、完整网页 HTML 和配套资源文件夹。
- [ ] 记录保存时使用的 ChatGPT 主题、浏览器缩放比例、窗口尺寸和页面滚动位置，以便进行视觉对照。
