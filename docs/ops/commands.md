# 命令清单与 CLI 设计

> 合并自 commands.md + cli-plan.md（2026-10-21 整理）。前一部分是「现在能跑什么」，后一部分是 CLI 的定位、选型与非目标。

> 命令清单部分从 `CLAUDE.md` 迁出（2026-10-21）。`CLAUDE.md` 只留最常用的 6 条。
> 产物输出到根 `dist/<platform>/`（Vite outDir；tauri.conf 的 frontendDist 指过去）。
> CLI 首次运行需 `apps/cli/.data/` 目录存在（gitignore，bun:sqlite 不会自建）。

## 构建与运行

```bash
bun run dev / tauri / tauri:build   # 纯前端 / 完整应用热重载 / 前端+release 构建
bun run tauri:release               # ⭐ Rust 以 release 编译但保留热重载（见 CLAUDE.md 环境要求）
bun run scripts/tauri.ts help       # 全部用法
```

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
bun run rss detail [url|--latest]       # xhs 单条详情补全（匿名 noteDetail）
bun run rss env --probe                 # appHost 门面自检
bun run rss refresh <key>               # core DataLayer 编排冒烟（SQLite 持久化）
bun run rss align                       # crawler/rsshub 同构断言
```

## 自检脚本（仓库无测试基建，用最小断言）

```bash
bun packages/core/src/example/media-store.check.ts      # 查询分支（分组聚合等）
bun packages/core/src/example/data-layer.check.ts       # 停用不抓取 / reading 回填 / 空抓取不丢内容
bun packages/core/src/example/repo-concurrency.check.ts # 仓储并发写不互相覆盖（丢数据护栏）
bun packages/core/src/reading-position.check.ts         # 续播落库判据（近片尾清除 / 5s 节流）
bun packages/host/src/example/host-check.ts             # 门面字段（openExternal/imageProxy）
bun packages/host/src/example/governor.check.ts         # 网络治理（分类/L0/去重/冷却/分档/并发）
bun packages/core/src/example/passive-mode.check.ts     # 被动采集（只走 fetchPassive / autoRefresh / 覆盖投影）
bun packages/crawler/src/example/bili-popular.check.ts  # bili 热门 payload → Item 字段映射
bun packages/crawler/src/example/twitch-live.check.ts   # Twitch GQL → Live 映射（频道 live/offline + 热门/分区流列表）
bun packages/crawler/src/example/youtube-channels.check.ts # YouTube 直播页栏目解析 + playlistId 归一
bun packages/crawler/src/example/bili-channels.check.ts    # B站合集/视频列表/收藏夹参数归一
bun packages/crawler/src/example/xhs-strategy.check.ts  # xhs 策略层（登录页/匿名/被动路由矩阵 + origin 校验）
bun packages/crawler/src/example/extract.check.ts       # 文章正文提取（标签剥离/实体/SPA 空页）
bun packages/crawler/src/example/passive-buffer.check.ts # LX 被动缓冲（URL 归一化 / TTL / 限额淘汰）
bun packages/crawler/src/example/passive-capture.check.ts # LX 采集编排（假后端回放 CDP 事件）
bun packages/resolve/src/example/router.check.ts        # by-url 路由表（host 边界 + 各平台命中）
bun packages/resolve/src/example/xhs-time.check.ts      # xhs 时间戳单位判别（秒/毫秒不写反）
bun packages/resolve/src/example/bili-buvid.check.ts    # bili 登录 cookie 缺 buvid3 时补匿名指纹（-352 回归）
bun packages/resolve/src/example/bili-space-sign.check.ts # bili space 系签名含 dm_* 指纹 + cookie 传递（412/-352 回归）
bun packages/resolve/src/example/credentials.check.ts   # 平台 cookie provider（三级语义 / sign 同接 / douyin 兜底序 / xhs 空串退出）
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
bun packages/player/src/hooks/useStreamSelection.check.ts # 默认选流 = streams[0]（不被格式族抢走）
bun packages/player/src/hooks/player-stats.check.ts      # 统计信息格式化（引擎/码率/档位/缓冲/丢帧）
bun apps/desktop/src/lib/boot-skeleton.check.ts         # 骨架/侧栏宽度契约（两份手写字面量必须一致）
```

「改了什么 → 跑什么」的完整巡检清单见 `docs/ops/smoke-check.md`。

## UI 交互巡检（连到正在运行的 dev 实例；需 `bun run tauri`，9222 由 dev 配置开启）

```bash
bun scripts/ui-probe.ts goto tab:all        # 导航 + 巡检（逐字竖排 / 溢出 / 遮挡 / 破图）
bun scripts/ui-probe.ts audit               # 只巡检当前页
bun scripts/ui-probe.ts eval "<js>"         # 在页面里求值（量真实 DOM / 计算样式）
bun scripts/ui-probe.ts click "<selector>"  # 可信鼠标点击（悬停→按下→抬起）
bun scripts/ui-console.ts                   # 遍历各视图，捕获 React 告警 / 未捕获异常
bun scripts/ui-design-audit.ts              # 量化设计审计：对比度(WCAG) / 点击区 / 字号 / 间距节奏
bun scripts/ui-shot.ts tmp/shots            # 给各模块截图存档（用于视觉复核）
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

