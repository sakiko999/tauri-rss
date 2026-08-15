# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。

## 目录结构

```
apps/
  src-tauri/     ★ 唯一 Rust crate（tauri-app），桌面/移动共享 commands/plugins
  desktop/       前端（React 19 + Vite，产物 → dist/desktop）。已接入 crawler/core/appHost
  mobile/        前端（React 19 + Vite，产物 → dist/mobile）。⚠️ 仍是 Tauri 模板，
                 尚未接入 crawler/core/appHost —— 是后续工作，勿把它当实现参考
packages/
  xml/           ★ @tauri-playground/xml — RSS 2.0 + tpl: 扩展的编解码（fast-xml-parser v5
                   XMLBuilder 编码 / parseFeed 解码）。唯一持有 fast-xml-parser
  host/          ★ @tauri-playground/host — 宿主后端 + 全局 appHost 门面
                   （node/ 真实网络+内存存储给 example；browser/ 浏览器 fetch+localStorage
                   给纯前端调试；tauri/ Rust http_get+ws_connect+localStorage 给生产。
                   ws:弹幕 WS 统一走宿主 ws_connect(node/tauri,可带自定义 header)。
                   曾按 header 需求分流(douyin 走宿主、bili/douyu/huya 走原生——
                   误判「schannel 对 douyu danmuproxy:8506 证书校验失败」);2026-08-14
                   probe 实测 native-tls 连 douyu/bili/huya 弹幕服务器握手全通
                   (证书 GlobalSign 有效,失败实为集群节点偶发 RST),故一律走宿主,
                   原生 WebSocket 仅纯浏览器调试兜底(无 appHost.ws))
  crawler/       ★ @tauri-playground/crawler — 订阅源抓取层（producer 的重构替代）。
                   一切皆 RssChannel：channel 直接 implements RssChannel(+ 能力接口
                   RssVideoChannel/RssLiveChannel/DanmakuPlayable),getSource 用组合工厂
                   (factory.ts)装配——纯函数,每次返回新 source,缓存/去重归 core。
                   apiFetch 包 fetch;liveHotSource 收敛 hot 委托(hot 源持同平台 live
                   source 能力,仅替换自家 fetch)。
                   直出 RSS 2.0 + tpl: XML 字符串。XML 即天然类型,不导出数据模型类型。
                   弹幕层在 danmaku/(createWsStream 统一 WS 封装 + deferredStream 收敛
                   「异步 setup→建流」竞态 + 各平台 codec proto/tars/douyin-proto),
                   四平台直播 channel 挂 getDanmaku 返回 DanmakuStream。共享工具在
                   utils/(ua:DESKTOP_CHROME_UA / str:strOr / cookie);douyin 签名层收敛
                   abogus.ts(UA_ENTER/signDouyinUrl/enterRoomParams)。
                   浏览器模拟在 browser/cdp.ts(cdpFetch/cdpNavigate/cdpJson,绕 CORS 靠
                   导航到目标域;weibo/xhs user channel 检测 appHost.browser 走此路径)。
                   依赖 **ramda** 0.32（+ @types/ramda devDep）——
                   嵌套解析/排序用 chain/sortWith/pathOr 函数式展开(范式见
                   bili/live.ts 的 parseBiliLiveStreams)
  core/          @tauri-playground/core — 订阅维护者。基于 crawler 输出维护订阅列表 + 分组
                   + 刷新编排 + 持久化。自解析 XML 建 MediaItem（不依赖 crawler 类型）
  player/        ★ @tauri-playground/player — 媒体播放器(video/audio/live 共用),从 ui 拆出。
                   PlayableMedia(懒解析+选流+分发唯一入口) + VideoShell/AudioShell 外壳 +
                   MediaChrome 式独立控件(controls/)。日志走 @tauri-playground/log(域注册+颜色)。
                   依赖 core(MediaStream 类型) + 全局 appHost(hls/flv/dash 走隧道) +
                   hls.js/flv.js/dashjs。依赖链:core ← player ← ui/desktop
  log/           ★ @tauri-playground/log  — 域注册语义化日志(零依赖叶子包)。
                   createLogDomain(name,{color,ansi,events}):每模块注册自己的域+模板事件,
                   颜色 devtools %c CSS / 终端 ANSI。开关 log="0" 全局关 info/debug、
                   log:<域>="0" 按域关,legacyKey 兼容旧 key(player-log/host-log);
                   warn/error 永保留。被 player/host/crawler 引用
  ui/            @tauri-playground/ui   — UI 组件库（按 kind 分发的媒体渲染器 + 原子组件）。
                   播放器已拆到 player 包,此处 re-export 保持旧入口;新代码直接引 player
  ✂️ xhshow(小红书签名库,Python 上游 fork)已移至 **feat/xhs-rustpython** 分支:
     原 xhshow-js TS fork 过时(2026-07 升级签名后 461),Python 版 + RustPython
     补丁随签名 crate 一起在专门分支维护,主分支不再包含(见 docs/xhs-signature-research.md)
```

