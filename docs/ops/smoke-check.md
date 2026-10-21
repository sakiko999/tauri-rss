# 端到端巡检清单（改完代码跑什么）

> 仓库无测试基建。本文件是**最小复验集合**：按「改了什么 → 跑什么」组织，每条都是
> 实测可用的命令。⚠️ 读代码判断不可靠 —— 本会话的 `hasPlayable` 误判 bili DASH 流
> （url 恒空串）、播客 `preload=none` 死锁，都只在**真机播放**才暴露。

## 一、改动 → 巡检对照

| 改了什么 | 跑什么 |
| --- | --- |
| **任何** 改动 | 6 包 `tsc --noEmit`（见下）+ 相关 `.check.ts` |
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
| OPML | `apps/xml` + `apps/desktop` 的 `opml.check.ts` |
| 新增/改动「回车提交」输入框 | `bun apps/desktop/src/lib/ime.check.ts`;⚠️ 守卫只挡 `keydown`,**不改中文输入法的组合行为**(实机验证仍需真 IME) |
| 弹幕 WS 重连(退避/熔断) | `bun run rss dm <在线房间> -s 5`;断线后看日志应是「第 N 次, 约 Xms 后」而非固定 1000·2ⁿ,且 10 次后打「放弃」 |
| desktop UI 布局/隐藏 | `scripts/ui-probe.ts goto <node>` + `ui-console.ts` |
| **主区滚动（死区）** | ⚠️ 必须用**真实滚轮**：`Input.dispatchMouseEvent{type:"mouseWheel"}`。**合成 `WheelEvent` 在 Chromium 里不触发滚动**，`scrollTop` 恒为 0，会得出假结论。逐点测「表头 `.grid-head`、直播轨 `.rail-block`、网格」三处，应**都** > 0 |

| 侧栏分组树(展开态/键盘) | `apps/desktop/src/lib/rail-nav.check.ts` + `ui-probe.ts goto tab:all`;⚠️ 必验「焦点在树行按 ↑↓ **不**切文章」,见 `docs/ui/rail-tree-accordion.md` |
| 组件拆分(移动/新建文件) | `tsc -p apps/desktop` + `ui-probe.ts goto page:settings` / `page:discover` 各走一遍;⚠️ tsc 查不出**循环 import 与渲染断链**,必须实机点 tab / 开弹窗 |
| 设计令牌/对比度 | `scripts/ui-design-audit.ts` |
| **响应式断点** | 逐宽度量真实几何（`Emulation.setDeviceMetricsOverride` + 读 `getBoundingClientRect`）。⚠️ **别只看断点数字**：两个断点撞在同一个宽度会产生**反向跳变**（播放页单栏 1080 与侧栏折叠 1080 撞车，窗口越窄播放器越小、到 1040 反而暴涨 912）。基线见下方结论记录 |
| **类名冲突（跨区块复用）** | ⚠️ `styles/` 拆成多文件后，**同名类会跨文件叠加**（`.rail-head` 同时给侧栏和直播区写过，`column` + `wrap` 叠加把头部撑成 132px）。改样式前先 `grep` 类名在 `styles/` 下**出现了几次**；新组件用**模块前缀**（`live-*`），别借侧栏的命名空间 |

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
| **xhs 登录 / 凭证 / 浏览器闸门 / 翻页**（2026-10-20） | `governor.check.ts`（含 browserGate）+ tsc + `bun run build:desktop`；真机八件事：① **未扫码时点「扫码登录」必须出二维码**（游客 `web_session` 不算登录）；②「清除凭证」后刷新应报「登录已失效」而不是继续用旧账号抓；③ 扫码期间点刷新，登录不应被导航抢页/abort 打断；④ **关掉二维码弹窗应立刻取消登录**（再点刷新不报「刷新超时」、重开弹窗马上出码）；⑤ 连续两次 xhs 浏览器操作间隔应 ≥600ms（L2/L3 更长）；⑥ **匿名 explore 滚动「加载更多」应增长**（纯被动，只读页面 state，不应出现 `/explore` HTML fetch）且**新内容在列表下方**（顶部首屏不被换掉）；⑦ **点开一条笔记后再点「加载更多」应继续推进**（共享 Edge 被导航走 → 页面重载；不得重复只返回已有条目、不得显示「已加载全部」）；⑧ 首屏 > 60 条时（explore 实测 89）列表尾部条目可见、footer 计数与头部总数一致 |
| **改 `browser.rs` 窗口模式 / 浏览器抓取** | `cargo check --manifest-path apps/src-tauri/Cargo.toml`（必 0 错）+ **release 实例**验证（debug 窗口恒可见，模式切换是 no-op）：`ui-probe eval "__TAURI__.core.invoke('browser_set_mode',{mode:'interactive'})"` → xhs:user「加载更多」应增长；切回 `hidden` 后滚动不再加载。机制实测见 `docs/risk/crawler-risk-control.md` §3.9 |
| 改 `ui-design-audit.ts` 本身 | 跑一遍看全视图 contrastIssues 是否 0（含半透明徽标卡片，如 `s-video-bili`） |
| **时间戳单位 / 排序** | `bun packages/resolve/src/example/xhs-time.check.ts`；⚠️ **必须重新抓取**才生效 —— 坏值已落库，看旧数据会误判成「没修好」。判据：social 的 `publishedAt` 年份应在合理区间（修前是 58754） |
| 滚动条 / `scrollBarStyle:fluentOverlay` | CDP 量 `El.offsetWidth - clientWidth`：**必须 0**（>0 = 被 `::-webkit-scrollbar` 顶成经典条）。空白页对照法见下方结论记录 |
| 改 `styles.css` 的 `@layer` / reset 结构 | CDP 量 tailwind 按钮的 `getComputedStyle(btn).padding`：**必须 `6px 12px`**（`0px` = reset 漏在层外，把 utility 压死了） |

