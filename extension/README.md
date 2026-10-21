# CEOBE 采集扩展

作用：把一条**公开分享链接**抓成本地可导入的 ZIP。不做别的事。

## 用法

1. `edge://extensions/` → 加载 `extension/` 目录（或重新加载）；
2. 点工具栏图标，输入 `https://chatgpt.com/share/…`；
3. 点「抓取并导出 ZIP」→ 得到 `ceobe-capture-<share-id>-<时间>.zip`；
4. 本地导入（或直接把 ZIP 拖到应用的导入页）：

```powershell
node scripts/import-share-package.mjs --input <下载的 zip>
npm run library -- --only <share-id>
```

## ZIP 内容

与 `archive/chatgpt-share/<id>/<时间戳>/` 对齐的**采集层**：

```
raw/share.html   匿名抓取的原始页面（不带 cookie）
capture.json     来源 URL、抓取时间、HTTP 状态、字节数、sha256
```

本地导入会解包、过归档守卫、用本地 Python importer 解码成 `conversation.ceobe.json`，
并生成 `conversation.md` 与 `import-report.json`——与 `npm run archive:share` 同一套逻辑。

## 边界

- 扩展只负责**抓取**：匿名请求、不读 cookie、不解析载荷、不写 `archive/`；
- 附件与引用资源由本地管线按既有规则解析；能否离线完整以 `import-report.json` 为准；
- 不做"登录态会话采集"：页面只在真实用户滚动时才请求更早的分页，程序化滚动无效，
  手动滚再导出的体验不如分享链接（结论与证据见 `TODO.md` 的「第二轨（已结束）」）。