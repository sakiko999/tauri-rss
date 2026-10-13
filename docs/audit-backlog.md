# 审计发现积压（未修，待处理）

> 来源：2026-10-13 全仓审计 workflow（8 维度 + 流程追踪 × 对抗验证）。已修的见各 commit；
> 本文件登记**已确认但未修**的发现，避免成果流失。格式：`[严重度] 文件 — 问题 / 建议`。

## 已修（本轮，供对照）

序列化边界丢字段 / RSS+OPML 转义 / Select 空值哨兵 / loadMore 分页窗口 / bili av 号 /
bili:live 作者名 / bili 视频时长 / 退订竞态+墓碑泄漏 / 停用订阅游标残留 / loadMore 无视停用 /
douyu 搜索人气丢单位 / douyu 搜主播假 0 / 全文搜索 / 阅读进度 / 续播 / 表格分隔线 /
player 圆角方角 / 弹幕前跳洪水 / attemptPlay 未处理 rejection / 弹幕同毫秒去重 /
ws reader 死循环+连接泄漏(rust) / ws 事件早于 resolve(host) / abortPending 全局误杀 /
Atom 多 link / rsshubArticleMedia 重复 / 死协议字段与死代码清理。

## 待修（已确认）

- [ ] **[medium] `packages/resolve/src/browser/cdp.ts:23` `withBrowserLock` 无队列取消** ——
      per-sub 超时 abortPending 后,排队等锁的浏览器操作不会被取消,之后仍会运行并重连
      CDP。要真正取消需给锁加取消上下文(改动较大,且 abort 本身是「不再等待」语义),
      故暂缓。影响:多浏览器订阅同时超时会有 CDP 关闭→重开的抖动(非正确性错误)。

- [x] **[medium] `deserialize.ts` `tpl:images` 死分支** — 无生产者（serialize 发 `media:content`），
      已删该分支，social 图统一走 `parseImagesFromMedia`。（2026-10-13）
- [x] **[medium] `Live.playUrls`/`playHeaders`/`playUrlsExpiresAt`** — 已删（types.ts 留警告注释）。
- [x] **[low] `apps/mobile/src/main.ts`** — 已删（mobile 接入时重写为 main.tsx，模板 greet 逻辑移除）。
- [x] **[medium] `App.tsx` URL 编码** — 核实无 bug：React Router 解码 params，loader（router.tsx:58）
      与 store 均用解码值，无字符串比较被编码串骗过。
- [x] **[medium] `markRead` / `lastReadAt`** — ⚠️ **此条早先「核实无缺口」的结论有误**：只查了
      `patchMany` 写 `lastReadAt`，漏看了 desktop `store.markRead` 把「未读」标志当「已读」写持久层
      （语义反转 → 刷新后回到未读）。**2026-10-13 第九轮已修**（见该轮记录）。
- [x] **[low] `packages/ui/src/index.ts`** — 已清（现仅导出 `MediaImage` + `fmtCount`；player re-export 已删）。
- [x] **[low] `log` `getLogDomain`/`resetLogDomains`** — **有意保留**（叶子包公开 API：读域 + 测试清空；
      API 面小，删了限制包的可测试性）。
- [x] **[low] `rsshubArticleMedia` 重复追加** — 已修（deserialize.ts 有 `seen` Set 按 URL 去重）。

## 待修（2026-10-13 第二轮审计，未修）

- [ ] **[med] `resolve/platform/douyin/stream.ts:127-137`** — 清晰度兜底按位置
      `flvList[flvList.length - level]` 配对 URL，应按 `sdk_key` 键关联。JSON map 顺序非
      清晰度契约 → 错档/负下标丢档。参照 pure_live 已点名这是 known-bad 模式。仅在
      `stream_data` 非 JSON 时触发（主路径正常），无失败证据，暂不改。
