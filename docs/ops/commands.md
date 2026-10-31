# 命令清单与 CLI 设计

> 上篇=现在能跑什么（命令 / 自检 / 探针）；下篇=CLI 的定位、选型与非目标。
> 产物输出到根 `dist/<platform>/`（Vite outDir；tauri.conf 的 frontendDist 指过去）。
> CLI 首次运行会自建 `apps/cli/.data/`（gitignore）与库文件 `rss.db`；目录不必预建。

## 构建与运行

```bash
bun run dev / tauri / tauri:build   # 纯前端 / 完整应用热重载 / 发布构建（含 service:build + runtime/browser + release 配置）
bun run tauri:release               # ⭐ Rust 以 release 编译但保留热重载（见 CLAUDE.md 环境要求）
                                    #   dev/tauri:release 都用 identifier app.amoeba.dev：与安装版数据完全隔离、可并跑
                                    #   ⚠️ 抓取浏览器 profile 例外：默认**共用**安装版（app.amoeba.desktop/webview-profile）
bun run tauri --own-profile         # 抓取浏览器改用 app.amoeba.dev 自己的 profile（首登/清凭证/换号调试）
bun run scripts/tauri.ts help       # 全部用法

# CLI 抓取浏览器 sidecar（Windows / WebView2；VS2022 Native Tools 环境）
cargo build -p amoeba-browser       # 产物 target/debug/amoeba-browser.exe
bun run rss env --browser           # 确认 CLI 注入了 browser（懒启动，不 spawn）
bun run rss fetch weibo:user --browser --kv uid=1195230310
bun run rss browser-reset --target cli   # 清 CLI 自己的 profile（默认；desktop=安装版，dev=调试实例，all=全部）
```

**实例身份（identifier 派生一切）**：single-instance 锁 / 服务 endpoint / DB / 抓取 profile /
主窗口 WebView2 UDF 全由 identifier 派生。`tauri.conf.json`（`app.amoeba.desktop`）勿改——
老用户数据目录与 updater 产物锚在它上面。dev 形态的安全护栏：

- **dev updater 已封**：`main.tsx` 只在 PROD 注入，否则 dev 里点「安装」会用正式 NSIS 覆盖升级正式版；
- **裸 `bunx tauri dev` 别用**：不经 `bun run tauri` 就不带 overlay（= desktop 身份），与安装版互斥；
- dev 库首启自动从旧共享目录迁移（`service.rs:migrate_legacy_shared_db`，原子落位 + legacy 改 `.migrated` 防复活）；
- 抓取浏览器 profile 是临时例外：非 desktop 身份共用安装版（`app.amoeba.desktop/webview-profile`），
  否则 dev 没有登录态；`--own-profile` 才走 `app.amoeba.dev`。代价是全局只有一个抓取浏览器
  （sidecar profile 命名 mutex 独占），两边同时跑时后启动的报「profile 已被另一个 sidecar 占用」。

## CLI 调试探针（收编全部 example；设计与边界见下文「CLI 设计与边界」）

