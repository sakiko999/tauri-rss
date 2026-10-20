# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。

桌面 = **订阅工作台**（抓取/播放/管理全功能）；移动 = **极简看内容**（未读列表 →
播放/阅读，已接 appHost+core，不做工作台）。
两端定位分离：desktop 数据供给走独立爬虫服务（承载重反爬平台），mobile 保持内置
crawler 仅有限平台。决策见 `docs/desktop-crawler-service.md`。

## 目录结构

```
apps/
  src-tauri/   唯一 Rust crate（amoeba），双端共享 commands/plugins
  desktop/     React 19 + Vite + Tailwind 4，产物 → dist/desktop
               形态 = 订阅工作台：rail 侧栏（内容类型/智能订阅/分组树）+ 五视图
               reader 三栏 / media 网格 / hot 热搜两栏 / page 整页 / player /
               shortvideo 短视频全屏流（节点 `short:<kind>`，Rail「模式」入口）。
               状态 src/store/（nodes 节点语法 · selectors 派生查询 · prefs 表现型偏好 ·
               index 动作编排），视图 src/views/。
               ⚠️ **样式拆成 src/styles/ 下的区块文件**（2026-10-15，原 styles.css 3858 行）：
                 `styles.css` 只留**入口与 @import 顺序**（顺序即层叠顺序，别按字母重排）；
                 `styles/10-tokens` 令牌+@theme · `15-base` 基础层/通用工具 ·
                 `20-shell` 外壳/侧栏 · `30-controls` 控件 · `40-pane`/`45-main` ·
                 `50-shortvideo`/`55-player` · `60-pages` · `70-overlays` 浮层 · `90-responsive`。
                 加样式先判断属于哪个区块。⚠️ **注释里别写类名通配**（星号紧跟斜杠那种）
                 —— 那串字符是注释结束符，会提前终止注释块、把后面文字变成裸 CSS。踩过两次。
               Tailwind 动效工具类：`10-tokens` 有**独立的非 inline `@theme` 块**注册
                 `--animate-*` / `--ease-*`（→ `animate-rise` / `ease-decel`）。
                 ⚠️ 三条实测：① `--animate-*` 放进 `@theme inline` **不注册**；
                 ② `keyframes` 与 `--animate-*` 必须**同块**且该块不能带 `inline`；
                 ③ Tailwind 4 **没有 `--duration-*` 命名空间**，`duration-*` 只吃裸数值。
               位置权威 = URL（/v/:nodeId、/play/:itemId）
               ⚠️ **组件按「功能件 / 业务件」分层**（2026-10-14 拆分）：
                 `src/components/*.tsx`        = 功能件，**纯 props、不碰 store**
                   Icon · Modal(Menu/Switch/Select) · StateBlock · NavRow · QrImage · BootSkeleton
                 `src/components/app/*.tsx`    = 业务件，读 useDesktop/usePrefs 或吃 domain 类型
                   Rail(+RailGroupTree) · TitleBar · Toaster · SocialDetailModal ·
                   MasonryGrid · LoadMoreFooter · Cards · ListRow
               判据就是「有没有 `useDesktop`/`usePrefs`/`@amoeba/core` 类型 / domain 常量」。
               往 components/ 加新组件前先问要在哪一层；业务件一律进 app/。
               ⚠️ **文件命名统一 PascalCase**（2026-10-14 改，原 `cards.tsx`/`icons.tsx` 是小写遗留）：
               组件文件即默认导出物，大写开头；"一族组件"从**导出名**看就够，不靠文件名首字母。
               仅 `main.tsx` / `router.tsx` 这类**入口**保留小写（生态惯例）。
               **store 内的两个收敛点**（2026-10-14）：
                 `syncSubscriptions()`（index.ts）—— 订阅/分组变更后「重读 + 重绘」的唯一入口。
                   8 处调用。⚠️ 内含 `refreshView()`，**必须先修 `selectedNodeId` 再调**
                   （退订/删组时否则会拿已删 id 重算视图）；也**不要**用在 `toggleSubEnabled`
                   （启停不改内容集，多调只是白重算）。
                 `lib/useLatestOnly.ts` —— 请求世代守卫（切平台/新搜索时丢弃先发后回的旧响应）。
                   2 处消费者（PlatformBrowser / AddSubscriptionDialog）。
                   ⚠️ 走 `appHost` 隧道取数**没有可传递的 abort 信号**，只能丢弃结果、不能取消请求。
  mobile/      React 19 + Vite，产物 → dist/mobile。已接入 appHost + core：
               极简「看内容」闭环（未读列表 → 点开播放/阅读）+ **订阅管理**（RSS 直链
               添加 / 移除）；复用 core DataLayer + player PlayableMedia + ui MediaImage
               + core resolveDetail。不做频道发现（那属桌面工作台）
  cli/         ★ 调试探针（Bun + cac 零构建）。channels/fetch/item/play/dm/hot/
               align/env/refresh 收编全部 example；宿主 = node 后端 + bun:sqlite
               （apps/cli/.data/rss.db）。详见 docs/cli-plan.md
packages/
  xml/         ★ RSS 2.0 + tpl: 编解码（fast-xml-parser v5）。唯一持有该依赖
  host/        ★ 宿主后端 + 全局 appHost 门面（runtime.ts）。
               node/ 真实网络+内存存储 · browser/ fetch+localStorage · tauri/ Rust
               http_get+ws_connect+sqlite+opener。ws 统一走宿主隧道（可带自定义握手头）
               net/governor.ts 统一治理所有 appHost.http（分级/并发/RPM/冷却/去重）
  resolve/     ★ 平台解析层。platform/（各平台 client + 播放解析 + 弹幕 codec；
               twitch = 公开 GQL + usher HLS）、
               resolver/（by-url 路由 → 播放/弹幕）、danmaku/（createWsStream/
               deferredStream 原语）、utils/、browser/（CDP 模拟）。
               契约：按 item.url 懒解析 + 平台 client 供 crawler 取数。类型自持，不依赖 crawler
  crawler/     ★ 订阅源抓取层，**只输出订阅数据**。一切皆 RssChannel：channel 定义 +
               getSource → { fetch }，取数经 resolve 的平台 client。
               不绑定流/弹幕解析（归 resolve by-url）。输出标准 RSS + 最小 tpl:kind/total
               twitch/（twitch:live 频道 + twitch:hot 热门 + twitch:category 分区，
               见 docs/twitch-channel.md）
               bili/（season 合集 / series 视频列表 / favlist 公开收藏夹，均 Pageable）
               youtube/（playlist 官方 RSS + live-hot / live-category 直播页栏目）
               分区目录订阅：`twitch:categories` / `youtube:live-categories` /
               `live:douyin:categories` / `live:douyu:categories` / `live:huya:categories`
               （产 kind:"category" 条目，点开 = 预览目标分区）
               可选 channel 级能力：Pageable / HotWordSource / ItemDetailSource / Loginable
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
`log` 是零依赖叶子；`host` **依赖 core**（sqlite backend 复用其 `db/schema.ts` 的
KV_TABLE/MIGRATIONS——包管理层面 host↔core 成环，core 把 host 放 devDep）。
读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装。
（曾有例外「desktop 直引 resolve 的 `fetchDouyinSuggestions`」——2026-10-16 已删，
发现页每键联想改为手动搜索；该函数仅剩 CLI `rss sug` 消费。新直引前先问
「能否经 core 门面」。）

⚠️ **crawler→core 的唯一通道是 XML（`serializeFeed`→自解析）**：core 用自解析 XML 建 MediaItem
（item 数据不经 crawler 类型；但 core 仍 import crawler 的渠道类型 `SourceInfoField` 与运行时
`registerAllChannels`/`isXxxSource`/`httpText`）。故 **channel 设的每个字段若要到达 UI，
serialize 必须写、deserialize 必须读**
——两边漏一个就静默丢。曾只写 `tpl:kind`，导致 Live 的 `liveStatus`/`online`/`platform`、
Video 的 `channel`、Audio 的 `artist`/`album`、Social 的 `likes` **全丢**（实测 174 条 live 全
`liveStatus="unknown"`、`online` 恒 undefined、「X 人在看」全平台不显示、YouTube 直播 platform
被 URL 兜底误判为 bilibili）。回归守卫：`serialize-roundtrip.check.ts`。
✅ **修复后实测**（2026-10-13）：观众数**全平台打通**——162 条 live 中 159 条有在线数
（此前仅 15，全是抖音）——bili 59万 / 斗鱼 303万 / 虎牙 436万 / 抖音；YouTube 直播 platform 正确。
**加新字段务必同时改 serialize + deserialize 两侧，跑 roundtrip.check。**

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
- **`net`**：网络治理门面（`configure` / `reportRisk` / `governorStats`）。governor 是
  host 内建能力，未注入 http 也恒可用 —— 等级/冷却/统计见下方「网络风控」

**storage 三态**：desktop `SqliteStorageBackend`（tauri-plugin-sql，appData/rss.db）·
CLI `sqliteStorage`（bun:sqlite）· example 内存版。
**DDL 唯一权威 = core `db/schema.ts`**（两端共用，插件自带的 migration 机制不用，防漂移）。

**内容缓存**：refresh 走 TTL 缓存（KV key `content:<subId>`，value = `{fetchedAt, xml}`）
——TTL 内命中跳过网络抓取（防反爬源被打）。TTL = 订阅级 `refreshIntervalSec` 优先，
否则 `settings.refreshIntervalMin`（默认 30min）。`refresh(id, {force:true})` 强制抓取
（手动刷新 / CLI 默认）；抓取失败回退旧缓存不空窗；退订一并删缓存。
`packages/core/src/repo/content-cache-repo.ts`。

## 网络风控（L0 / L1 / L2 / L3 / L9）

所有 `appHost.http` 出站都经 `packages/host/src/net/governor.ts` 的 `governedHttp`
（`runtime.ts` 的 `setHostCaps` 统一包住）：分类 → 平台冷却 → in-flight 去重 → 平台
并发/最小间隔/RPM → 全局并发。媒体/图片按 host+扩展名不计量，但仍占全局并发
（`globalMaxConcurrent`，默认 32）；播放器的 HLS/DASH loader 显式传
`policy: { metered: false }`，不靠 URL 猜。⚠️ 原生 `<img>` / 原生 mp4 不经
`appHost.http`，不在治理范围内。

- **等级统一用数字**（设置页「网络与风控」）：`0` 直通（仅调试）· `1` 入门 ·
  `2` 标准 · `3` 严格 · `9` 浏览器被动（L9 / LX）。全局默认 `AppSettings.netLevel`
  **只允许 0~3**（L9 不能一刀切套到所有渠道）；`netLevels` 同时支持**平台覆盖**与
  **channelKey 覆盖**，解析顺序 `用户渠道覆盖 → 内置渠道默认 → 平台 → "*" → 全局`。
  内置渠道默认在 `core/types/settings.ts` 的 `BUILTIN_CHANNEL_LEVELS`：
  **`xhs:user` = 9**（必须走浏览器导航读 SSR；页面内 fetch 属类别②，不算 LX）、
  **`xhs:explore` = 9**（正常路径本来就是导航 + 读页面 SSR，不构造 fetch；L9 的
  `fetchPassive` 先走 Network 捕获，拿不到缓冲回退页面 SSR，仍属被动）。
  ⚠️ 该内置规则只在 `appHost.browser` 存在时生效（移动端无 browser，回落普通等级，
  否则会永远只剩缓存）。宿主 governor 只认平台名，channelKey 只影响 core 的抓取闸门。典型配置：
  小红书平台 `9` 或仅 `xhs:user`/`xhs:explore` `9`、B站/YouTube 保持 `1`。
  旧持久化里的 `netStrict` 已移除（忽略即可）；`netLevels` 里的旧字符串 `"lx"` 会归一化为
  `9`（全局默认位置则回落 `1`）。
- **配额按等级缩放**：基准值是 `DEFAULT_NET_POLICY` 里的 L1；L2 = 并发/RPM ×0.5、
  最小间隔 ×2；L3 = ×0.25、×4。冷却时长不随等级变。
  L1 是**软限制**（bili/youtube 12 并发 / 600 RPM / 50ms；其它 8 / 300 / 50ms；
  全局 32），正常刷新/搜索/详情/解析不应感到排队——它只兜极端情况。
  `autoRefresh=false` 时**非 force** 刷新只读内容缓存（不发网络）；手动刷新/刷新全部
  走 `force:true`，不受该开关限制。
- **CDP 也要过闸**（2026-10-19）：浏览器操作不经过 `governedHttp`，xhs/weibo 的主路径
  全是导航 + 页面内 fetch。现在 `withBrowserMode(browser, mode, fn, platform)` 会在持锁后
  调 `net.browserGate(platform)`：平台冷却未到期直接拒绝，否则按「600ms~2.4s 基准 +
  0~400ms 抖动」放行（L2/L3 随等级放大）。**登录流程不传 platform** —— 冷却期仍需允许
  用户重新扫码自救。
- **L9 闸门在 core**：`data-layer.ts` 的 `doRefresh` 按渠道解析等级，`level === 9` 时
  只调 `source.fetchPassive?.()`；拿不到就回退内容缓存（即使过期），**绝不回退
  `source.fetch()`**。⚠️ 详情补全同样过闸（2026-10-19）：`core.resolveDetail` 在等级 9
  时给 `source.resolveDetail(item, { passive: true })` —— 渠道只能导航到详情页读页面 SSR，
  不构造 fetch；不支持就返回 `null`（原样返回列表 item）。`loadMore` / `previewChannel` /
  播放解析仍会主动请求。被动采集入口是 `crawler/passive/capture.ts`（只观察 CDP
  Network，`trigger` 只能导航/滚动/点击）+ `passive/buffer.ts`（内存 TTL 30min）。
  已接 `xhs:explore` / `xhs:user`（导航读 SSR，不用页面内 fetch）；
  其余渠道在 L9 下只显示缓存。⚠️ L9 对该**平台**的所有主动请求生效 —— 抓取之外的
  详情补全、播放解析也会被 governor 拒绝。⚠️ `bili:popular` **不接 L9**：B站匿名
  API 稳定，页面也不保证自然发 `/x/web-interface/popular`，被动采集没有收益。
- **渠道必须声明 L9 支持**：`RssChannel.supportsL9`（crawler，channel 级；core 投影为
  `ChannelInfo.supportsL9`）。目前为 true 的只有 `xhs:explore` / `xhs:user`；
  **未声明的渠道即使设成 9，core 也不会尝试 `fetchPassive`**，直接读缓存并如实报错。
  设置页据此**禁用未声明渠道的 L9 选项**（存量值仍显示，行 help 注明「选 L9 只会读
  缓存」）。新增被动渠道时：`supportsL9 = true` + `getSource` 提供 `fetchPassive`，
  两者缺一不可。
- **风控信号**：平台 client 命中明确信号时调 `appHost.net.reportRisk(platform, signal)`
  （bili 412/-352/-509；weibo 418/403/432/-100；douyin 4031/2483；youtube 429；
  xhs verify-box/300011）。governor 对计量请求的 412/418/403/429 也会自动写冷却；
  冷却按平台整体生效，未到期直接 reject，持久化 KV `governor:cooldowns`。
- 自检：`governor.check.ts` / `lx-mode.check.ts` / `bili-popular.check.ts`。

## 关键命令

```bash
bun run dev / tauri / tauri:build   # 纯前端 / 完整应用热重载 / 前端+release 构建
bun run tauri:release               # ⭐ Rust 以 **release 编译**但保留热重载（见下）
bun run scripts/tauri.ts help       # 全部用法

# CLI 调试探针（收编全部 example；详见 docs/cli-plan.md）
bun run rss channels                    # 渠道注册表（--kind/--json；--kind category = 分区目录）
bun run rss fetch bili:popular          # 单渠道抓取（--xml/--json）
bun run rss fetch apple:podcast-chart   # Apple 播客热门榜（匿名；--kv genre=1318 换分类）
bun run rss item <url>                  # by-url：路由 + streams 全档位 + 弹幕元信息
bun run rss fetch twitch:live --kv roomIds=shroud,riotgames  # Twitch 直播频道（匿名；离线也返 item）
bun run rss fetch twitch:hot            # Twitch 热门直播（观看数降序，游标翻页）
bun run rss fetch twitch:category --kv category=just-chatting  # Twitch 分区（slug / 目录链接）
bun run rss fetch twitch:categories     # 分区**目录**订阅（kind:category；点条目预览分区）
bun run rss fetch live:douyin:categories  # 抖音分区目录（16 条，顶层+子分区）
bun run rss fetch youtube:live-hot       # YouTube 直播热门（Live 页 Live Now）
bun run rss fetch youtube:live-category --kv category=gaming  # YouTube 直播栏目（news/gaming/sports）
bun run rss fetch youtube:playlist       # YouTube 播放列表（官方 RSS，≤15 条）
bun run rss fetch bili:season            # B站合集（30/页，需 Referer）
bun run rss fetch bili:series            # B站视频列表（20/页，pn/ps）
bun run rss fetch bili:favlist           # B站公开收藏夹（20/页）
bun run rss item https://www.twitch.tv/<login>  # Twitch 直播 HLS 档位（variant playlist，非 master）
bun run rss play <url> --open           # 解析直链，--open 丢系统播放器
bun run rss dm <url> -s 5               # 弹幕：VOD 样本 / 直播窗口统计
bun run rss hot <词>                    # 热搜词下微博流（需登录 cookie）
bun run rss sug <关键词>                # 抖音搜索联想词（匿名 appHost，输入补全）
bun run rss detail [url|--latest]       # xhs 单条详情补全（匿名 noteDetail）
bun run rss env --probe                 # appHost 门面自检
bun run rss refresh <key>               # core DataLayer 编排冒烟（SQLite 持久化）
bun run rss align                       # crawler/rsshub 同构断言

# 自检脚本（仓库无测试基建，用最小断言）
bun packages/core/src/example/media-store.check.ts      # 查询分支（分组聚合等）
bun packages/core/src/example/data-layer.check.ts       # 停用不抓取 / reading 回填 / 空抓取不丢内容
bun packages/core/src/example/repo-concurrency.check.ts # 仓储并发写不互相覆盖（丢数据护栏）
bun packages/core/src/reading-position.check.ts         # 续播落库判据（近片尾清除 / 5s 节流）
bun packages/host/src/example/host-check.ts             # 门面字段（openExternal/imageProxy）
bun packages/host/src/example/governor.check.ts         # 网络治理（分类/L0/LX/去重/冷却/strict/并发）
bun packages/core/src/example/lx-mode.check.ts          # LX 闸门（只走 fetchPassive / autoRefresh）
bun packages/crawler/src/example/bili-popular.check.ts  # bili 热门 payload → Item 字段映射
bun packages/crawler/src/example/twitch-live.check.ts   # Twitch GQL → Live 映射（频道 live/offline + 热门/分区流列表）
bun packages/crawler/src/example/youtube-channels.check.ts # YouTube 直播页栏目解析 + playlistId 归一
bun packages/crawler/src/example/bili-channels.check.ts    # B站合集/视频列表/收藏夹参数归一
bun packages/crawler/src/example/xhs-strategy.check.ts  # xhs 策略层（登录页/匿名/L9 路由矩阵 + origin 校验）
bun packages/crawler/src/example/extract.check.ts       # 文章正文提取（标签剥离/实体/SPA 空页）
bun packages/crawler/src/example/passive-buffer.check.ts # LX 被动缓冲（URL 归一化 / TTL / 限额淘汰）
bun packages/crawler/src/example/passive-capture.check.ts # LX 采集编排（假后端回放 CDP 事件）
bun packages/resolve/src/example/router.check.ts        # by-url 路由表（host 边界 + 各平台命中）
bun packages/resolve/src/example/xhs-time.check.ts      # xhs 时间戳单位判别（秒/毫秒不写反）
bun packages/resolve/src/example/danmaku-proto.check.ts # bili 弹幕 protobuf 解码（截断帧不死循环）
bun packages/resolve/src/example/douyu-frame.check.ts   # 斗鱼弹幕帧（一帧多包全解）
bun packages/resolve/src/example/twitch-playlist.check.ts # Twitch master 档位排序 + login/分类 slug 归一化
bun packages/core/src/example/serialize-contract.check.ts # tpl: 契约完整性（serialize 写 vs deserialize 读）
bun packages/core/src/example/body-cache.check.ts       # 文章正文持久缓存（索引/退订清除/容错）
bun apps/mobile/src/html.check.ts                       # mobile 正文 HTML→纯文本（探测/分段/实体）
bun packages/core/src/example/serialize-roundtrip.check.ts  # crawler→core 序列化边界（tpl 字段不丢）
bun packages/xml/src/example/opml.check.ts              # OPML 编解码往返（分组层级）
bun apps/desktop/src/lib/opml.check.ts                  # OPML ↔ 订阅映射（导出过滤 / 导入去重）
bun apps/desktop/src/lib/rail-nav.check.ts              # 侧栏树方向键映射（→ 折叠态只展开 / ← 回父行 / 未分组不折叠）
bun apps/desktop/src/lib/ime.check.ts                   # IME 组合态守卫（nativeEvent 取值 + 229 兜底 + 原生/合成两路径）
bun packages/player/src/hooks/useStreamSelection.check.ts # 默认选流 = streams[0]（不被格式族抢走）
bun apps/desktop/src/lib/boot-skeleton.check.ts         # 骨架/侧栏宽度契约（两份手写字面量必须一致）

# UI 交互巡检（连到正在运行的 dev 实例；需 `bun run tauri`，9222 已由 dev 配置开启）
bun scripts/ui-probe.ts goto tab:all        # 导航 + 巡检（逐字竖排 / 溢出 / 遮挡 / 破图）
bun scripts/ui-probe.ts audit               # 只巡检当前页
bun scripts/ui-probe.ts eval "<js>"         # 在页面里求值（量真实 DOM / 计算样式）
bun scripts/ui-probe.ts click "<selector>"  # 可信鼠标点击（悬停→按下→抬起）
bun scripts/ui-console.ts                   # 遍历各视图，捕获 React 告警 / 未捕获异常
bun scripts/ui-design-audit.ts              # 量化设计审计：对比度(WCAG) / 点击区 / 字号 / 间距节奏
bun scripts/ui-shot.ts tmp/shots            # 给各模块截图存档（用于视觉复核）
bun scripts/ui-play-check.ts               # ★ 播放矩阵巡检（video/live/audio/yt 真播，报起播）
bun scripts/ui-resize.ts 1500 950           # 改窗口尺寸（验证响应式断点）

# Numbered UI Overlay（dev-only，Ctrl+Shift+U；清单不依赖是否显示）
bun apps/desktop/src/dev/ui-overlay/overlay.check.ts  # 快捷键/编号/定位纯逻辑自检
bun scripts/ui-probe.ts eval "__uiOverlay.json()"     # 当前视口交互元素清单（给 AI）
bun scripts/ui-probe.ts eval "__uiOverlay.stats()"    # candidates/labels/overflow

# 浏览器模拟（先起干净 Edge，见 edge-cdp skill；脚本自连 CDP，零额外依赖）
bun packages/crawler/src/example/browser-sim.ts weibo:user   # 或 xhs:user（低频防风控）
bun scripts/lx-visibility-probe.ts     # 窗口可见性实测（隐藏/屏外/可见 → rAF/IO/lazy/scroll，见风控 §3.9）
bun scripts/lx-request-profile.ts      # 渠道单次刷新的请求扇出与耗时（风控 §3.12）
bun scripts/lx-probe.ts                # CDP 网络捕获边界（304/302/gzip/SSE/12MB/SW，见风控 §3.5/§3.7）
```

产物输出到根 `dist/<platform>/`（Vite outDir；tauri.conf 的 frontendDist 指过去）。
CLI 首次运行需 `apps/cli/.data/` 目录存在（gitignore，bun:sqlite 不会自建）。

## ⚠️ 环境要求

**必须从 "x64 Native Tools Command Prompt for VS 2022" 启动终端**，否则 Rust 链接失败。

- **Git Bash 的 `/usr/bin/link` 抢 MSVC** → 报 `/usr/bin/link: extra operand`。
  确保 MSVC 的 `bin\Hostx64\x64` 在 PATH 最前（Native Tools 启动即前置）。
  Bash 工具调用间 env 不持久，每次 cargo 命令前内联 `export PATH`。
  **不要在 `.cargo/config.toml` 里写死 linker**（硬编码 MSVC 版本，VS 更新必坏）。
- `cargo test/build` 前若 amoeba.exe 仍在跑会锁二进制报 `拒绝访问 (os error 5)`，
  先 `taskkill //F //IM amoeba.exe`。增量编译偶报同错，无害，忽略。
  ⚠️ 进程名 = Cargo **package name**（2026-10-16 由 `tauri-app` 改名而来），
  改名后这条命令要同步，否则杀不掉旧进程。**改产品名时一并检查这五处**：
  `tauri.conf*.json` 的 productName/title/identifier、`Cargo.toml` 的 name/lib name、
  `main.rs` 与 `tests/*.rs` 的 `*_lib` 引用、`.vscode/{tasks,launch}.json`、
  以及 `apps/cli/.../browser-reset.ts` 里那份**硬编码的 identifier 副本**
  （不同步会静默 no-op —— 去删一个不存在的目录）。
  ⚠️ **改包名后必须清 `target/debug` 里旧名的陈旧产物**（2026-10-16 实测）：
  Cargo 按「包名 + 哈希」存产物，**改名不改哈希** → 旧 `libtauri_app_lib-*.rmeta` /
  `build/tauri-app-*` / `.fingerprint/tauri-app-*` 全部留存，**`cargo clean` 也删不掉**
  （它只认当前包名的哈希）。后果：rust-analyzer / cargo 扫到旧 `.rmeta` 报
  `cannot find module or crate tauri_app_lib`（明明源码里 0 命中）—— 看着像源码没改干净，
  实为缓存。清法：`target/debug/{deps,.fingerprint,build}` 下按 `*tauri_app_lib*` /
  `*tauri-app*` / `incremental/tauri_app_lib-*` 删（release 侧是新编译的，无需动）。
- ⭐ **`bun run tauri:release`（= `tauri dev --release`）用来调「只在 release 下才走」的分支**。
  典型用例 = **隐藏 Edge 窗口**：`browser.rs` 的 `let hide_capable = !cfg!(debug_assertions)` 是
  **编译期**判据 —— 普通 `tauri dev` 跑 debug profile，窗口永远可见，那条分支根本不会执行
  （`browser_set_mode` 在 debug 下也是 no-op）。
  它保留 Vite dev server 与 Rust 热重载，但**首次要全量 release 编译（实测 4min）**。
  ⚠️ release 默认**无 debug 符号** → 断点行号漂移。VSCode 的 `tauri-dev-release` task
  用 `CARGO_PROFILE_RELEASE_DEBUG=true`（**环境变量，不是 Cargo.toml** —— 后者会让发布版
  安装包也白塞符号）在**首次构建时**决定符号；已构建过的话要 `cargo clean -p amoeba`
  或删 `target/release` 才会带符号重建。
  ⚠️ `--release` 时**不叠 `tauri.conf.dev.json`**（`DEV_CFG_FOR`）—— 那个文件唯一的
  作用就是开 9222，release 模式的意义是复现真实发布形态，带上它自相矛盾。
  ⚠️ 别用 `taskkill /IM msedgewebview2.exe` 清「残留」：**WebView2 宿主被杀 = 应用窗口
  消失、进程跟着退出**。它不是孤儿，就是当前实例的窗口进程。
  ⚠️ **隐藏 Edge 的判定必须看「可见性」，不能只看「藏到几个窗口」**（2026-10-16 修）：
  `hide_windows_for_pids` 若对 PID 的**每个**顶层窗口都计数，那 Chromium 那堆本来就
  `vis=False` 的辅助/IPC 窗口会让 `hidden>0` 在**主框架窗口创建之前**成立 —— 旧代码
  `if cdp_alive && hidden>0 { return }` 于是提前返回，稍后自行 `ShowWindow(SW_SHOW)`
  的主窗口漏藏（现象：release 下隐藏 Edge 仍**在任务栏出现图标**，主进程只被
  `--window-position=-32000` 挪到屏幕外）。正解两条缺一不可：① 只对 `IsWindowVisible`
  的窗口计数；② 等「**曾见过可见窗口** + 连续数轮 0 命中」的稳定态才返回（主框架比
  CDP 就绪晚约 1s，不加 `seen` 门槛 0.3s 就误判藏净）。**只在 release 显现**（debug 走
  可见分支不触发），改 `browser.rs` 的隐藏逻辑务必用 release 实例验证。
  ⭐ **两种窗口模式**（2026-10-19）：`browser_ensure(mode)` / `browser_set_mode` 支持
  `hidden`（`SW_HIDE`，默认，不渲染）与 `interactive`（屏外 shown + 遮挡 flag +
  `WS_EX_TOOLWINDOW`，渲染/IO/懒加载/scroll 事件与可见窗口一致）。遮挡与节流 flag 是
  **启动参数**，必须启动时就全带上；切换只靠 `ShowWindow`。⚠️ interactive 常驻渲染有
  CPU 开销，必须按需启停；`WS_EX_TOOLWINDOW` 属 Win32 技巧，Edge 升级后要回归。
  ⚠️ hidden 下 `scrollTo`
  **不派发 scroll 事件**、IO/lazy 全停 —— 滚动驱动页面用
  `withBrowserMode(browser, "interactive", fn)`（内部串行 + 结束自动切回 hidden），
  不要手写 `withBrowserLock` + `setMode`。焦点抢占任何模式都挡不住（`SW_SHOWNA` /
  `WS_EX_NOACTIVATE` 无效），已在每次 spawn/切换后用 `SetForegroundWindow` 还原原前台。
  ⚠️ `browser_ensure()` **不带 mode 必须保持当前模式**（不能默认切 hidden）——
  `ensureConn` 每次首连都会调用它，否则一轮滚动采集会把 interactive 打回 hidden。
  实测表与落点见 `docs/crawler-risk-control.md` §3.9。
  ⭐ **单验 release 行为不必重编**（2026-10-16 实测）：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
  环境变量**追加**到 WebView2 的 Chromium 参数（不覆盖 tauri.conf 的），设成
  `--remote-debugging-port=9222` 再启动 `target/release/amoeba.exe` 就有调试口——
  比 `tauri dev --release`（重编 4min）快得多。⚠️ 直接跑 release 二进制会加载 `devUrl`
  （`localhost:1420`），故**另起一个静态服务**喂 `dist/desktop`（`Bun.serve` 一行即可）
  否则页面停在 `chrome-error://`、`invoke` 报 "Origin header is not a valid URL"。
  之后 `ui-probe` eval `__TAURI__.core.invoke('browser_ensure')` 即可触发隐藏路径。
  量隐藏结果用 `EnumWindows` + `GetWindowThreadProcessId` 筛出该 Edge PID 的顶层窗口、
  `IsWindowVisible` 计数（应为 0；amoeba 自身作对照应为若干）。
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
- **UI 显示名统一「B站」**（2026-10-18）：平台标签、渠道名、账号页/引导/诊断文案都用
  「B站」；仅渠道 key（`bili:*`）、URL、API、代码标识保留 bilibili。
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
- ✅ **搜UP主**（2026-10-16，`searchBiliUsers` / 渠道 `bili:user`）：
  `search_type=bili_user` + **匿名 buvid3/4**（`biliClient.getJson(..., {buvid:true})`，
  裸请求 412）。与 `bili:user_video`（uid 投稿订阅）配对，走「添加订阅 → UP主 / 频道」
- ✅ **入站必刷**（2026-10-18，渠道 `bili:precious`）：
  `GET /x/web-interface/popular/precious` + 站内 Referer，匿名实测 98 条，无需
  wbi/cookie。原 RSSHub `/bilibili/precious` 是同一端点，已收编进 crawler；
  RSSHub 具名渠道（`rsshub:bili:*` / `weibo:*` / `youtube:*`）随之删除，只留
  `rsshub:feed` 泛用路由
- ✅ **合集 / 视频列表 / 收藏夹**（2026-10-20，均匿名可读 + `Pageable`）：
  `bili:season` 走 `x/polymer/web-space/seasons_archives_list`，**必须带 Referer**
  `https://www.bilibili.com/`（否则 `-352`），`mid` 可为 0，30 条/页；输入可粘视频
  链接（先读 `x/web-interface/view` 的 `data.ugc_season.id`）。
  `bili:series` 走 `x/series/archives`，⚠️ **分页参数是 `pn`/`ps`**（传
  `page_num=2` 会静默返回第 1 页，翻页永远重复首页），固定 20/页；`mid` 先由
  `x/series/series?series_id=` 的 `meta.mid` 得到，不要求用户输入。
  `bili:favlist` 走 `x/v3/fav/resource/list`（`fid` 与 `media_id` 同值），公开夹匿名、
  私有需登录，`attr != 0` 跳过，20/页。合集/系列条目没有作者名（archives 只带 `mid`）。
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
- ✅ **抖音号可直接当 web_rid 用**（2026-10-18 实测）：`live:douyin` 的 `roomIds`
  支持用户抖音号（`unique_id`，如 `pvcyinse`）/ 数字 short_id / 直播间 URL 的
  `<web_rid>`；enter API 会解析到当前房间，**离线也返 offline 条目**，开播后刷新变
  live。⚠️ 不能填长 `room_id`（`4001038`）。`roomIds` 会自动归一 `@抖音号` /
  `抖音号：xxx` / `live.douyin.com/<id>` 链接。
- ✅ **主页链接也走 `live:douyin`**（2026-10-19）：`roomIds` 接受
  `www.douyin.com/user/<sec_uid>`，先经匿名资料 API
  `aweme/v1/web/user/profile/other/?sec_user_id=...`（a_bogus+ttwid）换
  `unique_id`/`short_id`，再当 web_rid 走 enter。`live:douyin:user`
  （`channels/douyin/user.ts`）**保留给存量订阅**，新入口不再列出 —— 统一到
  `live:douyin` 后，新订阅才能和搜索添加/「并入已有订阅」共用同一个渠道。
- ✅ **抖音扫码登录**（2026-10-16，`resolve/platform/douyin/login.ts`）：纯 HTTP 走
  `sso.douyin.com` 通行证（get_qrcode → check_qrconnect 轮询 → redirect_url 落
  cookie），**实测被 JS 挑战页拦**（warmup 只给 `__ac_nonce`，无 JS 执行过不了
  `__ac_signature` 挑战 → get_qrcode 返 HTML）→ 自动回退 **CDP 浏览器路径**
  （douyin.com 点登录读弹窗 canvas 二维码，成功判据 = `sessionid` cookie）。两层
  都封装在 `douyinScanLogin`，channel 只做薄委托。⚠️ 社区实现靠 curl_cffi TLS
  指纹；宿主 reqwest 无伪装，纯 HTTP 层保留是为了协议变化时可能直连。
- ⚠️ **抖音登录 cookie 目前没有任何抓取/播放路径消费**（2026-10-19 核对）：登录成功只写
  `settings.douyinCookie`；`live:douyin` / `:hot` / `:category` / 用户主页 / 播放解析
  仍用首页 warmup 的 `ttwid`（`info.cookie` 未被读取）。真正的关键词搜索
  `aweme/v1/web/live/search` / `general/search/stream` 匿名返回 2483，**需要登录但未做
  调研与开发**；现有 `live:douyin:search` 只是匿名分区搜索。不要直接把主账号 cookie
  接进自动化搜索（4031/限流/账号标记风险）；要做先在有登录态的 Edge 上用**专用小号**
  做 1~2 次 CDP 被动探针，确认页面是否自然发 `live/search`、body 能否取到。
- **发现层**（分区/搜索，`resolve/platform/*/discover.ts`）：douyin 三路搜索只
  `partition/search` 匿名可用且只认游戏名级——但**顶层分区名恰是大类词**（舞蹈/音乐/聊天/
  二次元…），故 resolve 侧做「上游命中 ∪ 本地分区树 title 匹配」，0 → 20 条。
  ⚠️ **匿名搜抖音无解已用真实 Edge 复核**（路 1/2 仍 2483，搜索页被 verify-center 4031 拦）：
  登录硬门槛，**browser 模拟解不了**（xhs 是 TLS 指纹差异能解，抖音是账号门槛不能）。
  虎牙搜索/搜主播不可分页。✅ **抖音搜索渠道**（2026-10-18 调整）：
  `live:douyin:search` 本质是**分区搜索**（关键词 → 分区 → 列房），只认大类/游戏名，
  不搜主播/房间标题；`live:douyin:anchor` 已删除（本地过滤热门房间没有意义）。
  已登记进 `SEARCH_CHANNEL`（发现页/搜索面板的平台名显示「抖音分区」）；
  已知主播用 `live:douyin` + 抖音号/主页链接（发现页抖音卡片的「用户直播间」入口
  也预置 `live:douyin`）。缺口见 `docs/capability-gaps.md`

**YouTube**（`docs/youtube-stream-extraction.md`）
- 主力 client = **ANDROID_VR**：2026-08 起 ANDROID/IOS 标准 client 在部分 IP 触发
  poToken（LOGIN_REQUIRED）。⚠️ poToken 风控是**部分 IP 特性**，与 node/tauri/browser
  环境无关。端点走 gapis `youtubei.googleapis.com`
- 渐进式只到 itag 18（360p）→ **视频 1080p 走 DASH**：adaptiveFormats 自拼 SegmentBase
  MPD（共享 `utils/mpd.ts`）。360p 不混进返回数组（默认选流会落 360p），DASH 装配失败才 fallback
- ✅ **搜频道**（2026-10-16，`searchYouTubeChannels` / 渠道 `youtube:user`）：InnerTube
  `search` + `params:"EgIQAg=="`（仅频道过滤）匿名可用（WEB client + visitorData），
  解 `channelRenderer`。与 `youtube` 渠道（channelId 订阅）配对
- ✅ **搜直播间**（2026-10-18，`searchYouTubeLive` / 渠道 `youtube:live-search`）：同端点
  + `params:"EgJAAQ=="`（直播过滤，实为 protobuf field 8=1），匿名返回 18~20 条且全带
  LIVE badge，解 `videoRenderer`。搜索添加「直播间」→ 落地 `youtube:live`（参数 videoId）
- ✅ **直播热门 / 栏目**（2026-10-20，`youtube:live-hot` / `youtube:live-category`）：
  Live 页 `browseId=UC4R8DWoMoI7CAwX8_LjQHig` 匿名返回栏目；实测布局是
  `richGridRenderer.contents[].richSectionRenderer.content.richShelfRenderer`（旧版
  直接 `richShelfRenderer` 也兼容）。`Live Now` 12 条、News/Gaming/Sports 各 12，
  **无 continuation**。client 固定 `hl=en`/`gl=US`（栏目名是解析依据），只认
  `thumbnailOverlayTimeStatusRenderer.text === "LIVE"`（Recent/Upcoming 因此为空）；
  观看数只取 `"N watching"`（`views`/`waiting` 不算）。整页 ~800KB → 5 分钟 Promise
  缓存（并发去重），见 `resolve/platform/youtube/discover.ts`。
- ✅ **播放列表**（2026-10-20，`youtube:playlist`）：官方
  `feeds/videos.xml?playlist_id=` 匿名可用，**最多 15 条、无翻页**；条目结构与频道
  feed 同构（复用 `entryToVideo`）。`RD`/`WL`/`LL`/`LM` 前缀拒收（动态/私有/需登录）。
  完整列表（InnerTube `VL<playlistId>`，100/页 + continuation）未做。

**小红书**（细节见 `docs/xhs-signature-research.md`）
- ⚠️ **`web_session` 不是登录标志**（2026-10-19 实测 + 社区复核）：小红书对**匿名访客**
  首次打开页面就会签发一个游客 `web_session`（伴随 `a1`/`webId`/`sec_poison_id` 等）。
  按它判断登录会出现「还没扫码就显示已登录」，并把游客 cookie 当成账号凭证写进
  `settings.xhsCookie`。登录判据 = 页面 `__INITIAL_STATE__.user.loggedIn === true`
  / 侧栏「我」入口 / `user_id` cookie（后两者兜底）。权威接口是
  `/api/sns/web/v2/user/me` 的 `data.guest === false && data.user_id`。
- 主分支**全 SSR**：`xhs:explore` 匿名稳定可用。**笔记详情页匿名可用**，但**必须带列表项的
  xsec_token**（`tpl:xsecToken` → `SocialItem.xsecToken` → `resolveDetail`）
- ⚠️ **xhs 渠道按登录态/渠道分流**（2026-10-20）：登录态 → **被动**（导航后读页面
  `__INITIAL_STATE__`，或 L9 的 Network 捕获），不构造请求。匿名：
  - `xhs:explore` **也走被动** —— 匿名推荐流 SSR 本身有 feeds，首屏与 `fetchMore`
    共用同一份页面 state，不再多抓一次 HTML；
  - `xhs:user` 走 **fetch** —— 匿名 profile SSR 会**抹空 noteId**，`noteCardToSocial`
    只能生成 `anon-<hash>` 虚拟条目并清掉 url/xsecToken（预期降级）。
  登录判据统一走 `isXhsLoggedIn`（页面 `loggedIn` + 侧栏「我」+ `user_id` cookie），
  **不能看 `web_session`**（游客也有）。
  - `xhs:explore` 也实现了被动 `fetchMore`（滚动驱动，登录/匿名共用）。⚠️ 翻页**不能整页
    重载**：增量只能从页面累计的 `feed.feeds` 里切，重载会让 state 回到首屏。判据只比
    `pathname`（`shared.ts` 的 `ensureXhsPath`，三处入口包成 `ensureXhsPageReady`）——
    SPA 会往地址栏写 query，完整 `href` 永不相等，用 `cdpNavigate` 自带的同址判据会
    每次都重载。⚠️ `feed.feeds` 是**扁平数组**（`flat()` 对它是 no-op），滚动加载的
    新条目**追加在尾部**（实测 862 → 915 → 968）；prepend 判断只是防御，不是常态。
  - 详情同理：登录态导航详情页读 `noteDetailMap`（被动）；匿名走页面内 fetch 详情 HTML。
    `core.resolveDetail` 在等级 9 时传 `{ passive: true }`（禁止 fetch），匿名则直接
    回退列表 item。explore/user 的详情实现已收敛到 `channels/xhs/shared.ts`。
  - L9 的 `fetchPassive` 对未登录用户返回 null → core 回退内容缓存，不会偷偷改走 fetch。
  - 策略层入口 = `shared.ts` 的 `fetchXhsList`：登录页优先判匿名，**登录页且没有 `parseHtml`
    的渠道必须给 `loginError`**（explore），否则会读登录页的空 SSR 静默 0 条；SSR 列表读取
    统一走 `readXhsStateList` / `flatXhsStateList`（逐层解 `_rawValue` + flat）；
    `ensureXhsPath` 同址判据**同时校验 origin**（共享 Edge 可能停在别的域）。
    回归：`bun packages/crawler/src/example/xhs-strategy.check.ts`。
- ⚠️ 登录态 SSR 的 JSON 混入 JS 表达式（`"noteDetailMap":new Map([])`）——
  `extractInitialState` 用**平衡大括号截纯 JSON** + 空容器归一
- ⚠️ **不要手拼 user_posted fetch**（页面内 `_webmsxyw` 只返回部分头 → 300011 风控）。
  `xhs:user` 分页是**滚动驱动**（浏览器路径），已加窗口化 + 验证码检测
- 签名方案当前**不在主分支**（`signApiHeaders` 直接抛错降级）；曾经的 `packages/xhshow/`
  fork 与 `feat/xhs-rustpython` 分支**在本仓库已不存在**（纯算法处于上游失效期，故维持全 SSR）。
  若要重启签名移植，参照 `docs/xhs-signature-research.md` 的 Python xhshow 0.2.0

**时间戳单位**
- ⚠️ **平台的 `time` 字段单位会变**，别无条件 `* 1000`。xhs 从**秒**改成**毫秒**后，
  旧代码把它放大 1000 倍 → 落到**公元 5 万年** → 按时间倒序时**永久钉在最前**
  （实测「全部」页前 12 条全是 social，本该置顶的直播被挤到第 112 位）。判别统一走
  `resolve/platform/xhs/client.ts` 的 `toEpochMs()`。⚠️ 秒/毫秒的判据方向相反，
  **别写成三元**（那条件我写反过两次，`xhs-time.check.ts` 就是为它留的）。
- ⚠️ **core 解析层有「未来时间」上限**（`tryEpoch`，现在 + 1 天）：上游给错单位会产出
  极端错值，`new Date` 照收不误，会污染排序 / `fmtAgo`（「22 万年以前」）/ `isToday`。
  宁可判 `undefined` 沉底。
- ⚠️ **直播没有 `publishedAt`**（实测 210 条 live 无一条有）→ `?? 0` 会把它们全沉底。
  `sortItems` 用 `publishedAt ?? fetchedAt` 兜底，否则直播永远进不了首屏窗口，
  `MediaMain` 的 `hasMix` 恒假 → **「正在直播」横滑轨从来不渲染**。

**Apple 播客**（`resolve/platform/apple/catalog.ts` + `crawler/channels/apple/`）
- 目录是**元数据源**：`apple:podcast-chart`（热门榜）/ `apple:podcast-search`（关键词）。
  产出 `kind:audio`，`url` = 该节目的 **RSS feed** → 接进既有 `rss:podcast`，不另造解析器。
  每集 enclosure **不在榜单里**，故榜单条目的 `stream` 留空。⚠️ **留空 ≠ 可播**：
  `isPlayableKind("audio")` 恒真，卡片会摆播放按钮，但 resolver 只认平台域名、feed 域名
  路由不上 → 点必碎（「该条目不指向可解析的视频链接」）。
  这批条目的主操作是 **`isFeedItem()`**（`kind:"audio" && !stream`，`Cards.tsx`）判出的
  「**在右侧列出单集**」：点开 → URL 变 `?open=<itemId>` → `dl.previewChannel("rss:podcast", {url})`
  拉一次该 feed（**复用播客渠道，不另造解析器**；`previewChannel` 不写缓存不落库）→
  **`MediaMain` 用与正常订阅同一套网格/卡片**列出单集，只把表头换成「返回 / 订阅该节目」，
  点一集直接播（单集带 enclosure 直链，`PlayableMedia` 走 `streams` prop 不解析）。
  ⚠️ 预览单集**不落库、不建订阅**，只活在 store 的 `previewDetail` 里；
  **`PlayerPage` 的 item 查找必须回退查它**，否则「找不到这条内容」。
  `rss:podcast` 的条目**必有 enclosure**（没 enclosure 的 item 在建 Audio 时就被丢），
  故 `isFeedItem` 不会误伤真正的单集
- ⚠️ **榜单不含 `feedUrl`**（旧 iTunes RSS 只给 `im:id`）→ 必须再 Lookup 一次换 feedUrl。
  Lookup 返回顺序**不保证**与请求一致，按榜单原序重排；**没 feedUrl 的条目直接丢**（只能显示不能订阅）
- ⚠️ **搜索渠道刻意不声明 `defaultInfo`**：发现页「可一键订阅」判据 `!!defaultInfo || 无必填项`，
  **空对象是 truthy** → 写 `= {}` 会让需要 `q` 的渠道被误列进去（同 `bili:search`）
- 端点：旧 `itunes.apple.com/{cc}/rss/toppodcasts` / `search?media=podcast`（**直接给 feedUrl**）/
  `lookup?id=` 全可用；新 `rss.applemarketingtools.com` **504**。均匿名，但要带 UA

**Twitch**（`resolve/platform/twitch/` + `crawler/channels/twitch/`，一期方案 `docs/twitch-channel.md`）
- 匿名链路可用：公开 web Client-ID 的 **GraphQL**（`gql.twitch.tv/gql`，`Client-Id` 头）
  → `PlaybackAccessToken`（**persisted query**）→ `usher.ttvnw.net` HLS。不需要账号 /
  `Client-Integrity` / 浏览器。官方 **Helix 匿名 401**（且不给播放地址），故不走 Helix。
- ⚠️ **persisted query hash 会轮换**（2025-11 曾整体替换一次）—— 集中成
  `TWITCH_PLAYBACK_TOKEN_HASH`（`platform/twitch/live.ts`），Twitch 改版只改这一处；
  手写 `streamPlaybackAccessToken(login:...)` 已报 `argument: channelName is required`。
- ⚠️ **master 没有 `Access-Control-Allow-Origin`** → hls.js 不能直接加载。resolver 必须经
  `appHost.http` 拉 master、解析后把 **variant playlist URL** 作为 `Stream.url`
  （variant 与分片是 `ACAO: *`）。**别把 master URL 交给播放器**。
- ⚠️ master 的 variant 顺序**不是高→低**（实测 audio_only 排第二）→ `parseTwitchMaster`
  显式按高度/带宽降序、audio_only 最后（选流契约取 `streams[0]`）。
- `twitch:live` 的 `roomIds` 接受裸 login / `@login` / `twitch.tv/<login>`（小写，
  `[a-z0-9_]{3,25}`，排除站内保留字；多段路径一期不认）。离线频道仍产 `offline` item
  （下播不空订阅），**全部频道失败才抛错**。token 的 `value` 是 JSON（`geoblock_reason` /
  `blackout_enabled` 等）——**不进日志/错误文案**；地区/版权受限直接报错不重试。
- `twitch:hot`（无参数，`streams(sort: VIEWER_COUNT)`）与 `twitch:category`（参数
  `category`，接受 slug 或 `twitch.tv/directory/category/<slug>`，走
  `game(slug).streams`）共用 `twitchStreamToLive` 映射与 `channels/twitch/streams.ts` 的
  游标 `fetchMore`。⚠️ **首次 `fetchMore` 要两次请求**：core 首次翻页不传首页游标，渠道
  先取首页拿 `endCursor` 再取第二页（不能直接返回首页，会与首屏重复）；首页到底则返回
  空 XML 且无 cursor（core 判「没有更多」）。⚠️ **流列表必须用 Android app 公开
  Client-ID**（`TWITCH_MOBILE_CLIENT_ID`）：网页 ID 从第二页起（带 `after`）返回
  `IntegrityCheckFailed` 且 `data.streams = null`。频道元数据/播放 token 仍走网页 ID。
  `first` 上游硬上限 30（>30 报 400），`clampFirst` 统一 clamp；`throwOnErrors` 保留，
  移动 ID 也失效时透出原因，别当成「字段缺失」。
- `games(first)` 分类榜匿名可用，但**分类本身没有可播房间** → 暂不做 channel（订阅后
  只会是空列表）；发现层若要做，走「点分类 → 订阅 `twitch:category`」。
- **聊天弹幕属二期**：IRC（`wss://irc-ws.chat.twitch.tv:443`、`justinfan`）文本帧可用，
  但宿主 `WsLike.send(Uint8Array)` **只发 binary**，Twitch 不收 → 二期先给宿主 ws 加 text 帧。
  VOD / clip 路由（要排在频道名单段路径之前）、关键词搜索、分类榜 channel、登录均未做。