## 二、类型检查（6 包，必须全 0）

```bash
for p in packages/xml packages/core packages/crawler packages/resolve apps/desktop apps/mobile; do
  ./node_modules/.bin/tsc -p $p/tsconfig.json --noEmit
done
```
⚠️ player 包 tsconfig 单独跑会报 `Cannot find type definition file for 'vite/client'`（历史配置问题，
非代码错）；用 `tsc -p apps/desktop` 会连带编译 player，能查到 player 的类型错。

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
bun run rss fetch xhs:explore --json         # 小红书匿名流
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
- **xhs 详情裸 url**：`bun run rss detail <url>` 无 xsec_token 必失败（详情需列表项 token）；
  经 app 的 `resolveDetail(sub, itemId)` 才带 token。
- **浏览器路径（非 Tauri）**：`injectBrowserHost` 有 CORS 限制，平台抓取会失败，仅壳层可用。
- **douyin 弹幕 0 条**：房间离线时正常。

## 六、结论记录

- 2026-10-13 全会话复验：bili / douyu / huya / douyin / youtube / xhs / 播客 / RSS 全绿；
  播放矩阵 4/4；6 包 0 类型错误；9 `.check` 全通过；设计审计 0 真实对比度违规。
- 2026-10-13 审计轮复验：host/cli/xml/desktop+player 四轮审计 → 修 16 条真缺陷；
  8 包 0 类型错误；12 `.check` 全通过；播放矩阵 4/4；控制台 0 告警。抖音联想/热点榜 + `resume`
  智能订阅 + 发现页 5 处修复一并落地。
- 2026-10-13 审计轮二：resolve + crawler 两层审计 → 修 8 条真缺陷（bili 弹幕截断帧死循环 /
  斗鱼帧粘包只解首包 / youtube 解 n 抠错 videoId / bili buvid 缓存毒化 / 四平台直播全失败当成功 /
  huya 搜主播 online 假 0 / bili:square id 含下标 / douyin 重复 enter）+ 2 条复核纠正为误报。
  新增 2 守卫（danmaku-proto / douyu-frame）→ 14 `.check` 全通过；8 包 0 类型错误；播放矩阵 4/4；
  八路搜索矩阵全绿；控制台 0 告警。
- 2026-10-14 侧栏分组树改 Radix Accordion + 方向键导航（见 `docs/ui/rail-tree-accordion.md`）：
  tsc 0 错；`rail-nav.check.ts` 全过；CDP 验「焦点在树行按 ↑↓ 不切文章」+ 焦点移出树后仍能切文章
  （反证）；折叠栏 64px 与窄窗 1024px 下方向键均可用；`ui-probe` 0 问题；无 React 告警；
  `ui-design-audit` contrastIssues 0、smallTargets 6 → 1。
- 2026-10-14 启动过渡期骨架屏（Vite 的 dev 脚本执行前有 ~1.1s 纯空白）：
  `#boot-skeleton`(index.html 静态) + `.boot-overlay`(App 兜底) 同一判据 `showSkeleton()` 同收；
  修掉「库读到前视图画『还没有订阅』假信息」与「静态骨架留在正常流把 #root 顶出首屏」两坑。
- 2026-10-14 **`scrollBarStyle:"fluentOverlay"` 被 `.scroll-area::-webkit-scrollbar{width:10px}` 旁路**：
  实测（WebView2 155）`.rail-scroll` / `.main-region > .scroll-area` 的 `offsetWidth-clientWidth` 恒为 **9**
  —— 是**经典**滚动条、占布局。判定法：**空白页最小对比**（`overflow:auto` 的 300px 盒，
  量 `offsetWidth-clientWidth`）：无任何滚动条 CSS → `0`（overlay 生效）；加一条
  `::-webkit-scrollbar{width:10px}` → `10`（切经典）。`scrollbar-width:thin/auto` 则保持 `0`。
  故**只要 `::-webkit-scrollbar` 匹配上就会切经典模式**，fluentOverlay 失效。
  删掉那条规则后 gutter 归 0，`--rail` 268px 下侧栏 258→**267px**、主区宽 9px。
  ⚠️ 折叠栏图标对齐（-5px）与 `.group-head` 的 -6.3/5.1px 偏移都是这条规则的连锁副产品
  （滚动条吃 10px → 行 38px vs 48px）；「补 5px」类注释已更正为根因记录。
  回归：`tsc` 0 错；`ui-probe audit` issueCount 0；`ui-design-audit` contrastIssues 0；
  折叠栏图标中心 vs 侧栏中心 delta = -0.3px。