- [ ] **[med] `resolve/platform/douyin/abogus.ts:43`** — `enterRoomParams` 恒含
      `msToken:""`，`signDouyinUrl` 又追加一个随机 msToken → query 出现两个 msToken
      （一个空、一个真）。若服务端取首个(空)，签名可能与指纹不一致。删该行即修复，但
      douyin 现状「全通」，改动编码有回归风险 → 待有失败证据再动。
- [x] **[med] `resolve/platform/douyin/danmaku.ts:176`** — **实测无需改**：`bun run rss dm` 在在线
      房间（live.douyin.com/3010151431）收到 16 条真实弹幕，服务端接受当前 `%20` 编码方式。
      审计声称的 `|(;/` 未编码问题未实际触发。
- [ ] **[low] `resolve/platform/bili/client.ts`** — `navCache` 无 TTL（wbi key 轮换/换号后
      可能复用旧 nav）；当前主要缺陷（reject 毒化）已修，TTL 待 wbi 频繁轮换时再补。
- [x] **[low] `resolve/platform/bili/discover.ts:51`** — 已修：`stripEm` 收紧到 `/<\/?em\b[^>]*>/g`（属性可选），不再误删属性含 "em" 的标签。
- [x] **[low] `resolve/resolver/router.ts`** — 已修（2026-10-13）：全 7 条路由加 `(?:^|[./])` host 边界；补 douyin 用例 + 伪造域名反例进 router.check。
- [x] **[low] `resolve/platform/youtube/client.ts:270`** — **审计报告有误**：实测 `R.maxBy(h,a,b)`
      相等时返回**第二个参数**,故 `maxBy(height,f,best)` 相等取 best(保留首个)——注释正确,
      忠实原 `>` 语义。无功能问题。

- [ ] **[medium] `player/hooks/useStreamSelection.ts:59`** — 默认选流按格式族
      `find(isProgressiveVideo) ?? find(isHlsStream) ?? …` 而非取 `streams[0]`；若某源
      产出「更低清晰度的 progressive 排在更高档 hls 之后」（或首档只有 flv），会静默选低画质。
      ⚠️ 实测现有 crawler 不触发（huya 每档先 push HLS 再 push flv，无混排倒序），
      改动会变选流策略、有回归风险 → 待真出现混排源再改。
- [ ] **[low] `player/hooks/useMediaStream.ts:101`** — 档位锁定 `hls.currentLevel = max`
      在每次 MANIFEST_PARSED 重跑，直播 LL-HLS 持续重载、levels 增长时重锁到新末档。
      点播只触发一次；直播未见问题 → **判定非缺陷（2026-10-13 复核）**：重锁的语义就是
      「锁最高档」，重跑到同一 max 是幂等 no-op；levels 增长时锁到新末档仍是「最高档」
      期望行为。撤下待验。

## 在本会话修（供对照）

通用 RSS 文章正文按需补全（新功能）+ 持久缓存；社交弹窗控件条/HTML 渲染；`looksLikeHtml`
共享探测；`tpl:fetchedAt`/`authorAvatar`/`authorHandle` 契约缺口；弹幕冷启动开头丢失；
阅读进度恢复随补全重跑；切条目进度串写；extract `<figure>` 保留 / fallback 段落 / 误删守卫；
`serialize-contract.check` + `body-cache.check` + `extract.check` 三个新守卫。

## host 包审计（2026-10-13 第三轮，已修）

- [x] **[高] `host/tauri/tauri-ws-backend.ts`** — Rust 传输层错误同时投 Error + Close →
      onClose 双调 → 弹幕流起两条 WS 且泄漏一条。加 `closed` 终态去重。
- [x] **[中] `apps/src-tauri/src/commands/mod.rs` `is_blocked_host`** — `::ffff:169.254.169.254`
      判为 V6 且 segments[0]==0 → 绕过内网/云元数据拦截。先 `to_ipv4_mapped()` 走 v4 判定。