**cookie / 登录**
- `packages/core/src/bilibili-cookie.ts` 四个 `DEFAULT_*_COOKIE` 默认**全空**（纯匿名）。
  匿名行为：bili 视频列表稳定、直播 250 超清封顶；weibo 热搜列表可用但 user/词流需登录；
  xhs explore/详情可用、user 需登录；douyin 直播可用、原画档位需登录
- ⚠️ **抖音渠道前缀是 `live:douyin*`**：`cookieFieldFor` / AccountPage `cookieFieldOf`
  的平台匹配都为它写了专门分支（裸 `split(":")[0]` 得 "live" 匹配不上）
- 恢复登录：填真实 cookie → `git update-index --no-skip-worktree` 再改，**勿提交真实值**
  （文件有 skip-worktree 保护 + 空占位模板 `.example`）
- ⚠️ **`clearCookies` 的域匹配必须按标签边界**（2026-10-20）：裸 `endsWith("xiaohongshu.com")`
  会把 `notxiaohongshu.com` 这类第三方 cookie 一起删掉。判据 = `d === host || d.endsWith("." + host)`。
- 扫码登录是 **channel 级能力 `Loginable`**（平台级操作，不依赖 info 实例化）。
  `emitQr` 载荷语义：`data:image/...`（浏览器路径已编码）**或**待编码文本（纯 HTTP 路径）。
  ⚠️ `opts.signal`（2026-10-20）：UI 关闭二维码弹窗必须 abort —— 登录在 `withScanLoginLock`
  （cdp.ts，xhs/weibo hidden / douyin interactive，douyin 二维码是 canvas 绘制 hidden 画不出）
  里持全局浏览器锁直到成功/超时，没有取消通道的话关窗后所有浏览器操作都被排队卡住。
  ⚠️ xhs 登录的**初始检测只用页面证据**（`user.loggedIn`/侧栏「我」，cookie 完全不参与）；
  轮询判据是 `user_id` **相对基线变化** —— 服务端 session 失效时残留的旧 user_id 不算登录。