```bash
bun run rss channels                    # 渠道注册表（--kind/--json；--kind category = 分区目录）
bun run rss fetch bili:popular          # 单渠道抓取（--xml/--json）
bun run rss fetch apple:podcast-chart   # Apple 播客热门榜（匿名；--kv genre=1318 换分类）
bun run rss item <url>                  # by-url：路由 + streams 全档位 + 弹幕元信息
bun run rss fetch twitch:live --kv roomIds=shroud,riotgames  # Twitch 直播频道（匿名；离线也返 item）
bun run rss fetch twitch:hot            # Twitch 热门直播（观看数降序，游标翻页）
bun run rss fetch twitch:category --kv category=just-chatting  # Twitch 分区（slug / 目录链接）
bun run rss fetch twitch:categories     # 分区目录订阅（kind:category；点条目预览分区）
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
bun run rss detail <url> --cookie <ck>  # xhs 单条详情补全（登录态 noteDetail；URL 需带 xsec_token）
bun run rss login <platform>            # 扫码登录（经数据服务；终端渲染二维码，bili/weibo/xhs/douyin）
bun run rss login xhs --timeout 120     # 指定等待秒数；已登录时直接返回（不重复扫码）
bun run rss login xhs --endpoint <dir>  # 显式指定服务 endpoint（默认 dev 实例服务）
bun run rss env --probe                 # appHost 门面自检
bun run rss refresh <key>               # core DataLayer 编排冒烟（SQLite 持久化）
bun run rss align                       # crawler/rsshub 同构断言
bun run rss --service --data-dir <dir>  # 前台数据服务（READY + HTTP/WS + 单写者）
bun run rss fetch <key> --via-service --json     # 探针走数据服务（同 cookie/被动/配额；item/play/dm 同）
bun run rss attach status               # CLI 连 dev 实例服务：endpoint/health/rev/订阅/条目
bun run rss attach status --profile desktop  # 连安装版的服务（--endpoint 可指定任意路径）
bun run rss attach list [--json]        # 列出订阅（含条目数/总数/分组）
bun run rss attach refresh <id|channel> # 经服务刷新（--all 全部；--no-force 走 TTL）
bun run rss attach rpc <method> @params.json  # 通用 RPC（Windows 传 JSON 用 @file）
bun scripts/service-phase0.ts           # 阶段 0 测量：bootstrap/双写者/markMany 5k
bun scripts/service-skeleton-check.ts   # 握手/state/WS/单实例/shutdown（13 项）
bun scripts/service-data-check.ts       # 数据链路 48 项：快照/事件/阅读/备份/迁移/退订/回滚/取消/并发
bun scripts/remote-data-layer-check.ts  # 远端镜像 38 项：读/写 RPC/事件/诊断/取消/崩溃收敛
bun scripts/service-snapshot-size.ts    # 快照体积：原始 NDJSON vs gzip（默认桌面 dev 库副本；--db/--max-kb）
bun scripts/service-runtime-check.ts    # 启动器解析 Bun → 拉起服务 → stdout 只有 READY
bun run service:build                   # 打包独立服务入口 → dist/service/service.js（约 1.2MB）
SERVICE_ENTRY=dist/service/service.js bun scripts/service-runtime-check.ts  # 验证打包产物
cargo build -p amoeba-runtime           # 构建运行时启动器（target/debug/amoeba-runtime.exe）
cargo build -p amoeba-browser           # 浏览器 sidecar（--browser / 服务模式）
cargo test -p amoeba --lib service::tests  # Tauri 侧 spawn/READY/endpoint/shutdown
target/debug/amoeba-runtime.exe --print # 打印解析到的 Bun（AMOEBA_BUN → PATH → 随包 → 缓存 → 下载）
target/debug/amoeba-runtime.exe apps/cli/src/main.ts env   # 经启动器跑 CLI
target/debug/amoeba-runtime.exe --no-download <entry>      # 离线：只用已有 Bun
```

★ = 使用频率最高的三条探针（`channels` / `fetch` / `item`），可观测性是一等公民：
**每个命令默认给耗时，`--json` 全线支持**，错误打完整堆栈。

## 自检脚本（仓库无测试基建，用最小断言）

```bash
bun run check                          # ★ 统一入口：static + contract + state + style + typecheck（默认 5 层）
bun run check --list                   # 列出全部检查项与所属层
bun run check --layer service          # 起真实数据服务（慢，协议/快照/取消）
bun run check --layer all              # 六层全跑（默认 5 层 + service）
bun run check --filter core           # 按路径子串 / style 步骤名筛（调试单点时用；零匹配 = 失败）
```

分层与归属清单在 `scripts/check.ts` 的 `FILES` / `TYPECHECK_PROJECTS`；新增 `.check.ts` 要同时加进对应层。

> **CI**：`.github/workflows/ci.yml` 未建（2026-10-26 决策：日常提交不跑 CI）；`release.yml` 在构建前跑
> `bun run check`（2026-11-01 起）—— 本地不过的提交，打了 tag 也发不出去。
单跑某个文件（失败信息原样输出）：