依赖链：`xml ← crawler ← core ← ui ← desktop`，播放器支线 `core ← player ← ui/desktop`；
`log` 是零依赖叶子,被 player/host/crawler 引用;`host` 被 crawler/core/desktop/player 共用。
读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装。

## 宿主注入：全局 appHost 门面

宿主能力（http / ws / js 签名执行 / browser 浏览器模拟 / storage / now / log）经**全局 `globalThis.appHost`** 注入：

- **正常流程**：应用启动时 `injectTauriHost()`（desktop 在 `main.tsx`）。
- **example / 测试**：`injectNodeHost()`（Node fetch + 内存存储）。
- **纯前端调试**：`injectBrowserHost()`（浏览器 fetch，CORS 受限）。

门面在 `@tauri-playground/host`（`packages/host/src/runtime.ts`）——import host 包即初始化；
字段是 getter，未注入时访问 `http/js/storage` 抛清晰错误，`now/log` 兜底；`ws`/`browser`
可选（未注入返回 undefined，crawler 据此降级）。类型声明在
根 `global.d.ts`（`var appHost: AppHost`），被 `tsconfig.app.json` 的 `files` 引用，
所有 `extends ../../tsconfig.app.json` 的包自动可见。

## 关键命令

```bash
bun run dev                    # Vite dev（纯前端）
bun run tauri                  # Vite dev + Tauri dev 并行（完整应用热重载）
bun run tauri:build            # 前端构建 + release 构建
bun run scripts/tauri.ts help  # 查看全部用法

# crawler example（注入 Node host，真实抓取）
bun run packages/crawler/src/example/list_channels.ts     # 打印全部 channel（47 个）
bun run packages/crawler/src/example/sample_sources.ts live:   # 抽样 fetch，filter=live: 只看直播
bun run packages/crawler/src/example/resolve.ts bili:popular  # 懒解析可播流(视频,video/live 合一)
bun run packages/crawler/src/example/resolve.ts bili:live 312785  # 懒解析直播流(直播)
bun run packages/crawler/src/example/test-danmaku.ts 5    # 四平台直播弹幕(热门在播房间)
./node_modules/.bin/tsx packages/crawler/src/example/browser-sim.ts weibo:user  # 浏览器模拟抓微博(playwright-core;bun 跑会卡,用 tsx/node)

# core example（基于 crawler 输出的 channel 批量订阅 + 刷新）
bun run packages/core/src/example/data-layer.ts
```

前端产物输出到根 `dist/<platform>/`（Vite `outDir`），tauri.conf `frontendDist` 指向 `../../dist/<platform>`。

## ⚠️ 环境要求：MSVC linker（重要）

**必须从 "x64 Native Tools Command Prompt for VS 2022" 启动 VSCode / 终端**，否则 Rust 链接会失败。

### 坑：Git Bash 的 `link` 抢 MSVC

Git Bash 自带 `/usr/bin/link`（GNU 链接器），如果它在 PATH 里排在 MSVC 前面，cargo 链接时用它，会报：

```
/usr/bin/link: extra operand '...cgu.0.rcgu.o'
```

**解决**：确保 MSVC 的 `bin\Hostx64\x64` 在 PATH 最前（Native Tools 启动即自动前置）。

> 本机实际版本：`/c/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/VC/Tools/MSVC/14.51.36231/bin/Hostx64/x64`。
> **Bash 工具调用间 env 不持久**——每次 cargo 命令前都要内联 `export PATH`（写在同一条命令里）。

> 之前 `.cargo/config.toml` 硬编码过 linker 路径，已删除（硬编码 MSVC 版本号，VS 更新后必坏）。**不要在 cargo config 里写死 linker**，保持 PATH 方案。

## Git 提交身份

本机未配置全局 git 身份，直接 `git commit` 会报 `Author identity unknown`。提交时显式内联：

```bash
git -c user.name="zhh" -c user.email="zhonghuaremistinker@gmail.com" commit -m "..."
```

## 其他注意事项

- tsc 用根 `./node_modules/.bin/tsc -p <项目>`（各包/desktop/scripts 各自校验）；**不要** `npx tsc`
  （会误装 tsc@2.0.3），**不要**裸 `-p tsconfig.app.json`（扫全仓含 tmp/ 噪音）。