- [x] **[中] `host/tauri/sqlite-storage-backend.ts`** — ready rejected 被 `??=` 永久留存 +
      removeItem 无条件执行(先删后写)。catch 清回 null 可重试 + 写成功后才删 local。
- [x] **[中] `apps/src-tauri/src/commands/browser.rs`** — ensure/reset 同步 `pub fn` 跑主线程
      含 3s+ 忙等冻窗口。改 `#[tauri::command(async)]`。
- 判定非缺陷（复核后撤回）：ws.rs `conns` Mutex 中毒不可达；`KV_DDL` 无 DROP 不 wipe；
      json 解析守卫三后端一致（契约统一，非本后端独有）。

## CLI + core data-layer 审计（2026-10-13 第四轮，已修）

- [x] **[高] `apps/cli/src/commands/play.ts:31`** — `cmd /c start "" <url>` 在 query
      的 `&` 处截断直链(签名流 403)。改 `rundll32 url.dll,FileProtocolHandler`(不经 cmd)。
- [x] **[中] `host/node/node-ws.ts:41`** — error+close 双投递 → 重复重连+泄漏,与已修的
      Tauri 后端同款。加 `closed` 去重。
- [x] **[低] `core/data-layer.ts:257`** — 空抓取守卫只看内存 store,store 未水化(启动
      刷新失败/超时)时缓存仍在却会清空+覆盖。改为 store 或缓存任一有内容即保护。
- [x] **[低] `apps/cli/src/store/sqlite-storage.ts:21`** — 依赖 `.data/` 已存在。
      加 `mkdirSync(recursive)`,新克隆/CI 不再 fatal。
- 跳过（低/风格）：`browser-reset.ts` profile 路径由 env+硬编码 identifier 重建,标准
      配置下与 Rust `app_data_dir()` 一致,仅 AppData 被组策略重定向时可能分叉。

## desktop + player 审计（2026-10-13 第六轮）

- [x] **[高] `views/library/ShortVideoView.tsx:34`** — 「可视 ±1」三条都挂 PlayableMedia,
  挂载即带声自动播 → 三条同时出声 + 三路弹幕 WS。改为只挂当前条。CDP 实测:恒 1 媒体元素。
- [x] **[中] `lib/shortcuts.ts:52`** — 全局 j/k/↑↓ 不判 `defaultPrevented` 也不判播放页 →
  播放页按 k 会「暂停 + 静默挪 selectedArticleId」。加 defaultPrevented 守卫 + 播放页跳过。
- [x] **[中] `views/discover/DiscoverPage.tsx:213`** — genRef 只在 run() 自增,切平台/切视图
  不作废在途请求 → 旧响应覆盖新面板。改 useEffect([platform,view]) 作废 + 清 busy。
- [x] **[低] `player/hooks/useStreamSelection.ts:53`** — `useEffect([streams])` 按引用重置
  切档态;props 流路径每次渲染新建数组 → 切档立即失效。改内容签名依赖。
- [ ] **[中/暂缓] reading 按裸 `item.id` 落库** — 跨订阅同 id 条目(如同一 bilibili 房间在
  「手填订阅」与「热门榜」两处)共享已读/星标/续播。修需给 reading 键加 `subscriptionId`
  维度 + 持久化格式迁移(旧数据 key 是裸 id),**改动面大且有迁移风险**。`itemKey`(lib/media.ts)
  已用 `subId:itemId` 复合键做列表 key,说明作者知情。无失败证据 → 暂缓。

## xml 包审计（2026-10-13 第五轮）

- [x] **[中] `xml-parser.ts:9`** — `XMLParser` 默认 `parseTagValue` 把数字形字符串转数值
      (`roomId:"007"`→7、`guid:"0123"`→123,丢前导零+丢类型)。改为 `parseTagValue:false`
      (读端全经 num()/Number()/asString() 显式转换,零改动;属性本就不受影响)。