- 2026-10-14 **组件分层 + 大文件拆分**（纯重构，零行为变更）：
  - 分层：`components/` = 功能件（纯 props），`components/app/` = 业务件（读 store / 吃 domain 类型）；
    移动 8 个文件 + 13 处 import 路径批量修正。
  - 拆文件：Rail 461→125（+RailGroupTree 356 / NavRow 51）· AddSubscriptionDialog 591→392
    （+AddPanels 262）· SettingsPage 555→52（5 个 tab 各一文件）· DiscoverPage 429→155
    （+PlatformBrowser 218 / BoardList 69 / platforms 15）。
  - 回归：`tsc` 0 错；`ui-probe` tab:all / page:settings / page:discover 各 issueCount 0；
    设置 **17 个 tab 按钮**逐个点过、发现页 4 section、添加弹窗两模式、
    侧栏树方向键（焦点 group→member、defaultPrevented=true）全部实测通过；无 React 告警。
  - ⚠️ 手抄 store 动作签名会踩返回值：`addGroup` 返 `string|null`、`autoGroupByKind` 返 `number`
    —— 拆出的子组件一律用 `Store = ReturnType<typeof useDesktop.getState>` 派生，别手写。
- 2026-10-14 **重命名 + 两个收敛点**：
  - `cards.tsx → Cards.tsx`、`ui/atoms/icons.tsx → Icons.tsx`（全仓 tsx 统一 PascalCase，
    仅 `main.tsx`/`router.tsx` 入口例外）。
  - `store/index.ts` 新增 `syncSubscriptions()`（「重读订阅+分组 → 重绘」），收敛 8 处重复；
    `lib/useLatestOnly.ts` 取代 2 处手写 `genRef`。
  - ⚠️ **重构中引入并修掉的两个顺序 bug**（`syncSubscriptions` 内含 `refreshView`）：
    `removeSubscription` / `removeGroup` 原本是 `set → 改 selectedNodeId → refreshView`，
    改完若把 `syncSubscriptions` 放前面，就会**拿刚删的 id 重算视图**。实测路径：删掉
    *当前选中* 的分组 → 断言 `selectedNodeId==='tab:all'` 且视图非空（实测 120 条）。
  - ⚠️ `toggleSubEnabled` **故意不收敛**（启停不改内容集，多调 refreshView 是白重算）——
    实测 `view.list` 60→60 不变。
  - 回归：6 包 tsc 0 错；14 个 `.check` 全过；`ui-probe` issueCount 0；实机验证建组/改名/
    删选中组/停用/切平台连点/弹窗切模式全通过，无 React 告警。
- 2026-10-14 **播放舞台改黑底 + 揪出 `@layer base` 提前收尾的仓库级 bug**：
  - `PlayableMedia.tsx`:`MediaState` 从主题变量(`bg-[var(--surface-2)]` + `text-[var(--text)]`)
    改成写死黑底白字,并用 `bg-(--surface-2)`→`bg-black` 的 Tailwind 4 简写;顺手把两处
    原生浅色块(`red-300`/`zinc-300` 边框)一并收进 `MediaState`(三处配色原本各不相同)。
    理由:播放器末尾的未知流兜底分支本来就是 `bg-black`,舞台一贯是黑的。
  - **根因 bug**:`styles.css` 的 `@layer base{}` 只覆盖 `*` + `body`,**被自己提前 `}` 收尾**;
    后面的 `h1..figure`/`ul,ol`/`img`/`button,input,select,textarea`/`button` reset 全成了
    **无层规则**,而**无层优先级高于所有 `@layer`** → `button{background:none;border:0;padding:0}`
    把 packages 里 tailwind 按钮的 `bg-*`/`border-*`/`px-*`/`py-*` 全废掉。
    旧 `MS_BTN` 的边框/内边距其实**从来没生效过**,一直被这条掩盖。
  - 修法:把 8 组 reset 全部移进 `@layer base`。**运行时证明**(CDP 从活体 CSSOM 删掉那条
    无层规则 → `padding` 立刻从 `0px` 变 `6px 12px`、`bg` 变 `white/10`、`border` 出现;
    再插回 base 层,结果相同)—— 层序修复正确。
  - ⚠️ 测这层东西**不能只信源码**:Vite 对该文件的 transform 缓存一度卡住,服务端持续发
    旧 CSS(第二段 `@layer base` 恒 283 字节)。判据用**服务端 CSS 长度**或直接量 computed style,
    别用源码 diff。tailwind 的注释会被剥掉,也不适合当探针。
  - ⚠️ 另有环境坑:**重启 `bun run tauri` 会引发 WebView2 CDP 端口重绑**,正在跑的实例
    连不上 9222(本次即因此中断);诊断脚本别依赖跨重启的 CDP 会话。
  - 回归:6 包 tsc 0 错。