```bash
bun packages/log/src/example/log.check.ts               # 日志域（开关/前缀/sink/幂等注册/HMR 合并）
bun packages/core/src/example/media-store.check.ts      # 查询分支（分组聚合等）
bun packages/core/src/example/data-layer.check.ts       # 停用不抓取 / reading 回填 / 空抓取不丢内容
bun packages/core/src/example/repo-concurrency.check.ts # 仓储并发写不互相覆盖（丢数据护栏）
bun packages/core/src/reading-position.check.ts         # 续播落库判据（近片尾清除 / 5s 节流）
bun packages/host/src/example/host-check.ts             # 门面字段（openExternal/dataSaver）
bun packages/host/src/example/governor.check.ts         # 网络治理（分类/L0/去重/冷却/分档/并发）
bun packages/core/src/example/passive-mode.check.ts     # 被动采集（只走 fetchPassive / autoRefresh / 覆盖投影 / 预览）
bun packages/core/src/example/error-kind.check.ts       # 错误分类（errorKind 透出 / 403→risk / 冷却→rate-limit / no-data）
bun packages/core/src/example/cookie-sync.check.ts      # 启动 cookie 快照（标记/去重/不清空/compare-and-set/订阅门槛）
bun packages/crawler/src/example/bili-popular.check.ts  # bili 热门 payload → Item 字段映射
bun packages/crawler/src/example/twitch-live.check.ts   # Twitch GQL → Live 映射（频道 live/offline + 热门/分区流列表）
bun packages/crawler/src/example/youtube-channels.check.ts # YouTube 直播页栏目解析 + playlistId 归一
bun packages/crawler/src/example/bili-channels.check.ts    # B站合集/视频列表/收藏夹参数归一
bun packages/crawler/src/example/xhs-strategy.check.ts  # xhs 策略层（登录闸门 / 无匿名 / cookie 闸门 + origin 校验）
bun packages/crawler/src/example/extract.check.ts       # 文章正文提取（标签剥离/实体/SPA 空页）
bun packages/crawler/src/example/passive-buffer.check.ts # LX 被动缓冲（URL 归一化 / TTL / 限额淘汰）
bun packages/crawler/src/example/passive-capture.check.ts # LX 采集编排（假后端回放 CDP 事件）
bun packages/resolve/src/example/router.check.ts        # by-url 路由表（host 边界 + 各平台命中）
bun packages/resolve/src/example/xhs-time.check.ts      # xhs 时间戳单位判别（秒/毫秒不写反）
bun packages/resolve/src/example/youtube-danmaku-poll.check.ts # 直播聊天轮询退避（封顶 60s）/ 直播结束终止判定
bun packages/resolve/src/example/login-events.check.ts  # 登录/弹幕日志事件在四平台同形同文案
bun packages/resolve/src/example/bili-buvid.check.ts    # bili 登录 cookie 缺 buvid3 时补匿名指纹（-352 回归）
bun packages/resolve/src/example/bili-space-sign.check.ts # bili space 系签名含 dm_* 指纹 + cookie 传递（412/-352 回归）
bun packages/resolve/src/example/credentials.check.ts   # 平台 cookie provider（三级语义 / sign 同接 / douyin 兜底序 / xhs 空串退出）
bun packages/resolve/src/example/media-referrer-parity.check.ts # 防盗链 Referer 规则（TS ↔ Rust WebView2 注入）一致
bun packages/resolve/src/example/youtube-clients.check.ts # YouTube client 请求体形状（VISIONOS）
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
bun apps/desktop/src/lib/cn.check.ts                    # cn 合并：@theme 自定义令牌按组覆盖（漏登记 TW_THEME_EXTEND 即失败）+ Button 变体类不丢
bun apps/desktop/src/lib/css-classes.check.ts           # TSX 用到的语义类必须有 CSS 定义（死类 / 改名漏改）
bun apps/desktop/src/lib/core-imports.check.ts          # desktop 只许 import type core 根入口；值导入走 @amoeba/core/pure（首屏包体）
bun packages/player/src/hooks/useStreamSelection.check.ts # 默认选流 = streams[0]（不被格式族抢走）
bun packages/player/src/hooks/player-stats.check.ts      # 统计信息格式化（引擎/码率/档位/缓冲/丢帧）
bun apps/desktop/src/lib/boot-skeleton.check.ts         # 骨架/侧栏宽度契约（两份手写字面量必须一致）
```

「改了什么 → 跑什么」的完整巡检清单见 `docs/ops/smoke-check.md`。

## Lint 与格式化

```bash
bun run lint                           # oxlint（默认 correctness 规则；无配置文件，按 .gitignore 跳过 tmp/ 等）
bun run fmt                            # bun fmt 全仓格式化（bunfig.toml：120 列/无分号/双引号/尾逗号 all）
bun run fmt:check                      # 只检查不写（已并入 check 的 style 层）
```