- cargo test/build 前若 tauri-app.exe 仍在运行会锁二进制报 `拒绝访问 (os error 5)`，先 `taskkill //F //IM tauri-app.exe`。
- `tmp/` 是 gitignore 的迁移源 / 参考项目，**不要对它跑任何构建/测试**：
  - `RSSHub` — 路由静态摘录数据源目录（`scripts/rsshub-catalog.ts` 抄它的 handler）
  - `MediaCrawler` — 微博/小红书等反爬平台爬虫对照（确认为什么这些平台搞不定）
  - `dart_simple_live` — 直播流获取参考（虎牙/斗鱼/bilibili/抖音，Dart 实现，
    与 crawler 直播 channel 同源平台）
  - `producer` — 旧订阅生产者源码（无代码引用，保留参考：source/bilibili、douyin abogus、
    douyu cryptojs、huya、rss 的实现范式）
- Rust 增量编译偶尔报 `拒绝访问 os error 5`，是无害警告，忽略。
- Tauri dev 的 `devUrl` 是 `http://localhost:1420`，脚本并行启动 Vite dev server + tauri dev。
- `apps/src-tauri/tauri.conf.json` 是桌面配置，`tauri.conf.mobile.json` 是移动端。
- **WebView 自动播放(带声)默认放行**(wry `WebViewAttributes.autoplay=true`):Windows
  加 `--autoplay-policy=no-user-gesture-required`、macOS `setMediaTypesRequiring
  UserActionForPlayback:0`、Linux WebKitGTK `AutoplayPolicy::Allow`、Android
  `setMediaPlaybackRequiresUserGesture(false)`。⚠️ **实测存疑**:此前所有播放
  都是静音(唯一有声的是走流媒体库 hls/flv/dash 的源),说明该「默认无手势配置」
  **未必真的生效**——`unlockAudioPlayback()`(AudioContext.resume)也未解决问题。
  player 层实际修复是:原生 mp4 分支「src 刚设立即 play」媒体未加载致降级静音
  → 改等 `canplay` 再带声(与 hls/flv 分支对称),已解决。⚠️ **坑**:desktop 若
  自定义 `additionalBrowserArgs`(Windows)会**覆盖** wry 默认 browser args,必须
  显式带上 `--autoplay-policy=no-user-gesture-required`,否则带声播放回归静音。

## 测试数据源（RSSHub 摘录 + bilibili 复刻）

- `tmp/RSSHub` 是 RSSHub 的 git clone（已 gitignore）。`docs/rsshub-catalog.*` 由
  `bun run scripts/rsshub-catalog.ts` 静态摘录生成——只把 RSSHub 当**数据源目录**抄，
  **不跑它的运行时**（`@/` alias、config、cache、registry 太重，与不部署的诉求冲突）。
- RSSHub 里**绝大多数 handler 是定制 scraper，无现成原生 feed URL**；只有少量真·原生
  feed 直传（catalog 已高亮）。判断源可用性先 `curl` 实测（检查 200 + `<rss`/`<feed` 头，
  注意新浪科技带 `xml-stylesheet` 会误判 HTML，实为真 RSS）。
- **bilibili wbi 签名零登录可复刻**（关键发现）：`GET /x/web-interface/nav` 未登录
  （`code:-101`）仍返回 `data.wbi_img`，无需 cookie/puppeteer，纯
  `MD5(排序参数&wts&mixinKey)`。范式见 `packages/crawler/src/channels/bili/`
  （wbi 签名在 client.ts，channel 在 channels.ts/live.ts）。换位表 `MIXIN_KEY_ENC_TAB` 与 live 层同源。
- 内置 RSS 直链清单在 `packages/crawler/src/channels/rss/builtin.ts`（36 条，按 kind 标注）。
  desktop 测试订阅在 `apps/desktop/src/subscriptions.ts`（覆盖 article/video/audio/live/social，
  含 douyu/bili live/huya/douyin 在播房间 + bili:dynamic 半佛仙人）。可用性结论见
  `docs/domestic-feed-availability.md`。新源先 curl 验证再并入。
- **bili:dynamic 用户动态 channel**（`packages/crawler/src/channels/bili/dynamic.ts`）：
  用 RSSHub 同款 `GET /x/polymer/web-dynamic/v1/feed/space?host_mid={uid}`（非 dynamic_new
  时间线——那个返回关注流,`desc.uid` 不匹配目标用户）。**需登录 cookie**（未登录 code:-101,
  core 层 DEFAULT 自动注入）。动态类型靠 `modules.module_dynamic.major` 的 opus(图文/专栏)/
  archive(视频)分支;转发展开 `orig` 被转内容(**orig 是完整 DynItem,
  module_dynamic 在 orig.modules.module_dynamic 下**,非 DynModule 层级)。
  实测半佛 37663924(硬核的半佛仙人,转发为主;⚠️ 37883317 是「DILI念」勿用)、
  DIYgod 2267573(视频为主)。
- 热门平台判定：YouTube 走官方 RSS 可直接用；bilibili 走 API 可复刻；微博/小红书走
  登录 cookie + API 可复刻（见下）；**X 仍是硬反爬**（puppeteer+登录+代理），个人不
  部署 RSSHub 碰不了。