- 2026-10-15 **IME 守卫收口 + 弹幕重连加 jitter/熔断**(源自对 open-claude-ui 逆向库的调研):
  - **IME 守卫**:本仓已有两种手写写法(`CommandPalette` 的 `e.isComposing || keyCode===229`、
    `mobile/App.tsx` 的 `e.nativeEvent.isComposing`),但另有 **5 处裸 `key === "Enter"`** ——
    `AddPanels:84`(搜索)/`PlatformBrowser:181`(发现页搜索)/`EditSubscriptionDialog:88`(标题)/
    `settings/Subscriptions:193`(**新建分组名**)/`settings/Reading:64`(RSSHub 地址)。
    中文输入法下回车是**选词**,不拦会建出名叫 `fenzu` 的分组、搜到一半拼音就发请求 —— 全是静默错值。
    新增 `apps/desktop/src/lib/ime.ts` 收口 6 处(含 CommandPalette)。
    ⚠️ **必须取 `nativeEvent.isComposing`**:本仓 `@types/react` 只给**原生**事件声明了该字段,
    合成事件上 `e.isComposing` 直接编译不过(`TS2339`)—— `apps/mobile` 的写法正是因此。
    `keyCode===229` 保留为兜底(上屏那一下 `isComposing` 可能已 false),mobile 那处一并补上。
    自检 `apps/desktop/src/lib/ime.check.ts`(6 条:合成/原生两条路径 × 正常/229/普通)。
  - **弹幕重连**:`resolve/danmaku/stream.ts` 原来只有 `min(1000·2ⁿ, max)`,**无限重试**。
    加 ±15% Full Jitter(多直播间同时断线时错开重连,避免自造流量尖峰)+ `maxAttempts`(默认 10)
    熔断,超限打 `wsReconnectGaveUp` 后放弃(连接成功清零计数,长期在线后仍有全额)。
    ⚠️ 未做 `Retry-After` header 优先 —— WS 握手失败拿不到响应头,收益近乎零。
  - ⚠️ 另有 JS 侧 reduced-motion 缺口:`styles.css` 的媒体查询只压 CSS 动画,
    `ShortVideoView` 的 `scrollIntoView({behavior:"smooth"})` 不受影响 → 新增
    `apps/desktop/src/lib/motion.ts`(`prefersReducedMotion()` / `scrollBehavior()`),已接上短视频切条。
    **引动画库后这条会抬头**(JS 驱动的入场/形变全部绕过媒体查询),Motion 用
    `<MotionConfig reducedMotion="user">` 兜底。
  - 回归:desktop / resolve / mobile tsc 0 错;ime.check 全过。
- 2026-10-15 **styles.css 3858 行拆分 + Tailwind 动效工具类注册**：
  - 拆成 `src/styles/` 下 11 个区块文件（10-tokens ~ 90-responsive），原文件只留入口与
    `@import` 顺序。用 bun 脚本按行切（⚠️ **不用 PowerShell `Set-Content`** —— 会按代码页
    损坏中文），切完自校验「按序拼接逐字节等于原文」；产物 81.1KB 与拆分前**完全一致**。
  - 新增**独立的非 inline `@theme` 块**注册 `--animate-*` / `--ease-*`。三条实测结论：
    ① `--animate-*` 放进 `@theme inline` **不注册**（`@apply animate-rise` 报
    `Cannot apply unknown utility class`）——`inline` 的语义是「值内联展开、不产变量」；
    ② `@keyframes` 与 `--animate-*` 必须**同块**，否则 Tailwind 不关联输出；且该块
    **不能带 `inline`**（带则 `CssSyntaxError: Missing opening (`）；
    ③ **Tailwind 4 没有 `--duration-*` 命名空间**，`duration-*` 只吃裸数值或任意值。
    ⚠️ 验证方式：`@apply <工具类>`（**不是** `animation: var(--animate-x)` —— 后者只是
    引用变量，证明不了工具类生成）；且探针必须挂进**主 CSS 入口链**，从 `main.tsx` 直接
    import 的独立 CSS 会报 `missing @reference`（不同编译上下文）。
  - 顺带修掉一个**构建级潜伏 bug**：`@layer base` 的注释里写了类名通配（星号紧跟斜杠），
    那串字符是注释结束符 → 提前终止注释块 → 后面文字成裸 CSS → Tailwind 抛
    `Missing opening (`。该注释是 2026-10-14 那轮引入的，一直没暴露（**踩了两次**）。
  - 新增动效：`.modal` 入场（`modal-in`，scale 0.96→1 + 淡入；`.scrim` 早有 fade，
    弹窗本体原本瞬现）。⚠️ 用属性 `scale` 而非 `transform` —— `.modal` 居中靠
    `Modal.tsx` 内联 `translate: -50% -50%`，写 `transform` 会连坐覆盖。
  - 回归：vite build 通过、产物 81.2KB；关键类（keyframes rise/spin/shimmer、
    .app-shell/.rail/.toast/.modal/.social-detail、prefers-reduced-motion）全在产物中。
- 2026-10-15 **动效落地批次（侧栏折叠 / 吐司退场 / 弹窗入场）+ CDP 实测**：
  - **CDP + 真实 Chromium 155 实测**（不是靠版本号推断 —— 当天已在 `@theme` 上凭记忆错两次）：
    `startViewTransition` / `@starting-style` / `transition-behavior:allow-discrete` /
    `interpolate-size` / `calc-size()` **全部 true**；`grid-template-columns` 补间**确认真跑**
    （自建 DOM：268px → **166px**（中途取样）→ 64px）。
    ⚠️ 探针要点：CDP target **必须按 type+URL 过滤**（DevTools 自己也是 `type:"page"`）；
    desktop 纯浏览器起不来（要 `appHost`），所以布局类断言用**自建 DOM**，别去查 `.app-body`。
  - **侧栏折叠**：`.app-body` 的 `grid-template-columns` 加 `transition`。**不需要**把 `--rail`
    注册成 `@property` —— 两侧列模板的轨道数与轨道类型都不变，Chromium 直接插值。
  - **吐司退场**：`dismissToast` 改为只打 `closing` 标记（原来直接 `filter` → 元素当场卸载，
    没机会播动画），新增 `removeToast` 由 `Toaster` 在时长到点后调用。时长**读 CSS 令牌**
    （`lib/motion.ts` 的 `motionDurationMs`）—— JS 里写死会让 `data-motion="off"` 档白等。
    ⚠️ 用 `translate` 属性而非 `transform`（入场 `rise` 也用它，改同一属性不互相覆盖）。
  - **弹窗入场**：`.modal` 加 `modal-in`（scale 0.96→1 + 淡入）。`.scrim` 早有 fade，
    弹窗本体原本是**瞬现**。⚠️ 用属性 `scale` 而非 `transform` —— `.modal` 居中靠
    `Modal.tsx` 内联 `translate: -50% -50%`，写 `transform` 会连坐覆盖居中。
  - **未做（有意）**：社交详情「缩略图→全屏」morph。原生 `document.startViewTransition`
    已实测可用、**不必引 motion**（省 ~35KB），但它有三处必须**目视**才能定：① 新状态里
    卡片缩略图与弹窗大图若同名 → 浏览器**静默忽略**整个过渡（退化成淡入）；② React 异步更新
    须在回调里 `flushSync`，否则截到旧 DOM；③ 与刚加的 `modal-in` 叠加的观感。
  - 回归：6 包 tsc 0 错；vite build 通过。
