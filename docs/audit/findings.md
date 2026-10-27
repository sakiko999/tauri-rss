# 审计结论与兼容清单

> 合并自 audit-backlog.md + compatibility-inventory.md（2026-10-21 整理）。两类只记录「无法从代码看出」的结论：审计里故意不改的项 / 误报证伪，以及向后兼容补丁与破坏性变更。

> 来源：2026-10-13 全仓审计（十五轮 workflow，8 维度 + 对抗验证）。**已修的散落各 commit，
> 不在此登记**（git log 可查）；上半部分（一~四）只留两类**无法从代码看出**的结论：
> ① 已确认、**故意不改**的项（附判定理由）；② 审计**误报经实测证伪**的结论（防止后人重踩）。
> 格式：`[严重度] 文件 — 问题 / 为什么不改`。

## 一、故意不改（已确认，有理由）

- **[med] `resolve/platform/douyin/stream.ts:138`** — 清晰度兜底按位置
  `flvList[flvList.length - level]` 配对 URL，应按 `sdk_key` 键关联。JSON map 顺序非清晰度
  契约 → 错档/负下标丢档。**仅在 `stream_data` 非 JSON 时触发**（主路径正常），无失败证据，暂不改。
- **[med] `resolve/platform/douyin/abogus.ts:43`** — `enterRoomParams` 恒含 `msToken:""`，
  `signDouyinUrl` 又追加一个随机 msToken → query 出现两个 msToken（一空一真）。删该行即修复，
  但 douyin 现状「全通」，改动签名有回归风险 → 待有失败证据再动。
- **[low] `resolve/platform/bili/client.ts`** — `navCache` 无 TTL（wbi key 轮换/换号后可能复用
  旧 nav）。主要缺陷（reject 毒化）已修，TTL 待 wbi 频繁轮换时再补。
- **[low] `crawler/channels/weibo/user.ts:68-75`** — 首次翻页重拉首页拿 mids（多 2 次往返）。正确性
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
  - `isXhsLoggedIn` 轮询判据对**残留 user_id cookie**（服务端 session 已失效）仍可能误报
    登录 —— 初始检测已只用页面证据，轮询基线只挡「同值」，挡不住「过期但不同值」。需要
    真实过期样本才能验证，挂起。
  - core `cursorMoved && addedCount===0 → ended` 会把「页面被重载 + 渠道重试游标」的后续
    翻页提前掐断（`packages/core/src/data-layer.ts:887-888`）；放宽会在「上游真重复返回」时
    死循环加载，两难，保留现语义。
  - governor 对 `sso.douyin.com` 等登录域也计冷却（`platformOfHost` 按 host 推导、无白名单）
    —— 抖音扫码登录走纯 HTTP（`resolve/platform/douyin/login.ts:94`），可能被平台冷却挡住；
    浏览器路径已免疫（登录不传 platform，跳过 `browserGate`）。改法涉及 governor 语义
    （登录请求免冷却），待专门一轮。
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
- **`useMediaStream.ts:102-107` 档位重锁** — 直播 LL-HLS 持续重载时 `hls.currentLevel = max` 每次
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
- **`resolve/platform/bili/discover.ts:122-124` `stripEm`** — 已收紧到 `/<\/?em\b[^>]*>/g`，不再误删
  属性含 "em" 的标签。
- **`resolve/platform/youtube/client.ts:400-404`** — 审计称 `maxBy` 语义有误。实测 `R.maxBy(h,a,b)`
  相等时返回**第二个参数**，故 `maxBy(height,f,best)` 相等取 best（保留首个）——注释正确。
- **「扫码登录会把浏览器锁永久占死、只能重启」**（2026-10-20 审查）— 登录持锁那段确实成立，
  但「永久」不成立：CDP 单命令有 30s 超时（`packages/host/src/browser/channel.ts:15` 的
  `CDP_CMD_TIMEOUT_MS`）；lane 化后由 `tab.abortPending`/`abortTabs` 在连接层取消
  （`packages/resolve/src/browser/scheduler.ts:24-27`）。别再按「永久锁死」设计。

## 三、存疑（未确证，未改）

- `ShortVideoView` 的 `savePosition` 对 `isLive` 未加守卫 —— 若某直播流返回有限 duration，
  会写 positionSec 把该直播塞进「继续」视图。`PlayableMedia` 有 `dur<=0` 早退，直播一般
  duration=0/Infinity 不上报，未复现。