- [x] **[中] `serialize.ts:164`** — `Social.images` 类型允许 `string | SocialImage`,但
      serialize 对 string 元素取 `.url` 得 undefined 跳过 → 纯字符串图 URL 静默丢。
      加归一化 + 守卫补 images 往返用例。
- [ ] **[低/潜在] 无生产者的 latent 丢字段** — `Item.raw`(不往返)、`Live.quality`(不往返)、
      `article.media[]` 图片(只保首个为 thumbnail)。三者当前**无 channel 产出**,不触发;
      若未来有 channel 依赖再补 serialize+deserialize 两侧。
- [ ] **[低] `serialize-contract.check.ts` 盲区** — 只检测「deserialize 读、serialize 不写」,
      检测不到「**两侧都漏**」的字段(如上面的 quality/raw/media[])。扩展需维护「应透传字段」
      期望清单,成本不低;当前新增字段时会显式加守卫用例,暂够。

## resolve 平台解析层审计（2026-10-13 第七轮）

- [x] **[高] `bili/danmaku-proto.ts:60`** — 内层 `while (p < end)` 无边界保护:截断帧声明
      长度超缓冲 → p 到底后 varint 不前进 → 死循环冻结事件循环(实测 120s+ 挂住)。clamp end
      + 未前进即 break;新守卫 danmaku-proto.check.ts。
- [x] **[中] `douyu/danmaku.ts:61`** — 一帧多包只解首包,其后静默丢(斗鱼高峰粘包常见)。
      按 fullMsgLength+4 逐包遍历;新守卫 douyu-frame.check.ts。⚠️ 帧长 = fullMsgLength+4。
- [x] **[中] `youtube/signature.ts:210`** — 解 n 参数时从 googlevideo 直链正则抠 videoId 抠到
      **CDN 主机名**(rr3---sn-...)→ 取错 base.js → 流丢弃。改由 resolveYoutubeStreams 层层传
      真实 videoId(resolveFormatUrl → deobfuscateNParam)。
- [x] **[中] `bili/client.ts:115` `ensureBuvid`** — buvidPromise 无逐出:一次瞬时失败永久毒化
      → 4 个走 buvid 的 bili 渠道全废。补 `.catch(清缓存)`(对称于 getNavData 已修的坑)。
- [x] **[中] `douyin/stream.ts:31`** — step1 enter 与 step2 reflow 各调一次 fetchRoom(签名还
      不同)→ 反爬侧见同房间双 enter。实测 enter 响应**根本不含 stream_url**(纯拿 id_str 长号),
      重复 100% 发生。step1 响应传给 step2 复用。resolve 1.53s→1.33s。
- **判定非缺陷(复核纠正)**:
  - bili `qnDescName` 读 `playurl.g_qn_desc` —— 审计标「存疑」,**实测该字段确在 playurl 层**
    (8 条,10000→原画/400→蓝光/250→超清/150→高清),代码正确。
  - youtube 直播 chat poller 共享闭包状态 —— 每次 resolve 新建 poller(danmaku 来自
    resolved),`[danmaku]` effect 重订阅拿新实例,实际不可达。
- [ ] **[低/潜在] `douyin/stream.ts:111`** — `stream_data` 键名级别变更时主路径返回空 → 降级链
      (慢 2 RTT + 可能低画质)。无失败证据,待上游字段变更时再处理。

## crawler 渠道层审计（2026-10-13 第八轮）

- [x] **[高] `bili/client.ts` `ensureBuvid`** — 同上(该审计独立发现同一处)。
- [x] **[中] 四平台直播「全部房间失败」当成功 0 条** — bili:live/live:douyu/live:huya/
      live:douyin 全房间失败时静默返空(离线房间仍返 Live,全 null 必是失败)。改为抛出。
- [x] **[中] `huya/discover.ts:137` 搜主播 online 恒 0** — 读了主播桶**不存在**的
      game_total_count(桶里只有 game_activityCount=活动热度,非观众数)。改为省略 online
      (UI 显「—」),与 douyu 搜主播同款。
