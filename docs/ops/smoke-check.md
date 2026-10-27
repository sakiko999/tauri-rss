# 端到端巡检清单（改完代码跑什么）

> 仓库无测试基建。本文件是**最小复验集合**：按「改了什么 → 跑什么」组织，每条都是
> 实测可用的命令。⚠️ 读代码判断不可靠 —— 本会话的 `hasPlayable` 误判 bili DASH 流
> （url 恒空串）、播客 `preload=none` 死锁，都只在**真机播放**才暴露。

## 一、改动 → 巡检对照

| 改了什么 | 跑什么 |
| --- | --- |
| **任何** 改动 | `bun run check`（static + contract + state + typecheck，12 个 tsconfig）+ 相关 `.check.ts` |
| crawler→core 字段 | `serialize-roundtrip.check.ts` + `serialize-contract.check.ts` |
| player 选流/兜底/autoplay | `scripts/ui-play-check.ts`（真机播放矩阵）+ `packages/player/src/hooks/useStreamSelection.check.ts` |
| player 统计信息（右键） | `bun packages/player/src/hooks/player-stats.check.ts`；真机：播放中右键 →「统计信息」，引擎/档位/分辨率/帧率/丢帧/缓冲健康/编解码器/音量/宿主隧道/网络活动应有值（网络活动 = 进程累计出站流量与请求数，媒体分片持续增长）；直播另有「直播延迟」；再次右键可隐藏 |
| 二级订阅骨架形态 | 真机：播客节目 `?open=` 加载时骨架是**行列表**（不是卡片网格）；分区目录 `?open=` 骨架是**网格**；两者都**不应再出现第二条标题占位条**（预览页已有真实表头，用 `PreviewSkeleton` 而非全局 `GridSkeleton`） |
| 播放队列 / 播完下一条 | `packages/core/src/example/media-store.check.ts`；真机：入队 → 重载看仍在（localStorage `ui-queue`）→ 派发 `ended` 看是否跳下一条 |
| **按 id 记/改/查任何东西** | ⚠️ `MediaItem.id` 只在**订阅内**唯一（实测 `bilibili:7734200` 同时在 `bili:live` 与 `bili:live:hot`）—— 必须带 `subscriptionId`；`repo-concurrency.check.ts` 有跨订阅隔离用例 |
| 启动骨架 / 侧栏宽度 | `apps/desktop/src/lib/boot-skeleton.check.ts`（两份手写字面量必须一致，否则冷启动第一帧跳一下） |
| by-url 路由 | `packages/resolve/src/example/router.check.ts` |
| 文章正文提取 | `packages/crawler/src/example/extract.check.ts` |
| 正文持久缓存 | `packages/core/src/example/body-cache.check.ts` |
| 仓储并发/退订 | `packages/core/src/example/repo-concurrency.check.ts` |
| 续播进度落库（节流/近片尾清除） | `packages/core/src/reading-position.check.ts` |
| mobile 正文渲染 | `apps/mobile/src/html.check.ts` |
| OPML | `packages/xml` + `apps/desktop` 的 `opml.check.ts` |
| 新增/改动「回车提交」输入框 | `bun apps/desktop/src/lib/ime.check.ts`;⚠️ 守卫只挡 `keydown`,**不改中文输入法的组合行为**(实机验证仍需真 IME) |
| 弹幕 WS 重连(退避/熔断) | `bun run rss dm <在线房间> -s 5`;断线后看日志应是「第 N 次, 约 Xms 后」而非固定 1000·2ⁿ,且 10 次后打「放弃」 |
| desktop UI 布局/隐藏 | `scripts/ui-probe.ts goto <node>` + `ui-console.ts` |
| **主区滚动（死区）** | ⚠️ 必须用**真实滚轮**：`Input.dispatchMouseEvent{type:"mouseWheel"}`。**合成 `WheelEvent` 在 Chromium 里不触发滚动**，`scrollTop` 恒为 0，会得出假结论。逐点测「表头 `.grid-head`、直播轨 `.live-block`、网格」三处，应**都** > 0 |
| 侧栏分组树(展开态/键盘) | `apps/desktop/src/lib/rail-nav.check.ts` + `ui-probe.ts goto tab:all`;⚠️ 必验「焦点在树行按 ↑↓ **不**切文章」,见 `docs/ui/rail-tree-accordion.md` |
| 组件拆分(移动/新建文件) | `tsc -p apps/desktop` + `ui-probe.ts goto page:settings` / `page:discover` 各走一遍;⚠️ tsc 查不出**循环 import 与渲染断链**,必须实机点 tab / 开弹窗 |
| 设计令牌/对比度 | `scripts/ui-design-audit.ts` |
| **响应式断点** | 逐宽度量真实几何（`Emulation.setDeviceMetricsOverride` + 读 `getBoundingClientRect`）。⚠️ **别只看断点数字**：两个断点撞在同一个宽度会产生**反向跳变**（播放页单栏 1080 与侧栏折叠 1080 撞车，窗口越窄播放器越小、到 1040 反而暴涨 912）。基线（2026-10-15 实测，勿回退）：1440→764 / 1360→684 / 1290→614（双栏，右栏 320）；1279→947 / 1200→868 / 1100→768 / 1040→912（单栏，右栏在下方） |
| **类名冲突（跨区块复用）** | ⚠️ `styles/` 拆成多文件后，**同名类会跨文件叠加**（历史上 `.rail-head` 就同时被侧栏和直播区复用，`column` + `wrap` 叠加把头部撑成 132px；直播区现已改名 `live-*`）。改样式前先 `grep` 类名在 `styles/` 下**出现了几次**；新组件用**模块前缀**，别借侧栏的命名空间 |
| **数据服务/协议/客户端** | `service-skeleton-check.ts` + `service-data-check.ts`（含迁移表/每日备份/回滚演练/退订清理/取消/并发）+ `remote-data-layer-check.ts`（含取消/崩溃收敛）+ `service-snapshot-size.ts`（改投影字段时看 gzip 体积）+ `SERVICE_ENTRY=dist/service/service.js service-runtime-check.ts` + `cargo test -p amoeba --lib service::tests`；真机：`bun run tauri` → `ui-probe eval`（`__store.getState().serviceError===null`）→ `bun run rss attach status` → 两端互标已读看对方变化 → 正常关窗看 endpoint/lock 清理 |
| **服务打包** | `bun run tauri:build`（内含 service:build + runtime/browser 的 release 构建 + `tauri build --config tauri.conf.release.json`）；⚠️ 无 `TAURI_SIGNING_PRIVATE_KEY` 时 NSIS 之后的 updater 步失败，**安装包已产出**（7z 应列出 service.js/runtime/browser 三件） |
| **core schema/迁移** | `service-data-check.ts` 会断言 `_migrations`；本地再跑 `bun run rss env` 后查 CLI 库 `_migrations`。改 `STORAGE_SCHEMA` 的已发布条目 = checksum 拒绝启动，只能追加新版本 |
| **`rss login` / 二维码渲染**（2026-10-26） | `bun apps/cli/src/ui/qr-terminal.check.ts`（PNG 解码 → jsqr 还原 → 半块尺寸）；真机：起服务 → `rss login xhs`，终端码能被手机扫到；已登录 profile 应直接返回「已登录」。⚠️ 登录只走服务 RPC，服务未运行时命令应报错并给启动方式 |
| **平台表 / governor 分类**（2026-10-26，R9） | `bun packages/platform/src/example/platform.check.ts` + `governor.check.ts`；改平台只动 `packages/platform/src/index.ts`，`rss channels` 与账号页展示名应同步 |
| **StorageBackend.batch / 退订清理**（2026-10-26，R10） | `data-layer.check.ts`（断言多键一次 batch 删净）+ `service-data-check.ts` 退订段；⚠️ tauri-plugin-sql 后端刻意不实现 batch，mobile / 浏览器 dev 的进程内路径逐个删是预期行为 |
| **视频会员/付费标记**（2026-10-26，`membersOnly`） | `bun packages/core/src/example/serialize-roundtrip.check.ts` + `bun packages/resolve/src/example/youtube-channel.check.ts`；B站 `rss fetch bili:popular --json`（有付费条目时才出现）；YouTube `rss fetch youtube --kv channelId=<频道> --xml` 里 `tpl:membersOnly="1"`。⚠️ 匿名频道 Videos 首屏常只有公开视频，会员视频是否出现取决于频道 |
| 新增/改动 channel | `bun run rss channels --kind <kind>` + `bun run rss fetch <key> --json`；⚠️ 发现页「可一键订阅」判据是 `!!defaultInfo \|\| 无必填项` —— **空对象是 truthy**，给需要参数的渠道写 `defaultInfo = {}` 会让它被误列进去 |
| **Twitch（直播频道 / 热门 / 分区 / HLS）**（2026-10-20） | `bun run rss fetch twitch:live --kv roomIds=shroud --json`（离线频道也返 `offline` item，非 bug）+ `bun run rss fetch twitch:hot --json`（观看数降序）+ `bun run rss fetch twitch:category --kv category=just-chatting --json`（slug 或 `twitch.tv/directory/category/<slug>`）+ `bun run rss item https://www.twitch.tv/<login>`（应出多档 `hls`，**首档最高、`audio_only` 最后**）+ `bun packages/resolve/src/example/twitch-playlist.check.ts` + `bun packages/crawler/src/example/twitch-live.check.ts` |
| **YouTube 直播热门/栏目 / 播放列表 / B站合集·列表·收藏夹**（2026-10-20） | `bun packages/crawler/src/example/youtube-channels.check.ts` + `bun packages/crawler/src/example/bili-channels.check.ts` + 六个真机探针：`bun run rss fetch youtube:live-hot`、`youtube:live-category --kv category=gaming`、`youtube:playlist`、`bili:season`、`bili:series`、`bili:favlist`。⚠️ B站三个都要验**第二页有新增**（series 曾因 `page_num` 静默返回首页）；season 不带 Referer 会 `-352` |
| **播放 loader / 流路由条件**（2026-10-21） | ⚠️ **必须用 true release 验**：dev 的 `http://localhost:1420` 与 release 的 `http://tauri.localhost` 对上游是不同 Origin（Twitch CloudFront 只放行前者，回 403）。判据：release 下播 Twitch 与 YouTube 各一条，控制台应有 `[host:http] GET https://apn*.playlist.ttvnw.net/...`（走隧道），无 `403`、无 `manifestLoadError`，画面真的动 |
| **YouTube player client / fallback 链**（2026-10-21） | `bun packages/resolve/src/example/youtube-clients.check.ts` + `bun run rss item https://www.youtube.com/watch?v=dQw4w9WgXcQ`（6 档 DASH、首档 1080p）+ 直播同款（1 条 `hls`）。⚠️ 三个**静默失败**：clientVersion 过旧 → `UNPLAYABLE`；`VISIONOS` 设备字段缺失 → 静默「视频不可播」；`visitorData` 没透传 → `LOGIN_REQUIRED`（**与 IP 被风控同症状**，先别怀疑风控） |
| **分区目录订阅（`kind:"category"`）**（2026-10-20） | `bun packages/crawler/src/example/category-directory.check.ts` + `bun packages/core/src/example/serialize-roundtrip.check.ts`（category 专项）+ `bun run rss fetch twitch:categories`（及 `youtube:live-categories` / `live:douyin:categories` / `live:douyu:categories` / `live:huya:categories`）+ tsc；真机：发现页「可订阅榜单」一键订阅目录 → 订阅内容是分类卡片（**无播放按钮**，foot = 分区）→ 点卡片右侧**用正常网格**列出该分区内容（URL `?open=<itemId>`）→ 表头「订阅该分区」用**完整参数**落地（抖音必须 `partition` + `partitionType=4/1`）。⚠️ 目录渠道是独立订阅，不是发现页的临时目录 |
| **网络风控 / governor / 被动采集** | `bun packages/host/src/example/governor.check.ts` + `bun packages/core/src/example/passive-mode.check.ts` + `bun packages/crawler/src/example/bili-popular.check.ts`；真机：设置 →「网络与风控」里被动渠道（xhs:explore）显示「浏览器被动」标签且**没有等级下拉**，手动刷新不产生应用构造的请求；**平台 L0 必须能绕过平台冷却**（全局 L1 + B站平台设 L0，冷却期内刷新应放行）；`"*"` 行影响 RSS 直链（配额按 host 各自计数）；存量 `netLevels` 的 9/"lx" 启动后归一化为 1，旧 channelKey 键启动后折叠成平台键（风控 §2.4） |
| **B站扫码登录后的抓取**（2026-10-20） | `bun packages/resolve/src/example/bili-buvid.check.ts`；真机：扫码登录 → `bili:live:hot` 手动刷新应无错误（登录 cookie 只有 passport 五项、无 buvid3，必须补匿名 buvid，否则 `-352`）→ 同一登录态下直播播放解析正常 |
| **bili:user_video（UP 主投稿）刷新**（2026-10-21） | `bun packages/resolve/src/example/bili-space-sign.check.ts`；真机：登录态下 `bili:user_video` 手动刷新应成功（曾 412：漏传 cookie + space 接口缺 `dm_*` 指纹）；CLI 匿名对照 `bun run rss fetch bili:user_video --kv uid=<uid> --kv cookie=` 允许失败（匿名 space 已收紧），但登录态必须可用 |
| **cookie provider / 渠道工厂**（2026-10-21） | `bun packages/resolve/src/example/credentials.check.ts`（三级语义 / bili sign 家族同接 / douyin 登录 cookie 兜底 / xhs 空串退出）；真机：douyin 扫码登录后 `live:douyin` 播放应能取到登录档位（原画，`douyinCookie` 死键已接通——扫码 jar 自含 ttwid；若仍 250 封顶属平台侧行为，记录即可）；`rss fetch bili:popular` / `rss channels` 走工厂装配应与转换前同形 |
| **启动 cookie 快照同步**（2026-10-23） | `bun packages/core/src/example/cookie-sync.check.ts`；真机：登录 weibo 后重启桌面应用，settings.weiboCookie 应更新为浏览器 profile 的 m.weibo.cn 当前值；浏览器登出/清 profile 后重启**不得清空** settings；只有 bili/RSS 订阅、或 xhs/weibo 订阅全停用、或仅 xhs 订阅时，启动**不得拉起**抓取浏览器（任务管理器不应出现抓取 webview 进程） |
| **xhs 登录 / 凭证 / 浏览器闸门 / 翻页**（2026-10-20） | `governor.check.ts`（含 browserGate）+ tsc + `bun run build:desktop`；真机八件事：① **未扫码时点「扫码登录」必须出二维码**（游客 `web_session` 不算登录）；②「清除凭证」后刷新应报「登录已失效」而不是继续用旧账号抓；③ 扫码期间点刷新，登录不应被导航抢页/abort 打断；④ **关掉二维码弹窗应立刻取消登录**（再点刷新不报「刷新超时」、重开弹窗马上出码）；⑤ 连续两次 xhs 浏览器操作间隔应 ≥600ms（L2/L3 更长）；⑥ **登录态 explore 滚动「加载更多」应增长**（纯被动，只读页面 state，不应出现 `/explore` HTML fetch）且**新内容在列表下方**（顶部首屏不被换掉）；⑦ **点开一条笔记后再点「加载更多」应继续推进**（共享抓取 webview 被导航走 → 页面重载；不得重复只返回已有条目、不得显示「已加载全部」）；⑧ 首屏 > 60 条时（explore 实测 89）列表尾部条目可见、footer 计数与头部总数一致；⑨ **未登录时刷新必须报「需要登录」**（匿名态已移除，不得静默 0 条 / 不得返回匿名内容） |
| 改 `browser-sidecar` 窗口模式 / 浏览器抓取 | `cargo check -p amoeba-browser` + release 实例验证：服务 spawn 的 sidecar 输出 `READY <port>` 后 `/json/list` 可读；`interactive` 下 xhs:user「加载更多」应增长，切回 `hidden` 后滚动不再加载。**生命周期**：① 服务退出后 sidecar 进程必须退出；② 空闲回收后下一次抓取自动重建；③ 重建 3 次不报 profile 占用；④ 建 lane 后任务栏/Alt-Tab 不出现 about:blank 窗口；⑤ close 后端口释放、WebView2 进程消失；⑥ reset 后 profile 目录删除；⑦ 反复 open/close 不闪控制台黑框；⑧ 第二实例报 profile 占用且不杀第一个实例的浏览器。机制见 `docs/risk/crawler-risk-control.md` §3.9 |
| **lane 化 / 多 tab 浏览器**（2026-10-22） | `bun packages/resolve/src/example/scheduler.check.ts`（并发 lane / 租约计数 / gate 串行不占 lane / 异常释放 / abort 豁免登录）；真机（release 实例）：① xhs:user 刷新 → **打开一条笔记详情**（`detail:xhs` lane）→ 回来点「加载更多」应**从原 cursor 继续**（不再整页重载空页）；② 扫码登录（`login:*` lane）进行中触发全量刷新，其它订阅应正常刷新且登录不被打断；③ devtools `/json/list` 应能看到多个 target（`list:xhs:*` / `detail:xhs` / `login:*` 按需创建，上限 8） |
| 改 `ui-design-audit.ts` 本身 | 跑一遍看全视图 contrastIssues 是否 0（含半透明徽标卡片，如 `s-video-bili`） |
| **时间戳单位 / 排序** | `bun packages/resolve/src/example/xhs-time.check.ts`；⚠️ **必须重新抓取**才生效 —— 坏值已落库，看旧数据会误判成「没修好」。判据：social 的 `publishedAt` 年份应在合理区间（修前是 58754） |
| 滚动条 / `scrollBarStyle:fluentOverlay` | CDP 量 `El.offsetWidth - clientWidth`：**必须 0**（>0 = 被 `::-webkit-scrollbar` 顶成经典条）。空白页对照：`overflow:auto` 的 300px 盒，无滚动条 CSS → 0（overlay 生效）；加 `::-webkit-scrollbar{width:10px}` → 10（切经典） |
| 改 `styles.css` 的 `@layer` / reset 结构 | CDP 量 tailwind 按钮的 `getComputedStyle(btn).paddingInlineStart`：**必须 `12px`**（`0px` = reset 漏在层外；`.btn` 无纵向 padding，整串 padding 是 `0px 12px`） |