- 2026-10-15 **社交详情共享元素形变（P3，原生 View Transition）**：
  - `lib/viewTransition.ts` + `Cards.tsx`（点卡片记源）+ `SocialDetailModal.tsx`
    （`.social-detail-cover` 包裹层）+ `70-overlays.css`。**不引 motion**。
  - ⚠️ **CDP 探针实测的三条**（自建 DOM 复现同名交接，判据 = 伪元素动画是否出现）：
    | 用例 | `::view-transition-*` | 结论 |
    |---|---|---|
    | 源摘名 + 目标有 name | group/new/old(cover) 齐全 | 真形变 |
    | **源未摘名 + 目标同名** | **`[]` 空** | **整段被静默忽略、不报错** |
    | 目标无 name | 只有 root 淡入 | 不是形变 |
    第二行是**最容易踩且最难查**的：不摘源 name 的话功能**完全无效且零报错**。
  - 另两条：必须 `flushSync`（React setState 异步，否则目标还没渲染）；
    过渡期间停掉 `.modal` 的 `modal-in`（与 VT 形变叠加会抖）。
  - ⚠️ 目标 name 由 CSS **常驻**声明，**别**在过渡里动态挂/清 —— 动态挂的话结束后清掉，
    下一张图就没形变了。包一层 `.social-detail-cover` 而非直接给 `<img>` 挂 name，
    是因为 `<img>` 在换图/代理图就绪时会重挂、name 跟着丢。
  - 回归：desktop tsc 0 错；vite build 通过。
- 2026-10-15 **启动白闪 + 弹窗形变二次入场（两个都是动效改动的余波）**：
  - **启动白闪**：`index.html` 的内联 CSS 只**定义**了 `--bs-bg`，却**没应用到画布** ——
    实测 `html`/`body` 的 computed background 是 `rgba(0,0,0,0)`，画布回落到浏览器默认的
    **白色**；而 `styles.css` 的 `body{background:var(--bg)}` 要等 Tailwind 编译产物加载后才
    生效。深色主题下启动即白闪一下。⚠️ 闪的是**画布**不是骨架（骨架实测就是
    `oklch(0.168 0.006 72)`，深色）。修法：在 `:root` 上补 `background: var(--bs-bg)` ——
    `:root` 的背景会传播到画布，`fixed` 的骨架盖不住那一层。
    验证判据：`getComputedStyle(document.documentElement).backgroundColor` **不是**
    `rgba(0,0,0,0)`（实测由透明 → `oklch(0.168 0.006 72)`，与骨架底一致）。
  - **弹窗形变后闪一下**：`vt.finished` 里把 `animation` 还原成 CSS 值，会把 `modal-in`
    **重新挂回去并从头再播一遍**（过渡刚结束弹窗又缩一下）。改为保持 `none`。
    同时补上 `.scrim` 的 `fade` —— 它在 VT **快照**里被截在 `opacity≈0`，过渡结束后真身
    显示也是一帧闪烁。**VT 与 CSS 入场动画不能叠加**，过渡期间把两者都停掉。
- 2026-10-15 **播放页响应式：右栏在窄窗让位给播放器**：
  - 原来播放页要到 ≤1080 才收单栏，而 1080 **同时是侧栏折叠断点** —— 两个断点撞在
    同一宽度 → **反向跳变**：窗口一路变窄播放器一直变小（1440→764 / 1280→604 /
    1092→456），到 1040 侧栏折叠后反而暴涨到 912。
  - 修法：播放页单栏断点**独立**提到 1280（不再搭 `--col` 那档的车），并删掉 1080 区块里
    那条已死的 `player-layout` 规则。右栏单栏后移到播放器下方占满整行，内容不丢。
  - 阈值是**量出来的**（`Emulation` 逐宽度 + 读几何）：604px 的 16:9 只有 340px 高，
    已明显局促，故 1280 起单栏。
  - 复验基线（改完的期望值，勿回退）：**1440→764 / 1360→684 / 1290→614**（双栏，右栏 320）；
    **1279→947 / 1200→868 / 1100→768 / 1040→912**（单栏，右栏在下方）。
  - ⚠️ 一般教训：**落地响应式前先逐宽度量真实几何**，别只看断点数字 —— 撞车与反向跳变
    在代码里看不出来。