## 播放

**选流契约**：crawler 保证返回数组内**最高清晰度排最前**（bili/youtube/douyin/huya 显式
按 rate 降序；douyu 例外见上）。player `pickDefaultStream`（`hooks/streamKind.ts`）
**就取 `streams[0]`**，不做二次排序。
⚠️ 曾按**格式族**挑（`find(渐进式) ?? find(hls) ?? find(flv) ?? [0]`），以为「原生可播的
最稳」—— 那会在首档不是渐进式、后面却有的时候**静默降画质**（首档 1080p dash 后面跟一条
360p mp4 就去取 360p）。契约既保证顺序，就别再挑拣。回归：`useStreamSelection.check.ts`。
⚠️ 格式判据在 `streamKind.ts`（纯函数、**不 import 引擎**）—— `useMediaStream.ts` 引了
hls/flv/dashjs，加载即要 `window`，判据放那儿 node 侧自检跑不起来。

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
- **release 下 CDP Edge 禁图**：只有可隐藏的 release 构建才拼
  `--blink-settings=imagesEnabled=false` —— SSR/滚动抓取只读 DOM 文本，图片纯浪费内存/带宽。
  实测该参数**不影响** `interactive` 模式的 rAF / IntersectionObserver / scroll 事件
  （只让图片不加载），所以模式切换不需要重开浏览器。扫码不受影响：微博读远程 `img.src`
  （图另走 `appHost.http`）、小红书读 `img.qrcode-img` 的 data URL、抖音是 canvas 绘制；
  debug 不禁图便于观察