- **小红书双通道（2026-08 SSR 改版后）**：`xhs:explore` 发现页仍走 SSR
  `window.__INITIAL_STATE__`（feed.feeds 的 noteCard，noteId 在 `feeds[i].id` 顶层）；
  ⚠️ 登录态 SSR 的 JSON 混入 JS 表达式（`"noteDetailMap":new Map([])`）——extractInitialState
  用**平衡大括号截纯 JSON**（非截到 `</script>`）+ 空容器构造归一，RSSHub 的
  `replaceAll("undefined","null")` 救不了。`xhs:user` 用户笔记改走 **user_posted API**
  （edith.xiaohongshu.com）——小红书把 user 页笔记改为 JS/API 动态加载，SSR
  `user.notes` 已空（`[[],[],...]`）。user_posted API 需签名
  （`x-s/x-s-common/x-t`）+ **登录 cookie（web_session）**（匿名 406、未登录
  code:-101）；签名种子 `a1` 取自会话 cookie。实现见
  `packages/crawler/src/channels/xhs/{client,user,explore}.ts`。
  ⚠️ **签名库 xhshow 已移至 feat/xhs-rustpython 分支**:原 TS fork 过时(2026-07
  升级签名后 461),Python 版 + RustPython 补丁随签名 crate 在专门分支维护;
  主分支**降级 SSR 匿名刷新**(explore 快照+刷新、不做翻页;user 不可用),
  不维护签名 API。签名约 1 月~1 季度一改 + 按账号/会话灰度分发,b1 指纹需真实
  浏览器——纯算法维护成本高。**浏览器模拟路径(feat/browser-sim 分支,2026-08)**:
  Tauri spawn 系统 Edge + CDP(appHost.browser 可选门面),weibo/xhs user channel
  检测到门面则走浏览器页面 fetch(登录态 + 签名 _webmsxyw + 设备指纹全在真实浏览器,
  绕开 reqwest 406 / 纯算法 461 / b1 死结;未注入时降级现有路径)。weibo:user 已实测
  通(浏览器同源 fetch 无 CORS,导航到 m.weibo.cn 后);xhs:user 匿名 406 待登录态。
  细节/频率证据/维护成本见 `docs/xhs-signature-research.md`。
- **bilibili 登录档位**：`packages/core/src/bilibili-cookie.ts` 存默认 cookie（gitignore +
  空占位提交 + skip-worktree 保护,见 `.example`），`settings.bilibiliCookie` 作 core 层
  默认值,data-layer `sourceInfoFor` 合并到所有 bili 订阅解锁登录档位。改本地 cookie:
  编辑该文件 → `git update-index --no-skip-worktree` 再改,勿提交真实值。
  目前 DEFAULT_*_COOKIE 是临时方案;长期目标应用内扫码登录获取完整认证 + 定期保活,
  可行性见 docs/platform-login-research.md。

## 调研文档（tmp/ 参考仓库）