- formatter = Bun 内置 `bun fmt`（Prettier 兼容引擎）。⚠️ package.json 里的 `fmt` script 必须带
  `--no-script`，否则 `bun fmt` 会路由回同名 script 造成递归。
- linter = `oxlint`（Bun 内置 `bun lint` 在 1.4.x 尚未发布；升级后可直接替换本行命令）。
- `lint` 与 `fmt:check` 都在 `bun run check` 的 style 层（全仓格式化已收口），发布前 CI 也跑。
- 文档（`**/*.md`）与 `tmp/` 不在格式化范围内（bunfig.toml 的 ignorePatterns）。

## UI 交互巡检（连到正在运行的 dev 实例；需 `bun run tauri`，9222 由 dev 配置开启）

```bash
bun scripts/ui-probe.ts goto tab:all        # 导航 + 巡检（逐字竖排 / 溢出 / 遮挡 / 破图）
bun scripts/ui-probe.ts audit               # 只巡检当前页
bun scripts/ui-probe.ts eval "<js>"         # 在页面里求值（量真实 DOM / 计算样式）
bun scripts/ui-probe.ts click "<selector>"  # 可信鼠标点击（悬停→按下→抬起）
bun scripts/ui-console.ts                   # 遍历各视图，捕获 React 告警 / 未捕获异常
bun scripts/ui-design-audit.ts              # 量化设计审计：对比度(WCAG) / 点击区 / 字号 / 间距节奏
bun scripts/ui-shot.ts tmp/shots            # 给各模块截图存档（用于视觉复核）
bun scripts/ui-shots-all.ts                 # 批量实拍各视图（添加订阅弹窗/空态/深浅主题）
bun scripts/ui-play-check.ts               # ★ 播放矩阵巡检（video/live/audio/yt 真播，报起播）
bun scripts/ui-resize.ts 1500 950           # 改窗口尺寸（验证响应式断点）
```

## Numbered UI Overlay（dev-only，Ctrl+Shift+U；清单不依赖是否显示）

```bash
bun apps/desktop/src/dev/ui-overlay/overlay.check.ts  # 快捷键/编号/定位纯逻辑自检
bun scripts/ui-probe.ts eval "__uiOverlay.json()"     # 当前视口交互元素清单（给 AI）
bun scripts/ui-probe.ts eval "__uiOverlay.stats()"    # candidates/labels/overflow
```

## 浏览器 / 抓取探针

```bash
# 先起干净 Edge，见 edge-cdp skill；脚本自连 CDP，零额外依赖
bun packages/crawler/src/example/browser-sim.ts weibo:user   # 或 xhs:user（低频防风控）
bun scripts/lx-visibility-probe.ts     # 窗口可见性实测（隐藏/屏外/可见 → rAF/IO/lazy/scroll，风控 §3.9）
bun scripts/lx-request-profile.ts      # 渠道单次刷新的请求扇出与耗时（风控 §3.12）
bun scripts/lx-probe.ts                # CDP 网络捕获边界（304/302/gzip/SSE/12MB/SW，风控 §3.5/§3.7）
```

## CLI 设计与边界

**现状**：`channels` / `fetch` / `item` / `play` / `dm` / `hot` / `sug` / `detail` / `align` /
`env` / `refresh` / `login` / `attach` / `browser-reset` 全部可用（`bun run rss <cmd>`）；
`--service` 起数据服务，`--via-service` 让 fetch/item/play/dm 走服务。浏览器渠道经
`--browser` 接入独立 WebView2 sidecar；xhs 登录态经 `rss login` 获取（见下）。
`--log <域>` 开关未实现，调试日志用 `RSS_LOG=1` 全开。

### 登录：`rss login <platform>`

数据服务是唯一生产者，profile 与 cookie 只存在于服务上，所以登录**只有一条路径**：
连服务的 `scanLogin` RPC，cookie 由服务写入自己的 settings。CLI 不写本地库、不维护
第二份 profile —— 服务未运行时直接报错并给出启动方式（桌面会自动拉起服务；手动起
服务必须复用同一份 db/profile）。二维码在终端用 Unicode 半块字符渲染：data URL 类
（xhs/weibo/douyin）先解 PNG + jsqr 识别再重编码，纯内容类（bili）直接编码。

### 定位