**现状**：八命令（`channels` / `fetch` / `item` / `play` / `dm` / `hot` / `align` / `env` /
`refresh`）全部可用（`bun run rss <cmd>`），bili video/live、douyu、youtube 实测通过；
M3 `--log` 域开关与 M4 log 清退未做。

### 定位

**调试优先**，不是终端版 RSS 阅读器。它是 crawler/resolve/core 的正式观测面——
把散装 example（list_channels / sample_sources / resolve / test-danmaku / verify-*）统一收编
成命令，以 ad-hoc 直跑取代「开 tauri dev + desktop UI 复现」的调试循环。
附带红利：三大探针立起后，可以清退大部分数据路径 debug log（见下「log 清退联动」）。

### 范围与非目标

**一期渠道**（纯 HTTP/算法，零浏览器）：`rss:*` 直链、`bili:*`（popular/weekly/ranking/
square/user_video/dynamic/live）、`youtube`/`youtube:live`、`live:{douyu,huya,douyin,bili}`（+hot）。

- ⛔ **浏览器模拟渠道不在 CLI 内**：`weibo:user`、`xhs:*` 及扫码登录（`login`）整条线
  （依赖 `appHost.browser` = Edge spawn + CDP）。将来解锁时只需补一个 Bun 版 browser
  backend（spawn Edge + CDP 走 ws 包），门面接口已留好（`appHost.browser` 可选、未注入
  自动降级），CLI 其余部分零改动。`crawler/src/example/browser-sim.ts` 是唯一保留的
  example 脚本（CLI 排除该类渠道；2026-09-11 起零依赖：bun 内置 WebSocket 直连 CDP）。
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

目录：

```
apps/cli/
  package.json     # @amoeba/cli；deps: core, host, log + cac + picocolors + qrcode
  tsconfig.json    # 不 extends tsconfig.app.json（DOM/vite 环境）；面向 bun/node:
                   #   types: ["@types/bun"], moduleResolution bundler, allowImportingTsExtensions
  src/
    main.ts             # cac 入口 + 命令注册（根 scripts 加 rss:* 快捷）
    host/node-host.ts   # injectNodeHost 变体：http=fetch / js=new Function / ws=ws 包
                        #   [纪律] ws 必须绑 nodeWsBackend（ws 包），不透传 Bun 原生 WebSocket（见下）
    store/sqlite-storage.ts # StorageBackend 实现（bun:sqlite，见「存储」）
    commands/*.ts       # 命令实现（见「命令集」）
    ui/render.ts        # 表格输出（picocolors 即够）
    ui/qr.ts            # 暂缓（登录延后）
```

### Rust 绑定能力的对应（appHost 门面已解决）

desktop 前端 grep `@tauri-apps` 零命中——所有 Rust 能力只经门面暴露，且 node 后端
已被 crawler/core example 长期验证。逐项对应：

| Rust command | CLI（Bun）实现 | 状态 |
|---|---|---|
| `http_get`（reqwest） | fetch（`node-backend.ts`） | ✅ 已验证 |
| `ws_connect`（tungstenite+header） | `ws` 包（`node-ws.ts`） | ✅ test-danmaku 四平台通 |
| js 签名执行（new Function） | Node new Function（`node-js.ts`） | ✅ douyin abogus/webmssdk 通 |
| localStorage | storage backend（bun:sqlite） | ✅ |
| browser_ensure/close | — | 已排除 |

两个真实差异面：

1. **TLS/HTTP 指纹不同**（reqwest/rustls ≠ Bun fetch）：对主流目标（bili/youtube/四站
   直播）无碍——这就是 example 在跑的路径。遇平台行为不一致时，`rss fetch` 反而是最快的
   隔离工具（区分代码 bug vs 宿主指纹差异）。
2. **bili 直播弹幕不许碰 Bun 原生 WebSocket**：Bun 内置 WS 是浏览器标准 API，不支持
   自定义握手头，而 bili 要在握手里带 Cookie（buvid3/nav mid）。必须经 `appHost.ws`
   注入 `ws` 包 backend——注入层别图省事透传 native WS。

### 命令集（以调试为中心）