- **弹幕获取机制**：`docs/danmaku-research.md`。B站视频弹幕 = 零摩擦入口
  （`bvid→cid→GET /x/v2/dm/web/seg.so?oid&segment_index`,protobuf、6min/段、**匿名可用**）,
  是弹幕 MVP 首选。直播弹幕 4 平台已全通(bili 16B 大端头+zlib、douyu STT、huya Tars、
  douyin protobuf+gzip),**统一走宿主隧道 `appHost.ws`**(Rust ws_connect/ws 包)。
  曾按 header 需求分流——误判「schannel 对 douyu danmuproxy:8506 证书校验失败」走原生;
  2026-08-14 probe 实测 native-tls 连 douyu/bili/huya 弹幕服务器握手全通(证书
  GlobalSign 有效,失败实为集群节点偶发 RST),故一律走宿主,原生 WS 仅纯浏览器兜底。
  ⚠️ ws.rs 的 ws_connect **必须用 `req.url.as_str().into_client_request()` 从 URL 构造
  完整请求再插自定义头**——手动 `http::Request::builder()` 构造 Request<()> 缺
  Sec-WebSocket-Key(tungstenite 的 Request<()> IntoClientRequest 是 Ok(self) 不补 WS 头,
  generate_request 校验报 "Missing...sec-websocket-key")。曾致 douyin/bili 走隧道握手
  全失败,已修(2026-08)。
  ⚠️ **bili 直播弹幕坑(2026-08 风控)**:认证必须真实登录 uid——匿名 uid=0 握手成功即被
  服务器 1006 拒(probe-bili-cookie 实测:uid=0 1006、真实 nav mid → op=8 code 0 通过)。
  uid 取 nav 的 mid(cookie 登录态)、buvid 取 cookie 的 buvid3;**不走宿主隧道**(带 cookie
  header 触发 Rust ws_connect 的 sec-websocket-key 握手被拒)——原生 WS 即通过;host 的
  **wss_port 非标(常见 2245)必须拼端口**(默认 443 握手成功但非弹幕服务)。
  ⚠️ **弹幕连接释放竞态**:createWsStream 的宿主/原生 onOpen **必须检查 `stopped`**——
  退订后握手才完成时(宿主 ws_connect 异步),unsub 时 ws 未赋值跳过 close,握手完成 onOpen
  照发认证帧/心跳 → 连接泄漏(关闭直播间弹幕不释放)。onOpen 遇 stopped 立即 close 刚建的连接。
  ⚠️ **douyin 弹幕坑(2026-08 根因)**:签名脚本必须用 douyinLive 2024 修改版 webmssdk.js
  (`get_sign`,dart 2023 kWebMsSDK 已失效→415 DEVICE_BLOCKED);执行环境须**遮蔽 node 全局**
  (process/Buffer 等,否则走 node 分支指纹被拒)+ window 完整挂载;webcast100 域名 +
  真实 pushID(enter API 的 user.id_str);enter 用 QQBrowser UA(Chrome 150 返空 body)、
  WS 用 Chrome 150 UA。proto `progress` 是毫秒, XML 弹幕是秒,与 currentTime(秒)换算勿混淆。
  ⚠️ **弹幕探测收敛进 resolve(2026-08-14)**:`resolvePlay/resolveLivePlay` 返回
  `ResolvePlayback`(`{ streams, danmaku? }`),core 探测 `isDanmakuPlayable` 后
  `getDanmaku(id)` 一并给,**无独立 `openDanmaku` 门面**;`PlayableMedia` 从 resolve 结果
  提取 `danmaku` 传给 `DanmakuLayer`(订阅/退订生命周期收敛在 player,接收已探测流),
  desktop `ExpandedPlayer` 零弹幕逻辑(只传 resolve)。弹幕连接释放竞态同上
  (onOpen 检查 stopped)。「异步 setup → 建流」的 stopped 拦截统一收敛进
  `danmaku/stream.ts` 的 deferredStream(douyin 双层/bili live/huya/bili VOD 共用,
  2026-08-14 抽)。
- **Folo 架构**:`docs/folo-architecture-research.md`。分组=subscriptions 表 `category` 字符串
  + 按 siteUrl 域名自动归类;`Transaction` 四段式乐观更新(store→request→rollback→persist)
  最值得抄。它是云端聚合架构(抓取在服务端),我们 crawler 本地抓取不能照搬;
  iframe 嵌入播放差于我们 hls/flv/dash 直链解析,不抄。
- **平台扫码登录 + 保活**:`docs/platform-login-research.md`。三平台扫码登录全可行
  (bili 纯 HTTP/dart 参考、weibo JSONP、xhs 需签名——签名库在 feat/xhs-rustpython)。
  续期设计:仅 bili 可自动
  保活——bili_ticket 软性风控因子惰性随补即可,真正要保 SESSDATA(refresh_token 续期
  闭环,180 天窗口续一次即永久,登录须捕获 refresh_token——dart 参考漏了这步);
  weibo SUB / xhs web_session 均 ~1 年长效,到期扫码重登。统一兜底:失效检测
  (code:-101/1006/432/461)→引导重登。

## 下一步 Todo（阶段性任务）

### Demo 必选（按建议顺序）

**1. 媒体播放闭环（demo 差异化价值）**
- `packages/player/` 已落地：`PlayableMedia` 是**唯一入口**（懒解析 + 选流 + 分发三合一,
  原 MediaPlayer 已并入）;`useMediaStream`（hls.js/flv.js/dash.js 生命周期）。
  **选流契约**：crawler 保证返回数组内**最高清晰度排最前**（bili live/video、youtube、
  douyin、huya 显式 `R.sortWith(descend rate)` 降序;⚠️ **douyu 除外**——保留 multirates
  服务端顺序(高档在前),rate 是档位 ID 非清晰度,按 rate 降序会把原画 2K60 排末尾;
  youtube 渐进式 360p 不混排 DASH,只作整条 fallback）→ player `useStreamSelection`
  用 `find` 链取第一个,不做二次排序（渐进式优先=浏览器原生可播最稳,其次 hls/flv 流媒体）。
  **控件是 MediaChrome 式独立组件**（`controls/`,窄接口 `{state, ops}`、可自由组合）:
  `MediaPlayButton`/`MediaMuteButton`/`MediaVolumeSlider`/`MediaTimeRange`/`MediaRateButton`/
  `MediaQualityButton`/`MediaFullscreenButton`/`MediaLiveEdgeButton`/`MediaTimeDisplay`;
  `PlayerControls` 是默认组合（等价 `<media-control-bar>`）,`VideoShell`/`AudioShell` 外壳管
  自动隐藏/键盘快捷键/全屏/缓冲/点击播放暂停(音频保留原生控件)。状态中枢 `useVideoElement`
  （监听 11 媒体事件 → state + ops）。倍速/档位菜单用 **radix primitive**
  （ui 包装全量 26 个,desktop 只留 dialog）