- `douyin/stream.ts:111` — `stream_data` 键名级别变更时主路径返回空 → 降级链（慢 2 RTT +
  可能低画质）。无失败证据，待上游字段变更时再处理。
- `data-layer` `removedSubs` 墓碑无界增长（量级极小）；`resolveKind` 的 enclosure→audio 覆盖
  `ctx.kind`（对播客可能有意）。
- mobile（已冻结 2026-10-26，以下仅存档不再排期）：补全阈值 400 vs crawler 800 错配（白抓一次）；
  `looksLikeHtml` 误伤「讲 HTML 的纯文本」；li onClick 无 role/tabIndex、触控目标偏小；
  初始化失败无重试按钮。
- `view.total` 口径（loaded vs 渠道 total）与表头脱钩（语义取舍）；`usePlayerNav` 的
  `setTimeout(0)` 依赖「/v loader 同步跑完」的隐式时序契约。

## 四、教训（审计本身踩过的坑，值得记住）

- ⚠️ **截断守卫别用「不前进」当判据**：huya 守卫初版加的「skipField 后 p 未前进即退」误伤
  **ZERO_TAG**（零负载字段，skipField 合法地不前进）→ 含零值字段的正常帧提前退出、弹幕全丢
  （实测房间 116 从 10 条/12s → 0）。`while (p<len)` 本身即终止保证。
- ⚠️ **审计报告会误读代码**：上「二、误报」里多条是审计只看局部、没跑真实响应得出的结论。
  凡「字段丢了/映射错了」类结论，**先 dump 一次原始响应**再下判断。

## 五、持久化数据兼容

> 2026-10-19 整理。口径：这里主要是**向后兼容**（新代码继续读旧数据/旧输入）。
> 严格意义的**向前兼容**（旧版本读新版本写的数据）本项目基本没有——KV 是整块 JSON，
> 没有 `schemaVersion`，旧版本遇到新字段只会原样保留、不认识；只有版本化迁移
> （`SCHEMA_MIGRATIONS`）属于正向脚手架。
>
> ⚠️ **2026-10-19 同日清理：不再兼容旧持久化数据**。全新安装（库里只有当前代码写的
> 数据、无旧 localStorage/旧缓存 XML）为前提；已删补丁见 git 历史。

| 兼容点 | 旧形态 → 现行为 | 位置 |
| --- | --- | --- |
| 单房间 → 多房间 | 旧订阅只有 `info.roomId` → `parseRoomIds` 优先 `roomIds`，为空回退 `roomId`；4 个直播渠道的标题/链接也用 `info.roomIds ?? info.roomId` | `packages/resolve/src/utils/room-ids.ts:11-17`、`channels/{bili,douyu,huya,douyin}/live.ts` |
| 内置 RSS 旧订阅 | 旧订阅只存 channel key、`info.url` 为空 → 用构造期 `defaultUrl` 兜底（`defaultInfo` 一键订阅能力本身也依赖它） | `packages/crawler/src/channels/rss/raw.ts:38-50` |
| 抖音存量渠道 | `live:douyin:user` 不再出现在新建入口，但**仍注册**，旧订阅照常刷新；同时是 Discover 页「用户直播间」能力的判据 | `packages/crawler/src/register.ts:146`、`apps/desktop/src/views/discover/DiscoverPage.tsx:105-108` |
| 旧正文格式 | 无 `tpl:contentFormat` → `content ? "html" : undefined`，RSS 文章本来就可能不写该字段 | `packages/core/src/processing/deserialize.ts:173` |

**不能删的几处**：

- `parseRoomIds` 与 4 个直播渠道的标题回退：**CLI 当前仍以 `{roomId}` 建订阅**
  （`apps/cli/src/info.ts:18,26-28`，`rss refresh` 会落库）。要删先把 CLI 改成
  `roomIds`。
- 内置 RSS 的 `defaultUrl` 兜底：`apps/desktop/src/dev/seed.ts:43-52` 仍以
  `info:{}` 建 `rss:hn`；改成显式写 url 后才可删。
- `live:douyin:user` 的注册：`DiscoverPage.tsx:105` 用它判断是否渲染「用户直播间」
  入口，删掉是功能回退，不是清理旧数据。
- `contentFormat` 推断：属于当前 RSS 文章的常态兜底。

## 六、旧输入归一化