- **CDP Edge 干净度（对齐 edge-cdp 插件）**：`edge_args` 带
  `--disable-sync --disable-extensions --disable-default-apps
  --edge-redirect-feed-at-first-run-disabled=1`，避免把本机登录账号的同步设置/扩展
  带进抓取实例。⚠️ `.msn/.bing` 账户 cookie 仍会被 Edge 账户层注入（flag 挡不住，
  不影响抓取）；要真正清空 profile 用「存储与诊断 → 清理浏览器数据」
  （先杀我们的 Edge 再删目录）。⚠️ 不能像插件的 WSL 脚本那样 `taskkill /IM msedge.exe`
  杀全部 Edge —— 那会关掉用户正在用的浏览器
- ⚠️ **player 包方角（产品决定，非待补样式）**：`VideoShell`/`PlayerControls`/`PlayableMedia`
  **都不带 border-radius** —— 常见播放器都是满幅方角设计。曾经三处各写死一档
  （`rounded-xl`/`rounded-b-lg`/`rounded`）互相错位，且给画面套圆角本就不符合播放器惯例。
  播放器内嵌到任意容器都不该假定圆角档位
- ⚠️ **`scrollBarStyle:"fluentOverlay"` 会被 `::-webkit-scrollbar` 顶掉**（WebView2 155 实测）：
  页面上只要**任何** `::-webkit-scrollbar` 规则命中某个滚动容器，Chromium 就给它切**自定义**
  （经典、占布局）滚动条，fluentOverlay 整个失效。空白的 `overflow:auto` 盒对比：
  无规则 `offsetWidth-clientWidth=0`（overlay）；加 `::-webkit-scrollbar{width:10px}` → `10`。
  `scrollbar-width:thin/auto` 不触发（实测仍 0）。`.scroll-area` 曾有一条 `width:10px`「纯前端
  兜底」，注释还断言「对 WebView2 无效」——**说反了**，实测两处主滚动区 gutter 恒 9px。
  删掉后归 0（侧栏 258→267px）。折叠栏那两条「滚动条吃 10px → 图标偏左 5px」的对齐补丁
  都是它的连锁副产品。**改滚动条样式前先量 gutter，别用 `::-webkit-scrollbar`。**
  ✅ 2026-10-19 复核（同一实例）：overlay gutter=0；`::-webkit-scrollbar{width:10px}` → 10；
  `scrollbar-width:none` → 0（**标准属性不切经典模式**，要隐藏 overlay 条用它，别用伪元素）。
  即：**能改样式但会失去 overlay**；想保留 fluentOverlay 就只能用 `scrollbar-width/color`。