## 二、类型检查（12 个项目，必须全 0）

```bash
bun run check                  # static + contract + state + typecheck 一次跑完（推荐）
bun run check --layer typecheck # 只看类型
```

覆盖 `packages/{xml,log,platform,resolve,crawler,core,host,player,ui}` + `apps/{cli,desktop,mobile}`，
每个项目单独 `tsc -p`（入口 `scripts/check.ts`）。列表在 `scripts/check.ts:89` 的 `TYPECHECK_PROJECTS`。

## 二点五、Numbered UI Overlay（dev-only）

```bash
bun apps/desktop/src/dev/ui-overlay/overlay.check.ts   # 快捷键/编号/定位/标签选择纯逻辑
# 需 dev 实例（9222）；Ctrl+Shift+U 开关覆盖层
bun scripts/ui-probe.ts eval "__uiOverlay.stats()"     # candidates / blocks / labels / overflow
bun scripts/ui-probe.ts eval "__uiOverlay.json()"      # AI 可读清单（区块 + 控件）
bun scripts/ui-probe.ts eval "__uiOverlay.list().filter(e => e.block).length"  # 区块数
```
⚠️ 400 是**同屏标签上限**，不是编号上限；区块优先保留。编号在同一路由内固定，路由变化重置。
详见 `docs/ui/numbered-ui-overlay.md`。

