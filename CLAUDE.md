# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。

桌面 = **订阅工作台**（抓取/播放/管理全功能）；移动 = 待接入的模板。
两端定位分离：desktop 数据供给走独立爬虫服务（承载重反爬平台），mobile 保持内置
crawler 仅有限平台。决策见 `docs/desktop-crawler-service.md`。

## 目录结构

```
apps/
  src-tauri/   唯一 Rust crate（tauri-app），双端共享 commands/plugins
  desktop/     React 19 + Vite + Tailwind 4，产物 → dist/desktop
               形态 = 订阅工作台：rail 侧栏（内容类型/智能订阅/分组树）+ 五视图
               reader 三栏 / media 网格 / hot 热搜两栏 / page 整页 / player。
               状态 src/store/（nodes 节点语法 · selectors 派生查询 · prefs 表现型偏好 ·
               index 动作编排），视图 src/views/，卡片 src/components/cards.tsx。
               位置权威 = URL（/v/:nodeId、/play/:itemId）
  mobile/      React 19 + Vite，产物 → dist/mobile。⚠️ 仍是模板，勿当实现参考
  cli/         ★ 调试探针（Bun + cac 零构建）。channels/fetch/item/play/dm/hot/
               align/env/refresh 收编全部 example；宿主 = node 后端 + bun:sqlite
               （apps/cli/.data/rss.db）。详见 docs/cli-plan.md
packages/
  xml/         ★ RSS 2.0 + tpl: 编解码（fast-xml-parser v5）。唯一持有该依赖
  host/        ★ 宿主后端 + 全局 appHost 门面（runtime.ts）。
               node/ 真实网络+内存存储 · browser/ fetch+localStorage · tauri/ Rust
               http_get+ws_connect+sqlite+opener。ws 统一走宿主隧道（可带自定义握手头）
  resolve/     ★ 平台解析层。platform/（各平台 client + 播放解析 + 弹幕 codec）、
               resolver/（by-url 路由 → 播放/弹幕）、danmaku/（createWsStream/
               deferredStream 原语）、utils/、browser/（CDP 模拟）。
               契约：按 item.url 懒解析 + 平台 client 供 crawler 取数。类型自持，不依赖 crawler
  crawler/     ★ 订阅源抓取层，**只输出订阅数据**。一切皆 RssChannel：channel 定义 +
               getSource → { fetch }，取数经 resolve 的平台 client。
               不绑定流/弹幕解析（归 resolve by-url）。输出标准 RSS + 最小 tpl:kind/total
  core/        订阅维护者。基于 crawler 输出维护订阅/分组/刷新编排/持久化；
               自解析 XML 建 MediaItem（不依赖 crawler 类型）
  player/      ★ 媒体播放器（video/audio/live 共用）。PlayableMedia = 唯一入口
               （懒解析 + 选流 + 分发）+ VideoShell/AudioShell 外壳 + MediaChrome 式
               独立控件（controls/）。依赖 core 类型 + appHost 隧道 + hls/flv/dash.js
  log/         ★ 域注册语义化日志（零依赖叶子包）。createLogDomain(name,{color,ansi,events})
               → 每模块自己的域 + 模板事件；开关 log="0" 全局关 / log:<域>="0" 按域关
  ui/          ⚠️ **只剩原子件在用**：desktop 仅引 MediaImage（防盗链隧道）与 fmtCount。
               UnifiedCard / MediaItemView / 各 *Renderer **已删**（2026-10-12），
               只留 renderers/atoms/{MediaImage,format,Skeleton,icons}.tsx
```

依赖链 `resolve ← crawler ← core`，播放支线 `core ← player`，`ui` 是原子件；
`log`/`host` 是零依赖叶子。读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装。

⚠️ **crawler→core 的唯一通道是 XML（`serializeFeed`→自解析）**：core 用自解析 XML 建 MediaItem，
不经 crawler 类型。故 **channel 设的每个字段若要到达 UI，serialize 必须写、deserialize 必须读**
——两边漏一个就静默丢。曾只写 `tpl:kind`，导致 Live 的 `liveStatus`/`online`/`platform`、
Video 的 `channel`、Audio 的 `artist`/`album`、Social 的 `likes` **全丢**（实测 174 条 live 全
`liveStatus="unknown"`、`online` 恒 undefined、「X 人在看」全平台不显示、YouTube 直播 platform
被 URL 兜底误判为 bilibili）。回归守卫：`serialize-roundtrip.check.ts`。