**调试优先**，不是终端版 RSS 阅读器。它是 crawler/resolve/core 的正式观测面——
把散装 example（list_channels / sample_sources / resolve / test-danmaku / verify-*）统一收编
成命令，以 ad-hoc 直跑取代「开 tauri dev + desktop UI 复现」的调试循环。
附带红利：三大探针立起后，可以清退大部分数据路径 debug log（见下「log 边界」）。

### 范围与非目标

**一期渠道**（纯 HTTP/算法，零浏览器）：`rss:*` 直链、`bili:*`（popular/weekly/ranking/
square/user_video/dynamic/live）、`youtube`/`youtube:live`、`live:{douyu,huya,douyin,bili}`（+hot）。

- ✅ **浏览器渠道可选启用（2026-10-26）**：`--browser` / `AMOEBA_BROWSER=1` 时注入
  `appHost.browser`，由 `amoeba-browser.exe`（独立 WebView2 进程 + CDP，屏外窗口）
  承载 `weibo:user`、`xhs:*`。**显式 opt-in**：crawler 一看到 `appHost.browser` 就走
  浏览器路径并忽略 `--kv cookie=`，默认注入会让现有 HTTP 探针静默失效。
  - 构建：`cargo build -p amoeba-browser`；找不到时 CLI 保持 `browser=undefined`（HTTP 降级）。
  - profile：`%LOCALAPPDATA%/app.amoeba.cli/browser-profile`，与桌面 `webview-profile` 严格分开。
  - 登录：xhs 必须登录，用 `rss login <platform>`（经数据服务扫码）。CLI 自己的
    `--browser` sidecar profile 只用于抓取探针，**不承载登录态**。
  - 单页/lane：与桌面同一套 `@amoeba/host/cdp` 语义（`Target.createTarget` = 独立顶层窗口，
    sidecar 500ms tidy 去任务栏；`mode hidden|interactive` 同步切换）。
  - 退出：命令结束 `closeBrowser()` 关 stdin，sidecar 等 WebView2 flush cookie 后退出；
    超时 `taskkill /T`，父进程死亡由 `--parent-pid` 兜底。
- ⛔ **不做播放**：只到「解析出 stream 清单」为止；hls.js/flv.js/dashjs 不进 CLI。
  验证直链用 `--open` 丢给系统播放器。
- bili 登录档位不受影响：settings 登录态经 credentials provider（client 兜底）与
  data-layer `sourceInfoFor` 注入双通道生效，与浏览器无关。

### 技术选型：Bun + cac，零构建

| 方案 | 结论 |
|---|---|
| **Bun + cac 参数式** | **选定**。与仓库一致（TS 直跑免构建，改完即跑，比 tauri dev 循环快一个量级）；playwright 兼容坑随之消失 |
| Bun + Ink(TUI) | 渐进增强备选（单命令内嵌 ink render），不互斥；阅读器诉求弱化后暂无必要 |
| Node + tsx + commander | 不选：仓库其余全 bun，徒增分裂 |
| Rust clap | 排除：重写整个数据层 |

「零构建」仍成立：HTTP 渠道照旧 `bun run rss` 直跑；只有 `--browser` 需要先
`cargo build -p amoeba-browser`（独立 WebView2 宿主，不重写数据层）。

目录：

```
apps/browser-sidecar/      # amoeba-browser：无 Tauri 依赖的 WebView2 宿主（CDP + stdin 控制）
apps/cli/
  package.json     # @amoeba/cli；deps: crawler/core/resolve/host/log/platform/xml/service-* + cac + picocolors + qrcode + jsqr
  tsconfig.json    # 不 extends tsconfig.app.json（DOM/vite 环境）；面向 bun/node:
                   #   types: ["@types/bun"], moduleResolution bundler, allowImportingTsExtensions
  src/
    main.ts             # cac 入口 + 命令注册（根 scripts 加 rss:* 快捷）
    host/node-host.ts   # setHostCaps：http=nodeBackend / js=nodeJsBackend / ws=nodeWsBackend + sqliteStorage
                        #   [纪律] ws 必须绑 nodeWsBackend（ws 包），不透传 Bun 原生 WebSocket（见下）
    store/sqlite-storage.ts # StorageBackend 实现（bun:sqlite，见「存储」）
    commands/*.ts       # 命令实现（清单见文首）
    ui/render.ts        # 表格输出（picocolors 即够）
    ui/qr-terminal.ts   # 二维码 → 终端半块字符（PNG+jsqr 解码 / 纯内容直接编码）
    service/server.ts   # 数据服务 HTTP/WS（--service 入口）
```