- [x] **[低] `bili/square.ts:34`** — id 含数组下标 → 词位次变动产生重复。改为只用词(与
      weibo:hot/douyin:trend 同款)。
- [x] **[低] `douyin/live.ts:85`** — `raw:streamUrl` 死字段(raw 不经 XML,下游重新 fetchRoom)。
- [ ] **[低] `weibo/user.ts:55`** — 首次翻页重拉首页拿 mids(多 2 次往返)。正确性无损、
      注释已解释必要性;要省需跨调用缓存 lastMid(状态脆),暂缓。

## core 仓储 + 处理层审计（2026-10-13 第九轮）

- [x] **[高] `apps/desktop/src/store/index.ts:589` `markRead`** — 语义反转:算 `next = !item.isUnread`
      (内存的**未读**标志)却把 `next` 当「已读」传给 `reading.markRead(id, read)`(持久层 read
      语义是「已读」)→ 标已读存 read=false → applyReadingState 不回填 → **刷新后回到未读**;
      反向也无法标未读。CDP 实测复现。修:`markRead(item.id, !next)`。toggleStar 用 setStarred
      (同义值)无此问题。
- [x] **[低] `repo/subscription-repo.ts:122` `addGroup`** — 裸 push 不去重(同文件 `add` 有守卫)
      → 同 id 分组留两条 → updateGroup/removeGroup 只命中首个 → 改名/删除留孤儿。补原地覆盖 + 守卫。
- **判定非缺陷 / 暂缓（复核）**:
  - **[中/暂缓] `media-store.patch` 按裸 id 跨订阅匹配** — 与 backlog 已记「reading 按裸 id」同源
    (该审计补充了内存侧 `store.patch` 也裸 id)。修需 API 加 subscriptionId 维度 + 持久化迁移,
    无用户报告 → 维持暂缓。
  - **[低] `media-store.append` 丢弃重复 id(不合并更新)** — 看似丢字段新鲜度,但合并会**回退
    用户态**:markRead 异步落库,并发 loadMore 的 applyReadingState 可能读到旧 map,合并会把
    刚标记的已读覆盖回未读。当前「丢弃重复」更安全,保留。
  - **[低] `*:corrupt` 留证无消费** — 是**单** key(覆盖非堆积,审计「逐份堆积」有误),设计有意
    (留证供人工恢复),保留。

## desktop views + components + lib 审计（2026-10-13 第十轮）

- [x] **[高] `views/library/ShortVideoView.tsx`「退出短视频」死键** — `go(nodeId)` 的 nodeId
      即当前 `short:*` 节点 → 导航到当前位置 = no-op;且 Esc 未绑定,进短视频模式无独立退出口。
      改 `exit()` 去同类 tab(`short:video`→`tab:video`,CDP 实测 →`/v/tab:live`)并绑 Esc。
- [x] **[高] `lib/shortcuts.ts:75` j/k 不对称(k 死键)** — 旧 `idx + (found>=0 && down ? 1 : 0)`
      up 时加 0 落回当前项 → 被 `next.id===selectedArticleId` 挡掉。改显式 `step=down?1:-1`;
      已离场分支同改。CDP:选中第 4 条 ArrowUp → 第 3 条。
- [x] **[中] `views/player/usePlayerNav.ts` `openArticle` 漏 markReadOnOpen 守卫** — 关掉设置后
      从混合 feed 点文章仍强制标读落库。补 `settings?.markReadOnOpen ?? true`(同 ArticlePane)。
      CDP:关设置点卡 → isUnread 保持 true。
- [x] **[中] `lib/opml-file.ts` 文件框取消挂起** — `pickOpmlFile` 不监听 `cancel`,取消 → Promise
      永挂 → 导入按钮永久「导入中…」。挂 `cancel` → resolve(null)(Chromium 取消只 fire cancel)。