## 宿主注入：全局 appHost 门面

宿主能力经全局 `globalThis.appHost` 注入，门面在 `packages/host/src/runtime.ts`
（import 即初始化）。类型声明在根 `global.d.ts`，经 `tsconfig.app.json` 的 `files` 传递。

- **注入**：desktop `injectTauriHost()`（main.tsx）· example/测试 `injectNodeHost()` ·
  纯前端调试 `injectBrowserHost()`（CORS 受限）
- **必填**：`http` / `js`（签名脚本执行）/ `storage`。未注入时访问抛清晰错误
- **可选**（未注入返回 undefined，消费侧据此降级）：`ws`（弹幕隧道）、`browser`（CDP 模拟）
- **兜底**：`log`（console）、`now`（Date.now）
- **`openExternal(url)`**：打开外链。⚠️ 桌面必须走它（Tauri opener 插件）——
  WebView 会拦掉 `window.open`，表现为「点了没反应」
- **`imageProxy` / `dataSaver`**：渲染管线开关（AppSettings 的镜像，ui 的 MediaImage
  直读，避免层层传 props）。由 app 层在设置变化时写入

**storage 三态**：desktop `SqliteStorageBackend`（tauri-plugin-sql，appData/rss.db，
首次访问自动从 localStorage 搬迁）· CLI `sqliteStorage`（bun:sqlite）· example 内存版。
**DDL 唯一权威 = core `db/schema.ts`**（两端共用，插件自带的 migration 机制不用，防漂移）。

**内容缓存**：refresh 走 TTL 缓存（KV key `content:<subId>`，value = `{fetchedAt, xml}`）
——TTL 内命中跳过网络抓取（防反爬源被打）。TTL = 订阅级 `refreshIntervalSec` 优先，
否则 `settings.refreshIntervalMin`（默认 30min）。`refresh(id, {force:true})` 强制抓取
（手动刷新 / CLI 默认）；抓取失败回退旧缓存不空窗；退订一并删缓存。
`packages/core/src/repo/content-cache-repo.ts`。

## 关键命令

```bash
bun run dev / tauri / tauri:build   # 纯前端 / 完整应用热重载 / 前端+release 构建
bun run scripts/tauri.ts help       # 全部用法

# CLI 调试探针（收编全部 example；详见 docs/cli-plan.md）
bun run rss channels                    # 渠道注册表（--kind/--json）
bun run rss fetch bili:popular          # 单渠道抓取（--xml/--json）
bun run rss item <url>                  # by-url：路由 + streams 全档位 + 弹幕元信息
bun run rss play <url> --open           # 解析直链，--open 丢系统播放器
bun run rss dm <url> -s 5               # 弹幕：VOD 样本 / 直播窗口统计
bun run rss hot <词>                    # 热搜词下微博流（需登录 cookie）
bun run rss detail [url|--latest]       # xhs 单条详情补全（匿名 noteDetail）
bun run rss env --probe                 # appHost 门面自检
bun run rss refresh <key>               # core DataLayer 编排冒烟（SQLite 持久化）
bun run rss align                       # crawler/rsshub 同构断言

# 自检脚本（仓库无测试基建，用最小断言）
bun packages/core/src/example/media-store.check.ts      # 查询分支（分组聚合等）
bun packages/core/src/example/data-layer.check.ts       # 停用不抓取 / reading 回填 / 空抓取不丢内容
bun packages/core/src/example/repo-concurrency.check.ts # 仓储并发写不互相覆盖（丢数据护栏）
bun packages/host/src/example/host-check.ts             # 门面字段（openExternal/imageProxy）
bun packages/core/src/example/serialize-roundtrip.check.ts  # crawler→core 序列化边界（tpl 字段不丢）
bun packages/xml/src/example/opml.check.ts              # OPML 编解码往返（分组层级）
bun apps/desktop/src/lib/opml.check.ts                  # OPML ↔ 订阅映射（导出过滤 / 导入去重）

# UI 交互巡检（连到正在运行的 dev 实例；需 `bun run tauri`，9222 已由 dev 配置开启）
bun scripts/ui-probe.ts goto tab:all        # 导航 + 巡检（逐字竖排 / 溢出 / 遮挡 / 破图）
bun scripts/ui-probe.ts audit               # 只巡检当前页
bun scripts/ui-probe.ts eval "<js>"         # 在页面里求值（量真实 DOM / 计算样式）
bun scripts/ui-probe.ts click "<selector>"  # 可信鼠标点击（悬停→按下→抬起）
bun scripts/ui-console.ts                   # 遍历各视图，捕获 React 告警 / 未捕获异常
bun scripts/ui-design-audit.ts              # 量化设计审计：对比度(WCAG) / 点击区 / 字号 / 间距节奏
bun scripts/ui-shot.ts tmp/shots            # 给各模块截图存档（用于视觉复核）
bun scripts/ui-resize.ts 1500 950           # 改窗口尺寸（验证响应式断点）

# 浏览器模拟（先起干净 Edge，见 edge-cdp skill；脚本自连 CDP，零额外依赖）
bun packages/crawler/src/example/browser-sim.ts weibo:user   # 或 xhs:user（低频防风控）
```

