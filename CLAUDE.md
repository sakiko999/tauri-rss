# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。
桌面 = **订阅工作台**（抓取/播放/管理全功能）；移动 = **极简看内容**（未读列表 → 播放/阅读，
已接 appHost+core）。两端定位分离：desktop 数据供给走独立爬虫服务（承载重反爬平台），
mobile 保持内置 crawler 仅有限平台。决策见 `docs/architecture/crawler-topology.md`。

## 目录结构

```
apps/
  src-tauri/   应用 Rust crate（amoeba），desktop/mobile 共享 commands/plugins；
               另有 browser-sidecar / runtime 两个独立 crate
  desktop/     React 19 + Vite + Tailwind 4 → dist/desktop
               订阅工作台：rail 侧栏（主导航/内容类型/智能订阅/分组树）+ 七种视图意图
               home 看板（`/`）/ reader 三栏 / media 网格 / hot 热搜 / page 整页 /
               player / shortvideo 全屏流（`/library` 深链落「未开放」说明，P1）。
               状态 src/store/（nodes 节点语法 · selectors 派生 · prefs 偏好 · index 编排），
               视图 src/views/，样式 src/styles/（按区块拆分，入口只留 @import 顺序）。
  mobile/      ⛔ **已冻结（2026-10-26）**：除主动开启外，后续改动不为 mobile 做适配/回归
               （不跑 mobile tsc/build、不加注入开关或 UI 分支）。保留为进程内
               `createDataLayer()` 的只读参考：极简「看内容」闭环 + RSS 直链订阅管理。
  cli/         ★ 调试探针（Bun + cac 零构建）+ 数据服务载具。默认本地探针宿主 =
               node 后端 + bun:sqlite（apps/cli/.data/rss.db）；`--service` 跑单写者服务，
               `rss attach` 作为桌面服务的客户端。详见 docs/ops/commands.md
  browser-sidecar/  amoeba-browser：无 Tauri 依赖的 WebView2 宿主（屏外窗口 + CDP）。
               CLI `--browser` 时由 packages/host/src/node/browser-sidecar.ts spawn，
               与 desktop 共用 @amoeba/host/cdp 的 lane/超时/拦截语义
  runtime/     amoeba-runtime：小体积 Bun 启动器（Rust）。解析顺序
               AMOEBA_BUN → 全局 PATH → 随包 → 缓存 → 下载固定版本（SHA256/原子解压），
               然后 spawn 入口并透传 stdio/退出码。stdout 只留 READY，日志全走 stderr
packages/
  xml/         ★ RSS 2.0 + tpl: 编解码（fast-xml-parser v5）。唯一持有该依赖
  host/        ★ 宿主后端 + 全局 appHost 门面（runtime.ts）。node/browser/tauri 三态；
               net/governor.ts 统一治理所有 appHost.http（分级/并发/RPM/冷却/去重）。
               应用走子路径 `./node|tauri|browser|cdp|runtime|governor`；根入口无 import 副作用。
               `browser/*` 是载具无关的 CDP 核心（BrowserDriver 收敛桌面/CLI 差异）。
               桌面媒体防盗链走 WebView2 请求头注入（src-tauri/media_referer.rs：
               图片/视频改 Referer，XHR/fetch 改 Origin——规则表在 resolve
               media-referrer.ts，parity check 守护）；图片/实况均恒直连，无 JS 回退
  resolve/     ★ 平台解析层：platform/（各平台 client + 播放解析 + 弹幕 codec）、
               resolver/（by-url 路由）、browser/（CDP 模拟）、utils/、danmaku/ 原语。
               契约：按 item.url 懒解析 + 平台 client 供 crawler 取数。类型自持，不依赖 crawler
  crawler/     ★ 订阅源抓取层，只输出订阅数据。一切皆 RssChannel：定义 + getSource → { fetch }，
               取数经 resolve 的平台 client。不绑定流/弹幕解析。输出标准 RSS + 最小 tpl:*。
               可选 channel 能力：Pageable / HotWordSource / ItemDetailSource / Loginable / passive
  core/        订阅维护者：基于 crawler 输出维护订阅/分组/刷新编排/持久化；自解析 XML 建
               MediaItem（不依赖 crawler 类型）
  player/      ★ 媒体播放器（video/audio/live 共用）。PlayableMedia = 唯一入口（懒解析 + 选流 +
               分发）+ VideoShell/AudioShell + 独立控件。依赖 core 类型 + appHost 隧道 + hls/flv/dash.js
  platform/    ★ 平台名单一权威（R9）：channelKey 前缀 / URL 域名 / cookie 字段 / 展示名。
               零依赖叶子，host（governor）与 core（cookie 注入）共用。
  log/         零依赖叶子：域注册语义化日志（log="0" 全局关 / log:<域>="0" 按域关）
  service-protocol/ ★ 服务 HTTP/WS 契约（45 个 RPC 方法 = 36 个 DataLayer 语义方法 +
                   refreshAll/diagnostics/probe + snapshot/event/job 类型）
  service-client/   ★ RemoteDataLayer：desktop/CLI 共用。读本地镜像、写 RPC、WS 事件；
                   运行时不 import core 根入口（避免拉进 crawler/resolve）
  ui/          ⚠️ 只剩原子件：desktop 仅引 MediaImage（原生直连，防盗链归 Rust 注入）与 fmtCount
```

依赖链 `resolve ← crawler ← core`，播放支线 `core ← player`；`log` 是零依赖叶子；
`host` **不依赖 core**（DDL 仍归 core，由 `createDataLayer()` 经
`appHost.storage.setSchema?.()` 注入 SQL 后端），`resolve` **不依赖 host**
（防盗链 Referer 规则在 `resolve/media-referrer.ts`）。
读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装；新直引前先问
「能否经 core 门面」。

**desktop 组件分层**（加组件前先定层）：`src/components/*.tsx` = 功能件（纯 props、不碰 store）；
`src/components/app/*.tsx` = 业务件（读 `useDesktop`/`usePrefs` 或吃 domain 类型）。
判据 = 有没有 `useDesktop`/`usePrefs`/`@amoeba/core` 类型 / domain 常量。文件名统一 PascalCase
（仅 `main.tsx`/`router.tsx` 这类入口保留小写）。位置权威 = URL（`/v/:nodeId`、`/play/:itemId`）。
store 收敛点：`syncSubscriptions()`（变更后「重读+重绘」唯一入口，内含 `refreshView()`，
**必须先修 `selectedNodeId` 再调**；8 处调用，**不要**用于 `toggleSubEnabled` —— 启停不改
内容集）· `lib/useLatestOnly.ts`（请求世代守卫，只能丢弃不能取消）。

## 界面守则：布局负责解释，文案只补布局说不出的

- **一个事实只说一次**。标题 + 副标题 + 帮助文 + toast 重复同一句 = 三份迟早不一致的副本。
- **删「是什么」，留「会怎样」**。「阅读行宽 / 正文栏的最大宽度」是废话；
  「间隔内刷新复用缓存，不会重复访问源站」才改变用户的选择。
- 说明文字只留四类：**不可见的后果**（退订会删缓存）、**反直觉行为**（锁最高档不自动降清晰度）、
  **跨平台差异**、**隐私/安全承诺**。其余一律删。
- **优先改布局，不加提示**：同一信息两处出现 → 合并分组、用选中态/图标表达；
  信息缺失 → 补结构，不补小字。
- 每加一行小字先自问「删掉它，用户会做错哪一步」；答不上来就删。
- UI 里**不出现技术标识**（channelKey、内部 id、字符数、能力计数），它们只进「存储与诊断」。
- 例外：**空态/错误态**必须写清真实失败模式与下一步动作（`components/StateBlock.tsx`）。

## 硬契约（违反即静默错）

- **crawler → core 的唯一通道是 XML**：channel 设的每个字段要到达 UI，serialize 必须写、
  deserialize 必须读，漏一边就静默丢。回归 `serialize-roundtrip.check.ts`。
  见 `docs/architecture/data-and-storage.md`。
- **`MediaItem.id` 只在订阅内唯一**：凡「按 id 记/改/查」都要带 `subscriptionId`
  （reading 键、store.patch、播放队列、findItem）。见 `docs/architecture/data-and-storage.md`。
- **选流 = `streams[0]`**，产流侧（resolve 平台解析）保证最高清晰度排最前，player 不做二次排序。
  见 `docs/playback/playback.md`。
- **可播判定 = kind 门控**（video/audio/live）+ `isFeedItem`（audio 且无 stream = 播客 feed）。
  新增「播放」入口一律经 `usePlayerNav` 收口。见 `docs/ui/ui-conventions.md`。
- **appHost 全局注入**：必填 `http`/`js`/`storage`，可选 `ws`/`browser` 未注入即降级；
  打开外链必须走 `openExternal`（WebView 拦 `window.open`）。见 `docs/architecture/host-abi.md`。
- **日志统一 `@amoeba/log`，不走 appHost**（`appHost.log` 已删）：包内 `createLogDomain("域", { events })`
  写语义事件，不直写 `console`；开关 `log="0"` 全局 / `log:<域>="0"` 单域，`warn/error` 永留。
  服务进程用 `setLogSink` 把全部级别写 stderr（stdout 只留 `READY <port>`）。
  **同形事件用共享模板**（登录 spread `LOGIN_EVENTS`、弹幕初始化 `DANMAKU_EVENTS`），
  异常参数一律 `formatError(e)`（不要 `(e as Error)?.message`），正常回退路径用 `debug`。
  回归 `packages/log/src/example/log.check.ts` + `packages/resolve/src/example/login-events.check.ts`。
- **存储 DDL 唯一权威 = core `db/schema.ts`**（插件自带 migration 不用，防漂移）；
  由 `createDataLayer()` 首行经 `appHost.storage.setSchema?.()` 注入 SQL 后端，host 不 import core。
  `_migrations` checksum 变化 → 拒绝启动；已发布迁移只能追加新版本，不能改 SQL。
- **数据服务单写者**：Tauri 桌面默认 `service_endpoint` → `@amoeba/service-client`，
  `injectTauriHost({storage:false,browser:false})` 把 desktop 的直连封死
  （进程内 DataLayer 回退已删除）。任何第二写者
  （desktop 直连、dev seed、Diagnostics、CLI 直开 desktop 库）都会静默丢数据。
- **服务协议**：`protocol` 整数不兼容才 +1；RPC/事件类型唯一权威 = `@amoeba/service-protocol`；
  一次提交 `rev+1` 可带多条事件（共享 rev）；断线/rev gap 先全量 `GET /v1/state`，
  不做事件补丁恢复。stdout 只留 `READY <port>`，日志全走 stderr。
- **平台 cookie 三级语义**（`resolve/platform/credentials.ts`）：调用点显式非空 > 显式
  **空串 = 强制匿名**（CLI `--kv cookie=` 依赖；xhs 会因此报「需要登录」）> provider
  （settings 登录态，core DataLayer / CLI 入口注册同一张表）。**渠道层不许再手抄
  channelKey→cookie 前缀表**
  ——单一权威 = core `cookieFieldFor`；「同形渠道」优先用 crawler `makeApiChannel`
  工厂（接线/channelOptions/翻页样板收敛处，cookie 在 fetchPage 闭包从 info 取一次）。
  漏传案底：bili:user_video 412 / favlist 私有夹 / douyinCookie 死键。

## 环境与工具

- **必须从 "x64 Native Tools Command Prompt for VS 2022" 启动终端**，否则 Rust 链接失败。
  Git Bash 的 `/usr/bin/link` 会抢 MSVC（`/usr/bin/link: extra operand`）；
  **不要在 `.cargo/config.toml` 里写死 linker**（硬编码 MSVC 版本，VS 更新必坏）。
- `cargo build/test` 前若 amoeba.exe 在跑会锁二进制（`拒绝访问 os error 5`）：
  `taskkill //F //IM amoeba.exe`。⚠️ 进程名 = Cargo **package name**；改名时一并检查
  `tauri.conf*`、`Cargo.toml`、`main.rs`/`tests/*_lib`、`.vscode/{tasks,launch}.json`、以及
  `apps/cli/.../browser-reset.ts` 里硬编码的 identifier 副本；**并清 `target/debug` 下旧包名
  的产物**（`cargo clean` 只认当前包名哈希，旧 `.rmeta`/`build`/`.fingerprint` 会残留并让
  rust-analyzer 报 `cannot find module or crate *_lib`）。
- ⭐ **`bun run tauri:release`（`tauri dev --release`）** 用来调「只在 release 才走」的分支
  （`!cfg!(debug_assertions)` 是编译期判据，如 Windows 子系统）。保留 Vite dev server 与 Rust 热重载，
  但首次全量 release 编译（~4min），且**不叠 `tauri.conf.dev.json`**（不开 9222）。
  ⚠️ release 默认无调试符号：要断点用 `CARGO_PROFILE_RELEASE_DEBUG=true`（**环境变量**，写进
  Cargo.toml 会让发布安装包也白塞符号），只在**首次构建时**生效（已构建过需删 release 产物重建）。
  ⚠️ 别 `taskkill /IM msedgewebview2.exe`：那是应用窗口进程，杀它 = 应用退出。
- **单验 release 行为不必重编**：设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  后直接跑 `target/release/amoeba.exe`，另起静态服务喂 `dist/desktop`（否则停在 `chrome-error://`）。
- tsc 用根 `./node_modules/.bin/tsc -p <项目>`；**不要** `npx tsc`（会误装 tsc@2.0.3），
  **不要**裸 `-p tsconfig.app.json`（扫全仓含 `tmp/` 噪声）。
- ⚠️ **改源码一律用 Edit/Write，不要用 PowerShell `Set-Content -Encoding utf8` 整份重写**
  —— 中文/UTF-8 会按代码页往返损坏成乱码。
- **加了新依赖必须 `bun install` + 重启 dev server**（Vite 预打包只在启动时做）；workspace 包
  还须在**消费方 package.json** 声明 `workspace:*`。改完清 `node_modules/.vite`。
- **Git 身份未全局配置**，提交需内联：
  `git -c user.name="zhh" -c user.email="zhonghuaremistinker@gmail.com" commit -m "..."`。
- `tmp/` 是 gitignore 的参考项目（RSSHub / MediaCrawler / NewPipe 等），**不要对它跑构建/测试**。

## 常用命令

```bash
bun run dev / tauri / tauri:build   # 纯前端 / 完整应用热重载 / 前端+release 构建
bun run tauri:release               # release 编译 + 热重载（调 release-only 分支）
bun run rss channels | fetch <key> | item <url> | play <url>   # CLI 调试探针
bun run rss login <platform>                                # 扫码登录（经数据服务；终端二维码）
bun run rss fetch <key> --via-service           # 探针走数据服务（同 cookie/被动/配额）
bun run rss attach status | list | refresh <id>  # CLI 作为桌面数据服务客户端
bun run service:build                       # 打包独立服务入口 → dist/service/service.js
bun run check                               # ★ 统一检查入口：static+contract+state+typecheck
bun run check --layer service       # 起真实数据服务（慢）；`--layer all` 五层、`--list` 列清单
bun run lint                                # oxlint 静态检查（默认 correctness 规则；当前 0 error / 16 warning）
bun run fmt / fmt:check                     # bun fmt 全仓格式化 / 只检查不写（配置在 bunfig.toml）
bun scripts/service-data-check.ts           # 服务数据链路 48 项自检（含 job 取消/并发写/回滚）
bun scripts/remote-data-layer-check.ts      # 远端镜像 38 项自检（含取消/崩溃 fail-closed/重启收敛）
bun scripts/service-snapshot-size.ts        # 快照体积实测（原始 vs gzip，默认桌面 dev 库副本）
cargo build -p amoeba-browser        # CLI 浏览器 sidecar（--browser 才用；需 VS2022 环境）
cargo build -p amoeba-runtime        # Bun 运行时启动器（全局优先/缺失下载）
bun scripts/ui-probe.ts goto tab:all        # UI 巡检（需 dev 实例，9222 已开）
bun scripts/ui-play-check.ts                # 播放矩阵巡检（真播，报起播）
bun packages/core/src/example/data-layer.check.ts   # 自检：改动对应包的最小断言
```

完整命令、全部自检脚本、UI/浏览器探针见 **`docs/ops/commands.md`**；
「改了什么 → 跑什么」见 **`docs/ops/smoke-check.md`**。

## 平台速查（细节见 `docs/platforms/platform-notes.md`）

| 平台 | 一句话 |
| --- | --- |
| B站 | 匿名 API 稳（wbi 零登录可复刻）；扫码 cookie **不含 buvid3**，带 cookie 也要补匿名 buvid，否则 `-352`；space 系接口需登录 + `dm_*` 指纹（`signSpace`），否则 412/-352 |
| 抖音 | `live:douyin` 的 `roomIds` 吃抖音号/主页链接/直播间 URL；登录 cookie 经 credentials provider 消费（2026-10-21 前是死键），登录解锁原画档位待真机验证；真搜索需登录（未做） |
| YouTube | 主力 client **VISIONOS**（`VISIONOS → ANDROID_VR → WEB`）；换 client 救不了机房 IP 风控；1080p 走 DASH |
| 小红书 | 全 SSR；**`web_session` 不是登录标志**；**2026-10-22 起全渠道要求登录（匿名态已移除）**，未登录直接报「需要登录」；`xhs:explore` 被动、`xhs:user` 滚动翻页；带 `web_session` 的会话 **SSR 只给空壳**（feed 由页面 XHR 填，读 state 前要等列表非空）；匿名滚动翻页不可靠（headless 300012 / WebView2 300011，风控累积）——这是移除匿名的依据 |
| Twitch | 公开 GQL + usher HLS，纯匿名；master 无 CORS 必须服务端拉；流列表翻页要用 Android Client-ID |
| 斗鱼/虎牙 | douyu `rate` 是档位 ID 不是清晰度；huya 低档只产 HLS |
| Apple 播客 | 榜单条目 = 一个 feed（`stream` 空），主操作是「列出单集」不是播放 |

## 网络风控 / 浏览器

等级 `0` 直通 / `1` 入门 / `2` 标准 / `3` 严格（`netLevels` 键只有平台名与 `"*"`）；
所有 `appHost.http` 出站经 `host/src/net/governor.ts`（分类 → 冷却 → 去重 → 平台并发/RPM →
全局并发），CDP 操作另经 `net.browserGate(platform)`（登录流程不传 platform）。
RSSHub 外挂请求由 source 显式声明 `policy.platform="rsshub"`（自建实例也归同一桶，不靠域名猜）。
被动采集是**渠道属性** `RssChannel.passive`（`xhs:explore` 声明、`xhs:user` 刻意不声明）。
窗口模式 `hidden` / `interactive` **是整实例级**，滚动驱动页面用
`withBrowserOp(browser, {lane, mode:"interactive", platform}, fn)`；`withBrowserMode` 只是
`lane:"default"` 兼容壳，不要手写 `withBrowserLock` + `setMode`。多 tab 与 lane 化已实现
（2026-10-22）见 `docs/risk/crawler-risk-control.md` §3.13。
**完整规则见 `docs/risk/crawler-risk-control.md`**。

## 文档地图（完整索引见 `docs/README.md`）

| 分类 | 文档 |
| --- | --- |
| 架构与契约 | ★ `docs/architecture/system/README.md`（全仓系统架构：包职责/契约/流程/扩展/风险） · `docs/architecture/system/06-data-service.md`（数据服务单写者/协议） · `docs/architecture/host-abi.md` · `docs/architecture/data-and-storage.md` · `docs/architecture/crawler-topology.md` |
| 平台 | ★ `docs/platforms/platform-notes.md` · `docs/platforms/channels.md`（渠道与缺口）· `docs/platforms/youtube.md` · `docs/platforms/twitch.md` · `docs/platforms/xhs-signature.md` · `docs/platforms/login.md` · `docs/platforms/domestic-feeds.md` |
| UI | ★ `docs/ui/ui-conventions.md` · `docs/ui/numbered-ui-overlay.md` · `docs/ui/rail-tree-accordion.md` · `docs/ui/heliu-redesign-plan.md`（实施中，分支 `feat/heliu-redesign`） |
| 播放与弹幕 | ★ `docs/playback/playback.md` · `docs/playback/danmaku.md` · `docs/playback/mpv.md`（未做） |
| 风控 | ★ `docs/risk/crawler-risk-control.md` |
| 运维 | ★ `docs/ops/commands.md` · ★ `docs/ops/smoke-check.md` · `docs/ops/release-updater.md` |
| 审计 | `docs/audit/findings.md` · `docs/audit/refactor-candidates.md`（重构候选分档） |

## 下一步

**登录（2026-10-26 收口）**：`rss login <platform>` 已落地（终端二维码，只走服务 RPC
`scanLogin`）；登录态回归已实测——已登录短路、`xhs:explore` / `xhs:user` 首屏 + 翻页、
`rss detail` 全过。唯一未验的是**扫码出码本身**（现有 profile 已登录，走的是短路）：
用未登录 profile 起临时服务（`rss --service --profile-dir <空目录>`）再验；2026-10-28 起
service 侧浏览器默认 `images:false`（`--blink-settings=imagesEnabled=false`），二维码
路径（img.src 属性 / canvas.toDataURL / 纯 HTTP）理论上不受影响，验证时一并覆盖。

**未做的功能**（按可行性排序，细节见 `docs/platforms/channels.md`）：

- **自动保活**（仅 bili 可行）：已有 `refresh_token` 但无续期调度 —— 到期只能重扫。
- **抖音登录态搜索调研**：先专用小号 + CDP 被动探针，再决定是否实现。
- ~~移动端扫码登录~~：mobile 已冻结（2026-10-26），不再排期。

**待实机验证**：清单在下方 TODO（没跑过不算完成），当前包括干净 VM 安装/卸载与断网首启、
WebView2 生命周期剩余、release 内存、`xhs:explore` 被动命中、实况图/实况播放。

**长期悬置**（收益不抵复杂度）：CSP（现 `csp: null`，抖音/斗鱼签名脚本靠 `eval`）；
live 按平台二次聚合的 UI 侧。

<!-- cc-todo:start -->
## TODO / 重要信息（cc-todo 自动维护）

- [ ] **CI 工作流暂缓（2026-10-26 定）**：`.github/workflows/ci.yml` 未建；统一入口 `bun run check`
- [ ] 干净 VM 复核：安装/卸载、断网首启（Bun 缓存命中）、生产 WebView2 Origin
- [ ] WebView2 生命周期剩余：空闲回收后自动重建、`/json/new` lane tab 关得掉、`/json/close` 不残留、连续 3 次关/建
- [ ] release 验收：GPU 进程 private 是否下降；关 lane 后 renderer 是否释放；空闲 3 分钟是否归零
- [ ] `xhs:explore` 手动刷新命中 `passiveBuffer`（未命中走页面 SSR 兜底）
- [ ] 实况图验收：微博 .mov 在 WebView2 能否播、失败是否退回静态图
- [ ] 实况播放 release 验收：mp4 解码与暂停/续播（dev 已修 Referer 403 + ORB）
- [ ] 实机回归：真实微博/xhs feed 图片网格（直连+回退）、滚动时缓存命中
- [ ] 界面文案：发现页与添加订阅弹窗跑一次 `bun run dev` 看布局
- [ ] Referer 改造剩余：规则表抽共享 JSON（现 TS/Rust 双份 + parity check）；实况视频的响应头注入（ORB 兜底）按需再做
- [ ] twitch XHR Origin 改写（`playlist.ttvnw.net` → `www.twitch.tv`）需 release 复验：dev 页面 Origin（localhost:1420）本就被 CDN 放行，验证不了 `*.tauri.localhost` 场景；若 release 仍 403 则回滚 player 特判
- [ ] 系统文档正文细化（03 时序图 / 02 契约正文；01 依赖矩阵与 02 字段表已随 R9 / membersOnly 更新）
- [!] host 根入口不再有 import 副作用；应用必须显式 `inject*Host()`/`setHostCaps()`（内部幂等 initAppHost），新代码取后端走 `@amoeba/host/{node,tauri,browser}` 子路径。
- [!] **数据服务是唯一写者**：SQLite/crawler/browser 全归 `rss --service`；desktop/CLI 只能发语义命令（读镜像 + RPC），绝不直开 DB 或写 KV blob —— 第二写者是数据丢失的唯一根因。计划见 `docs/architecture/system/06-data-service.md`。
- [!] 桌面只走 `service_endpoint` + `@amoeba/service-client`，`injectTauriHost({storage:false,browser:false})` 封死第二写者；进程内 DataLayer 回退已删（非 Tauri 的浏览器 dev 仍走进程内）。
- [!] `tauri-plugin-sql` 保留：mobile 的进程内 DataLayer 仍用它（mobile 冻结但保留）。
- [!] 视频会员标记 = `Video.membersOnly`（`tpl:membersOnly`）：B站取 `rights.pay/arc_pay/ugc_pay`；YouTube 频道走 InnerTube（官方 RSS 无标记），**匿名首屏可能不含会员视频**，回退 RSS 时标记缺失。
- [!] CLI 浏览器必须显式 `--browser`；显式空串 `--kv cookie=` 在浏览器路径也强制匿名（xhs 直接报「需要登录」），不传 cookie 键时浏览器路径才用 profile 登录态。
- [!] CDP 通用语义只放 `@amoeba/host/cdp`；桌面/CLI 的差异只能写进 `BrowserDriver` / `CdpConnector`，不要回写进 backend。
- [!] WebView2 请求头注入（图片/视频 Referer + XHR Origin）仅 Windows；图片与实况视频**均恒直连、无 JS 回退**（blob 隧道 2026-10-28 全删，`nativeMediaReferer` 探测一并删除）；未注入环境 403 → 占位（图片 ImageOff / 实况退回静态图 + 重试）。
- [!] 9334 本来就是无鉴权的本地调试端口（release 也开），attach 没有新增攻击面，但也别把它当成安全边界。
- [!] CLI 暂不编译成 92MB 二进制；分发用 `amoeba-runtime` 启动器（Rust，release 3.7MB）拉起 JS。
- [!] 运行时**全局 Bun 优先**；缺失自动下载固定版本到 `%LOCALAPPDATA%\app.amoeba.runtime` 并校验 SHA256；不随包 Bun，不回退 Node。
- [!] updater 签名密钥已于 2026-10-26 轮换（旧公钥 `55477786…` → 新 `397EFB52…`），本机私钥 `~/.tauri/amoeba.key` 无密码、不入库；轮换前发布的安装包无法用新签名升级。
- [ ] 合流改版：M0–M6 已落地、M7 部分收尾（分支 `feat/heliu-redesign`），
  进度与剩余项见 `docs/ui/heliu-redesign-plan.md` §实施状态
- [x] 实拍添加订阅弹窗（2026-10-27，`bun scripts/ui-shots-all.ts` + CDP）：渠道目录分类 tab、搜索、
  行式列表与「添加/配置」密度均正常；首页/阅读空态/动态/影音/发现/片库页同时复核（深浅两套主题）
- [ ] `scripts/ui-design-audit.ts` 把 oklch 背景解析成 `rgb(271,111,74)` 这类非法值（>255），
  active chip / `.tag-ok` 恒报 ~1.1:1 误报；真实值已手工复算过 AA。修脚本前别把它的
  `contrastIssues` 当阻塞项
- [ ] docs 遗留清单已全量对码（2026-10-27，120 条：open 81 / stale 8 / fixed 10 / decision 21；
  快照见 `docs/audit/doc-backlog-2026-10-27.md`）：
  分批按 `docs/audit/refactor-candidates.md` 排期；下一批优先 A1（服务端 diagnostics 归位）、
  A4（取消时 abortTabs）、A0b（runJob abort race），再做 B 段性能
- [x] 渠道翻页/去重审计（2026-10-27，55 渠道 + core 语义，快照
  `docs/audit/pagination-dedupe-audit-2026-10-27.md`）：19 条行动项已修 15
  （三批 `c3eb177` / `765771f` / `0c0a802`）；余 A6 RSS 入站上限 / A9 搜索候选翻页 /
  A10 youtube:playlist InnerTube 化单独立项，B7/B8/B9 low 留观
- [ ] 修 huya 403 时发现根 tsconfig.app.json 的 `types:["vite/client"]` 靠 vite 根提升才成立（2026-10-28 起已改为根 package.json 显式声明 vite ^8.1.5）；若未来再动 workspace 布局，注意 player/ui tsc 会先断
- [!] 媒体加载统一策略（2026-10-28）：平台知识只在 resolve 规则表，Rust WebView2 网络层按 context 改头（IMAGE/MEDIA 改 Referer、XHR/FETCH 改 Origin），消费侧恒直连无回退；图片/实况 blob 隧道与 `nativeMediaReferer` 探测已全删。
- [!] 微博匿名只给首页 10 条，翻页（page/since_id/weibo.com ajax）一律登录墙，`weibo:user` 想多拿只能登录
- [ ] 登录微博后复验 `weibo:user` 首屏自动预加载第二页真正落地（本次改动只验到匿名态）
- [!] 补全（`resolveDetail`）**不保证纯文本**：feed 自带全文时 `raw.ts` 原样返回 HTML（contentFormat=html）；桌面镜像剥掉 article 的 content，所以阅读器必走补全 —— 消费侧必须按返回体的 contentFormat 渲染
- [ ] 重启桌面应用复验阅读器：阮一峰正文应渲染为排版好的 HTML（本次只验到 core 侧 resolveDetail 返回 contentFormat=html，没在真机 UI 上确认）
- [ ] 听视频（`?mode=listen`）实机 UI 验证：卡片音符钮 → 播放页版式（.listen-art + 原生音频条）、
  听⇄看切换进度衔接、队列自动下一条保持 listen 模式。引擎路径已真播实证（dash.js 挂 `<audio>`
  播剥完 video AdaptationSet 的 MPD，经 DashHostLoader 隧道起播推进，2026-10-28）；UI 装配层只过了 tsc。
<!-- cc-todo:end -->