- 2026-10-15 **弹幕 canvas 清屏漏边缘 → 播放器右侧白竖边**：
  - 用户描述「弹幕从右侧出现后就会保留右侧白边」。根因是**两套坐标系取整不一致**：
    位图 = `round(w * dpr)`（dpr=1.875、w=516 → **968 列**），而清屏是
    `clearRect(0,0,w,h)` 经 `setTransform(dpr)` 缩放 → 只覆盖到 `516 × 1.875 = 967.5` 列。
    **最右半列永远清不掉**；弹幕默认白色且从右缘进入（`x = w`），画进去就永久残留。
  - 修法：清屏在**位图坐标系**下做 —— 复位变换 → `clearRect(0,0,canvas.width,canvas.height)`
    → 再设回 dpr 缩放。
  - A/B 实测（dpr=1.875，位图 968×544，先在右缘画白条再清屏）：旧写法最后一列 alpha
    **255**（残留白）／新写法 **0** ✓。
  - ⚠️ **只在非整数 dpr 下暴露**。我先后在 dpr 1 / 1.25 / 1.5 / 2 下扫过像素、扫过连续
    白条、查过元素堆叠，**全部复现不出** —— 是用户给出 `devicePixelRatio = 1.875` 才定位到。
    **复现渲染类问题，先问 dpr**，别只在默认值下扫。
- 2026-10-15 **类名冲突：直播区头部撑成 132px 空白**：
  - 「正在直播」区复用了侧栏的 `.rail-head`，而侧栏那份是 `flex-direction: column`
    （品牌 + 操作纵向堆叠）。两处定义叠加成 `column` + `wrap` → 子元素**纵向堆叠还横向
    换列** → 标题/计数/按钮各占一行，头部从 28px 涨到 **132px**（那一块几乎全是空的）。
  - ⚠️ **这个 bug 一直存在却从未暴露**：先前 `hasMix` 恒假（直播进不了首屏窗口）、
    `.rail-block` **从不渲染** —— 是刚修好的排序把它翻出来的。**修好一个 bug 常会暴露
    被它掩盖的另一个**，改完别只看目标指标，把相邻区域也扫一眼。
  - 修法：改名 `live-block` / `live-block-head` / `live-track`，与本区已有的
    `.live-pulse` / `.live-online` 一致，避开侧栏命名空间。
  - 实测：`flexDirection` column→row，头部 132→38px，直播块 470→376px。
  - ⚠️ 同一冲突在参考实现 `apps/new_desktop/styles.css`（776/777 行）里也存在，未改。