- **日志域注册（@tauri-playground/log）**：全包日志走独立包（禁止裸 console.*）。
  `createLogDomain(name, {color, ansi, events})` 每模块注册自己的域 + 模板事件:调用处只传
  事件数据、不拼文案;文案/级别/颜色集中在各域模板。player 域 resolve/select/engine/play/loader/
  danmaku（前缀 `[player:<阶段>]`）、host 域 `[host:http]`、crawler 按 channel 建域（`[bili]`/
  `[youtube]` 等）+ 弹幕通用 WS 层 `[danmaku]`（createWsStream 连接生命周期模板事件:建连/建立/
  关闭/重连/帧数,`wsConnect`/`wsItems` 为 debug 级可 `log:danmaku="0"` 关）。开关
  `localStorage["log"]="0"` 全局关 info/debug、`log:<域>="0"` 按域关;旧 key
  `player-log`/`host-log` 兼容(warn/error 永保留)。devtools Console 过滤 `[player:` 看各域颜色。
- ✅ 已通：Audio（mp3 原生）、douyu 直播（flv.js HTTP-FLV）、bilibili 直播（hls.js + avc 过滤）、
  huya 直播（flv.js HTTP-FLV）、douyin 直播（flv.js HTTP-FLV,5 档）、bilibili 视频
  （dash.js 双 SourceBuffer,DASH 1080P 有声）、YouTube 视频（adaptiveFormats 拼 MPD,
  DASH 1080P 有声）、
  **YouTube 直播（ANDROID_VR client → 自带 hlsManifestUrl,hls.js 播;无 hls 时才 fallback iOS）**
- ✅ 自动播放：点击「播放」→ 带声自动播（`unlockAudioPlayback` 手势内解 autoplay policy +
  失败降级静音）；全部平台（B站视频/YouTube/douyu/bili live/huya/douyin）一致
- ✅ 多档位切换：douyu/bili live/bili video/douyin 动态获取档位（服务端 accept_qn/
  multirates/accept_quality,非硬编码）,MediaPlayer 档位条切换（同 rate 去重）
- ✅ B站视频 DASH：playurl `fnval=16` 拿 dash.video(avc)+dash.audio(AAC),crawler 拼 MPD
  （每档单 Representation,SegementBase Range）存 `stream.dashManifest`,dash.js 双
  SourceBuffer 合成播放(等价 B 站官方 MSE)。登录后 avc 有 1080P（非会员也）;
  `url:""` + `format:"dash"` + dashManifest 由 `isDashStream`(format==="dash")识别
- ✅ HLS 档位：video/live **锁最高档**（`currentLevel=max`,ABR 关闭）。原因：宿主隧道
  （Rust reqwest + base64）的固定开销让 ABR 带宽估算失真（1080p 4561kbps 测得仅 ~1Mbps），
  自动降档会骤降 144p 永不回升。档位选择后续在播放器开放，用户手动选
- ✅ dash.js 走 `DashHostLoader`（工厂函数,dash.js extend 用 Object.create;blob MPD 原样
  fetch,分片 Range 补 `bytes=` 前缀走 appHost.http 隧道无 CORS）;hls.js 走 `HlsHostLoader`
  （class,googlevideo.com 无 CORS 时切隧道）;dash/hls 均锁最高档防隧道带宽估算降档
- ⚠️ 已知边界：YouTube 视频若 avc1 DASH 装配失败（如 SABR-only / 非 avc1 编码）→ 降级
  渐进式 360p;直播若 VR 无 hls（罕见形态）→ fallback iOS,仍无则降级 `format:"web"`。
  内嵌 DASH 播放（视频已支持,见下）;直播的原生 dashManifestUrl 可选增强未用,
  见 `docs/youtube-stream-extraction.md`「四、本项目落地」