- ⚠️ **吐司的 grid 项必须 `min-width:0`**（2026-10-19）：`.toast-root` 是 grid，`.toast` 是
  grid item；默认 `min-width:auto` 时，错误文案里的长 URL 会把 min-content 撑到 **592px**，
  无视 `max-width:360px` 直接出视口。`.toast-body` 也要 `min-width:0`，`.toast-text` 加
  `overflow-wrap:anywhere`。governor 的冷却/L9 错误已去掉完整 URL（只留平台/剩余时间/信号）。
- ⚠️ **`.menu` 必须是 Radix popper wrapper 的在流子元素**（2026-10-19）：Radix 的 floating
  元素是外层 `div[data-radix-popper-content-wrapper]`（`position:fixed; transform`），
  `.menu` 只是它的子节点。给 `.menu` 写 `position:fixed/absolute` 会脱离文档流 →
  wrapper 量成 **0×0** → flip 不翻面、`--radix-popper-available-height` 按 0 高算、
  `align=end` 按 0 宽对齐。症状：侧栏底部行的菜单被压成 122px 带滚动条的矮条，且向右溢出。
  修法 = `.menu` 不写 `position`。**这是「弹窗里为什么有滚动条」的根因，别再改回去。**

## 弹幕（细节见 `docs/danmaku-research.md`）