产物输出到根 `dist/<platform>/`（Vite outDir；tauri.conf 的 frontendDist 指过去）。
CLI 首次运行需 `apps/cli/.data/` 目录存在（gitignore，bun:sqlite 不会自建）。

## ⚠️ 环境要求

**必须从 "x64 Native Tools Command Prompt for VS 2022" 启动终端**，否则 Rust 链接失败。

- **Git Bash 的 `/usr/bin/link` 抢 MSVC** → 报 `/usr/bin/link: extra operand`。
  确保 MSVC 的 `bin\Hostx64\x64` 在 PATH 最前（Native Tools 启动即前置）。
  Bash 工具调用间 env 不持久，每次 cargo 命令前内联 `export PATH`。
  **不要在 `.cargo/config.toml` 里写死 linker**（硬编码 MSVC 版本，VS 更新必坏）。
- `cargo test/build` 前若 tauri-app.exe 仍在跑会锁二进制报 `拒绝访问 (os error 5)`，
  先 `taskkill //F //IM tauri-app.exe`。增量编译偶报同错，无害，忽略。
- tsc 用根 `./node_modules/.bin/tsc -p <项目>`；**不要** `npx tsc`（会误装 tsc@2.0.3），
  **不要**裸 `-p tsconfig.app.json`（扫全仓含 tmp/ 噪声）。
- ⚠️ **改源码一律用 Edit/Write，不要用 PowerShell `Set-Content -Encoding utf8` 整份重写**
  ——中文/UTF-8 会按代码页往返损坏成乱码（曾一次弄坏 4 个文件）。
- **Git 身份未全局配置**，提交需内联：
  `git -c user.name="zhh" -c user.email="zhonghuaremistinker@gmail.com" commit -m "..."`
- `tmp/` 是 gitignore 的参考项目（RSSHub / MediaCrawler / dart_simple_live / producer /
  NewPipe 等），**不要对它跑构建/测试**。

## 平台现状与坑

**bilibili**
- **wbi 签名零登录可复刻**：`GET /x/web-interface/nav` 未登录（code:-101）仍返回
  `data.wbi_img`，无需 cookie/puppeteer，纯 `MD5(排序参数&wts&mixinKey)`。
  换位表 `MIXIN_KEY_ENC_TAB` 与 live 层同源
- **bili:dynamic**（`channels/bili/dynamic.ts`）：`GET /x/polymer/web-dynamic/v1/feed/space?host_mid={uid}`
  （⚠️ 非 dynamic_new——那个返回关注流）。**需登录 cookie**。转发展开 `orig`
  （⚠️ `module_dynamic` 在 `orig.modules.module_dynamic` 下，非 DynModule 层级）。
  实测 uid：半佛仙人 37663924（⚠️ 37883317 是「DILI念」勿用）
- **直播档位按实际值标注**：B 站对访客降档——匿名请求 `qn=10000`（原画）实测只给
  `current_qn=250`（超清），且多档请求会收敛到同一值。故读 `current_qn` 标注并按实际值去重
- **按分区列房未做**：`second/getList` 需登录，匿名带 buvid3/wbi 实测仍 `-352`。
  分区树走 `Area/getList`（匿名可用，已实现未挂 channel）