- YouTube 直链实现见 `docs/youtube-stream-extraction.md`（**主力 client = ANDROID_VR**
  （Oculus Quest 3,`1.65.10`,yt-dlp master）——2026-08 起 ANDROID/IOS 标准 client 部分
  IP 触发 poToken(LOGIN_REQUIRED 机器人检测),VR 返回免 token 直链;>1.65 可能
  SABR-only,需随 yt-dlp 更新;live 判定看 `playabilityStatus.liveStreamability`;
  请求端点统一走 gapis `youtubei.googleapis.com` + t/id 参数,NewPipe 同款;
  ⚠️ poToken 风控是**部分 IP 特性**（与 node/tauri/browser 环境无关）——受控 IP 上
  ANDROID/IOS 才 LOGIN_REQUIRED,当前开发机三环境均正常抓取;换 IP 仍被控时可在
  fallback 链插 ANDROID_VR 之外再考虑 poToken 方案;
  ⚠️ **渐进式分辨率实测修正（2026-08-12）**:两个 client 的渐进式都只到 itag 18
  （360p）,无 720p 渐进式。**视频 1080p 走 DASH**:adaptiveFormats 带 initRange/
  indexRange,与 B站同构 → 自拼 SegmentBase MPD（共享 `utils/mpd.ts`,从 bili 抽出）,
  `format:"dash"` + dashManifest 由 dash.js 双 SourceBuffer 合成;每档 MPD 只含该档
  video + 公共最高音轨锁档。渐进式 360p 不混进返回数组（MediaPlayer 默认选流优先
  渐进式会落 360p）,DASH 装配失败才 fallback。**直播已 1080p**（HLS 自带 6 档 +
  currentLevel=max;新发现直播自带 dashManifestUrl 原生 MPD,可选增强,
  见 `docs/youtube-stream-extraction.md`「四、本项目落地」）
- huya 直链实现见 `packages/crawler/src/channels/huya/play.ts`（buildAntiCode 纯 MD5/base64,
  `lChannelId` 作 presenterUid;反爬是**频率限制**,连续请求会降级页,单次 resolve 稳定;
  ⚠️ 只返回最高档,`&ratio=` 低档 flv.js 播几秒断）
- douyin 直链见 `packages/crawler/src/channels/douyin/index.ts`（enter API ABogus 签名 →
  stream_url 的 live_core_sdk_data.stream_data(JSON sdk_key 展开)/flv_pull_url 索引,reflow
  长号兜底,HTML flv_pull_url 末级兜底;liveStatus **status==2 才是直播中**(复刻 dart,
  ==4 是 roomId 一次性需换 webRid);resolveLivePlay 用 **web_rid(短号)**)
- bili live/video 登录档位：`DEFAULT_BILIBILI_COOKIE` 作 core 层默认值(core 层 settings.
  bilibiliCookie),data-layer `sourceInfoFor` 合并到所有 bili 订阅,解锁登录档位;
  cookie 文件 gitignore + 空占位 + skip-worktree 保护(见 `packages/core/src/bilibili-cookie.ts`)

**2. 订阅管理 UI（已完成）**
- ✅ `apps/desktop/src/components/AddFeedDialog.tsx`：`listChannels()` 选渠道 →
  按 `sourceInfoTpl` 动态渲染参数字段;有 `defaultInfo` 的 channel 一键订阅。
  走 `useDesktop.addSubscription`（dl.subscriptions.add + refresh）。已换 **radix Dialog**
  （焦点陷阱/ESC/ARIA）替代裸 div modal
- ✅ 三栏阅读器已落地（参考 `tmp/rss-reader`）：Sidebar（订阅树/分组/smart feeds/
  kind tab,含 dark 切换）+ 中栏按 kind 分发（article → ArticleList+ArticleDetail 两栏,
  video/audio/live/social → MediaList 卡片）+ AddFeedDialog
- ✅ **三栏布局梳理（2026-08-13）**：`showDetail` 按**节点意图**判定——只有 tab:article
  或真实文章订阅才进 ArticleList 三栏,聚合视图（tab:all/today 等）无论内容是否全
  article 都走 MediaList（防「今日」误吞进文章栏）。顶栏视图名抽 `viewTitleFor`
  （store.ts）共用显示真实身份（今日/未读/星标/订阅名）,三栏与中栏一致;
  MediaList 顶栏活性点（健康隐藏/刷新脉冲蓝/错误红）+ tabular 计数;空态「无信号」环
  （活性点放大静止版）按场景给方向 + 刷新 CTA。卡片分发统一 **UnifiedCard**
  （16:9 中卡等尺寸,VirtuosoGrid 网格）,**social 单一视图保留专属卡片 SocialRenderer +
  MasonryGrid 瀑布流**;列表容器 key 绑 selectedNodeId,切节点滚动归零
- ⚠️ 分组树仅渲染/展开,不做增删组 UI;分组节点点击只 toggle 不 select

