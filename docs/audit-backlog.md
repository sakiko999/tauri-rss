# 审计发现积压（已确认但未修）

> 来源：2026-10-13 全仓审计（十五轮 workflow，8 维度 + 对抗验证）。**已修的散落各 commit，
> 不在此登记**（git log 可查）；本文件只留两类**无法从代码看出**的结论：
> ① 已确认、**故意不改**的项（附判定理由）；② 审计**误报经实测证伪**的结论（防止后人重踩）。
> 格式：`[严重度] 文件 — 问题 / 为什么不改`。

## 一、故意不改（已确认，有理由）

- **[med] `resolve/platform/douyin/stream.ts:127`** — 清晰度兜底按位置
  `flvList[flvList.length - level]` 配对 URL，应按 `sdk_key` 键关联。JSON map 顺序非清晰度
  契约 → 错档/负下标丢档。**仅在 `stream_data` 非 JSON 时触发**（主路径正常），无失败证据，暂不改。
- **[med] `resolve/platform/douyin/abogus.ts:43`** — `enterRoomParams` 恒含 `msToken:""`，
  `signDouyinUrl` 又追加一个随机 msToken → query 出现两个 msToken（一空一真）。删该行即修复，
  但 douyin 现状「全通」，改动签名有回归风险 → 待有失败证据再动。
- **[low] `resolve/platform/bili/client.ts`** — `navCache` 无 TTL（wbi key 轮换/换号后可能复用
  旧 nav）。主要缺陷（reject 毒化）已修，TTL 待 wbi 频繁轮换时再补。
- **[medium] `resolve/src/browser/cdp.ts:23`** — `withBrowserLock` 无队列取消：per-sub 超时
  `abortPending` 后，排队等锁的浏览器操作不会被取消，之后仍会运行并重连 CDP。要真正取消需给锁加
  取消上下文（改动大，且 abort 本身是「不再等待」语义），故暂缓。影响：多浏览器订阅同时超时时
  CDP 关闭→重开抖动（非正确性错误）。
- **[low] `crawler/channels/weibo/user.ts:55`** — 首次翻页重拉首页拿 mids（多 2 次往返）。正确性
  无损、注释已解释必要性；要省需跨调用缓存 lastMid（状态脆），暂缓。
- **[低/潜在] 无生产者的 latent 丢字段** — `Item.raw`（不往返）、`Live.quality`（不往返）、
  `article.media[]` 图片（只保首个为 thumbnail）。三者当前**无 channel 产出**，不触发；未来有
  channel 依赖再补 serialize + deserialize 两侧。
- **[low] `crawler/channels/xhs/explore.ts` prepend 判定** — 只识别「纯前插/纯追加」（比较滚动
  前后首条 id）。头部非纯前插的变动（首卡被替换、同轮前插+后插）会切到已返回过的旧条目，
  靠 `store.append` 按 id 去重兜底（最多丢一批，不会重复展示）。实测（2026-10-20，862→968 条）
  平台推荐流是**尾部追加**；要精确需维护已见 id 集合，收益不抵复杂度。
- **[med] 0.4.0 审查遗留（2026-10-20，审查 16 条、修 6 条 + 窗口模式）**，未修项与理由：
  - 「清除凭证」先删浏览器 cookie 再清 settings，中途失败会「浏览器已登出、settings 还有旧值」，
    用户重试时走到 alreadyLoggedIn 分支又把旧值写回 —— 正确顺序应先备份后清、失败回滚。低频
    （只在手动清凭证触发），暂缓。
  - `data.ts` refreshAll 的 `withTimeout` 在 `scanLoginActive` 时跳过 abortPending —— 登录
    期间排队的刷新超时无法中止（「不再等待」降级为「等到登录结束」）。登录最长 5 分钟且低频，
    误杀登录连接的代价更高，保留。
  - `isXhsLoggedIn` 轮询判据对**残留 user_id cookie**（服务端 session 已失效）仍可能误报
    登录 —— 初始检测已只用页面证据，轮询基线只挡「同值」，挡不住「过期但不同值」。需要
    真实过期样本才能验证，挂起。
  - core `cursorMoved && addedCount===0 → ended` 会把「页面被重载 + 渠道重试游标」的后续
    翻页提前掐断（详见 CLAUDE.md 分页守卫段）；放宽会在「上游真重复返回」时死循环加载，
    两难，保留现语义。
  - governor 对 `sso.douyin.com` 等登录域也计冷却（配额按 host 推导无白名单）+ `withBrowserMode`
    的 `browserGate` sleep 持锁进行 —— 登录/自救路径可能被平台冷却挡住。改法涉及 governor
    语义（登录请求免冷却），与「冷却期允许重新扫码自救」的承诺相关，待专门一轮。
- **[低] `serialize-contract.check.ts` 盲区** — 只检测「deserialize 读、serialize 不写」，
  检测不到「**两侧都漏**」的字段（如上面的 quality/raw/media[]）。扩展需维护「应透传字段」期望
  清单，成本不低；当前新增字段时显式加守卫用例，暂够。

## 二、误报（实测证伪，防重踩）

- **douyin「包裹形 `{room:{...}}` 字段全丢」** — 审计称读 `item` 拿不到字段。实测 dump
  `partition/detail/room/v2` 原始响应：`data.data[0]` 顶层键含 `room,tag_name,uniq_id,web_rid,...`
  确实**有** `.room` 包裹层，而代码读的正是 `item.web_rid`（顶层）+ `item.room.title/owner`——
  **字段映射完全正确**。审计误读代码。