| 兼容点 | 旧形态 → 现行为 | 位置 |
| --- | --- | --- |
| 抖音输入 | `@抖音号` / `抖音号：x` / 直播间 URL / 裸短号 / `douyin.com/user/<sec_uid>` / `iesdouyin.com/share/user/...` → 去前缀、取末段、主页链接走资料 API 换 web_rid | `resolve/platform/douyin/ids.ts`、`crawler/channels/douyin/live.ts:74-86` |
| B站旧 ID | `av<数字>` URL/ID → 订阅/播放/弹幕统一转 aid | `resolve/resolver/router.ts:30-32`、`platform/bili/client.ts:258`、`platform/bili/danmaku-vod.ts:37-40` |
| YouTube 短链 | `youtu.be/<id>` → 与 `watch?v=` 同路由 | `resolve/resolver/router.ts:48` |
| 小红书时间 | 旧秒级时间戳 → 按阈值判别后统一 epoch ms | `resolve/platform/xhs/client.ts:190-208` |
| 小红书 SSR | `new Map([])`、`{_rawValue}`、noteId 在外层/noteCard → 清洗、解包、两处取 | `xhs/client.ts:81-100,184-185` |
| Atom | `<feed><entry>` → 归一成 RSS 字段（id→guid、published→pubDate 等） | `packages/xml/src/xml-parser.ts:78-131` |
| OPML | outline 省 `type`、标题在 `text/title/#text` → 逐级回退 | `packages/xml/src/opml.ts:94-110` |
| 流格式缺失 | 无 `format` → 按 URL 后缀判 HLS/FLV/MP4 | `player/hooks/streamKind.ts:11-40` |
| 二维码载荷 | `data:image/...` 直接显示；纯文本本地编码成二维码 | `apps/desktop/src/components/QrImage.tsx:14-26` |
| cookie 字段前缀 | `douyin:*` 与 `live:douyin*` 都映射到 `douyinCookie` | `packages/core/src/data-layer.ts:169`（`cookieFieldFor` → `@amoeba/platform`）、`apps/desktop/src/views/manage/AccountPage.tsx:275` |
| 发现页渠道 key | 同时匹配 `<platform>:<cap>` 与 `live:<platform>:<cap>`；搜索先查映射再回退旧命名 | `DiscoverPage.tsx:39-42` |

## 七、向前兼容脚手架

- **DB 迁移**：`packages/core/src/db/schema.ts:55-57` 的 `SCHEMA_MIGRATIONS` 有序执行，已落 `_migrations(version,name,applied_at,checksum)` 版本表；已发布版本 checksum 变化 → 拒绝启动，只能追加新版本。
- **settings 预留字段**：`viewMode/startMuted/defaultQuality` 暂时没有消费者，但保留并用默认值 spread 合并，避免以后加字段要迁移。
- **未知枚举值**：`deserialize.ts:414-424` 只放行已知的 `streamingFormat/contentFormat`，未知值返回 `undefined`，不抛错、不透传。
- **日志域重注册**：`log/src/core.ts` 同域二次创建返回同一引用，HMR 不重置开关。

## 八、运行时降级

不是数据兼容。

- 内容缓存：自动刷新关闭/被动无数据/水化回退旧 `content:<subId>`（`data-layer.ts:481,526,612`）；抓取失败回退旧缓存（`:579-594`）；抓取成功但 0 条则保留现有内容并报错（`:551-553`）。
- 旧 API/协议：抖音 enter→reflow→HTML 三级；YouTube VISIONOS→ANDROID_VR→WEB（直播兜 iOS）、DASH→渐进；B站 DASH→durl、直播 probe 重解；Apple 新版 504 → 继续用旧 iTunes 端点。
- 环境能力：无 `appHost.ws` → 原生 WebSocket；无 `openExternal` → `window.open`；Node 无 `getSetCookie()` → 读 `set-cookie`。

## 九、破坏性变更

没做兼容的破坏性变更：

- **RSSHub 具名渠道整体删除**：`rsshub:bili:*` / `weibo:*` / `youtube:*` 等旧订阅刷新会失败，只能迁移到对应内置渠道或 `rsshub:feed`。这是目前最大的一处「不兼容」。
- **`live:douyin:anchor` 已删除**：旧订阅如果引用它，刷新会失败。
- `live:douyin:user` 属于半兼容：旧订阅仍能刷新，但不再出现在新建列表，也不会成为 `live:douyin` 的合并目标。

## 十、维护提醒

兼容层散落在各个读取点，因为 KV 存的是整块 JSON、没有 `schemaVersion`。好处是不用
集中迁移；坏处是删掉任何一处都不会报错，只会静默降级——比如旧房间不再抓取、旧订阅
显示 0 房。改这些读取逻辑时，最好把对应的 `.check.ts` 一起跑。