- **扫码登录**：纯 HTTP（`passport.bilibili.com` qrcode/generate + poll），不需
  `appHost.browser`。⚠️ 上游只给**二维码内容 URL**，编码在 UI 侧（`QrImage`）；
  `biliScanLogin` 必须复用已生成的码，否则它会自己再生成一个、轮询的 key 与你展示的不是同一个

**斗鱼 / 虎牙 / 抖音**
- **douyu `rate` 是档位 ID 不是清晰度** —— 按 rate 降序会把原画 2K60 排到末尾。
  保留服务端 multirates 顺序
- **huya**（`resolve/platform/huya/play.ts`）：数据源 `mp.huya.com/.../profileRoom` JSON API，
  flv+hls 双协议 × 多 CDN × 全档位，`multiLine[].url` 已含签名（`buildAntiCode` 已删）。
  ⚠️ **低档位只产 HLS**（`ratio=` 切档）；`ratio=` 低档 flv.js 播几秒断
- **douyin**（`channels/douyin/index.ts`）：enter API ABogus 签名 → `stream_url`。
  ⚠️ `liveStatus ==2` 才是直播中（`==4` 是 roomId 一次性，需换 webRid）
- **发现层**（分区/搜索，`resolve/platform/*/discover.ts`）：douyin 三路搜索只
  `partition/search` 匿名可用且只认游戏名级——但**顶层分区名恰是大类词**（舞蹈/音乐/聊天/
  二次元…），故 resolve 侧做「上游命中 ∪ 本地分区树 title 匹配」，0 → 20 条。
  ⚠️ **匿名搜抖音无解已用真实 Edge 复核**（路 1/2 仍 2483，搜索页被 verify-center 4031 拦）：
  登录硬门槛，**browser 模拟解不了**（xhs 是 TLS 指纹差异能解，抖音是账号门槛不能）。
  虎牙搜索/搜主播不可分页；抖音搜主播未做。缺口见 `docs/capability-gaps.md`

**YouTube**（`docs/youtube-stream-extraction.md`）
- 主力 client = **ANDROID_VR**：2026-08 起 ANDROID/IOS 标准 client 在部分 IP 触发
  poToken（LOGIN_REQUIRED）。⚠️ poToken 风控是**部分 IP 特性**，与 node/tauri/browser
  环境无关。端点走 gapis `youtubei.googleapis.com`
- 渐进式只到 itag 18（360p）→ **视频 1080p 走 DASH**：adaptiveFormats 自拼 SegmentBase
  MPD（共享 `utils/mpd.ts`）。360p 不混进返回数组（默认选流会落 360p），DASH 装配失败才 fallback

**小红书**（细节见 `docs/xhs-signature-research.md`）
- 主分支**全 SSR**：`xhs:explore` 匿名稳定可用；**`xhs:user` 必须登录态**（匿名 SSR
  渲染卡片但 noteId 被抹空 → 0 条）；**笔记详情页匿名可用**，但**必须带列表项的
  xsec_token**（`tpl:xsecToken` → `SocialItem.xsecToken` → `resolveDetail`）
- ⚠️ 登录态 SSR 的 JSON 混入 JS 表达式（`"noteDetailMap":new Map([])`）——
  `extractInitialState` 用**平衡大括号截纯 JSON** + 空容器归一
- ⚠️ **不要手拼 user_posted fetch**（页面内 `_webmsxyw` 只返回部分头 → 300011 风控）。
  `xhs:user` 分页是**滚动驱动**（浏览器路径），已加窗口化 + 验证码检测
- 签名库 xhshow 在 **feat/xhs-rustpython** 分支（主分支含则触发风控与维护成本）；
  纯算法当前处于上游失效期，故维持全 SSR

**cookie / 登录**
- `packages/core/src/bilibili-cookie.ts` 三个 `DEFAULT_*_COOKIE` 默认**全空**（纯匿名）。
  匿名行为：bili 视频列表稳定、直播 250 超清封顶；weibo 热搜列表可用但 user/词流需登录；
  xhs explore/详情可用、user 需登录
- 恢复登录：填真实 cookie → `git update-index --no-skip-worktree` 再改，**勿提交真实值**
  （文件有 skip-worktree 保护 + 空占位模板 `.example`）
