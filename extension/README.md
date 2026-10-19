# CEOBE 采集扩展

当前形态：**分享链接 → ZIP**。不再尝试"无分享链接采集"（那条线已暂停，见文末）。

## 用法

1. `edge://extensions/` → 加载 `extension/` 目录（或重新加载）；
2. 点工具栏图标，输入 `https://chatgpt.com/share/…`；
3. 点「抓取并导出 ZIP」→ 得到 `ceobe-capture-<share-id>-<时间>.zip`；
4. 本地导入：

```powershell
node scripts/import-share-package.mjs --input <下载的 zip>
npm run library -- --only <share-id>
```

ZIP 结构与 `archive/chatgpt-share/<id>/<时间戳>/` 对齐：`raw/share.html` + `capture.json`；
本地导入会解包、过归档守卫、解码成 `conversation.ceobe.json`，再生成 `conversation.md`、`import-report.json`。

## 边界

- 扩展只做**抓取**：匿名请求（不带 cookie），不下载附件、不解析载荷、不写 `archive/`。
- 解码复用本地 Python importer，保证与 `npm run archive:share` 同一套逻辑。
- 附件资源仍由本地管线按既有规则解析；扩展不承诺离线完整。

## 已暂停的部分

"不建分享链接也能采集"（页面接口 / fiber props / 自动滚动）已验证不可行：页面只在**真实用户滚动**时才请求
更早的页（`?before=<游标>`），程序化滚动不触发；手动滚再导出不如直接用分享链接。相关代码与结论保留在本目录，
不再作为可用功能。