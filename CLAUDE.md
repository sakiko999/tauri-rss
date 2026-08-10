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
                   给纯前端调试；tauri/ Rust http_get+localStorage 给生产）
  crawler/       ★ @tauri-playground/crawler — 订阅源抓取层（producer 的重构替代）。
                   一切皆 RssChannel：channel 直接 implements RssChannel(+ 能力接口
                   RssVideoChannel/RssLiveChannel),getSource 用组合工厂(factory.ts)
                   装配——纯函数,每次返回新 source,缓存/去重归 core。直出 RSS 2.0 + tpl:
                   XML 字符串。XML 即天然类型,不导出数据模型类型。依赖 **ramda** 0.32
                   （+ @types/ramda devDep）——嵌套解析/排序用 chain/sortWith/pathOr
                   函数式展开(范式见 bili/live.ts 的 parseBiliLiveStreams)
  core/          @tauri-playground/core — 订阅维护者。基于 crawler 输出维护订阅列表 + 分组
                   + 刷新编排 + 持久化。自解析 XML 建 MediaItem（不依赖 crawler 类型）
  ui/            @tauri-playground/ui   — UI 组件库（当前仅按 kind 分发的媒体渲染器）
```

依赖链：`xml ← crawler ← core ← ui ← desktop`；`host` 被 crawler/core/desktop 共用。
读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装。

## 宿主注入：全局 appHost 门面

宿主能力（http / js 签名执行 / storage / now / log）经**全局 `globalThis.appHost`** 注入：

- **正常流程**：应用启动时 `injectTauriHost()`（desktop 在 `main.tsx`）。
- **example / 测试**：`injectNodeHost()`（Node fetch + 内存存储）。
- **纯前端调试**：`injectBrowserHost()`（浏览器 fetch，CORS 受限）。

门面在 `@tauri-playground/host`（`packages/host/src/runtime.ts`）——import host 包即初始化；
字段是 getter，未注入时访问 `http/js/storage` 抛清晰错误，`now/log` 兜底。类型声明在
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
bun run packages/crawler/src/example/list_sources.ts      # 每个 channel 实例化 source
bun run packages/crawler/src/example/sample_sources.ts live:   # 抽样 fetch，filter=live: 只看直播
bun run packages/crawler/src/example/resolve_play.ts bili:popular  # 懒解析可播流(视频)
bun run packages/crawler/src/example/resolve_live_play.ts bili:live 6  # 懒解析直播流(直播)

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
  archive(视频)分支;转发展开 `orig` 被转内容。实测半佛 37883317(转发为主)、
  DIYgod 2267573(视频为主)。
- 热门平台判定：YouTube 走官方 RSS 可直接用；bilibili 走 API 可复刻；微博/X/小红书
  是硬反爬（puppeteer+登录+代理），个人不部署 RSSHub 碰不了。
- **bilibili 登录档位**：`packages/core/src/bilibili-cookie.ts` 存默认 cookie（gitignore +
  空占位提交 + skip-worktree 保护,见 `.example`），`settings.bilibiliCookie` 作 core 层
  默认值,data-layer `sourceInfoFor` 合并到所有 bili 订阅解锁登录档位。改本地 cookie:
  编辑该文件 → `git update-index --no-skip-worktree` 再改,勿提交真实值。

## 调研文档（tmp/ 参考仓库）

- **弹幕获取机制**：`docs/danmaku-research.md`。B站视频弹幕 = 零摩擦入口
  （`bvid→cid→GET /x/v2/dm/web/seg.so?oid&segment_index`,protobuf、6min/段、**匿名可用**）,
  是弹幕 MVP 首选;直播弹幕全是 WS 长连接(bilibili 16B 大端头+brotli、douyu STT、huya Tars、
  douyin protobuf+QuickJS 签名),**host 层目前只有 HTTP 是缺口**。proto `progress` 是毫秒,
  XML 弹幕是秒,与 currentTime(秒)换算勿混淆。
- **Folo 架构**:`docs/folo-architecture-research.md`。分组=subscriptions 表 `category` 字符串
  + 按 siteUrl 域名自动归类;`Transaction` 四段式乐观更新(store→request→rollback→persist)
  最值得抄。它是云端聚合架构(抓取在服务端),我们 crawler 本地抓取不能照搬;
  iframe 嵌入播放差于我们 hls/flv/dash 直链解析,不抄。

## 下一步 Todo（阶段性任务）

### Demo 必选（按建议顺序）

**1. 媒体播放闭环（demo 差异化价值）**
- `packages/ui/src/player/` 已落地：`useMediaStream`（hls.js/flv.js/dash.js 生命周期）+
  `MediaPlayer`（按 format 选流分发）+ `PlayableMedia`（懒解析+播放），video/audio/live 共用。
  **控件是 MediaChrome 式独立组件**（`controls/`,窄接口 `{state, ops}`、可自由组合）:
  `MediaPlayButton`/`MediaMuteButton`/`MediaVolumeSlider`/`MediaTimeRange`/`MediaRateButton`/
  `MediaQualityButton`/`MediaFullscreenButton`/`MediaLiveEdgeButton`/`MediaTimeDisplay`;
  `PlayerControls` 是默认组合（等价 `<media-control-bar>`）,`VideoShell` 外壳管
  自动隐藏/键盘快捷键/全屏/缓冲/点击播放暂停。状态中枢 `useVideoElement`
  （监听 11 媒体事件 → state + ops）。倍速/档位菜单用 **radix primitive**
  （ui 包装全量 26 个,desktop 只留 dialog）
- ✅ 已通：Audio（mp3 原生）、douyu 直播（flv.js HTTP-FLV）、bilibili 直播（hls.js + avc 过滤）、
  huya 直播（flv.js HTTP-FLV）、douyin 直播（flv.js HTTP-FLV,5 档）、bilibili 视频
  （dash.js 双 SourceBuffer,DASH 1080P 有声）、YouTube 视频（原生 mp4 直链）、
  **YouTube 直播（iOS client → hlsManifestUrl,hls.js 播;ANDROID 直播不返回 HLS,必须 iOS）**
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
- ⚠️ YouTube DASH-only 直播（如 Claude FM `tRsQsTMvPNg` 当前形态）：iOS 不返回 hlsManifestUrl、
  只有 adaptiveFormats（音视频分离）→ 仍降级 `format:"web"` 打开页面。已知边界,
  见 `docs/youtube-stream-extraction.md` 5.5
- YouTube 直链实现见 `docs/youtube-stream-extraction.md`（InnerTube ANDROID client,
  渐进式 mp4 无签名无 n 参数,clientVersion 必须最新 21.03.36;旧版会 400/UNPLAYABLE;
  直播加 iOS client `getIosPlayerResponse`,live 判定看 `playabilityStatus.liveStreamability`;
  ANDROID/WEB/iOS 请求端点统一走 gapis `youtubei.googleapis.com` + t/id 参数,NewPipe 同款;
  ⚠️ node/example 环境被 YouTube IP 风控(LOGIN_REQUIRED),Tauri 设备环境正常）
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
- ⚠️ 分组树仅渲染/展开,不做增删组 UI;分组节点点击只 toggle 不 select

**3. packages/ui 接入 tailwind**
- 目前 renderer 全是内联 `style={styles}` CSSProperties；desktop 已接 `@tailwindcss/vite`
  （v4 CSS-first），ui 包本身没有 tailwind 依赖
- 计划：给 ui 包加 tailwind（@theme 设计令牌在 `packages/ui/src/styles/theme.css`，见
  `technical-plan.md` 的 Tailwind 4 接入节——`@source` 显式扫包源码、styles.css 引入 theme.css）
- 注意：与 #1 有交叉（renderer 都要改），可合并推进

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