### Rust 绑定能力的对应（appHost 门面已解决）

desktop 前端只有 `store/data-source.ts` 一处直引 `@tauri-apps/api/core`（拿
`service_endpoint`），其余 Rust 能力只经门面暴露，且 node 后端已被 crawler/core
example 长期验证。逐项对应：

| Rust command | CLI（Bun）实现 | 状态 |
|---|---|---|
| `http_get`（reqwest） | fetch（`@amoeba/host/node` 的 `node-backend.ts`） | ✅ 已验证 |
| `ws_connect`（tungstenite+header） | `ws` 包（`node-ws.ts`） | ✅ `rss dm` 四平台通 |
| js 签名执行（new Function） | Node new Function（`node-js.ts`） | ✅ douyin abogus/webmssdk 通 |
| localStorage | storage backend（bun:sqlite） | ✅ |
| webview_browser_* | — | 已排除（与宿主窗口绑定） |

两个真实差异面：

1. **TLS/HTTP 指纹不同**（reqwest/rustls ≠ Bun fetch）：对主流目标（bili/youtube/四站
   直播）无碍——这就是 example 在跑的路径。遇平台行为不一致时，`rss fetch` 反而是最快的
   隔离工具（区分代码 bug vs 宿主指纹差异）。
2. **bili 直播弹幕不许碰 Bun 原生 WebSocket**：Bun 内置 WS 是浏览器标准 API，不支持
   自定义握手头，而 bili 要在握手里带 Cookie（buvid3/nav mid）。必须经 `appHost.ws`
   注入 `ws` 包 backend——注入层别图省事透传 native WS。

### example 收编

散装 example 已全部收编转正并清退；**唯一保留** `crawler/src/example/browser-sim.ts`
（浏览器模拟，CLI 排除该类渠道）。新增调试能力只写一处（CLI），不再新起 example。

### 存储

core 数据层认 repo 接口（`subscription/reading/settings-repo` 注入 `createDataLayer`），
换 backend 不动 core 与命令层：

```
bun:sqlite（数据服务 rss --service，唯一写者，appData/rss.db）  ← desktop / CLI 都只发 RPC
bun:sqlite（CLI 本地探针，apps/cli/.data/rss.db） / tauri-plugin-sql（mobile 进程内，冻结保留）
共用：DDL 唯一权威 = core db/schema.ts（createDataLayer 经 appHost.storage.setSchema?.() 注入）
```

- desktop 已无进程内 DataLayer：`createDesktopDataLayer` → `service_endpoint` +
  `createRemoteDataLayer`（读镜像 / 写 RPC / WS 事件），`injectTauriHost({storage:false})`
  封死直连。第二写者会静默丢数据 —— 详见 `docs/architecture/data-and-storage.md`
  「单写者与迁移/备份」。
- WAL/PRAGMA：`journal_mode=WAL` + `busy_timeout=5000` + `synchronous=NORMAL` +
  `foreign_keys=ON`（`sqlite-storage.ts` 的 `applyPragmas`，服务与 CLI 探针共用）。

### log 边界（判据）

判据 = **「CLI 能否直接复现」**：能复现的数据路径 log 不加（用探针）；环境路径 log
（隧道 / canplay 时序 / UI 竞态）保留。⚠️ CLI 抓不到的两类 bug（长期运行泄漏/竞态、
UI 交互态错乱）留保险。

**防回涨约定**：任何 bug 先问「CLI 能否复现」。能 → 不许为它加 log，去修 CLI / 加探针；
不能 → 才允许埋 log。

⚠️ `packages/resolve/src/log.ts` 的注释已改指本节（原 `docs/cli-plan.md §7` 已并入此处）。
改注释前别删本节。

### 收益

- **迭代速度**：免 vite/tauri 的毫秒级反馈循环，crawler/resolve/core 改动即测
- **回归测试入口**：`fetch`/`item`/`dm` 天然是各平台解析的可脚本化回归（配 `--json` 出断言）
- **服务化地基（已落地 2026-10-26）**：CLI 先行正是数据服务的第一块 —— node-host 基建
  + `Bun.serve` HTTP/WS 即 `rss --service`，desktop 经 `service_endpoint` 复用同一进程。
  见 `docs/architecture/system/06-data-service.md`