- **弹幕开关在播放器控件栏**（`MediaDanmakuButton`），不在播放页 meta 的按钮组。
  `PlayableMedia` 只在 `resolved.danmaku` 存在时把 control 传给 `VideoShell`；
  `enabled` 跟 `showDanmaku` 而不是渲染用的 `danmaku` —— 关闭后流被丢弃但按钮仍在，
  否则按钮会随流一起消失、无法再打开。全局设置 `danmakuEnabled` 关闭时不渲染按钮。

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

## 发布与自动更新

- **Windows 只发 NSIS `*-setup.exe`**（`bundle.targets: ["nsis"]`，按用户装到
  `%LOCALAPPDATA%`，免管理员）。**不是 MSIX**（Tauri 没有该 target）、**不是 portable**
  （无安装记录，updater 无法替换）。⚠️ **别再加回 MSI**：per-machine 与 NSIS 是两条
  安装记录，`latest.json` 只能指向一种安装器，混发会断更新链。
- **updater**：`tauri-plugin-updater` + `tauri-plugin-process`（Rust 侧 `#[cfg(desktop)]`
  注册）；前端经 appHost 可选能力 `updater`（`packages/host/src/tauri/updater-backend.ts`）。
  启动静默检查（`apps/desktop/src/lib/update.ts`：4s 后、离线跳过、失败不打扰）+
  「设置 → 关于与更新」手动检查/下载进度/重启。
- **签名密钥**：私钥 `~/.tauri/amoeba.key`（不入库），公钥写 `plugins.updater.pubkey`，
  CI 用 secret `TAURI_SIGNING_PRIVATE_KEY`。⚠️ **私钥丢失或公钥更换 = 已安装用户永远
  收不到更新** —— 备份私钥。
- **发版**：同步三处版本号（`tauri.conf.json` / `Cargo.toml` / `package.json`）→ 提交 →
  `git tag vX.Y.Z && git push origin vX.Y.Z`。`.github/workflows/release.yml` 在
  windows-latest 构建、签名并发布 Release + `latest.json`。详见 `docs/release-updater.md`。
- **VSCode「Tauri Release (true production)」**：`vite build`（PROD）+ `tauri build
  --no-bundle` 后直接启动 `target/release/amoeba.exe` —— 无 dev server / 无 9222、
  用生产库 `rss.db`、无测试种子，与用户装到的版本一致（release 无调试符号，断点不可用）。

## 其他约定

- ⚠️ **分页条目的 `fetchedAt` 必须对齐到首屏**（2026-10-20，小红书发现页实测）：
  没有 `publishedAt` 的源，`selectors.sortItems` 走 `publishedAt ?? fetchedAt` 兜底，
  而 `loadMore` 是**另一次抓取**（`tpl:fetchedAt` 更新）—— 新一批会整体排到列表最前。
  现象：滚到底点「加载更多」，视口里还是原来那批，**新内容全插到顶部**（实测 89 → 272 条，
  顶部一屏一换），用户描述成「往下滑一直看同一页」。修法：`core.loadMore` 把本页条目的
  `fetchedAt` 覆盖成该订阅已有内容的抓取时间（同一订阅 = 同一批快照）→ 排序键相同 →
  稳定排序保持 append 顺序。**新增分页渠道时不需要额外处理**（在 core 统一做）。
  另有守卫：游标前进但 `store.append`（按 id 去重后**返回实际新增数**）为 0 条 =
  上游把已返回内容又给了一遍 → `hasMore=false`；游标没动（或本轮是**首次翻页**，
  core 原本无游标，渠道返回的重试游标不算「前进」）才是「平台还在加载」的 retry 语义。
  配套两条：① 渠道的 cursor **不能 clamp 到当前页面条数** —— 页面被重载过（点开笔记/
  刷新别的 xhs 订阅会把共享 Edge 导航走）时 clamp 会把切片压回已返回前缀，表现为「加载
  更多点了没反应」；正确做法是保持旧 cursor 滚到超过它，滚不到就返回空 + 原 cursor 重试。
  ② refresh/refreshAll 后要把本地窗口（desktop `page[id]`）抬到至少覆盖新首屏 —— 首屏
  可能超过 PAGE_SIZE（xhs:explore 实测 89 条），而渠道分页只按 `addedCount` 增长窗口，
  首屏缺口永远补不上（尾部条目不可见、footer 却报「已加载全部」）；**种子用 `PAGE_SIZE`
  不是 0**（停用订阅 refresh 返回 itemCount 0，用 0 当种子会把窗口压成 0 → 空视图）。
  ③ 游标是「页面 state 下标」的渠道（xhs explore/user）**首次翻页的起点用 core 传入的
  `ctx.existing`（`Pageable.fetchMore` 第二参，store 已有条数），不要用页面当前长度**
  —— 共享 Edge 页面可能已被上次滚动养到几百条，用页面长度会跳过中间几百条。
- ⚠️ **「回车提交」的输入框必须过 `lib/ime.ts` 的 `isImeComposing(e)`**：中文输入法候选
  未上屏时的回车是**选词**，不是提交。不拦的后果全是**静默错值** —— 会建出名叫 `fenzu` 的
  分组、搜索拿半截拼音发请求、订阅标题存成半截。曾散落 6 处、两种手写写法（`e.isComposing ||
  keyCode===229` / `e.nativeEvent.isComposing`），2026-10-15 收口。⚠️ **取值必须走
  `nativeEvent`**：本仓 `@types/react` 只给原生事件声明了 `isComposing`，合成事件上直接
  `e.isComposing` 编译不过（TS2339）。守卫只挡 keydown，不改输入法组合行为。
- ⚠️ **JS 驱动的动画挡不住 `prefers-reduced-motion`**：`styles.css` 那条媒体查询只压
  CSS 的 animation/transition，对 `scrollIntoView({behavior:"smooth"})`、脚本编排的入场
  与形变**完全无效**。要在 JS 侧问偏好，用 `lib/motion.ts`（`prefersReducedMotion()` /
  `scrollBehavior()` / `motionDurationMs()`）。**等动画放完再卸载**时读
  `motionDurationMs()` 而非写死 —— 动效有三档，写死会让 `data-motion="off"` 白等。
- ⚠️ **共享元素形变走原生 View Transition，不引 motion**（2026-10-15 实测 Chromium 155
  支持 `startViewTransition`）。入口 `lib/viewTransition.ts`。三个**静默失败**的坑：
  1. **源元素在新状态里必须摘掉 `view-transition-name`** —— 与目标同名的话浏览器判定
     重复、**忽略整个过渡且不报错**（探针实测：伪元素动画为空数组）。这是最难查的一条。
  2. 回调里必须 `flushSync` —— React 的 setState 是异步的，不同步刷 DOM 则目标还没渲染。
  3. 别与元素的入场动画叠加（如 `.modal` 的 `modal-in`），过渡期间把它停掉。
  目标 name 用 **CSS 常驻声明**，别在过渡里动态挂/清（结束后清掉，下次就没形变了）。
- **可播判定 = kind 门控**：只有 `video`/`audio`/`live` 有可播流，`article`/`social`/
  `category` 不是。卡片的整卡点击与播放按钮都走 `cards.tsx` 的 `isPlayableKind`——article
  显示 0 个播放按钮、点击进「打开文章」（`tab:article` 三栏读），social 进详情弹窗，
  `category`（分区目录条目）在右侧列表打开目标分区（`?open=`，用条目的
  categoryChannel + categoryInfo 预览）。
  ⚠️ 曾漏掉 article：点一下掉进「该条目不指向可解析的视频链接」的破碎播放页。
  ⚠️ **kind 门控不够**：`kind:"audio"` 也可能是**一个播客 feed**（Apple 榜单条目，
  `stream` 空）——见上方 Apple 播客段。判据是 `isFeedItem(item)`，主操作走
  `onSubscribeFeed`（订成 `rss:podcast`），不出播放按钮、不进队列、不进播放页。
  ⚠️ 新增「播放」入口（卡片/命令面板）一律经 `usePlayerNav` 收口
- **搜索添加有两类目标**（2026-10-16）：搜房间（`SEARCH_CHANNEL` → live 渠道，
  roomIds 列表参数可「并入已有」）与搜用户（`USER_SEARCH_CHANNEL` →
  `bili:user_video`/`youtube`，uid/channelId **单值参数无并入**，targets 恒空自动隐藏
  「添加到」区块）。⚠️ 用户模式的落地参数名用**显式表 `USER_SUB_PARAM`**，不能取
  `sourceInfoTpl[0]`——`youtube` 渠道首参是 videoId（订阅单视频），频道订阅是第二参
  channelId。候选值从 **url 解析**（`candidatesFromUsers`：`space.bilibili.com/<mid>` /
  `channel/<UC...>`）——raw 不穿 XML 边界，粉丝/订阅数走 summary 字段。
- **「清除凭证」现在会真正登出浏览器账号**（2026-10-19）：桌面 xhs/weibo/抖音抓取用的是
  Edge profile 的登录态，只清 `settings.*Cookie` 等于没退。账号页的清除按钮先调
  `browser.clearCookies(<域后缀>)`（按域精确删除，不连带其它平台），再清 settings；
  中途失败则 settings 保持不动。⚠️ 不要改成 `clearBrowserCookies`（会登出所有站点）。
- **`loginable` 是「支持扫码登录」，不是「必须登录」**：抖音直播/分区搜索等匿名也可用。
  渠道 chip 用紧凑 QR 标记（13px + accent-soft pill），并按**平台**聚合 —— 同平台
  任一渠道支持登录就给该平台所有 chip 同一标记；不要用文字 tag「需登录/可扫码登录」
  （太小读不懂、像警告）。选中渠道后另有登录说明，入口统一在「账号与凭证」
  （2026-10-19 修正）。