**3. packages/ui 接入 tailwind（✅ 已完成）**
- ✅ renderer 已全部改走 **Tailwind 4 类**（desktop `@tailwindcss/vite` + `@source` 扫 ui 包）。
  媒体卡片体系参考 **Folo entry-column** 完整重设计（素色主题,不学 Folo accent 彩色）:
  - `renderers/atoms/` 原子组件：`MediaCard`（统一卡片壳 border-border/bg-card/hover）、
    `CardThumb`（aspect-ratio 撑开 + 角标）、`MediaImage`（lazy + error 占位 +
    loadedUrls 模块级缓存防虚拟化重挂载闪骨架）、`Skeleton`（animate-pulse）、
    `UnreadDot`（accent 蓝未读圆点,已读收缩）、`RelativeTime`、`format.ts`
  - 卡片形态：video 紧凑横向小卡（长列表塞更多）、live 纵向大图（16:9 + 状态角标）、
    audio 行式方形封面、social 瀑布流（见下）、article 列表行式
  - **关键**：全部从固定 `zinc-*` 迁到**语义令牌**（bg-card/border-border/text-muted-foreground），
    暗色主题免费生效;未读圆点/选中态用 `blue-*`（与 Sidebar/ArticleList 一致的唯一提示蓝）
  - 网格响应式：`MediaList` 用 **ResizeObserver** 观察容器宽度 → 断点选列数
    （>=1280→5 / >=1152→4 / >=768→3 / >=512→2 / 否则1），对齐 Folo 断点
  - **social 瀑布流**：`apps/desktop/src/components/MasonryGrid.tsx`（CSS columns 实现,
    非 VirtuosoGrid——其假设等尺寸 item 承载不了变高瀑布流）。递增渲染 + 底部哨兵
    无限加载;图片按 width/height 撑比例
  - **图片宽高方案 A**：`crawler/src/utils/img-size.ts` Range 预取文件头解析
    （PNG 64B / JPEG 1KB,WebP/GIF 同源）,失败退化 4:3。bili:dynamic 用 API 宽高 +
    Range 兜底(archive 封面)。XML `tpl:image` 支持 `@_url/@_width/@_height` 属性,
    core `SocialItem.images` → `SocialImage[]`
  - **图片防盗链 Referer**：`MediaImage` 内联 `useProxiedImage`(blob 隧道)——命中
    sinaimg 等防盗链图床的 src 经 `appHost.http` 带站内 Referer 拉取 → Blob URL 显示
    (`<img>` 原生加载 Referer 固定为页面源,空/错 Referer 均 403)。规则表 host 层
    `mediaReferrerFor` 唯一权威,ui 不写死域名。Rust 自定义协议方案(伪 scheme + 安全
    洞)评估见 `docs/image-loading-referrer.md`
- ui 包依赖：`clsx`（拼类）;lucide-react 只在 desktop，ui 包图标用自包含内联 SVG
  （`renderers/atoms/icons.tsx`）
- **player 独立包**：播放器已拆到 `@tauri-playground/player`(见目录结构)。
  ui 的 `index.ts` re-export 保持旧入口;新代码直接引 player 包。
  desktop `styles.css` `@source` 需同时扫 ui/src + player/src(拆包后补过)
- **IntelliSense**：ui/player 包各有一个 dev-only `src/styles/tailwind.css`
  （`@import "tailwindcss"` + `@source "../"`）,不进 bundle,给 VSCode 插件识别类名

**4. 阅读体验**
- ✅ 文章详情已落地（ArticleDetail:HTML 渲染/正文/pre 纯文本/已读/星标/打开原文）
- 图片懒加载 / 阅读进度等仍可加强

### Demo 之后（产品化）

- react-query 数据流 + 无限滚动（列表化内容不再一次性全量；MediaList 当前用
  IntersectionObserver + PAGE=50 本地切片）
- 三模式 UI：三分栏 ✅ / 瀑布流 / 短视频（technical-plan 的 P2–P4;三分栏已实现）
  - ⚠️ **live 源是 1:1、其他源是 1:N 的错位**：live 单房间订阅在列表/瀑布流是孤条。
    设计记录见 `docs/technical-plan.md`「live 源与产品形态的错位」——倾向 **B 分组聚合**
    （core 层把同 kind 的 live 订阅合成混合 feed），C 分区/搜索聚合（发现流，参考
    `tmp/dart_simple_live`）后补。瀑布流/短视频前需定稿
- mobile 接入 appHost + core（当前还是 Tauri 模板）
- **source 缓存（core 层）**：crawler 的 `getSource` 是纯函数（每次新实例）。
  若要「同参复用实例 / 去重刷新」，在 core 编排层按 `channelKey + info` 持 Map 实现
  （与 `RssChannel.sourceInfoTpl`/`defaultInfo` 参数体系相关，见 `packages/core/src/data-layer.ts`）
- 离线缓存 + SQLite（P6）
- **浏览器模拟落地(feat/browser-sim,2026-08)**:Tauri spawn 系统 Edge + CDP
  (appHost.browser 门面 + browser_ensure/browser_close command + crawler
  browser/cdp.ts)。weibo:user 实测通;xhs:user 匿名 406 待登录态(Edge profile
  扫码一次或注入 cookie)后验证签名路径。edge-profile 登录态持久化在 appData;
  应用退出 browser_close 需确保调用(desktop 生命周期钩子)。