- [x] **[中] `views/library/HotPane.tsx` 吃 view.list** — 已套全局搜索词,同视图内打词即清空热搜榜
      →「没有取到热搜」误导。改用 `baseFor` 取未过滤条目。CDP:setQuery 后仍 50 行。
- [x] **[低] `views/palette/CommandPalette.tsx` 搜不到命令** — 非空输入只搜 entries;改同时搜
      entries+commands。CDP:输入「刷新」→ 命中「刷新全部订阅」。
- [x] **[低] `views/manage/SettingsPage.tsx` RSSHub 地址每键写库** — 改草稿,blur/Enter 落库。
- **复核后剔除（误报）**:
  - **[中] `EditSubscriptionDialog`「设 TTL=0 不清除」** — 审计只看了 `{...prev,...patch}` 的
    内存 spread(`undefined` 确实覆盖键),漏了 `JSON.stringify` **丢弃 undefined 值** + repo 的
    `get/list` **每次重读磁盘**。实测:update 后 `refreshIntervalSec` 键消失、值被清除。非缺陷。
- **存疑（未确证）**:`ShortVideoView` 的 `savePosition` 对 `isLive` 未加守卫 —— 若某直播流返回
  有限 duration,会写 positionSec 把该直播塞进「继续」视图。`PlayableMedia` 有 `dur<=0` 早退,
  直播一般 duration=0/Infinity 不上报,未复现。

## 第十一轮:resolve / host+Rust / player 三线深审（2026-10-13）

- [x] **[P0] `resolve/platform/huya/danmaku-tars.ts` `skipToStructEnd` 无边界 → 截断帧同步
      死循环**(解码跑在 WS 回调里,冻整个事件循环,连 setTimeout 都不转)。加「p<len + 不前进即
      退」守卫。实测:截断帧修复前挂起(>12s),修复后返回 []。新守卫 `huya-tars.check.ts`。
- [x] **[高] `resolve/platform/youtube/signature.ts` 解 n 参数两端皆失败** — `(${fn})` 把函数声明
      变表达式→名字不绑定(ReferenceError);`arguments[0]` 依赖后端透传实参而 FunctionJsBackend
      的 wrapper 不收 → 恒 undefined。改传 (fn 作 code, realName 作 fn, [n] 作显式实参)。
      实测复现两端报错(ReferenceError / SyntaxError)→ 修复后 "n:N"。host-check 补 js 契约断言。
- [x] **[中] `resolve/platform/bili/live-play.ts` `resolveBiliLiveProbe` 丢 quality/rate** —
      档位菜单空 + 违反带 rate 契约。补 probe 实际档位。
- [x] **[中] `resolve/platform/youtube/signature.ts` n 解密器无键缓存** — base.js 轮换后复用旧
      解密函数 → 流限速/403。改按 base.js URL 键控(与 getPlayerCode 同键)。
- [x] **[中] `apps/src-tauri/src/commands/mod.rs` http_get 重定向不复查** — Policy::limited 只数
      次数 → 302 → 169.254.169.254 绕过 is_blocked_host。改自定义策略逐跳复查(loopback 按设计放行)。
- [x] **[低] `host/node/node-backend.ts` json 空 body 抛错** — 与 Rust/browser 后端分叉;改空 body
      回 null。
- [x] **[中] player 切档重置静音偏好** — `muted=!autoPlay`(恒 false)在切流/切档把用户静音强行打开;
      改保留元素当前 muted。
- [x] **[低] player `isProgressiveVideo` 抢 `.ogg`** — ogg 音频进 <video>;ogg 归音频,互斥。
- [x] **[低] player `useVideoElement` `live = dur===Infinity` 死分支** — 改 dur<=0。
- [x] **[低] player `attemptPlay` AbortError 不调 onFail** — 媒体不推进则静默卡住;补延迟重试+上报。
- [x] **[低] `resolve/platform/douyin/stream.ts` reflow 读错 HLS 字段名** — 读 `hls_pull_url`,
      实为 `hls_pull_url_map`(参照 pure_live douyin_site.dart:699 + 本文件 fallback 同用该名)
      → 恒 undefined,flv 缺失房间 HLS 兜底静默丢。改 `hls_pull_url_map` 优先 + `hls_pull_url` 兜底。