- **手工添加直播房间也能并入已有订阅**（2026-10-19）：`AddSubscriptionDialog` 手工模式下，
  `roomIds` 列表型参数会列出同渠道已有订阅；提交时用 `splitValues` 合并去重，
  不新建。搜索模式的「添加到」同义。
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
- **发现页能力矩阵只显示已实现入口**：不再渲染「无渠道」灰行；没有分区/搜索能力的
  平台整卡不出现（微博/小红书走「可订阅榜单」）；切平台时视图自动落到该平台支持的
  第一个能力（`DiscoverPage` 的 `pickPlatform` + `caps` 效应）。平台卡用
  `flex-direction:column` + `.chip-row{margin-top:auto}`，能力行数不同也把操作按钮
  固定在卡片底部。
  ⚠️ **分区目录本身是一个订阅**（`twitch:categories` 等，产 `kind:"category"` 条目），
  不是发现页的一次性目录。它出现在「可订阅榜单」里，点分类卡片 → URL 变 `?open=` →
  右侧**用正常网格**列出该分区内容（条目自带的 `categoryChannel` + **完整 `categoryInfo`**
  调 `previewChannel`，苹果播客式二级）→ 表头「订阅该分区」。
  ⚠️ 预览条目的 `subscriptionId` 是 `preview:<channelKey>`、没有订阅记录 —— 播放解析在
  core 里按这个前缀补默认 info（`previewInfoFor`），否则会误报「不指向可解析的直播链接」。
  ⚠️「浏览分区」入口（已知分区 ID 直接取内容）用显式 `CATEGORY_CHANNEL` 表，
  不按 `<platform>:category` 命名约定 —— `youtube:live-category` 不在约定里；
  手输参数**逐字段渲染 `sourceInfoTpl`**（抖音 `partition + partitionType` 双参不会漏）。
- **发现页搜索与「添加订阅」同形态**：两者共用 `AddPanels.tsx` 的 `CandidateList`
  （缩略图 + label/sub/meta + 选中态 + 已订阅标记）。发现页（分区/搜索/搜主播）的
  结果都转成候选，选中后可直接 `addSubscription`（roomId/videoId 单值），不用再开
  弹窗；「订阅该搜索词」仍走 `AddSubscriptionDialog`。
- ⚠️ **不用原生 `<select>`**：下拉面板由 WebView/系统渲染，深色主题下弹的是**亮色
  系统菜单**且 CSS 管不到。统一用 `components/Modal.tsx` 的 `Select`（radix，自带浮层）。
  同理 `Switch`/`Menu`/`Modal` 都在那个模块。原生 `<input>`/`<textarea>` 保留（可主题化）。
  ⚠️ **占位提示走 `placeholder`，不要塞进 `options`**（否则会渲染成可点击的
  `role=option`，选它只是空操作）；无空值选项时 Root 的 `value` 必须是 `""` 才显示
  placeholder —— 内部哨兵 `__none` 会被 Radix 当成已选值。选项可带 `disabled`
  （如未声明 L9 支持的渠道）。
- ⚠️ **浮层必须处理视口**：共享 `Menu`（Radix DropdownMenu）已配 `collisionPadding`，
  `.menu` 用 `--radix-dropdown-menu-content-available-height` 限高并内部滚动；不要在
  业务组件里自造 absolute 菜单/提示层，否则窗口底部会贴边或顶出视口。
- ⚠️ **加了新依赖必须重启 dev server + `bun install`**：Vite 的依赖预打包只在启动时做，
  热重载不会补新包 → `Xxx is not defined` / `Failed to resolve import` 白屏或 Vite
  error overlay。workspace 包（如 `@amoeba/xml`）还须先在**消费方
  package.json** 声明 `workspace:*`（desktop 曾在缺该声明时炸过：store 一 import 就白屏）。
  改完清 `node_modules/.vite` 后 `bun install` 再重启。
- ⚠️ **元素级 reset 必须写在 `@layer base` 里**：`styles.css` 的 `@layer base{}` 一旦被
  自己提前 `}` 收尾，后面的 `button/h1/ul` reset 就成了**无层规则** —— 而**无层 CSS
  优先级高于所有 `@layer`**（Tailwind 4 层序 `theme < base < components < utilities`）。
  后果：`button{background:none;border:0;padding:0}` 把 packages 里所有 tailwind 按钮的
  `bg-*`/`border-*`/`px-*`/`py-*` **全废掉**（渲染成无边框无内边距的裸按钮）。
  app 内看不出来（desktop 用自己的 `.btn`/`.icon-btn`，同为无层、自己就能赢），
  受害的是 `packages/player`、`packages/ui` 这类只靠 utility 的代码。
  2026-10-14 修复：把 `h1..figure/ul,ol/img/button,input,select,textarea/button` 全部移进
  base 层。**改 styles.css 的结构性规则后，务必用 CDP 量一次真实 computed style**
  （`getComputedStyle(btn).padding` 应为 `6px 12px` 而非 `0px`）。
- ⚠️ **app 的 `styles/` 是无层 CSS；Tailwind utility 在 `@layer utilities`**。同一属性
  若被无层语义类设置（如 `.stack{gap}`、`.pane > .scroll-area{flex}`、
  `.article-body{...}`），utility 会被压过，表现为「类写了但没生效」。给已有语义类
  元素加 utility 覆盖前先 grep 该属性；必要时保留 inline 或改语义类，不要盲目加 `!`。
- **字体**：IBM Plex 自托管（`apps/desktop/public/fonts`，~136KB，离线可用）。
  Sans=UI/标题，**Serif=正文**，Mono=数字/通道号。中文回落到系统栈（字体包太大不随包）。
- **视觉基调**：暖石墨中性（色相 72/75）+ 琥珀 accent；深/浅两套同色相，改一处要改两处。
  对比度用 `scripts/ui-design-audit.ts` 复测（目标 0 处低于 WCAG AA）。
- ⚠️ **UI 自动化的 CDP target 必须按 URL 过滤**：DevTools 自己也是 `type: "page"`，
  取第一个会连到 DevTools 而不是应用页面（曾因此截了一堆 DevTools 的图当"应用截图"）。
- ⭐ **抓取用 Edge 的 CDP 端口固定 9223，可从外部脚本直连**（`GET http://127.0.0.1:9223/json/list`
  → page target → WebSocket `Runtime.evaluate`）。验证 browser 侧行为（页面 state / 滚动 /
  翻页方向）不必往产品代码加日志：前后两次读 `__INITIAL_STATE__` 对比即可（2026-10-20 用它
  定位了 explore 分页方向）。⚠️ 两个测量陷阱：① state 树里有**循环引用**（`user.loggedIn`
  可能是对象），`JSON.stringify` 整棵树抛「Converting circular structure」—— 只挑标量/字符串
  再序列化，布尔判据写 `=== true` 或解 `_rawValue`；② 虚拟列表 `scrollTo(0,0)` 后**立即**读
  `innerText` 拿到的是滚动前的卡片（Virtuoso/masonic 重渲染是异步），等 ~1s 再读，否则会把
  「顶部没变」误判成「顶部被换掉」。
- ⚠️ **正文里的外链必须拦截**：`.article-body` 的委托 click 命中 `<a>` 要走
  `openExternalSafely`；不拦的话 WebView 会整页导航走（应用没配 Tauri `on_navigation`），
  界面被外部网页顶掉、只能重启才回来
- ⚠️ **卡片主操作按 kind 分流**：`MediaCard` 里 `social` 走「开详情弹窗」、其余走「播放」——
  social 无可播流，误当视频播会进「不指向可解析的视频链接」的破碎播放页。
  混合 feed（全部/分组/智能订阅）里的 social 走的是 `MediaCard`（只有**整屏都是 social**
  才走 `SocialCard` 瀑布流），所以这条分流必须在 `MediaCard` 里，不能只靠 `SocialCard`。
  `usePlayerNav.onPlay` 另有一道收口兜底。
- ⚠️ **主区里不在滚动器内部的元素是「滚动死区」**：`body` 是 `overflow:hidden`，鼠标停在
  这些元素上找不到可滚祖先 → 滚轮完全无反应（用户会描述成「页面无法上下滑动」）。
  `MediaMain` 的 `.grid-head` / `.rail-block` 曾占掉 **59% 的视口**。
  ✅ **正解是把它们移进滚动器内部**（hasMix 走 `VirtuosoGrid` 的 `Header`；socialOnly 走
  `MasonryGrid` 的 `header` prop）—— 既消除死区，又让**头跟着一起滚**（整体滚动）。
  ❌ 不要用「捕获阶段转发 wheel」绕：那只是内容滚、**头依旧固定**，不是用户要的。
  ⚠️ **测滚动必须用真实滚轮**（CDP `Input.dispatchMouseEvent{type:"mouseWheel"}`）：
  合成 `WheelEvent` 在 Chromium 里**不触发滚动**，会得出假结论。⚠️ 也别 navigate 后**立刻**测 ——
  启动骨架存活期（~900ms）与 masonic 的测量窗口期都会让容器「暂时不可滚」，**多采样几次**再下结论。
  判据要看**头部矩形是否随之移动**，不能只看 `scrollTop`。
- ⚠️ **样式拆成多文件后，同名类会跨文件叠加**：`.rail-head` 曾同时给**侧栏**和
  **直播区**定义（侧栏那份是 `flex-direction: column`），叠加成 `column` + `wrap`
  → 子元素纵向堆叠还横向换列，头部从 28px 涨到 **132px**。**新组件用模块前缀**
  （直播区用 `live-*`，与已有的 `.live-pulse` / `.live-online` 一致），别借侧栏命名空间。
  改样式前先 `grep` 类名在 `styles/` 下出现了几次。
- ⚠️ **canvas 清屏别用 CSS 尺寸**（`DanmakuLayer`）：位图是 `round(w * dpr)`，dpr **非整数**时
  它比 `w * dpr` 大 —— 实测 dpr=1.875、w=516 时位图 968 列而 `516×1.875 = 967.5`，
  `clearRect(0,0,w,h)`（经 `setTransform(dpr)` 缩放）**漏掉最右那半列**。白色弹幕从右缘
  进入（`x = w`）画进去后永久残留 → 播放器右侧一条白竖边。正确写法：**复位变换 +
  `clearRect(0,0,canvas.width,canvas.height)`**，再设回 dpr 缩放。
  ⚠️ **只在非整数 dpr 下暴露**（Windows 150%/187.5% 缩放），dpr=1/1.25/1.5/2 都测不出 ——
  复现这类问题**先问用户 `devicePixelRatio`**，别只在默认 dpr 下扫。
- **列表虚拟化**：网格 = VirtuosoGrid，文章列表 = Virtuoso。⚠️ 尺寸走
  `listClassName`/`itemClassName`（CSS），**不要用 `components.List/Item` 覆盖** ——
  List 的 inline style 带 virtuoso 的虚拟化偏移（paddingTop/Bottom），覆盖会让滚动定位错乱
- **首启种子订阅**在 `apps/desktop/src/dev/seed.ts`（SEED_SUBSCRIPTIONS + SEED_GROUPS，仅 dev 构建动态 import）。
  **覆盖全部 channel**（每个 channel 一条，2026-10-20）：需登录的 `bili:dynamic` / `weibo:user`
  停用；关键词搜索类（`*:search` / `*:anchor` / 搜频道 / 搜UP主）进「搜索」组且**默认停用**
  （启用即测）；36 条内置 RSS 直链属同一实现，只留 `rss:hn` 代表。
  首次写入后落 `dev:seeded` 标记 —— **重置数据/手动删空后不会再次写入**（要恢复测试种子：
  删掉该 KV key 或整个 dev DB）。⚠️ **只在空库 + 无标记 + `import.meta.env.DEV` 下写入** ——
  之后再启动不覆盖（否则用户 CRUD 的订阅会被启动时删掉）；生产构建里种子 import 被摇掉，
  **发布版首启是空库**（走 onboarding）。⚠️ **改了种子列表存量 dev 库不会自动补** ——
  需「设置 → 存储与诊断 → 完全重置数据」或删 dev DB 再启动。
- **存储与诊断 → 完全重置数据**（`settings/Diagnostics.tsx`）：删空 SQLite KV + 清
  localStorage，然后整页重载；dev 下写 `dev:seeded` 防止种子回填。**不碰**浏览器
  profile/登录态——那是同页「清理浏览器数据」的职责。
  ⚠️ **DB 按运行形态隔离**（`packages/host/src/tauri/sqlite-storage-backend.ts`）：
  生产 `rss.db` · 普通 dev `rss.dev.db` · release debug `rss.release-debug.db`
  （`scripts/tauri.ts` 在 `--release` 时给 Vite 注入 `VITE_AMOEBA_PROFILE`）。
  release debug 仍走 Vite dev server（DEV=true），会在自己的库里写种子