- **douyin 推荐位广告混进热门** — 实测 `is_recommend` 对全部 15 条非直播推荐位为真（该字段是
  「可被推荐」属性，非「是广告」）；`type` 恒 `null`（无 douyu `type===1` 那种可过滤标记），
  所有条均带 `room`+`web_rid` → 无从过滤，亦非缺陷。
- **`EditSubscriptionDialog`「设 TTL=0 不清除」** — 只看了 `{...prev,...patch}` 的**内存 spread**
  （`undefined` 确实覆盖键），漏了 `JSON.stringify` **丢弃 undefined 值** + repo 的 `get/list`
  **每次重读磁盘**。实测：update 后 `refreshIntervalSec` 键消失、值被清除。非缺陷。
- **`useMediaStream.ts:101` 档位重锁** — 直播 LL-HLS 持续重载时 `hls.currentLevel = max` 每次
  MANIFEST_PARSED 重跑。**判定非缺陷**：重锁的语义就是「锁最高档」，重跑到同一 max 是幂等 no-op；
  levels 增长时锁到新末档仍是「最高档」期望行为。
- **`resolve/platform/bili/live-play.ts` `qnDescName` 读 `playurl.g_qn_desc`** — 审计标「存疑」，
  实测该字段确在 playurl 层（8 条，10000→原画/400→蓝光/250→超清/150→高清），代码正确。
- **youtube 直播 chat poller 共享闭包状态** — 每次 resolve 新建 poller（danmaku 来自 resolved），
  `[danmaku]` effect 重订阅拿新实例，实际不可达。
- **`media-store.append` 丢弃重复 id（不合并更新）** — 看似丢字段新鲜度，但合并会**回退用户态**：
  markRead 异步落库，并发 loadMore 的 applyReadingState 可能读到旧 map，合并会把刚标记的已读覆盖
  回未读。当前「丢弃重复」更安全，保留。
- **`*:corrupt` 留证无消费** — 是**单** key（覆盖非堆积，审计「逐份堆积」有误），设计有意
  （留证供人工恢复），保留。
- **[低] `douyin/danmaku.ts:176`** — 审计称 `|(;/` 未编码。实测在线房间收到 16 条真实弹幕，
  服务端接受当前 `%20` 编码，未触发。
- **`resolve/platform/bili/discover.ts:51` `stripEm`** — 已收紧到 `/<\/?em\b[^>]*>/g`，不再误删
  属性含 "em" 的标签。
- **`resolve/platform/youtube/client.ts:270`** — 审计称 `maxBy` 语义有误。实测 `R.maxBy(h,a,b)`
  相等时返回**第二个参数**，故 `maxBy(height,f,best)` 相等取 best（保留首个）——注释正确。
- **「扫码登录会把浏览器锁永久占死、只能重启」**（2026-10-20 审查）— 登录持锁那段确实成立，
  但「永久」不成立：CDP 单命令有 30s 超时（`browser-backend.ts`），`abortPending` 只 reject
  在途 CDP 命令、对 `browser_ensure`/`ws_connect` 本就无效。实际影响上限是关窗后锁被占到
  deadline（已在同一轮修掉：`opts.signal` 取消）。别再按「永久锁死」设计。
- **`resolveXhsItemDetail` 的 `!browser` 分支忽略 `passiveOnly`（会走 HTTP）** — 代码事实成立，
  但不可达：唯一会传 `{passive:true}` 的是 desktop `resolveDetail`，而能持有 xhs 条目的宿主
  只有 desktop Tauri（mobile/CLI 只对 `kind==="article"` 调详情补全，xhs 是 social）。
  保留现状；若未来出现非 Tauri 宿主消费 social 详情，需在此分支也尊重 passive。

## 三、存疑（未确证，未改）

- `ShortVideoView` 的 `savePosition` 对 `isLive` 未加守卫 —— 若某直播流返回有限 duration，
  会写 positionSec 把该直播塞进「继续」视图。`PlayableMedia` 有 `dur<=0` 早退，直播一般
  duration=0/Infinity 不上报，未复现。
- `douyin/stream.ts:111` — `stream_data` 键名级别变更时主路径返回空 → 降级链（慢 2 RTT +
  可能低画质）。无失败证据，待上游字段变更时再处理。
- `data-layer` `removedSubs` 墓碑无界增长（量级极小）；`resolveKind` 的 enclosure→audio 覆盖
  `ctx.kind`（对播客可能有意）。
- mobile：补全阈值 400 vs crawler 800 错配（白抓一次）；`looksLikeHtml` 误伤「讲 HTML 的纯文本」；
  li onClick 无 role/tabIndex、触控目标偏小；初始化失败无重试按钮。
- `view.total` 口径（loaded vs 渠道 total）与表头脱钩（语义取舍）；`usePlayerNav` 的
  `setTimeout(0)` 依赖「/v loader 同步跑完」的隐式时序契约。

## 四、教训（审计本身踩过的坑，值得记住）

- ⚠️ **截断守卫别用「不前进」当判据**：huya 守卫初版加的「skipField 后 p 未前进即退」误伤
  **ZERO_TAG**（零负载字段，skipField 合法地不前进）→ 含零值字段的正常帧提前退出、弹幕全丢
  （实测房间 116 从 10 条/12s → 0）。`while (p<len)` 本身即终止保证。
- ⚠️ **审计报告会误读代码**：上「二、误报」里多条是审计只看局部、没跑真实响应得出的结论。
  凡「字段丢了/映射错了」类结论，**先 dump 一次原始响应**再下判断。
