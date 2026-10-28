# CEOBE 采集扩展

作用：把一条**公开分享链接**抓成本地可导入的采集包，要么直接发给本地 CEOBE，要么导出 ZIP 离线导入。
只做匿名抓取，不读 cookie、不解析正文、不写 `archive/`。

## 安装

1. `edge://extensions/`（或 `chrome://extensions/`）→ 打开「开发人员模式」→「加载解压缩的扩展」→ 选本目录；
2. 更新过文件后点扩展卡片上的「重新加载」；
3. 需要本地 `npm run dev` 或 `npm run preview` 在运行（默认 `http://127.0.0.1:5173`）。

## 三种用法

| 入口 | 操作 | 需要本地服务 |
|---|---|---|
| 工具栏 popup | 粘贴链接 →「发送到本地 CEOBE」 | 是 |
| 分享页内按钮 | 打开 `chatgpt.com/share/…` → 右下角「发送到 CEOBE」 | 是 |
| 工具栏 popup | 粘贴链接 →「导出 ZIP」→ 拖到本地导入页 | 否（导入时需要） |

- 「检测」会从 5173 起逐个探测 `http://127.0.0.1:<端口>/api/capabilities`，找到服务后记住地址；
- 端口被系统保留或占用时，`npm run dev` 会打印实际端口，也可以直接在 popup 里填；
- 直接发送成功后 popup / 页内提示里会给「打开会话」链接；
- ZIP 在 popup 内直接抓取并生成（不经过扩展消息通道，避免二进制被 JSON 序列化）；
- 如果提示「采集包已归档，但页面更新失败」，说明快照已经保存、只是页面没更新：运行 `npm run library`
  或再点一次发送（不会重复导入）。

## 采集包契约（`format` / `version`）

ZIP 是 STORE（不压缩）格式，内含：

```
raw/share.html   匿名抓取的原始页面（不带 cookie）
capture.json     来源 URL、抓取时间、HTTP 状态、字节数、sha256、format、version
```

`capture.json` 带 `format: "ceobe.capture"`、`version: 1`。本地导入：

- 认这个格式与版本 → 正常导入；
- 没有 `format`/`version`（0.4.x 旧包）→ 按 legacy 接受；
- 格式不对或版本更高 → 明确报错（提示更新 CEOBE 或扩展），不会带着半个包解码；
- 导入成功后本地会**全量重建索引与页面**再返回结果；如果导入已完成但页面更新失败，会返回
  `archived: true` 并提示“重试只更新页面”。

本地导入会解包、过归档守卫、用 Python importer 解码成 `conversation.ceobe.json`，
并生成 `conversation.md` 与 `import-report.json`——与 `npm run archive:share` 同一套逻辑。

## 权限与隐私

- `host_permissions` 只有 `https://chatgpt.com/*`、`http://127.0.0.1/*`、`http://localhost/*`；
- 抓取用 `credentials: 'omit'`，不带 cookie、不跟随重定向（`redirect: 'error'`）；
- 服务端只接受扩展 scheme 的跨源请求（`chrome-extension://` / `moz-extension://`），普通网站
  仍然受同源与 `sec-fetch-site` 检查保护；
- 附件的发现与下载由本地管线按既有规则完成，扩展不下载附件。

## 书签小工具兜底

没有装扩展时，用 [bookmarklet.md](bookmarklet.md) 里的书签：点一下打开本地导入页并预填链接。
这条路线不跨站 POST，因此不放宽本地服务的 CSRF 防护。

## 边界

- 不做"登录态会话采集"：页面只在真实用户滚动时才请求更早的分页，程序化滚动无效；
- 多站点（Claude 等）暂不做，口径见 `TODO.md`；
- 扩展不解析载荷、不生成 `conversation.ceobe.json`，也不直接写 `archive/`。