- 扫码登录是 **channel 级能力 `Loginable`**（平台级操作，不依赖 info 实例化）。
  `emitQr` 载荷语义：`data:image/...`（浏览器路径已编码）**或**待编码文本（纯 HTTP 路径）

## 播放

**选流契约**：crawler 保证返回数组内**最高清晰度排最前**（bili/youtube/douyin/huya 显式
按 rate 降序；douyu 例外见上）。player `useStreamSelection` 取第一个，不做二次排序
（渐进式优先=原生可播最稳，其次 hls/flv）。

- **HLS/DASH 锁最高档**（`currentLevel=max`，ABR 关闭）。原因：宿主隧道的固定开销
  （Rust reqwest + base64）让 ABR 带宽估算失真（1080p 实测仅 ~1Mbps），自动降档会骤降
  144p 永不回升。`defaultQuality: "auto"` 因此**不做**，设置页只留只读的「锁最高档」
- **带声自动播放**：`unlockAudioPlayback()` 必须在**用户手势的同步调用栈内**调
  （不能挪进 effect）。原生 mp4 分支要**等 `canplay` 再带声 play** —— src 刚设立即 play
  媒体未加载，易被 policy 判断失败而降级静音
- ⚠️ desktop 若自定义 `additionalBrowserArgs`（Windows）会**覆盖** wry 默认 args，
  必须显式带上 `--autoplay-policy=no-user-gesture-required`，否则带声播放回归静音
- ⚠️ **CDP 调试端口 9222 只在 dev**：`tauri.conf.json` 不带它（release 构建会带 = 发布版
  开无鉴权远程调试口，本机任意进程 attach 后可读改 cookie）；dev 用
  `scripts/tauri.ts` 叠的 `tauri.conf.dev.json`（`bun run tauri` 自动带上）
- ⚠️ **player 包一律方角，圆角归外部**：`VideoShell`/`PlayerControls`/`PlayableMedia`
  的 MediaState **都不自带 border-radius**（曾经三处各写死一档 `rounded-xl`/`rounded-b-lg`
  /`rounded`，互相错位）。圆角与裁切由**消费方**决定——desktop 在 `PlayerPage` 里用
  一层 `<div className="overflow-hidden rounded-xl">` 当舞台框（`overflow-hidden` 负责把
  方角 video/控件裁到圆角里）。内嵌到任何容器都不该假定圆角档位

## 弹幕（细节见 `docs/danmaku-research.md`）

四平台直播弹幕已全通（bili 16B 大端头+zlib、douyu STT、huya Tars、douyin protobuf+gzip），
B站视频弹幕走 `bvid→cid→GET /x/v2/dm/web/seg.so`（protobuf，匿名可用）。

- **统一走宿主隧道 `appHost.ws`**（Rust ws_connect）。⚠️ ws.rs 的 `ws_connect` **必须
  用 `req.url.as_str().into_client_request()` 从 URL 构造完整请求再插自定义头** ——
  手动 `http::Request::builder()` 缺 `Sec-WebSocket-Key`，握手报
  "Missing...sec-websocket-key"
- ⚠️ **bili 直播弹幕匿名可用**：uid=0 + 匿名 buvid3（`biliClient.anonBuvid3()`）即可。
  **buvid3 = cookie 有则取 cookie、否则取 anon** —— 曾误判「匿名被 1006 拒」，
  真实原因是匿名时 buvid3 为空。认证走 WS 帧 op=7（**不带 cookie header**，
  否则触发隧道握手被拒）；host 的 `wss_port` 非标（常见 2245）**必须拼端口**
- ⚠️ **连接释放竞态**：`createWsStream` 的 onOpen **必须检查 `stopped`** —— 退订后
  握手才完成时会泄漏连接（关闭直播间弹幕不释放）。「异步 setup → 建流」的拦截统一收敛进
  `deferredStream`
- ⚠️ **douyin**：签名脚本须用 2024 修改版 webmssdk.js（`get_sign`；2023 版已失效→415），
  执行环境须遮蔽 node 全局（否则走 node 分支指纹被拒）；enter 用 QQBrowser UA、
  WS 用 Chrome 150 UA。proto `progress` 是毫秒，XML 弹幕是秒

## 其他约定

