# Tauri Playground

Tauri 2 monorepo — RSS Reader，桌面 + 移动双端。
桌面 = **订阅工作台**（抓取/播放/管理全功能）；移动 = **极简看内容**（未读列表 → 播放/阅读，
已接 appHost+core）。两端定位分离：desktop 数据供给走独立爬虫服务（承载重反爬平台），
mobile 保持内置 crawler 仅有限平台。决策见 `docs/architecture/crawler-topology.md`。

## 目录结构

```
apps/
  src-tauri/   唯一 Rust crate（amoeba），双端共享 commands/plugins
  desktop/     React 19 + Vite + Tailwind 4 → dist/desktop
               订阅工作台：rail 侧栏（内容类型/智能订阅/分组树）+ 五视图
               reader 三栏 / media 网格 / hot 热搜 / page 整页 / player / shortvideo 全屏流。
               状态 src/store/（nodes 节点语法 · selectors 派生 · prefs 偏好 · index 编排），
               视图 src/views/，样式 src/styles/（按区块拆分，入口只留 @import 顺序）。
  mobile/      React 19 + Vite → dist/mobile。极简「看内容」闭环 + 订阅管理（RSS 直链
               添加/移除）；复用 core DataLayer + player PlayableMedia + ui MediaImage。
               不做频道发现（那属桌面工作台）
  cli/         ★ 调试探针（Bun + cac 零构建），收编全部 example。宿主 = node 后端 +
               bun:sqlite（apps/cli/.data/rss.db）。详见 docs/ops/commands.md
packages/
  xml/         ★ RSS 2.0 + tpl: 编解码（fast-xml-parser v5）。唯一持有该依赖
  host/        ★ 宿主后端 + 全局 appHost 门面（runtime.ts）。node/browser/tauri 三态；
               net/governor.ts 统一治理所有 appHost.http（分级/并发/RPM/冷却/去重）
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
  log/         零依赖叶子：域注册语义化日志（log="0" 全局关 / log:<域>="0" 按域关）
  ui/          ⚠️ 只剩原子件：desktop 仅引 MediaImage（防盗链隧道）与 fmtCount
```

依赖链 `resolve ← crawler ← core`，播放支线 `core ← player`；`log` 是零依赖叶子；
`host` **依赖 core**（sqlite backend 复用其 `db/schema.ts`，core 把 host 放 devDep）。
读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装；新直引前先问
「能否经 core 门面」。

**desktop 组件分层**（加组件前先定层）：`src/components/*.tsx` = 功能件（纯 props、不碰 store）；
`src/components/app/*.tsx` = 业务件（读 `useDesktop`/`usePrefs` 或吃 domain 类型）。
判据 = 有没有 `useDesktop`/`usePrefs`/`@amoeba/core` 类型 / domain 常量。文件名统一 PascalCase
（仅 `main.tsx`/`router.tsx` 这类入口保留小写）。位置权威 = URL（`/v/:nodeId`、`/play/:itemId`）。
store 收敛点：`syncSubscriptions()`（变更后「重读+重绘」唯一入口，内含 `refreshView()`，
**必须先修 `selectedNodeId` 再调**；8 处调用，**不要**用于 `toggleSubEnabled` —— 启停不改
内容集）· `lib/useLatestOnly.ts`（请求世代守卫，只能丢弃不能取消）。

## 硬契约（违反即静默错）

- **crawler → core 的唯一通道是 XML**：channel 设的每个字段要到达 UI，serialize 必须写、
  deserialize 必须读，漏一边就静默丢。回归 `serialize-roundtrip.check.ts`。
  见 `docs/architecture/data-and-storage.md`。
- **`MediaItem.id` 只在订阅内唯一**：凡「按 id 记/改/查」都要带 `subscriptionId`
  （reading 键、store.patch、播放队列、findItem）。见 `docs/architecture/data-and-storage.md`。
- **选流 = `streams[0]`**，crawler 保证最高清晰度排最前，player 不做二次排序。
  见 `docs/playback/playback.md`。
- **可播判定 = kind 门控**（video/audio/live）+ `isFeedItem`（audio 且无 stream = 播客 feed）。
  新增「播放」入口一律经 `usePlayerNav` 收口。见 `docs/ui/ui-conventions.md`。
- **appHost 全局注入**：必填 `http`/`js`/`storage`，可选 `ws`/`browser` 未注入即降级；
  打开外链必须走 `openExternal`（WebView 拦 `window.open`）。见 `docs/architecture/host-abi.md`。