- **复核后判定为存疑（未改）**:
  douyin 清晰度兜底按位置 join(主路径正常,已记 backlog);bili `danmaku-live` 控制符切分;
  DASH blob 跨格式切换泄漏(无混合格式源);http_get 每请求新建 reqwest::Client(纯吞吐)。
- ⚠️ **本轮引入并当场修复的回归**:huya 守卫初版加的「skipField 后 p 未前进即退」误伤
  **ZERO_TAG**(零负载字段,skipField 合法地不前进)→ 含零值字段的正常帧提前退出,弹幕全丢
  (实测房间 116 从 10 条/12s → 0)。`while (p<len)` 本身即终止保证,去掉多余判据 + 补
  ZERO_TAG 守卫用例。教训:截断守卫别用「不前进」当判据,零负载字段会假阳性。

## core 编排与仓储审计（2026-10-13 第十二轮）

- [x] **[中] `data-layer.ts` resolvePlayByUrl/resolveLivePlayByUrl 吞 resolver 错误** —
  内层 catch 把风控/无流/限区/登录错误折成 null → 外层误报「该条目不指向可解析的视频链接」
  (与文件头「真实错误必须原样透出」注释相悖)。去内层 catch,由外层 catching 原样透出。
- [x] **[中] `deserialize.ts` id 兜底 `hash-${title}`** — 同标题条目撞 id → store.patch 改所有
  同 id、reading map 串号。改优先 link 兜底。
- [x] **[低] `data-layer.ts` 退订孤儿缓存** — 在途 refresh 的 contentCache.set 不在墓碑保护内
  → 退订后留无消费者的 content:<id>。加 removedSubs 拦截。
- [x] **[低] `settings-repo.ts` reset 绕过 run()** — 与并发 set() 竞态。改走串行链。
- **存疑（未改）**:`removedSubs` 墓碑无界增长(量级极小);`resolveKind` 的 enclosure→audio
  覆盖 ctx.kind(对播客可能有意);`loadMore` 空页+非空游标 → hasMore 恒 true(赖源行为)。

## crawler 渠道层审计（2026-10-13 第十三轮）

- **复核后全部剔除（误报,已实测证伪）**:
  - **[高] douyin「包裹形 `{room:{...}}` 字段全丢」** — 审计称 `mapPartitionRooms`/`hot.ts`
    读 `item` 拿不到字段。**实测证伪**:dump `partition/detail/room/v2`(partition_type=1)
    原始响应,`data.data[0]` 顶层键含 `room,tag_name,uniq_id,web_rid,...`,确实**有** `.room`
    包裹层;而代码读的正是 `item.web_rid`(顶层)+ `item.room.title/owner/cover` —— 字段映射
    **完全正确**。`live:douyin:hot` 实测返回真实房间(title=血雾之里…、author=德子叔叔、
    online=18866)。审计**误读代码**。
  - **[中] 推荐位广告混进热门** — 实测 `is_recommend` 对全部 15 条非直播推荐位为真(该字段
    是「可被推荐」属性,非「是广告」);且 `type` 字段恒 `null`(无 douyu `type===1` 那种可过滤
    标记),所有条均带 `room`+`web_rid`。无从过滤,亦非缺陷。