- 2026-10-15 **时间戳单位错值 → 排序错位 + 直播从不进首屏**：
  - 根因链：`xhs` 的 `time` 从**秒**改成**毫秒**，而 `client.ts` 仍无条件 `* 1000`
    → 落到**公元 58754 年** → 按时间倒序**永久钉在最前**（实测「全部」页窗口前 12 条
    全是 social）。连带 `fmtAgo` / `isToday` 口径也错。
  - 第二处：**210 条 live 无一条有 `publishedAt`**，`?? 0` 全沉底 → 第一条 live 排到
    第 **112** 位（PAGE_SIZE 才 60）→ 首屏窗口 0 条 live → `hasMix` 恒假
    → **「正在直播」横滑轨从来不渲染**。改为 `publishedAt ?? fetchedAt` 兜底。
  - 第三处（兜底）：`core` 的 `tryEpoch` 加**未来时间上限**（现在 + 1 天），挡住任何
    量级错误的上游值；宁可判 `undefined` 沉底，也不要极端错值进排序。
  - 实测（**必须重新抓取** —— 坏值已落库，看旧数据会误判成没修好）：
    social 坏时间戳 0 条；第一条 live 112 → **44**；窗口前 60 由 21social/0live 变为
    44social/**16live**；「正在直播」横轨**从不渲染 → 渲染**。
  - ⚠️ `toEpochMs` 的秒/毫秒判据**写反过两次**，都是新加的自检
    `xhs-time.check.ts` 抓出来的 —— 最后改成显式具名常量比较，不用三元。
- 2026-10-15 **主区滚动死区 → 改为整体滚动（用户描述「无法上下滑动」）**：
  - 根因：主区里**不在滚动器内部**的元素（`.grid-head`、`.rail-block`）是死区 —— 鼠标停上去
    找不到可滚祖先，而 `body` 是 `overflow:hidden`，滚轮完全无反应。实测「全部」页里这两块
    合计占 **59% 的视口**（`.rail-block` 占 y114–584，视口才 797px）。
  - **第一版修法走错了方向**：在 wrapper 上捕获阶段截获 wheel 转给主滚动器 —— 那只是让内容滚、
    **头依旧固定不动**，与用户要的「上下作为整体滚动」不符。
  - **正解（布局）**：两处头部都移进各自的滚动器内部 —— hasMix 走 `VirtuosoGrid` 的 `Header`；
    socialOnly 给 `MasonryGrid` 加 `header` prop，渲染在滚动容器内、网格之上。
  - ⚠️ 试过「按头部高度偏移 masonic 的 `scrollTop`」，**撤掉了**：`useEffect(…, [header])` 的
    `header` 是每次渲染新建的 JSX，`ResizeObserver` 被反复重连；且 `overscanBy:2` 本有余量。
  - ⚠️ **测量方法（这轮最大的教训）**：
    1. 合成 `WheelEvent` 在 Chromium 里**不触发滚动**，用它测会得出「滚不动」的**假结论**；
       必须用 CDP `Input.dispatchMouseEvent{type:"mouseWheel"}`。
    2. 别在 `Page.navigate` 后**立刻**测 —— 启动骨架存活期（约 900ms）主区本来就不滚；
       masonic 也有自己的测量窗口期（第 1 次采样常为「无滚动器」）。**多采样几次**再说结论。
    3. 判据用**头部矩形**而非只用 `scrollTop`：整体滚动要看 `.grid-head` 的 `top` 是否随滚动上移。
  - 实测（硬重载 + 3 次采样）：社交分组 `.grid-head.top` 52 → **-548**（scrollTop=600）；
    全部（含直播轨）同样 52 → -548。
- 2026-10-15 **接入 Apple 播客目录（`apple:podcast-chart` / `apple:podcast-search`）**：
  - Apple 目录是**元数据源**，产出 `kind:audio` 且 `url` = 该节目的 **RSS feed** ——
    接进既有的 `rss:podcast` 那条路，不另造解析器。取数在
    `resolve/platform/apple/catalog.ts`，两个 channel 在 `crawler/channels/apple/`。
  - ⚠️ **榜单不含 `feedUrl`**（旧 iTunes RSS 只给 `im:id`），必须再 Lookup 一次换成 feedUrl；
    这是 Apple 的接口约束。Lookup 返回顺序**不保证**与请求一致，故按榜单原序重排。
    没有 feedUrl 的条目**直接丢弃**（留着只能显示不能订阅）。
  - ⚠️ **搜索渠道刻意不声明 `defaultInfo`**：发现页「可一键订阅」判据是
    `!!defaultInfo || 无必填项`，而**空对象是 truthy** —— 写 `= {}` 会让这个需要 `q` 的渠道
    被误列进一键订阅（同 `bili:search`，它也不声明）。实测 `_probe-boards` 复刻判据：
    chart → 可一键订阅 ✓ / search → 否 ✓。
  - 端点实测（2026-10-15）：旧 `itunes.apple.com/{cc}/rss/toppodcasts` ✅ 200 ·
    `search?media=podcast` ✅ 200（**直接给 feedUrl**，省一次往返）· `lookup?id=` ✅ 200 ·
    新 `rss.applemarketingtools.com/api/v2/…` ❌ **504 超时**，故走旧接口。均无需 cookie，
    但要带 UA（裸请求被拒）。
  - 实测：榜单默认分类 19 条；分类 1318（科技）5 条；搜索「故事」5 条。
    **feedUrl 确实可被 `rss:podcast` 订阅** —— 岩中花述 87 集 / 故事FM 995 集 /
    硅谷101 265 集 / **喜马拉雅源 1057 集**（先前担心防盗链，实测直接给标准 RSS）。
  - 回归：6 包 tsc 0 错；`rss channels --kind audio` 两渠道均列出。
- 2026-10-15 **播客闭环补全（榜单条目点不动 + 没有订阅入口）**：
  - 用户报「添加了热门榜似乎并不能点进去播放」——**两个都是真缺口**：
    ① 榜单条目 `kind:"audio"` 但 `stream` 空（`url` 是节目的 RSS feed 而非一集音频），
    `isPlayableKind("audio")` 恒真 → 摆了播放按钮 → 点进播放页必然「该条目不指向可解析的
    视频链接」（resolver 只认平台域名，feed 域名路由不上）；
    ② `AddSubscriptionDialog` 的 `rss:` 过滤器把 `rss:podcast` 也滤掉了，**无处可贴 feed**。
  - 修法①：新增 `isFeedItem(item)`（`kind:"audio" && !stream`，`Cards.tsx`）——
    这类条目的主操作改成 `onSubscribeFeed`（订成 `rss:podcast`），不出播放按钮、不给队列、
    `usePlayerNav.onPlay` 里也改道（含命令面板）。
    ⚠️ 判据用 `stream` 而非 `sourceId`：榜单条目抓取时来自 `apple:*`，落库后
    `subscriptionId` 才指向订阅；而 `rss:podcast` 的条目**必有 enclosure**
    （没 enclosure 的 item 在 `itemToAudio` 就被丢），故不会误伤真单集（已 curl 实测两类）。
  - 修法②：过滤器放行 `rss:podcast`（`rss:url` 之外第二个例外）。
  - 实测（CDP，硬重载后）：发现页榜单出现 Apple 卡 → 一键订阅得 19 条；
    **网格里 feed 卡 `card-play:false`** → 点卡 → toast「已订阅 声动早咖啡 渠道 rss:podcast」
    → 侧栏出现「声动早咖啡 1057」；手工入口「按渠道配置」现在列出**播客 RSS** →
    贴 `feed.xyzfm.space/...` → 得 87 集；**同一条目的单集卡 `card-play:true`** →
    点开真播（`currentTime 5.87s`，`paused:false`）。对照清晰：同一批播客，
    feed 条目无播放按钮、单集有。
  - 回归：6 包 tsc 0 错；`ui-probe goto` tab:all / tab:social / page:discover 均 issueCount 0。
  - ⚠️ **顺带修掉 `ui-probe` 的一个假阳性**（它一直在掩盖真问题）：`offscreen-x` 检查没有
    豁免「横向滚动容器里待滑入的卡」—— `.live-track`（`overflow-x:auto`）右侧的卡
    `left > innerWidth` 是**设计如此**，却稳定刷出 18 条 `issueCount`。判据缺失与同文件
    `click-covered` 的「滚动裁剪祖先」豁免不一致。补上 `inScrollX()` 后
    **tab:all 18 → 0**（`git stash` 基线对比确认这 18 条与本次业务改动无关）。
    ⚠️ 教训：巡检数字**变了不等于业务坏了**，先 `stash` 拿基线再归因；
    而稳定复现的「已知良性」项要么豁免、要么记进本文件，否则真问题来了看不出来。
- 2026-10-16 **backlog 集中处理（阅读态/队列按订阅维度隔离 · 播完下一条 · 选流 · 榜单可播）**：
  - **根因是同一条**：`MediaItem.id` 只在**订阅内**唯一（实测 `bilibili:7734200`
    同时在 `bili:live` 与 `bili:live:hot`）。凡按 id 记/改/查的地方都会让两个订阅**串**：
    - reading 键 → `readingKey(subId, itemId)`；内存 `store.patch(subId, id, patch)`；
      播放队列存 `itemKey` 复合键。reading 键必须带订阅维度（不再有裸 id 回退）。
    - store 里 `get().allItems.find(i => i.id === item.id)` 这类定位也一并改 `findItem`。
  - **播放队列**：落 localStorage `ui-queue` + 复合键。实测入队 → **重载后仍在**。
  - **播完自动下一条**（`autoPlayNext`，默认开）：`PlayableMedia` 的 `onEnded`
    ⚠️ 必须挂**两处** —— video 的 `videoRef` 与播客的 `AudioShell.audioRef`；
    只挂前者音频播完永不触发。实测派发 `ended` → 切下一条且播过的出队（3→2）；
    关掉设置后同操作**不跳转、队列不变**。
  - **默认选流改取 `streams[0]`**：旧实现按格式族挑，首档 1080p dash 后面跟 360p mp4
    时会**静默降画质**。判据另抽到纯函数模块 `streamKind.ts`（`useMediaStream` 引了
    hls/flv/dashjs，加载即要 window，判据留那儿自检跑不了）。
    ⚠️ 顺带修 `ui-play-check` 的取样口径 —— 它原来会挑中 Apple 榜单的 **feed 条目**
    （audio 但无 stream），选进来必报「无法从 URL 解析视频流」，**假失败**。
  - **Apple 榜单条目可播**：`isFeedItem` 的主操作从「订阅」改成「**在右侧列出单集**」
    —— 点开 → URL 变 `?open=<itemId>` → `previewChannel("rss:podcast", {url})`（复用播客渠道，
    不另造解析器）→ MediaMain **用正常网格**列出单集 → 选一集直接播。⚠️ 预览单集
    **不落库/不建订阅**，只活在 store 的 `previewDetail`，**`PlayerPage` 的 item 查找必须
    回退查它**（播放页返回也回 `?open=`，不丢单集列表）。
    实测：榜单卡 → 右侧网格「单集 · 1060 条」→ 点第一集 → **真播**（`currentTime 4s`）→ 返回仍在预览。
  - **骨架宽度契约自检**：两份手写字面量（`boot-skeleton.css` vs `styles/10-tokens.css`
    + `90-responsive.css`）**故意改坏验证过会失败**（非空转）。
  - 回归：6 包 tsc 0 错；播放矩阵 3/3 起播；`ui-probe` tab:all / page:discover issueCount 0；
    9 个 `.check` 全过。
- 2026-10-19 **网络风控落地（governor + LX 闸门 + 被动采集）**：
  - `packages/host/src/net/governor.ts` 包装全部 `appHost.http`：平台分类 → 冷却 →
    in-flight 去重 → 平台并发/最小间隔/RPM → 全局并发。默认 L1；L0 直通；LX 拒绝计量请求。
  - `AppSettings.netLevel / netLevels / autoRefresh` + 设置页「网络与风控」；
    等级统一为数字 L0/L1/L2/L3/L9（L9=LX，只能平台覆盖，不能全局）。
  - core `doRefresh` 在 lx 下**只调** `source.fetchPassive?.()`，拿不到回退内容缓存，
    **绝不回退主动 `fetch()`**。
  - 被动采集只接 `xhs:explore` / `xhs:user`（内置默认 L9）；`bili:popular` 已移除
    L9（匿名 API 稳定，被动无收益）。平台风控信号统一走 `appHost.net.reportRisk`。
  - 回归：6 包 tsc 0 错；`bun run build:desktop` 通过；`governor` / `lx-mode` /
    `bili-popular` / `passive-*` 与既有 core+crawler+resolve 自检全过。
  - ⚠️ **实机 LX 未验证**：`xhs:explore` / `xhs:user` 的真实页面请求仍待 release 实例
    复核；capture 不到 = 返回 null → core 回退缓存，属预期降级。
- 2026-10-21 **L9 移除 / 被动采集改为渠道属性**：
  - `RssChannel.passive`（原 `supportsL9`）+ 删除 `BUILTIN_CHANNEL_LEVELS`；等级只剩
    L0~L3（「谁发起请求」不是配额档）。存量 `9`/"lx" 在 settings-repo 归一化为 `1`。
  - 设置页被动渠道只显示「浏览器被动」标签、无等级下拉；渠道覆盖只提供 0~3。
  - 覆盖投影保留：L0 优先 / 1~3 取严格 / 被动渠道跳过；改设置立即同步。
  - 设置页进一步收为**只按平台**（含 `"*"` 兜底行）：RSS 直链吃 `"*"`，配额仍按 host
    各自计数；存量 channelKey 键启动时折叠成平台键（`foldChannelLevels`）。
  - 回归：6 包 tsc 0 错；`build:desktop` 通过；`governor` / `passive-mode` /
    `xhs-strategy` / `subscriptions` / `xhs` 流程自检全过。