- **一键按类型归组**（`store/index.ts` 的 `autoGroupByKind`）先把未分组订阅按
  `channelKind` 分桶，**只为实际有成员的 kind 建组** —— 否则会留下 0 成员空分组
  （用户看着像归类失败）；带撤销（分组本身留着）
- 内置 RSS 直链清单 `packages/crawler/src/channels/rss/builtin.ts`；可用性结论见
  `docs/domestic-feed-availability.md`。新源先 curl 验证再并入（注意新浪科技带
  `xml-stylesheet`，会误判 HTML，实为真 RSS）
- ⚠️ **`AddSubscriptionDialog` 的 `rss:` 过滤器只放行两个**：`rss:url`（任意直链）
  与 `rss:podcast`（播客，解 enclosure → 可播条目）。其余 `rss:*` 是 36 条种子清单，
  列出来太噪。⚠️ 曾把整个 `rss:` 前缀滤掉 → **手工加外部 feed / 订阅播客都没有入口**
- ⚠️ **`MediaItem.id` 只在订阅内唯一，跨订阅会撞**：实测 `bilibili:7734200` 同时在
  `bili:live`（roomIds 解析成该房）与 `bili:live:hot`。凡是「按 id 记/改/查」的地方
  **都要带 subscriptionId**，否则两个订阅互相串：
  - **reading 键** = `readingKey(subId, itemId)`（`core/types/reading.ts`，分隔符 `\u0000`）。
    `subscriptionId` 是必填 —— 不再有裸 id 形态（旧版回退已于 2026-10-19 删除）。
  - **内存 store** `patch(subscriptionId, id, patch)`（`media-store.ts`）—— 原来按裸 id
    打**所有**订阅的同 id 条目。
  - **播放队列**存 `itemKey` 复合键 + 落 localStorage `ui-queue`（原来只存内存，重开就没）。
  - 定位用 `findItem(items, subId, id)`；列表 key 用 `lib/media.ts` 的 `itemKey`。
- ⚠️ **播完自动下一条**（`core` settings `autoPlayNext`，默认开）：`PlayableMedia` 的
  `onEnded` 必须**两处都挂** —— video 挂 `videoRef`，播客（audio）挂 `AudioShell` 的
  `audioRef`。只挂前者的话音频播完永远不触发（audio 根本不经过 videoRef）。
  播过的当前条同时出队（队列是待播列表，不是播放历史）。
- ⚠️ **通用 RSS 文章按需补全正文**：feed 只带 description 摘要时，点开阅读视图会抓
  `item.url` 原文页、提正文纯文本（`crawler/channels/rss/extract.ts`，零依赖正则启发式
  —— 全仓无 HTML 解析器，HTMLRewriter/DOMParser 各只在一端）。阈值：feed 自带正文
  可见文本 ≥ `FULLTEXT_HINT`(800) 则**不抓**（不把好 HTML 降级纯文本）；`ReaderMain` 只对
  可见文本 <400 的 article 触发。UI 侧经 `dl.resolveDetail`（`ItemDetailSource`，与 xhs 同一条
  能力总线，已从 `resolveSocialDetail` 更名）。SPA / 反爬占位页提取失败 → 回退原摘要。
  **持久缓存**：抓到的正文落 KV（`core/repo/body-cache-repo.ts`，`body:<sub>:<item>`），
  退订一并清；**只对 article**（xhs social 补全含多图/标签，只缓存 content 会丢）。
- **Numbered UI Overlay**（`apps/desktop/src/dev/ui-overlay/`，dev-only）：`Ctrl+Shift+U`。
  扫描**已挂载 + 视口内**的候选 = **组件显式声明的区块**（`data-ui-overlay-block`）
  + 自动发现的可交互控件。区块用 `lib/uiOverlay.ts` 的
  `{...overlayBlock("kind", "可选业务 key")}` 声明（DEV 之外返回 `{}`，生产无属性）；
  区块 = 绿色标签 + **整个区块的绿色描边边界框**（随滚动实时重定位），控件 = 琥珀
  标签；工具栏可「仅区块」。`400` 是**同屏标签上限**，不是编号
  上限（编号可超 400，超出部分只显示 `+N`，**区块优先保留**）。同一元素/条目在本路由
  会话内编号固定：稳定 key 优先取 `data-ui-overlay-key` / React fiber 业务 id
  （`item.subscriptionId:id` / `sub.id` / `group.id`），其次 data-* / 唯一 id / 列表
  标题；虚拟列表滚出滚回、DOM 重建都复用同号。路由变化重置，隐藏/显示不重置。
  见 `docs/numbered-ui-overlay.md`。

## 调研文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/platform-login-research.md` | 三平台扫码登录 + 保活设计（仅 bili 可自动续期） |
| `docs/danmaku-research.md` | 弹幕机制（VOD 分段 / 直播四平台 codec） |
| `docs/youtube-stream-extraction.md` | YouTube 直链（ANDROID_VR / poToken / DASH 自拼） |
| `docs/xhs-signature-research.md` | 小红书签名史与社区现状复核 |
| `docs/twitch-channel.md` | Twitch 渠道（匿名公开 GQL + PlaybackAccessToken + usher HLS；频道/热门/分区已做，VOD/clip/聊天/搜索未做） |
| `docs/desktop-crawler-service.md` | desktop 爬虫服务化选型与切分边界 |
| `docs/capability-gaps.md` | 各平台能力缺口（分区/搜索/主播） |
| `docs/channel-expansion-research.md` | YouTube 直播热门/栏目、YouTube 播放列表、B站合集/视频列表/收藏夹、分区目录订阅（`kind:"category"` + `*:categories`）（均已实现，2026-10-20） |
| `docs/cli-plan.md` | apps/cli 调试工具计划 |
| `docs/sqlite-storage-research.md` | 存储三态与迁移 |
| `docs/domestic-feed-availability.md` | 国内 feed 可用性实测 |
| `docs/image-loading-referrer.md` | 防盗链图方案（含 Rust 自定义协议评估） |
| `docs/rsshub-vs-crawler.md` | RSSHub 对照结论 |
| `docs/folo-architecture-research.md` | Folo 架构调研（云端聚合，不能照搬） |
| `docs/mpv-playback-research.md` | 外部播放器 mpv 接入（未做） |
| `docs/mobile-cdp-feasibility.md` | 移动端 CDP 可行性（未做） |
| `docs/smoke-check.md` | ★ 端到端巡检清单（改了什么 → 跑什么） |
| `docs/rail-tree-accordion.md` | 侧栏树选型（为何用 Accordion 而非树组件 + 三个静默失败坑） |
| `docs/audit-backlog.md` | 审计发现积压：故意不改的理由 + 误报证伪（已修不在此） |
| `docs/compatibility-inventory.md` | 兼容补丁清单（持久化数据 / 输入归一化 / 脚手架 / 破坏性变更）+ 侧栏菜单视口审计 |
| `docs/crawler-risk-control.md` | ★ 风控分级（L0 / L1 / L2 / L3 / L9）+ 集中式 governor + CDP 被动采集；窗口模式、governor、L9 闸门与 xhs:explore / xhs:user 被动采集已实现 |
| `docs/release-updater.md` | 发布产物（NSIS）、签名密钥、自动更新链路与发版步骤 |
| `docs/numbered-ui-overlay.md` | Numbered UI Overlay（dev-only，已实现）：编号语义/400 上限/AI 清单 |

## 下一步

**未做的功能**（按可行性排序）：

- **自动保活**（仅 bili 可行）：扫码已拿 `refresh_token`，但无续期调度——登录态到期
  只能重扫。协议与量级见 `docs/platform-login-research.md`（`bili_ticket` 软因子 /
  `SESSDATA` 硬凭证）。
- **desktop 爬虫服务化**：形态待选型（倾向自研 sidecar）——切分边界与落地清单见
  `docs/desktop-crawler-service.md`。
- **bili 按分区列房**：`second/getList` 需登录，匿名带 buvid3/wbi 实测仍 `-352`。
- **B站直播分区目录**：其余平台的分区目录订阅已完成（`*:categories`）；B 站
  `second/getList` 需登录，匿名 `-352`，暂不做。
- **移动端扫码登录**：`Loginable` 已具备，移动端 CDP 不可行（`docs/mobile-cdp-feasibility.md`）。
- **抖音登录态搜索调研**：先用专用小号 + CDP 被动探针确认 `live/search` 的页面自然
  请求与账号风险，再决定是否实现（不要把主账号 cookie 直接接到 API 搜索）。
- **live 按平台二次聚合**：`tab:live` 已聚合**全部** live 条目（`selectors.baseFor`
  的 tab 分支 `filter(kind==="live")`，方案 B，2026-10-13 落地）。若要「哔哩哔哩直播 /
  虎牙直播」这类**按平台**再分组，需在 core 编排层加二次聚合——问题定性与 A/B/C
  方案对比见 git 历史的 `docs/technical-plan.md`（2026-10-16 删）。
- **播放器「流状态监控」**（stats for nerds，右键菜单）：仿 YouTube 右键「统计信息」，
  展示当前引擎（hls / flv / dash / 原生）、实际档位与分辨率、码率/缓冲区、丢帧、
  音轨、以及宿主隧道耗时。落点 `packages/player` 的控件层；数据源已在
  `useMediaStream` / `PlayableMedia` 的引擎句柄上（`currentLevel`、`levels`、
  `<video>` 的 `getVideoPlaybackQuality()`），不需要新依赖。
- **二级订阅进入时的骨架屏形态**（UI 细节）：`MediaMain` 在 `?open=` 预览时复用了
  全局 `GridSkeleton`，与内容形态（播客单集是行列表、分区房间是网格）不对应 ——
  按容器 kind 给对应骨架（单集行 / 房间网格），别让骨架和落地内容差太多。

**待实机验证（风控 / LX，没跑过不算完成）**：

- release 实例：`browser_set_mode` hidden ↔ interactive 切换 + `xhs:user` 翻页各一次。
- `xhs:explore`（现默认 L9）手动刷新，确认命中 `passiveBuffer`；未命中时应走页面 SSR 兜底。
- `xhs:user` L9：登录态导航能出条目；匿名应回退缓存。
- 接入 LX 前用 `Network.requestWillBeSent` 逐平台确认风险文档 §3.11 标「推断/未确认」
  的页面请求。
- ⚠️ **governor 的 `rsshub` 平台配额是死键**：平台名按 host 推导，需改成 host 后缀
  匹配或显式映射（当前 RSSHub 请求落到通用 host 桶）。

**已完成的**（细节在代码与 git log，不在此堆叠）：三分栏/瀑布流/短视频三模式、续播与
阅读进度、OPML 导入导出、扫码登录 UI、文章正文补全（含 KV 持久缓存）、mobile 接入、
抖音用户直播间（主页链接 → 抖音号 → 房间）与分区搜索（2026-10-18）、
Numbered UI Overlay（dev-only，2026-10-18）、RSSHub 收口为 `rsshub:feed` +
`bili:precious` 收编（2026-10-18）。

**长期悬置**（收益不抵复杂度，暂不做）：
- **CSP**：现 `csp: null`。要配最小 CSP 须放 `unsafe-eval`（抖音/斗鱼签名脚本靠 `eval`），
  收益有限。
- **live 分组聚合的 UI 侧**：见上「live 按平台二次聚合」。
