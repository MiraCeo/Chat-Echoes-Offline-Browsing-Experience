# 书签小工具兜底（不装扩展时的一键入口）

在分享页（`https://chatgpt.com/share/…`）上点一下书签，打开本地导入页并**预填**这条链接，
再点「导入」即可。它不跨站发 POST，因此不需要放宽本地服务的 CSRF 防护。

## 安装

1. 新建一个书签，名称随意（例如「发送到 CEOBE」）；
2. 地址填下面这段（一行）：

```text
javascript:(()=>{const port=5173;const u=location.href;if(!/^https:\/\/chatgpt\.com\/share\//.test(u))return alert('请在 ChatGPT 分享页使用');open('http://127.0.0.1:'+port+'/import.html?url='+encodeURIComponent(u),'_blank')})()
```

3. 在 `chatgpt.com/share/…` 页面点这个书签。

## 注意

- 端口按 `npm run dev` 实际打印的地址改（默认 5173；被系统保留时启动器会往上找）；
- 浏览器可能禁止在 `javascript:` 书签里直接执行 `open`（弹窗拦截），允许一次即可；
- 如果本地服务没启动，导入页会显示「只读 / 服务不可用」的提示，不会白屏；
- 这条路线只打开本地页面，链接里的 URL 会由导入页校验后再抓取，扩展的「直连发送」才是 POST 路线。