- **可播判定 = kind 门控**：只有 `video`/`audio`/`live` 有可播流，`article`/`social`
  不是。卡片的整卡点击与播放按钮都走 `cards.tsx` 的 `isPlayableKind`——article 显示
  0 个播放按钮、点击进「打开文章」（`tab:article` 三栏读），social 进详情弹窗。
  ⚠️ 曾漏掉 article：点一下掉进「该条目不指向可解析的视频链接」的破碎播放页。
  ⚠️ 新增「播放」入口（卡片/命令面板）一律经 `usePlayerNav` 收口
- **侧栏窄栏隐藏列表必须两份对齐**：`styles.css` 里 `.rail.rail-collapsed`（手动折叠）
  与 `@media (max-width:1080px)`（窄窗）各有一份 `display:none` 清单，**逐项必须
  一致**（`nav-label`/`nav-count`/`nav-warn`/`rail-empty`/`group-empty`/…）。曾漏掉
  `group-empty` → 空分组提示文案在 64px 栏里被压成逐字竖排
- **图片防盗链**：`MediaImage` 内联 `useProxiedImage`（blob 隧道）——命中 sinaimg 等
  防盗链图床的 src 经 `appHost.http` 带站内 Referer 拉取 → Blob URL。
  规则表 host 层 `mediaReferrerFor` 是唯一权威，ui 不写死域名
- **图片宽高**：`resolve/src/utils/img-size.ts` Range 预取文件头解析（PNG 64B / JPEG 1KB），
  失败退化 4:3。XML `tpl:image` 带 `@_url/@_width/@_height`
- **social 瀑布流**用 **masonic** 虚拟化（CSS columns 追加会重排已渲染卡片）。
  ⚠️ 内层滚动容器（masonic 默认绑 window）需用 `usePositioner + useMasonry` 手动喂
  `scrollTop/height`；append 保持 positioner，refresh 重建 layoutVersion
- ⚠️ **不用原生 `<select>`**：下拉面板由 WebView/系统渲染，深色主题下弹的是**亮色
  系统菜单**且 CSS 管不到。统一用 `components/Modal.tsx` 的 `Select`（radix，自带浮层）。
  同理 `Switch`/`Menu`/`Modal` 都在那个模块。原生 `<input>`/`<textarea>` 保留（可主题化）。
- ⚠️ **加了新依赖必须重启 dev server + `bun install`**：Vite 的依赖预打包只在启动时做，
  热重载不会补新包 → `Xxx is not defined` / `Failed to resolve import` 白屏或 Vite
  error overlay。workspace 包（如 `@tauri-playground/xml`）还须先在**消费方
  package.json** 声明 `workspace:*`（desktop 曾在缺该声明时炸过：store 一 import 就白屏）。
  改完清 `node_modules/.vite` 后 `bun install` 再重启。
- **字体**：IBM Plex 自托管（`apps/desktop/public/fonts`，~136KB，离线可用）。
  Sans=UI/标题，**Serif=正文**，Mono=数字/通道号。中文回落到系统栈（字体包太大不随包）。
- **视觉基调**：暖石墨中性（色相 72/75）+ 琥珀 accent；深/浅两套同色相，改一处要改两处。
  对比度用 `scripts/ui-design-audit.ts` 复测（目标 0 处低于 WCAG AA）。
- ⚠️ **UI 自动化的 CDP target 必须按 URL 过滤**：DevTools 自己也是 `type: "page"`，
  取第一个会连到 DevTools 而不是应用页面（曾因此截了一堆 DevTools 的图当"应用截图"）。
- ⚠️ **正文里的外链必须拦截**：`.article-body` 的委托 click 命中 `<a>` 要走
  `openExternalSafely`；不拦的话 WebView 会整页导航走（应用没配 Tauri `on_navigation`），
  界面被外部网页顶掉、只能重启才回来
- ⚠️ **卡片主操作按 kind 分流**：`MediaCard` 里 `social` 走「开详情弹窗」、其余走「播放」——
  social 无可播流，误当视频播会进「不指向可解析的视频链接」的破碎播放页。
  混合 feed（全部/分组/智能订阅）里的 social 走的是 `MediaCard`（只有**整屏都是 social**
  才走 `SocialCard` 瀑布流），所以这条分流必须在 `MediaCard` 里，不能只靠 `SocialCard`。
  `usePlayerNav.onPlay` 另有一道收口兜底。
