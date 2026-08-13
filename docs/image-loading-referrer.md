# 图片加载与 Referer 防盗链方案

> 2026-08。微博图床 403 触发:审计 `<img>` 图片加载的 Referer 处理,评估「Rust 层做
> Referer / 自定义协议代理」的可行性,结论:**维持 blob 隧道**,自定义协议列为未来
> mobile 接入时的独立优化。

## 背景

新浪图床(`*.sinaimg.cn`)对**空 Referer 也返回 403**,只放行 `weibo.com` / `m.weibo.cn`
系 Referer(curl 实测:无 Referer 403,带 weibo.com 200)。而 `<img>` 原生加载**必带页面源
Referer**(桌面是 `tauri://localhost`),且 Referer 由 Referrer-Policy 控制、**与同源策略
(SOP) 是两套独立机制**——关掉 webview 的 SOP 也救不了(`--disable-web-security` 只放开
fetch 读跨源响应体,改不了 img 发出的 Referer)。无免防盗链子域捷径(实测
n/tva/ws1.sinaimg.cn 等子域全部 403/404)。

唯一能让 Referer 正确的途径 = **带自定义 header 的请求**(Rust reqwest 可设任意 header)。

## 现状方案(已落地)

**blob 隧道**:命中防盗链图床的 src 经 `appHost.http`(Tauri 生产走 Rust `http_get`,
node/browser 后端同接口)带站内 Referer 拉取 `arraybuffer` → Blob URL → `<img>` 显示。

- 规则表 `mediaReferrerFor(url)` 收敛在 **host 层**(`packages/host/src/media-referrer.ts`,
  `sinaimg.cn → https://weibo.com/`)——唯一权威,ui 不写死任何域名,加图床只改这一处;
- 消费方 `MediaImage.tsx`(`packages/ui/src/renderers/atoms/MediaImage.tsx`)内联
  `useProxiedImage`:命中未就绪返回 undefined(不挂原 src,避免先发必 403 的请求);
  隧道失败回退原 src 走 `<img> onError` 占位;模块级 `proxyCache` 防重复请求;
- 跨三环境统一(tauri/browser/node),纯 TS 无 eval,CSP 安全;
- 已验证:node 环境带 weibo Referer 拉图 200(1.8MB 字节取回)。

## Rust 层替代方案评估

### 方案 A:http_get command 内自动补 Referer

Rust 侧维护「host → Referer」表,请求进来自动带。代价小,但**前端仍需判断「这张图
要不要走隧道」**——判断依据和 Referer 规则是同一份知识,会在 TS(判断)与 Rust(补头)
**分裂成两份**,比现在的 `mediaReferrerFor`(host 层一份)更分散。**不值**。

### 方案 B:自定义协议 `media://` 代理图片(彻底 Rust 化)

`<img src="media://…">`,Rust 注册 `register_uri_scheme_protocol` 带站内 Referer 拉图、
流式返回字节。img 原生加载,无 blob/base64 膨胀/JS 隧道,性能显著更好(瀑布流多图时
是真实收益)。代价(「四件套」):

1. tauri.conf 配 scheme + Rust handler;
2. 前端 URL 重写(`https://wx1.sinaimg.cn/...` → `media://...`),需跨平台分支(见下);
3. browser 纯前端调试环境无 Rust scheme,需降级回原生 img / fetch;
4. **跨平台 scheme 形态差异 + 已知安全洞**(见下)。

## Tauri 自定义协议跨平台差异(官方 docs.rs 查证)

`register_uri_scheme_protocol` 把协议映射成两种形态:

| 平台 | 形态 | 原因 |
|---|---|---|
| macOS / iOS / Linux | 真 scheme:`media://localhost/<path>` | WebView 原生支持(WKURLSchemeHandler / WebKitGTK) |
| **Windows / Android** | **伪 scheme:`http://media.localhost/<path>`** | WebView2 / Android WebView **不能直接服务自定义 scheme**,Tauri 伪装成 `<scheme>.localhost` 域名 |