```bash
rss channels [--kind live]          # 渠道注册表：name/tpl 字段/defaultInfo 快照
                                    #   --kind category 可看分区目录订阅
rss fetch <key> k=v ...             # ★ 单渠道抓取探针：耗时+条数；--xml 看原始输出；
                                    #   --json 进管道配 jq；失败完整堆栈；--log <域,...> 细粒度日志开关
rss item <url>                      # ★ by-url 一站式：resolveRoute 命中 → streams 全档位表
                                    #   （format/rate/headers）→ danmaku 元信息
rss play <url> [--open]             # 同 item 只看流；--open 丢系统播放器实测直链活性
rss dm <url> [-n 50]                # 弹幕探针：VOD 前 N 条样本 / 直播实时滚动 + 连接帧数统计
rss align                           # 收编 verify-alignment：crawler XML 与 rsshub 同构消费断言
rss env                             # ★ appHost 各门面自检（http/ws/js/storage 可用性+caps）
rss refresh [sub]                   # core createDataLayer 编排冒烟（SQLite 持久化）
rss hot <词>                        # weibo:hot resolveHotWord 热搜词流（需登录 cookie；纯匿名失败）
rss detail [url|--latest]           # xhs 单条详情补全（匿名 noteDetail，--latest 用当前列表首条）
```

★ = 使用频率最高的三条探针（`channels` / `fetch` / `item`），可观测性是一等公民：
**每个命令默认给耗时，`--json` 全线支持**，错误打完整堆栈。

### example 收编

散装 example 已全部收编转正并清退；**唯一保留** `crawler/src/example/browser-sim.ts`
（浏览器模拟，CLI 排除该类渠道）。新增调试能力只写一处（CLI），不再新起 example。

### 存储：bun:sqlite（CLI）/ tauri-plugin-sql（desktop）

core 数据层认 repo 接口（`subscription/reading/settings-repo` 注入 `createDataLayer`），
换 backend 不动 core 与命令层：

```
bun:sqlite (CLI，apps/cli/.data/rss.db)  /  tauri-plugin-sql (desktop，appData/rss.db)
共用：DDL 唯一权威 = core db/schema.ts（两端各跑同一份幂等迁移）
```

- 两端都**不用插件/库各自的 migration 机制**（防与对方各写各的 SQL 漂移）；desktop 用
  官方 tauri-plugin-sql（sqlx 底层），CLI 用内置 `bun:sqlite`；StorageBackend 语义保持
  （KV string），三 repo 与 commands 全身而退。选型/迁移/验证状态见
  `docs/architecture/data-and-storage.md`。
- WAL：两端各持独立库文件、单进程访问，暂不开；sidecar 互通（同库文件）时再开。

### log 清退联动（CLI 的最大一次性红利，未执行）

判据不是「log 写得好不好」，而是 **「CLI 能否直接复现」**：

| 类型 | 定义（~占比） | 处置 |
|---|---|---|
| 数据路径 log（~80%） | request/response、抓取、流解析决策、弹幕帧统计、deserialize 中间值——函数进出与数据形态 | **清退**。CLI 探针给出结构化答案，优于把散布各处的 log 自己拼回去 |
| 环境路径 log（~20%） | 仅 Tauri/WebView 存在的行为：base64 分片隧道、hls/flv 锁档带宽失真、canplay 自动播时序、webview 并发 UI 竞态 | **保留**。CLI 无法复现，log 是唯一案发现场 |

具体动作（探针在岗后分批执行；现 `resolve/src/log.ts` 仍引用本表，勿删本节）：

- warn/error 一级不留地保留（永久级别）
- crawler 各 channel 域 + danmaku WS 模板事件几乎全是数据路径 → 大面积清退，仅在
  「请求失败/风控命中」处留一个 warn
- player/host 分拣：`loader/play/engine` 里隧道/canplay 相关留；`select`（选流纯逻辑）
  在 `rss item` 可重演 → 清
- 清完后剩余 log 收敛进更少域（host 一个 + player 一两个），不再每 channel 一个
- 现状：`--log <域>` 全面接入 `@amoeba/log` 属未完成项；`RSS_LOG=1` 全开（CLI 无
  localStorage，垫了默认 `log="0"` 的 shim）

**防回涨新约定**：任何 bug 先问「CLI 能否复现」。能 → 不许为它加 log，去修 CLI/加探针；
不能 → 才允许埋 log。没有这条，下一次赶工 log 会重新长回来。

⚠️ 顺序不能反：先立三大探针再动 log（旧观测拆掉前新的必须在岗）。
⚠️ CLI 抓不到的两类 bug 留保险：长时间运行的累积性问题（泄漏/竞态）、UI 交互触发的
状态错乱——这几处 log 别删。

### 收益

- **迭代速度**：免 vite/tauri 的毫秒级反馈循环，crawler/resolve/core 改动即测
- **回归测试入口**：`fetch`/`item`/`dm` 天然是各平台解析的可脚本化回归（配 `--json` 出断言）
- **未来 sidecar 地基**（desktop 爬虫服务化，见 `docs/architecture/crawler-topology.md`）：
  node-host 基建外套 HTTP 层（hono/fastify）即是 sidecar，CLI 先行是该里程碑的第一块