- **低 / 前瞻（未改,当前不触发）**:
  - `bili/hot.ts` 等 `online: Number(item.online ?? 0)` 字段缺失时写 0 而非省略 → 显示「0 人在看」。
    实测这些接口均带 online,仅缺字段时退化(低频);产品口径:0 是合法值。
  - 四平台直播「全 null 抛错」护栏判 `ok.length`,字段改名后可能产出空壳 `Live`(前瞻,当前字段正确)。
  - `youtube:live` 取不到 meta 时 liveStatus 退化「live」(有意取舍,注释已述)。
  - `rss/podcast.ts` id 兜底 `hash-${title}`(与 core deserialize 已修的同源;播客几乎都带 guid)。
- **未发现**:翻页游标语义(实测页间 0 重叠)、kind 标注一致性、tpl: 契约(serialize-contract 全绿)、
  失败处理、URL/正则/id 生成 —— 均正确。

## mobile 接入审计（2026-10-13 第十四轮）

- [x] **[高] `store.ts` addFeed 无重复拦截** — 同 URL 加两次 → 两条 rss:url 订阅,同 feed 的
  相同 item.id 存两份(key 冲突/未读翻倍/patch 一次改两条)。加去重;并去掉冗余的显式 refresh。
- [x] **[中] `store.ts` 手动刷新 force:false** — TTL 内命中缓存,列表无变化。改 force:true。
- [x] **[高] `App.tsx` Detail 无「打开原文」出口** — 补全失败时死路,且文案承诺了不存在的按钮。
  加按钮走 appHost.openExternal。
- [x] **[中] `App.tsx` 订阅副标题显示 channelKey(恒 "rss:url")** — 改显示 feed 地址。
- [x] **[中] `App.tsx` 退订无确认** — 触屏误触 + 不可撤销。加 window.confirm。
- **存疑/未改（低危）**:补全阈值 mobile 400 vs crawler 800 错配(白抓一次,desktop 同款);
  `looksLikeHtml` 误伤「讲 HTML 的纯文本」(desktop 用 hasFull 绕开,mobile 无该标志);
  行/tab 的 a11y(li onClick 无 role/tabIndex)、触控目标偏小;初始化失败无重试按钮。
- **未发现**:XSS(全字符串渲染,无 innerHTML)、refresh 串行/竞态、savePosition、
  首启无种子(合定位)、MediaImage 接入 —— 均正确。

## desktop store / router 审计（2026-10-13 第十五轮）

- [x] **[高] `lib/shortcuts.ts:58` 播放页守卫是死代码** — `/play/:itemId` 的 loader 故意不改
  `selectedNodeId`(router.tsx:73),故 `nodeTypeOf(selectedNodeId)==="player"` 永假。播放页按
  `j`(容器不接管 j)会把上一个 feed 的一篇无关文章标为已读并落库。改按 URL 判。CDP:/play
  按 j×2 → unread 保持、selectedArticleId 为 null(tab:article 的 ↓ 仍正常)。
- [x] **[中] `views/library/ShortVideoView.tsx` 60 条截断无出口** — 吃 view.list 的 PAGE_SIZE
  切片,不挂 LoadMoreFooter、不调 growPage → 第 61 条起滑不到(实测 84 条只显 60)。加
  activeIdx 近末尾自动 growPage。CDP:滑到末条 → 窗口 60→84。
- [x] **[中] `store/index.ts` refreshAll 未清 loadMoreEnded** — refreshAll 抓新首页(core 侧
  cursor 已重置)但不复位 loadMoreEnded → 曾翻到底的源刷新后仍显「已加载全部」、翻不动。
  finally 里一并清。CDP:置 ended=true → refreshAll → 清空。
- **存疑/未改（低危）**:`view.total` 口径(loaded vs 渠道 total)与表头脱钩(语义取舍);
  `usePlayerNav` 的 `setTimeout(0)` 依赖「/v loader 同步跑完」的隐式时序契约。
- **未发现（重点核查）**:baseFor/queryView 全分支自洽、动作 refreshView 无遗漏、
  autoGroupByKind/importOpml 边界、prefs↔首帧脚本契约、路由编解码配对、节点切换副作用 —— 均正确。