- **列表虚拟化**：网格 = VirtuosoGrid，文章列表 = Virtuoso。⚠️ 尺寸走
  `listClassName`/`itemClassName`（CSS），**不要用 `components.List/Item` 覆盖** ——
  List 的 inline style 带 virtuoso 的虚拟化偏移（paddingTop/Bottom），覆盖会让滚动定位错乱
- **首启种子订阅**在 `apps/desktop/src/subscriptions.ts`（SEED_SUBSCRIPTIONS + SEED_GROUPS）。
  ⚠️ **只在空库写入** —— 之后再启动不覆盖，否则用户 CRUD 的订阅会被启动时删掉
- **一键按类型归组**（`store/index.ts` 的 `autoGroupByKind`）先把未分组订阅按
  `channelKind` 分桶，**只为实际有成员的 kind 建组** —— 否则会留下 0 成员空分组
  （用户看着像归类失败）；带撤销（分组本身留着）
- 内置 RSS 直链清单 `packages/crawler/src/channels/rss/builtin.ts`；可用性结论见
  `docs/domestic-feed-availability.md`。新源先 curl 验证再并入（注意新浪科技带
  `xml-stylesheet`，会误判 HTML，实为真 RSS）

## 调研文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/platform-login-research.md` | 三平台扫码登录 + 保活设计（仅 bili 可自动续期） |
| `docs/danmaku-research.md` | 弹幕机制（VOD 分段 / 直播四平台 codec） |
| `docs/youtube-stream-extraction.md` | YouTube 直链（ANDROID_VR / poToken / DASH 自拼） |
| `docs/xhs-signature-research.md` | 小红书签名史与社区现状复核 |
| `docs/desktop-crawler-service.md` | desktop 爬虫服务化选型与切分边界 |
| `docs/capability-gaps.md` | 各平台能力缺口（分区/搜索/主播） |
| `docs/technical-plan.md` | 三模式 UI、live 源与产品形态的错位 |
| `docs/cli-plan.md` | apps/cli 调试工具计划 |
| `docs/sqlite-storage-research.md` | 存储三态与迁移 |
| `docs/domestic-feed-availability.md` | 国内 feed 可用性实测 |
| `docs/image-loading-referrer.md` | 防盗链图方案（含 Rust 自定义协议评估） |
| `docs/rsshub-vs-crawler.md` | RSSHub 对照结论 |
| `docs/folo-architecture-research.md` | Folo 架构调研（云端聚合，不能照搬） |
| `docs/core-auth-architecture.md` | core 认证架构 |
| `docs/mpv-playback-research.md` | 外部播放器 mpv 接入（未做） |
| `docs/mobile-cdp-feasibility.md` | 移动端 CDP 可行性（未做） |

## 下一步

- **ui 包 renderer 清理**：✅ 已完成（2026-10-12 删除全部无消费者 renderer）
- **mobile 接入** appHost + core（当前仍是模板）
- **desktop 爬虫服务化**：形态待选型（倾向自研 sidecar）——切分边界与落地清单见
  `docs/desktop-crawler-service.md`
- **三模式 UI**：三分栏 ✅ / 瀑布流 / 短视频。⚠️ live 源是 1:1、其他源是 1:N 的错位，
  倾向分组聚合，设计见 `docs/technical-plan.md`
- **续播与阅读进度**：✅ **续播已完成**（`setPosition` 有消费者了）。`MediaItem.positionSec`
  由 core `applyReadingState` 从 reading 回填（与 isStarred 同款）；playback 侧
  `PlayableMedia` 的 `startAtSec` 起播跳转（≤3s 不跳）+ `onProgress` 上报，store
  `savePosition` 节流（<5s 不写）+ 近片尾清除；卡片 `.card-progress` 进度条。
  ⏳ `setScrollRatio`（文章阅读进度）**仍无消费者**
- **OPML 导入导出**：✅ 已完成（设置→订阅与分组）。编解码在 `packages/xml/src/opml.ts`
  （唯一持有 fast-xml-parser 的包），订阅映射在 `apps/desktop/src/lib/opml.ts`。
  导入落 `rss:url` 通用直链（register.ts 新增）；导出只含带 URL 的 rss/rsshub 订阅。
  ⚠️ 搜索渠道（bili:search 等）无独立 feed URL，**不在导出内**（若要需按关键字重建）
- **自动保活**（未做，仅 bili 可行）