- **存储 DDL 唯一权威 = core `db/schema.ts`**（插件自带 migration 不用，防漂移）。
- **平台 cookie 三级语义**（`resolve/platform/credentials.ts`）：调用点显式非空 > 显式
  **空串 = 强制匿名**（xhs 详情、CLI `--kv cookie=` 依赖）> provider（settings 登录态，
  core DataLayer / CLI 入口注册同一张表）。**渠道层不许再手抄 channelKey→cookie 前缀表**
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
  （`!cfg!(debug_assertions)` 是编译期判据，如隐藏 Edge）。保留 Vite dev server 与 Rust 热重载，
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
| 小红书 | 全 SSR；**`web_session` 不是登录标志**；`xhs:explore` 被动、`xhs:user` 主动 fetch |
| Twitch | 公开 GQL + usher HLS，纯匿名；master 无 CORS 必须服务端拉；流列表翻页要用 Android Client-ID |
| 斗鱼/虎牙 | douyu `rate` 是档位 ID 不是清晰度；huya 低档只产 HLS |
| Apple 播客 | 榜单条目 = 一个 feed（`stream` 空），主操作是「列出单集」不是播放 |

## 网络风控 / 浏览器

等级 `0` 直通 / `1` 入门 / `2` 标准 / `3` 严格（`netLevels` 键只有平台名与 `"*"`）；
所有 `appHost.http` 出站经 `host/src/net/governor.ts`（分类 → 冷却 → 去重 → 平台并发/RPM →
全局并发），CDP 操作另经 `net.browserGate(platform)`（登录流程不传 platform）。
被动采集是**渠道属性** `RssChannel.passive`（`xhs:explore` 声明、`xhs:user` 刻意不声明）。
窗口模式 `hidden` / `interactive` **是整实例级**，滚动驱动页面用
`withBrowserMode(browser, "interactive", fn)`（内部串行 + 结束切回 hidden），不要手写
`withBrowserLock` + `setMode`。多 tab 与 lane 化（设计，未实现）见 §3.13。
**完整规则见 `docs/risk/crawler-risk-control.md`**。

## 文档地图（完整索引见 `docs/README.md`）

| 分类 | 文档 |
| --- | --- |
| 架构与契约 | `docs/architecture/host-abi.md` · `docs/architecture/data-and-storage.md` · `docs/architecture/crawler-topology.md` |
| 平台 | ★ `docs/platforms/platform-notes.md` · `docs/platforms/channels.md`（渠道与缺口）· `docs/platforms/youtube.md` · `docs/platforms/twitch.md` · `docs/platforms/xhs-signature.md` · `docs/platforms/login.md` · `docs/platforms/domestic-feeds.md` |
| UI | ★ `docs/ui/ui-conventions.md` · `docs/ui/numbered-ui-overlay.md` · `docs/ui/rail-tree-accordion.md` |
| 播放与弹幕 | ★ `docs/playback/playback.md` · `docs/playback/danmaku.md` · `docs/playback/mpv.md`（未做） |
| 风控 | ★ `docs/risk/crawler-risk-control.md` |
| 运维 | ★ `docs/ops/commands.md` · ★ `docs/ops/smoke-check.md` · `docs/ops/release-updater.md` |
| 审计 | `docs/audit/findings.md` · `docs/audit/refactor-candidates.md`（重构候选分档） |

## 下一步

**未做的功能**（按可行性排序，细节见 `docs/platforms/channels.md`）：

- **自动保活**（仅 bili 可行）：已有 `refresh_token` 但无续期调度 —— 到期只能重扫。
- **desktop 爬虫服务化**：形态待选型（倾向自研 sidecar）。
- **移动端扫码登录**：`Loginable` 已具备，移动端 CDP 不可行。
- **抖音登录态搜索调研**：先专用小号 + CDP 被动探针，再决定是否实现。

**待实机验证**（没跑过不算完成）：

- release 实例：`browser_set_mode` hidden ↔ interactive 切换 + `xhs:user` 翻页各一次。
- `xhs:explore` 手动刷新命中 `passiveBuffer`；未命中走页面 SSR 兜底。
- `xhs:user` 刷新：登录态导航出条目；匿名走页面内 fetch（`anon-*` 虚拟条目）。
- ⚠️ **governor 的 `rsshub` 平台配额是死键**：平台名按 host 推导，RSSHub 请求落到通用
  host 桶，需改成 host 后缀匹配或显式映射。

**长期悬置**（收益不抵复杂度）：CSP（现 `csp: null`，抖音/斗鱼签名脚本靠 `eval`）；
live 按平台二次聚合的 UI 侧。