由此派生:

1. **URL 必须按平台分支**:同一套前端代码,`<img src>` 在 iOS 写 `media://localhost/xxx`,
   Android/Windows 得写 `http://media.localhost/xxx`(写 `media:` 会 ERR_UNKNOWN_URL_SCHEME,
   有开发者实测确认)。需一个跨平台 scheme URL 生成器。
2. **Origin 差异**:伪 scheme 页面 Origin 是 `http://media.localhost`,与主应用
   (`tauri://localhost` / `http://tauri.localhost`)跨源。`<img>` 显示无影响(图片可跨源);
   若前端 `fetch` 读字节,Rust handler 响应须带 `Access-Control-Allow-Origin`。
3. **iOS 是最「规整」的移动端**:真 scheme,与 macOS 行为一致,无伪 scheme 问题。所以
   「移动端差异」主要就是 Android 那一套。

## 安全(GHSA-7gmj-67g7-phm9)

Windows/Android 伪 scheme 有**已公开漏洞**:`is_local_url()` 只校验第一个子域
(`split_once('.')`),导致 `http://<scheme>.evil.com` 这类攻击者域名被误判为本地源,
从而**调用本应为本地保留的 IPC command**。注册的自定义 scheme 越多、前端引用越广,
风险面越大。macOS/iOS 真 scheme 无此漏洞。

## 决策

- **维持 blob 隧道**。理由:规则已收敛(host 层一份)、跨平台统一、后端已跨平台
  (`http_get`)、无安全洞;自定义协议在桌面是小优化,在 Android 踩伪 scheme + 安全
  advisory + 跨平台 URL 分支三连坑,远超「Rust 层加个 Referer」的收益。
- **方案 B 列为未来独立优化**:当 mobile 真正接入 appHost/crawler、瀑布流多图成为
  性能瓶颈时,按平台评估真 scheme 方案(参考本文件的差异表与安全提示)。

## 性能现状:微博图片加载慢(2026-08 实测)

**现象**:桌面端瀑布流微博图片加载明显慢(skeleton 持续时间长、图片逐个缓慢浮现)。

**原因分析**(按影响排序):

1. **隧道每次全量下载**——命中 sinaimg 的图经 `appHost.http` 拉**完整图字节**
   (arraybuffer,原图可达 1.8MB 级),一次性取回后才显示;`<img>` 原生加载本可按需
   渐进,隧道路径丢了这个能力。
2. **缓存只活一个会话**——`MediaImage` 的 `proxyCache`(src → blob URL)是**模块级
   内存 Map**,应用重启 / HMR 后即清空,瀑布流全部微博图**重新隧道下载**。crawler 层
   `fetchImageSize` 的 `sizeCache` 只缓存**尺寸**(Range 文件头 ~1KB),不缓存图内容。
3. **无并发上限**——瀑布流多图各自独立发起隧道请求,无批大小限制;几十张图同时
   走 Rust 隧道(reqwest 线程池)排队时放大总耗时。
4. **尺寸预取是额外往返**——缺宽高的图先发一个 Range 请求(~1KB),再发全量隧道
   请求,两段式;微博图没有 API 宽高,每张都要走(小红书 SSR 自带宽高、bili 动态
   API 自带宽高,不受此影响)。

**已有缓解**:`sizeCache`(crawler)缓存尺寸、`proxyCache`(ui)会话内缓存图 → 同一
会话内滚动重挂载不重复拉图。**跨重启无缓存**是主要短板。

**优化方向**(未来,均未做):
- **方案 B 自定义协议 `media://`**(本文件上文):Rust 侧流式返回、`<img>` 原生加载,
  无 blob 膨胀/JS 隧道,瀑布流多图是真实收益——本慢问题的主要解法;
- 或隧道层加**磁盘缓存**(图 URL → 字节,持久化,重启复用);
- 或 `proxyCache` 加 **LRU 上限**防长期会话内存膨胀;
- 或隧道请求加**并发批大小上限**(如 ≤6 并发)。