## 三、播放矩阵（必须 4/4 起播）

需 `bun run tauri` 在跑（9222 已开）。
```bash
bun scripts/ui-play-check.ts
```
覆盖 video-bili（DASH）/ video-youtube（DASH）/ live（HLS）/ audio（原生）。断言 `currentTime > 0`。
⚠️ 用 CDP `Page.navigate` 而非 `location.href=`（后者被 react-router startTransition 接管，读到旧页）。

## 四、平台能力探针（CLI，无需 app）

```bash
bun run rss fetch bili:popular --json        # bili 视频列表
bun run rss fetch bili:precious --json       # bili 入站必刷（匿名，~98 条）
# ⚠️ xhs:explore 的 HTTP SSR 是空壳；登录态用 `rss login xhs`（经数据服务），
#    探针再走 `--via-service`（CLI 自己的 --browser sidecar profile 不承载登录态）
cargo build -p amoeba-browser && bun run rss fetch weibo:user --browser --kv uid=1195230310  # 浏览器渠道冒烟
bun run rss fetch xhs:user --kv user_id=<id> --kv cookie=<ck> --json   # 小红书用户笔记（HTTP SSR）
bun run rss fetch douyin:trend --json        # 抖音热点榜（匿名，含热度/榜位）
bun run rss sug 王者                          # 抖音搜索联想词（匿名）
bun run rss fetch live:douyin --kv roomIds=@<抖音号> --json       # 抖音号/短 ID/直播间链接归一
bun run rss fetch live:douyin:user --kv secUid=<主页链接> --json  # 主页链接 → 抖音号 → 房间（在播/离线）
bun run rss play "https://live.douyin.com/<在线房间>"   # douyin 直播多档位
bun run rss dm   "https://live.douyin.com/<在线房间>" -s 6  # douyin 弹幕（需在线房间）
bun run rss item <url>                        # by-url 路由 + 全档位
bun run rss fetch apple:podcast-chart --json             # Apple 播客热门榜（匿名）
bun run rss fetch apple:podcast-chart --kv genre=1318 --json
bun run rss fetch apple:podcast-search --kv q=故事 --json
```
⚠️ **固定房间会下播**：种子里的 bili/douyu/huya/douyin 房间硬编码，下播时流/弹幕为空
（`liveStatus:"offline"`）**非 bug**。取实时在线房间用 `live:douyin:hot` 等热门渠道。

## 五、已知「看似失败实为正常」

- **离线直播**：`resolveLivePlay` 返回空 / flv 404 / 0 弹幕 —— 房间已下播（查 `liveStatus`）。
- **xhs 详情裸 url**：`bun run rss detail <url>` 无 xsec_token 必失败（详情需列表项 token）；CLI 不拉列表（`--latest` 已删），cookie 用 `--cookie <ck>` 或 CLI settings；
  经 app 的 `resolveDetail(sub, itemId)` 才带 token。
- **浏览器路径（非 Tauri）**：`injectBrowserHost` 有 CORS 限制，平台抓取会失败，仅壳层可用。
- **douyin 弹幕 0 条**：房间离线时正常。
