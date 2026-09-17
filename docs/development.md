# 开发指南

[返回 README](../README.md) · [使用指南](usage.md) · [架构说明](architecture.md)

## 本地开发

运行环境和首次安装步骤见[使用指南](usage.md)。使用真实档案开发时，先完成备份。

```powershell
npm run library
npm run dev -- --host 127.0.0.1 --port 5173
```

`library` 生成页面，`dev` 服务现有页面；只重启开发服务不会自动重新生成 HTML。修改构建脚本或模板后需要重新生成，修改运行时 JS／CSS 也可能需要经过对应构建器的复制与指纹步骤。

不要与导入、删除等写入任务并发手动构建。服务使用 `scripts/workspace-mutation.mjs` 协调写入；维护脚本若修改派生工作区，也应遵守同一约定。

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
node scripts/test-copy-content.mjs
```

### 按功能选择测试

| 范围 | 主要入口（位于 `scripts/`） |
|---|---|
| 书签与个人备注 | `test-bookmarks-store.mjs`、`test-bookmarks-browser.mjs`；聊天删除整体验证另见 `test-chat-actions-store.mjs` |
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
| 侧栏、搜索与整理 | `test-sidebar-controls.mjs`（标题与正文搜索、片段高亮、页内精确跳转与跨页哈希跳转；正文索引和 `/api/chats` 均为只读夹具）、`test-search-index.mjs`（索引只含可见提问／回复／代码，排除推理、隐藏上下文、引用与附件名）、`test-sidebar-polish.mjs`、`test-chat-organizer.mjs` |
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
- 真实分享链接导入仅通过显式配置启用，例如 `CEOBE_TEST_SHARE_URL`；不要默认联网归档。
- 异常锁和恢复目录不是缓存，不应未经核查清除。

原生保存接口桩用于验证建议文件名、内容、取消与失败路径；浏览器下载回退另行验证。它们不能替代实际 Windows 保存窗口的目录、权限和覆盖操作验收；该项人工验收已完成，见 `TODO.md`。

## 界面与模板维护

界面以获授权的官方 DOM 与样式为基线，不凭截图重新设计一套近似控件。

1. 将官方页面作为一次明确的迁移输入，默认仅查看、导航与捕获，不提交远端写入。
2. 去除个人名称、实际内容、认证信息、临时资源地址与无效状态。
3. 把所需模板、样式和图标冻结到独立包中；禁止构建读取私人捕获目录。
4. 确认图标、字体、预览片段等资源均可本地解析，再对照行为与计算样式。
5. 同时验证开发和生产构建，尤其注意嵌套页面路径、按需资源及脚本依赖链。

模板提取入口 `npm run extract:templates` 用于校验和整理独立包，不应恢复对已删除参考目录的永久依赖。

DOM 经多次序列化时使用 `scripts/serialize-html.mjs` 的处理，避免空 SVG `title`／`desc` 自闭合形式导致后续 HTML 解析吞掉图表。字体本地化应在页面构建末尾执行。

写入链接属性时使用 `setAttribute('href', …)`，不要用 linkedom 的 `element.href = …`：该 setter 会对值执行 `decodeURI`，来源 URL 中合法的 `%01` 之类转义会被还原成控制字符，Vite 在开发与构建时都会以 parse5 解析错误拒绝整页。`build-official-replay.mjs` 在写出页面前调用 `assertHtmlSerializable` 作为最后一道防线，出现此类字符时构建失败而不是生成无法打开的页面；`test-sources-panel.mjs` 覆盖这一回归。

书签存储测试覆盖稳定 ID、合并回复、版本与书签 ID 的并发校验、损坏数据保护，以及删除构建失败／切换中途失败后的回滚。浏览器测试拦截全部书签写入，默认验证开发服务；设置 `CEOBE_TEST_DIST=1` 可验证生产构建。不要用真实备注做测试数据。

### 视觉与交互回归

书签布局将 resize 与 ResizeObserver 通知合并到同一个动画帧，先读取几何再批量写入变化；只测量视口附近消息，避免读取离屏子节点时强制渲染 `content-visibility:auto` 内容。稳定消息别名映射按页面生命周期缓存，书签记录与消息 DOM 不做裁剪；精确跳转仍启用完整高度布局。无附件聊天也应使用公共阅读器的离屏渲染规则。

连续缩放回归优先限制布局及样式重算次数，避免用受机器负载影响的固定毫秒阈值；墙钟耗时作为对照记录。

既有桌面基线主要为 1092×935 或 1028×908 CSS 像素，DPR 1.5。尺寸和锚点基线应以对应冻结模板、布局元数据与专项测试为准，而不是不断复制到 README。

除外观外，还应覆盖键盘导航、Tab／Escape、取消后的焦点恢复、菜单翻转与短视口滚动。不要通过强制点击绕过真实用户无法命中的按钮来宣称修复成功。

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
