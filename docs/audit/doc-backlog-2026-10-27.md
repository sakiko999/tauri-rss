# docs 遗留问题全量核对（2026-10-27）

> 方法：对 `docs/` 全部 32 篇文档里的「遗留 / 未做 / 缺口 / 待验证 / 未实现」标记逐条对码
> （5 个区域并行读文档 + 查代码/git log），再由人工复核修正状态。
> 本文是**核对快照**，不是新增需求；后续按 §下一批建议排期。

## 为什么会有 120 条

不是 120 个 bug。按状态拆分：

| 状态 | 数量 | 含义 |
| --- | --- | --- |
| open | 82 | 确实没做（其中大量是 low/trivial 的清理或产品 backlog） |
| stale | 8 | 文档写法已过期（代码已变），只需改文档 |
| fixed | 9 | 核对时仍未做，本轮已修（见 §本轮已修） |
| decision | 21 | 文档明确写了「故意不改/不做」并有理由，不算待办 |

按严重度：high 2 · medium 22 · low 96；
按工作量：trivial 32 · small 43 · medium 40 · large 5。

来源分布：

| 文档 | 条数 |
| --- | --- |
| `docs/audit/refactor-candidates.md` | 30 |
| `docs/audit/findings.md` | 21 |
| `docs/architecture/system/05-risks.md` | 21 |
| `docs/platforms/channels.md` | 14 |
| `docs/architecture/system/02-contracts.md` | 8 |
| `docs/ui/ui-conventions.md` | 6 |
| `docs/platforms/login.md` | 5 |
| `docs/architecture/system/00-overview.md` | 4 |
| `docs/architecture/system/03-flows.md` | 4 |
| `docs/risk/crawler-risk-control.md` | 4 |
| `docs/platforms/platform-notes.md` | 1 |
| `docs/ops/commands.md` | 1 |
| `docs/playback/mpv.md` | 1 |

> 口径提醒：一个「未做的平台能力」会同时出现在 channels.md、platform-notes.md 的同一主题下；
> 本文按**文档条目**计数，同一件事可能占 2–3 行。

## 本轮已修（9）

- **RSSHub provider 只在 desktop/mobile 进程注册；桌面已改远端 DataLayer，服务入口没 import → rsshub:* 在桌面/服务里实际不可用**（`docs/architecture/system/00-overview.md:54`）
  - 证据：现状：docs 说「desktop/mobile 入口都 import」，但 desktop 的 DataLayer 现在跑在服务（apps/desktop/src/store/data-source.ts:27-37），注册副作用只发生在 desktop 进程（apps/desktop/src/main.tsx:8）等于空转；服务入口 apps/cli/src/service/main.ts:9 与 server.ts:18-33 都没有 import "@amoeba/core/source/rsshub"，全仓 grep 仅 desktop/mobile 两处 import。服务 listChannels（server.ts:591）因此不含 rsshub，refresh 会 NoChannelError。04-extension.md:410 的排查条目同样过期。
  - 处理：服务/CLI 入口补 import；probe.fetch 走 source 聚合表；service-data-check 钉住（2026-10-27 已修）
- **A3 扫码登录成功后读本地 settings 镜像再写回，可能把刚写入的 cookie 覆盖成旧值**（`docs/audit/refactor-candidates.md:193`）
  - 证据：AccountPage.tsx:275-279 仍是 `await dl.settings.get()` 再 `setSetting(field, s[field])`；service-client:692-693 settings.get 只返回本地镜像变量。LoginResult 已带 cookie（core data-layer.ts:52-57），server.ts:812-823 是 runJob → commit(settingsEvent) → return，事件与 HTTP 响应分两条连接，镜像未更新时就会把旧 cookie 写回去（WS 断连时必然命中）
  - 处理：改用 LoginResult.cookie 同步 UI（2026-10-27 已修）
- **误报已失效：桌面经数据服务把单订阅 TTL 改回 0 时，旧的 refreshIntervalSec 不会被清除**（`docs/audit/findings.md:56-58`）
  - 证据：EditSubscriptionDialog.tsx:47 仍传 undefined → store/actions/subs.ts:85 → service-client/index.ts:127,592-596 JSON.stringify 丢掉 undefined → apps/cli/src/service/server.ts:633-637 原样透传 → core/repo/subscription-repo.ts:107 的 {...prev,...patch} 保留旧值。文档的『实测键消失』只在浏览器 dev 的进程内 DataLayer 成立；非本分支改动，但当前生产链路已使结论反转。
  - 处理：SubscriptionPatch：null = 清除；repo 删键；自检覆盖写/清（2026-10-27 已修）
- **A-2「在播」判据两处各写一遍**（`docs/audit/refactor-candidates.md:174`）
  - 证据：Cards.tsx:10 import isLiveNow，:159 与 :173 全改用 isLiveNow，:114 留了合并说明；判据本体 media.ts:41-42。修复提交 446d40b（commit message 明写「refactor A-2，去掉内联副本」）。文档写的 Cards.tsx:102 已漂移。PlayerPage.tsx:202/232 残留的 liveStatus 是「下播不自动播放」与标签文案语义，不能换成 isLiveNow（对非 live 条目会误判）
  - 处理：无需改动；把文档这条删掉，别让后来者顺手把 PlayerPage 的两处也换掉
- **A6 contentCache.delete 无调用、bodyCache.deleteAll 只剩自检用**（`docs/audit/refactor-candidates.md:200`）
  - 证据：content-cache-repo.ts:29,55 仍导出 delete，全仓（TS/TSX）0 调用；body-cache-repo.ts:28,52 deleteAll 只在 core/src/example/body-cache.check.ts:47-68 用；退订清理走 keysOf 批量删（data-layer.ts:1152-1153）
  - 处理：删除无调用方法；bodyCache.deleteAll 标注仅自检（2026-10-27 已修）
- **kind 的中文名/图标仍有两份本地实现，且都缺 category**（`docs/audit/refactor-candidates.md:34`）
  - 证据：apps/desktop/src/views/player/PlayerPage.tsx:353-355 `kindName` 只有 article/video/audio/live/social，无 category，仍在 :311 被使用；apps/desktop/src/views/palette/CommandPalette.tsx:83 四层三元同样无 category（回落 "rss"）。权威表 store/nodes.ts:32-41 中 category = { label:"分区", icon:"layers" }
  - 处理：PlayerPage/CommandPalette 统一 KIND_META（2026-10-27 已修）
- **selectors.ts 仍存在三个无调用者的导出（unreadCount/subUnread/lastFetchedOf）**（`docs/audit/refactor-candidates.md:51`）
  - 证据：apps/desktop/src/store/selectors.ts:199 unreadCount、:211 subUnread、:231 lastFetchedOf；全仓 grep 只命中定义处与 apps/desktop/src/views/library/ArticlePane.tsx:57 的一句注释（“直接用 unreadCount() 会写出…”），无 import 调用。文档写的 185/197/217 已漂移到 199/211/231，但结论不变
  - 处理：删除 unreadCount/subUnread/lastFetchedOf（2026-10-27 已修）
- **scripts/check.ts 仍是白名单，TYPECHECK_PROJECTS 仍漏 service-client/service-protocol，--filter 打错仍退 0**（`docs/audit/refactor-candidates.md:224`）
  - 证据：scripts/check.ts:24-92 FILES 白名单（新 .check.ts 不登记就不跑，无 glob 校验）；:94-107 TYPECHECK_PROJECTS 12 项，无 service-client/service-protocol（这两个包连 tsconfig.json 都没有，packages/*/tsconfig.json 只有 9 个）；:178-179 `items` 过滤后为空 → `continue`，:202-210 results 为空时打印“全部通过 · 0/0”并 `return 0`
  - 处理：未登记 check / 未纳入 typecheck / --filter 空匹配 全部改为失败（2026-10-27 已修）
- **ShortVideoView 的 savePosition 对直播仍无守卫**（`docs/audit/findings.md:84-86`）
  - 证据：apps/desktop/src/views/library/ShortVideoView.tsx:51 直接 savePosition(item,sec,dur)；只有 packages/player/src/PlayableMedia.tsx:300-303 与 AudioShell.tsx:100-103 的 dur<=0 早退。直播若返回有限 duration 会写 positionSec 进「继续」。
  - 处理：savePosition 入口统一拦 kind=live（2026-10-27 已修）

## open · high（1）

- **[high/medium]** A0 browser-sidecar 未接 WebView2 浏览器进程退出事件，浏览器崩溃后 sidecar 仍存活并继续返回坏端口
  - 来源：`docs/audit/refactor-candidates.md:177`
  - 证据：apps/browser-sidecar/src/main.rs 全文无 BrowserProcessExited / ProcessFailed 注册（grep 0 命中），仍只有 SetTimer(500ms)（:928）+ on_timer/tidy（:690-714）；open_process_for_wait 只在 Drop 里用于关 controller 后等进程退出（:794-800）。host/src/node/browser-sidecar.ts:87-88 ensureReady 只判 child.exitCode === null 就直接返回旧 port。对照桌面载具已有自愈：webview_browser.rs:414-435 每次 open 先 cdp_alive() 探活，不通就销毁重建
  - 建议：main.rs 注册 ICoreWebView2::add_BrowserProcessExited → request_shutdown()（只对浏览器进程退出，不要用泛化的 ProcessFailed，否则渲染进程崩溃会打断在途抓取）；或退一步在 on_timer 里对 browser_pid 做 SYNCHRONIZE 存活检查，失效即 shutdown。TS 侧 ensureReady 可再加一次端口探活兜底


## open · medium（19）

- **[medium/trivial]** douyin enterRoomParams 仍写空 msToken，signDouyinUrl 再追加随机 msToken，query 出现双 msToken
  - 来源：`docs/audit/findings.md:15-17`
  - 证据：packages/resolve/src/platform/douyin/abogus.ts:43 含 msToken 空串；同文件 22-27 的 signDouyinUrl 又追加随机 msToken。douyin 现状全通，属潜在风控风险。
  - 建议：删掉 enterRoomParams 里的空 msToken（或复用已有值），同轮实测直播/弹幕签名不回归后再合入。
- **[medium/small]** markAllRead 仍逐条 store.patch（每次全表 map + emit），没有 patchMany
  - 来源：`docs/audit/refactor-candidates.md:205`
  - 证据：apps/desktop/src/store/actions/reading.ts:45 `for (const it of items) dl.store.patch(...)`；MediaStore 接口只有单条 patch（packages/core/src/store/media-store.ts:29，实现 :84-92 是 `items.map` 全表扫 + 每次 emit()）；远端镜像同实现（packages/service-client/src/index.ts:723 直接把 patch 转给同一个 store）。全仓无 patchMany 符号（只有 reading-repo 内部的私有 patchMany）
  - 建议：给 MediaStore 加 `patchMany(entries)`（一次 map + 一次 emit），desktop markAllRead/回滚改用它；两处实现（core store、service-client 镜像复用同一 store）自然同步。docs/architecture/system/06-data-service.md:307 已按 patchMany 描述，代码需对齐。
- **[medium/small]** readingRecords() 仍为发事件整表读 reading blob
  - 来源：`docs/audit/refactor-candidates.md:206`
  - 证据：apps/cli/src/service/server.ts:476-482 `await layer.reading.getAll()`（packages/core/src/repo/reading-repo.ts:93-95 → load() → storage.get + JSON.parse 整张 blob），只取其中几个 key；调用点 :685/:693/:700/:707/:714（每条续播/已读 RPC 一次）
  - 建议：改为按 key 取：reading repo 增加 `getMany(keys)`（一次 load 但只回填命中项）或在服务端缓存 reading map 并随 reading.changed 增量维护；至少别为单条 RPC 解析整表。
- **[medium/small]** hydrate() 仍串行 restoreFromCache，且每个订阅各读一次整张 reading blob
  - 来源：`docs/audit/refactor-candidates.md:207`
  - 证据：packages/core/src/data-layer.ts:609-613 `for (const sub of subs) await restoreFromCache(...)`（串行）；:250-262 restoreFromCache → :354-357 applyReadingState → `reading.getAll()`，即 N 个订阅 = N 次整表 JSON.parse
  - 建议：hydrate 先并发读一次 reading map 传给 applyReadingState（或给 applyReadingState 加可选 map 参数），restoreFromCache 保持串行也行——瓶颈在重复解析。
- **[medium/small]** eventLog 仍按 512 条封顶，单条 items.replaced 可携带整订阅条目
  - 来源：`docs/audit/refactor-candidates.md:210`
  - 证据：apps/cli/src/service/server.ts:81 `EVENT_LOG_LIMIT = 512`、:393-394 push + shift；items.replaced 构造在 :441-445 与 :456-461 带 `next.map(projectItem)`（整订阅条目数组）
  - 建议：改按字节/条目总量封顶（例如累计 items 数或序列化字节），对 items.replaced 只保留 rev+subscriptionId 并在排空后丢弃；超限时让客户端走全量 resync（现成机制 :1146-1150）。
- **[medium/small]** douyin 清晰度兜底仍按位置配对 URL，未按 sdk_key/键名关联
  - 来源：`docs/audit/findings.md:12-14`
  - 证据：packages/resolve/src/platform/douyin/stream.ts:133-142 仍是 flvList[flvList.length - level]；Object.values 顺序非清晰度契约，level 过大还会负下标。仅 stream_data 非 JSON 时触发，无失败证据。
  - 建议：兜底分支改用 flv_pull_url 的键名（FULL_HD1/HD1/...）与 quality/sdk_key 关联，取不到对应档就跳过。
- **[medium/small]** 扫码出码本身仍未在「未登录 profile」下实测（现有 profile 已登录，走的是短路）
  - 来源：`docs/platforms/login.md:171`
  - 证据：登录实现已在（packages/resolve/src/platform/{bili,weibo,xhs,douyin}/login.ts，apps/desktop/src/views/manage/AccountPage.tsx:243-321），但 git log 无未登录 profile 实测提交；CLAUDE.md「下一步」仍标注唯一未验的是扫码出码
  - 建议：用 rss --service --profile-dir <空目录> 起临时服务，逐平台跑一次 rss login 并截图验证出码/轮询/写库
- **[medium/medium]** A-1 B站收藏夹/合集/系列条目的会员（充电专属）标记仍缺
  - 来源：`docs/audit/refactor-candidates.md:170`
  - 证据：favlist.ts:55、season.ts:95、series.ts:98 仍只是照传 `rights`，而这三个接口的列表项没有该字段（`docs/platforms/platform-notes.md:32-35` 实测结论仍成立，`is_upower_exclusive` 只在 view 详情里）；video-common.ts:21-24,61 只认 rights.ugc_pay 与 space 的 is_charging_arc。04bb6f8 只修了 user_video，此后无相关提交
  - 建议：二选一并写清：接受缺口（在 channel 注释与 platform-notes 标「已知，列表侧无字段」），或按条目懒查 view 补 membersOnly（成本高，且卡片角标回不到列表）
- **[medium/medium]** A1 服务端 diagnostics 内联一份 core 实现，clearAll 语义与 core 不一致
  - 来源：`docs/audit/refactor-candidates.md:186`
  - 证据：server.ts:860-876 仍是内联实现：直接删 storage 全部键 + store.clear + lastItems.clear + settings.reset + commit；对比 core data-layer.ts:1036-1046 还会清 removedSubs/pageCursors/pageTotals。在途刷新未取消（jobs 未参与），clearAll 也不给被清订阅挂 removedSubs 墓碑，因此换入 :562 的 replaceIfLive 拦不住，在途 refresh 会把 contentCache 与 items 写回已清空的库（用户看到「已清除」后内容复活）。另：文档「不重置 netPolicy」已过期——server 调的 layer.settings.reset()（data-layer.ts:1178-1181）本身就 syncNetPolicy + 重置 cookieSnapshot。core layer.diagnostics 在生产路径确为死代码：只有 scripts/remote-data-layer-check.ts:136 经 RemoteDataLayer 走 RPC 触达，apps/mobile 无引用
  - 建议：dispatch 一律委托 layer.diagnostics；为 clearAll 先取订阅列表 → 取消在途 job/挂墓碑 → 再清，并返回受影响 subscriptionId 供 server 清 lastItems 与发事件。文档里 netPolicy 那半句要修掉
- **[medium/medium]** A2 服务端/客户端 projectItem 剥掉 article 的 content，桌面正文搜索在生产路径静默失效
  - 来源：`docs/audit/refactor-candidates.md:190`
  - 证据：server.ts:297-301 projectItem 剥 content，出口全走它（:443/:452/:459 items 事件、:555 快照）；service-client:209-212 再剥一次（:273/:526 应用）。selectors.ts:146-171 bodyText/matchesQuery 仍把 content 计入匹配，但镜像里恒空 → 实际只搜标题/作者/摘要。文章卡片读的是 summary（Cards.tsx:190-201），不读 content，所以文档「卡片摘要直接读 item.content」已过期；「文案说谎」也已修：ArticlePane.tsx:233-241 已改成「搜索覆盖标题、作者与摘要；正文不在本地镜像里」（bc58270），MediaMain.tsx:544 空态也不提正文
  - 建议：仍需产品决策：投影保留 content（体积↑，先跑 service-snapshot-size 估量），或搜索改走服务端 / 按需 resolveDetail。定了之后要么改 matchesQuery 的承诺，要么补实现，别两边都不动
- **[medium/medium]** A4 刷新超时不 abortTabs，被放弃的抓取继续占浏览器 lane
  - 来源：`docs/audit/refactor-candidates.md:195`
  - 证据：core data-layer.ts:385-409 withSignal 仍是「race 即 reject」，注释明说不做 socket 级 abort；桌面 data.ts:208-213 withTimeout 超时只 ac.abort()，service-client:731-738 转成 /v1/jobs/:id/cancel，服务端只 abort controller（server.ts:1080），底层 browser op 仍在 op:<platform> lane 上跑。全仓无 abortTabs 生产调用：只有定义 host/src/browser/backend.ts:498、自检 resolve/src/example/scheduler.check.ts:207、以及 cdp.ts:108 的注释描述
  - 建议：在取消/超时路径经 core 调 appHost.browser.abortTabs("refresh-timeout", { keepLogin: true })，让 lane 立即释放；注意只断本次刷新相关 lane，别把登录 tab 带走（scheduler 已支持 keepLogin）
- **[medium/medium]** /v1/state 仍每次重建快照 + 同步 gzipSync，无按 rev 缓存
  - 来源：`docs/audit/refactor-candidates.md:208`
  - 证据：apps/cli/src/service/server.ts:1052-1067 handler 每次 `await snapshot()` 再 `Bun.gzipSync(...)`（同步阻塞，:1063）；snapshot 定义 :541-577 每次重新读 subscriptions/groups/settings/reading 与 `layer.store.all()` 并逐行 JSON.stringify；全文件无 snapshotCache/ETag/lastRev 复用
  - 建议：按 rev 缓存 {body, gzip}：rev 不变直接返回（同时用于 /v1/state 的 ETag/If-None-Match）；gzip 结果随快照一起缓存，避免每次请求同步压缩 ~2.3MB。
- **[medium/medium]** R13：release-only 分支无法被同一套巡检覆盖（release 不开 CDP、__store 仅 DEV）
  - 来源：`docs/architecture/system/05-risks.md:25`
  - 证据：scripts/tauri.ts:60-61 release 不叠 tauri.conf.dev.json；apps/desktop/src/main.tsx:25-29 的 __store/ui-overlay 仅 import.meta.env.DEV；scripts/ui-play-check.ts:43、scripts/ui-shot-play.ts:25 都读 window.__store，release 实例即使手开 9222 也拿不到状态。
  - 建议：给 release 提供受控只读核对钩子（或让巡检脚本在无 __store 时退化为 DOM/HTTP 断言），再跑一遍 release 播放/浏览器矩阵。
- **[medium/medium]** R14：cookieSnapshot 无版本，doRefresh 与 applySettings/scanLogin 交错时后写者胜
  - 来源：`docs/architecture/system/05-risks.md:138`
  - 证据：packages/core/src/data-layer.ts:472 每次刷新无条件 cookieSnapshot=s；:914（applySettings）、:945（applySettingsIfUnchanged）写同一闭包变量；启动投影 :219-221 只做了「首次填充」保护，刷新路径没有版本/序号比较。
  - 建议：给快照加单调版本（settings.updatedAt 或写入序号），刷新只在新于当前快照时覆盖；配 cookie-sync.check 用例。
- **[medium/medium]** R16：抓取浏览器空闲回收与长等待边界未建模（无显式 lease）
  - 来源：`docs/architecture/system/05-risks.md:28`
  - 证据：packages/host/src/tauri/browser-backend.ts:86 IDLE_CLOSE_MS=3min；packages/host/src/browser/backend.ts:289-303 只在 begin/end 时 touch()，没有续期 API；登录靠轮询隐式续期（xhs/login.ts:181-193 每 1s、weibo/login.ts:118-146 每 500ms），全仓 grep lease/keepAlive 无实现。
  - 建议：在 BrowserBackend 上加 lease/续期（登录与长轮询显式持有），把「不产生 CDP 命令的长等待」写进契约与检查。
- **[medium/medium]** R17：FLV 分支仍不带 headers，防盗链流会静默失败（其余兜底已挂 onError）
  - 来源：`docs/architecture/system/05-risks.md:29`
  - 证据：packages/player/src/hooks/useMediaStream.ts:209-213 flvjs.createPlayer 只传 url，注释明说不支持自定义 header；PlayableMedia.tsx:469-479 未知格式裸 video 已挂 onError（这部分已修）。
  - 建议：FLV 走 ffmpeg/隧道或 flv.js 自定义 loader 注入 referer/UA；做不到时在 UI 明确提示「该流需要防盗链请求头」。
- **[medium/medium]** `LoginResult.refreshToken` 在 crawler/core 边界被丢弃，bili 自动续期没有落地前提
  - 来源：`docs/architecture/system/05-risks.md:60`
  - 证据：packages/resolve/src/index.ts:17-22 声明 refreshToken，packages/resolve/src/platform/bili/login.ts:93-94,134 实际产出；packages/crawler/src/index.ts:97-102 与 packages/core/src/data-layer.ts:52-57 都无该字段；scanLogin 只写 cookie（data-layer.ts:929-931）。
  - 建议：先决定续期凭证落哪（settings 加密字段 + 迁移），再把 refreshToken 贯通 crawler/core 的 LoginResult；否则在文档里明确「自动保活不可做」。
- **[medium/medium]** `resolveDetail(item as never)` 仍是零类型校验边界
  - 来源：`docs/architecture/system/02-contracts.md:279`
  - 证据：packages/core/src/data-layer.ts:795 `source.resolveDetail(item as never, …)`；crawler 契约要求 crawler 的 `Item`（packages/crawler/src/index.ts:66），core 传的是 `MediaItem`，只靠两侧字段同形。
  - 建议：在 core 里显式构造一个最小 `Item`（或把接口改为接受两模型共有的子集类型），去掉 `as never`。
- **[medium/medium]** bili 自动保活整条链路未做：bili_ticket 惰性续期与 refresh_token 续 SESSDATA 均无实现，refresh_token 也从未持久化
  - 来源：`docs/platforms/login.md:6-8`
  - 证据：packages/resolve/src/platform/bili/login.ts:93,134 只把 refresh_token 放进登录返回值；packages/core/src/data-layer.ts:919-931 的 scanLogin 仅写 cookie 字段；全仓 grep GenWebTicket/bili_ticket/cookie/refresh 无代码命中；git log --all --grep=保活|refresh_token 无相关提交
  - 建议：先按 login.md §6 实测 cookie/refresh 参数，再把 refresh_token 落 settings 并做启动检查 + 到期前续期；bili_ticket 走请求前临期判断即可（无需定时任务）


## open · low（62）

- **[low/trivial]** A0b rss --service 的 job 表在 cancel 后可能永久残留
  - 来源：`docs/audit/refactor-candidates.md:183`
  - 证据：server.ts:488-514 runJob 仍只在 finally 里 jobs.delete；cancel 端点（:1075-1081）只调 controller.abort() 不摘条目；多个 fn 根本不接 signal（如 :787 layer.loadMore、:795 resolveDetail、:800 resolvePlay），abort 后 promise 不 settle → Map 条目与 AbortController 永挂，/health 的 jobs.size（:1045）也只涨不落
  - 建议：cancel 时立刻标记并摘掉条目（或定时清扫 signal.aborted 的条目），同时给 runJob 的所有 fn 传 signal 并在层内检查；至少让 loadMore/resolve* 这些不接 signal 的路径有超时兜底
- **[low/trivial]** 可播判定仍散在 Cards 与 selectors 两处，未下沉到 lib/media.ts
  - 来源：`docs/audit/refactor-candidates.md:43`
  - 证据：唯一定义仍是 apps/desktop/src/components/app/Cards.tsx:42 的 `isPlayableKind`（同文件 :113/:219 使用）；apps/desktop/src/store/selectors.ts:102 在 `short:` 分支仍内联 `i.kind === "video" || i.kind === "audio" || i.kind === "live"`；apps/desktop/src/lib/media.ts 里没有该函数
  - 建议：把 isPlayableKind 移到 apps/desktop/src/lib/media.ts，Cards 与 selectors 都从那里引；mobile 保持自己的 isPlayable（apps/mobile/src/store.ts:150，已冻结）。
- **[low/trivial]** 每条 CDP 命令仍先 await port() 再进 sweepJunk（端口未缓存）
  - 来源：`docs/audit/refactor-candidates.md:209`
  - 证据：packages/host/src/browser/backend.ts:444-445 ensureConn 每次执行 `await this.port()` + `sweepJunk(...)`；sweepJunk 由 `junkSwept` 首次后直接 return（:455-456），所以“每条命令都真的扫一遍”并不准确，但 `this.port()`（:308-310 → driver.ensureReady）仍每条命令跑一次：tauri driver 是每次 invoke IPC（packages/host/src/tauri/browser-backend.ts:91），node sidecar 是 O(1) 内存判断（packages/host/src/node/browser-sidecar.ts:88）。生产路径用的是 sidecar，代价已很小
  - 建议：在 BrowserBackend 缓存 `portPromise`（close()/resetProfile() 时清），ensureConn 里只在缓存为空时取端口；顺带把 sweepJunk 调用收进同一分支。
- **[low/trivial]** loadMore 仍两次 store.query + append
  - 来源：`docs/audit/refactor-candidates.md:211`
  - 证据：packages/core/src/data-layer.ts:854 `store.query({ subscriptionId }).length`（当 existing 传给 fetchMore）、:872 再 `store.query({ subscriptionId }).reduce(...)` 求 batchTime、:878 `store.append(...)`；三次全量过滤同一订阅
  - 建议：第一处查一次拿数组，length 与 reduce 复用同一结果（若 fetchMore 期间 store 未变即可；若担心变化，把 existing 与 batchTime 用同一次 query 的值）。
- **[low/trivial]** mergeProbeInfo 仍手抄 core sourceInfoFor 的 cookie 合并规则
  - 来源：`docs/audit/refactor-candidates.md:221`
  - 证据：apps/cli/src/service/server.ts:311-325（rsshub→baseUrl、cookieFieldFor + settings 字段）；packages/core/src/data-layer.ts:332-345 sourceInfoFor（同样的 rsshub/cookie 规则，用 cookieFor + 可传 settings 快照）。两份各自演进（一个用 cookieFieldFor、一个用 cookieFor）
  - 建议：core 导出一个纯函数 `mergeSourceInfo(channelKey, info, settings)`，data-layer.sourceInfoFor 与 probe 都调它；server 侧只保留 settings 读取。
- **[low/trivial]** 客户端仍只比对 hello.protocol，不读 minClientProtocol
  - 来源：`docs/audit/refactor-candidates.md:229`
  - 证据：packages/service-client/src/index.ts:104-111 只把响应断言成 { protocol?, serviceVersion? } 并要求 `hello.protocol !== SERVICE_PROTOCOL` 就抛；全文无 minClientProtocol。该字段只在协议类型 packages/service-protocol/src/index.ts:49 与服务端返回（apps/cli/src/service/server.ts:1030、:1130）出现，服务端当前恒等于 SERVICE_PROTOCOL
  - 建议：hello() 里解析 minClientProtocol，`minClientProtocol > SERVICE_PROTOCOL` 直接报“服务端要求更高协议版本”；顺带把 hello 类型换成协议包的 HelloResponse。
- **[low/trivial]** `NetLevel` 仍是三份同形字面量声明，无 type import 关系
  - 来源：`docs/architecture/system/05-risks.md:61`
  - 证据：packages/core/src/types/settings.ts:20、packages/host/src/net/governor.ts:34、global.d.ts:79,85 各写一遍 0|1|2|3。
  - 建议：让 host 与 core 从同一处（如 @amoeba/platform 或 core 类型）import，global.d.ts 至少加注释指向权威。
- **[low/trivial]** refreshAll 的 finally 无条件 busy:{} 会清掉并行单条 refresh 的 busy 态
  - 来源：`docs/architecture/system/05-risks.md:131`
  - 证据：apps/desktop/src/store/actions/data.ts:244-251 set({busy:{}}) 与单条 refresh 的 :113-125 busy 增删没有代际判断；refreshAll 只挡了 loading 重入，不挡单条 refresh。
  - 建议：refreshAll 只清自己置位的 id（或维护 busy 计数），不要整体置空。
- **[low/trivial]** 依赖声明与源码不一致（ui 仍声明未用的 core/player；引用的行号也已错位）
  - 来源：`docs/architecture/system/05-risks.md:161`
  - 证据：packages/ui/package.json:11-13 声明 core/player/resolve，但 packages/ui/src 只 import resolve/media-referrer（MediaImage.tsx:25），无 core/player；原文「:11,13 声明 core/player」把第 13 行（实为 resolve）当成了 player。mobile 侧声明未用依赖仍成立但已冻结。
  - 建议：删掉 ui 里未用的 core/player 依赖并修正文档行号；mobile 随冻结不处理。
- **[low/trivial]** FLV 的 ERROR 对象被 String() 成 `[object Object]`
  - 来源：`docs/architecture/system/03-flows.md:269`
  - 证据：packages/player/src/hooks/useMediaStream.ts:215-218 report?.(e) 传的是 flv.js 的 info 对象；PlayableMedia.tsx:394 用 String(playError) 显示。
  - 建议：在 report 前把 flv 错误归一成 Error（code/type/detail），别把对象直接抛给 UI。
- **[low/small]** A5 channelVideoToItem 缺 author/publishedAt/duration
  - 来源：`docs/audit/refactor-candidates.md:197`
  - 证据：crawler/.../youtube/channel.ts:119-135 仍只写 id/title/summary/thumb/fetchedAt/membersOnly；resolve/.../youtube/channel.ts:22-32 的类型只有 viewsText/publishedText（相对时间），fromLockup（:103-132）也没解 duration。后果仍成立：selectors.ts:86 的「今天」只认 publishedAt → YouTube 频道订阅恒空；缺 author → 卡片 :193-200 落空 spacer。但文档另两句已过期：时间排序不退化（selectors.ts:125 timeKey 用 fetchedAt 兜底），卡片也不会「把 summary 当作者名」（只有 category 条目才那样渲染，:195-197）
  - 建议：补 author（InnerTube browse 响应的频道 title 透传到 crawler）与 duration（lockup thumbnail overlay 里能解）；publishedAt 反推继续保持不做（已是有理由的决策），只把文档里那两句过期描述改掉
- **[low/small]** 串行队列仍在 4 个文件各写一份，repo/ 下没有 serial.ts
  - 来源：`docs/audit/refactor-candidates.md:23`
  - 证据：packages/core/src/repo/subscription-repo.ts:37 / reading-repo.ts:36 / settings-repo.ts:26 各自 `let serial = Promise.resolve()`；packages/core/src/data-layer.ts:618 的 `serialized()` 另维护 `chains` Map；`packages/core/src/repo/` 只有 5 个文件，无 serial.ts
  - 建议：新增 packages/core/src/repo/serial.ts 导出 createSerialQueue/createKeyedSerialQueue，四处替换本地实现；行为等价（fn,fn 双分支 + 吞错续链）要照抄。
- **[low/small]** 两条按 URL 解析的链路仍是两份只差 resolver 调用的实现
  - 来源：`docs/audit/refactor-candidates.md:58`
  - 证据：packages/core/src/data-layer.ts:706-724 resolvePlayByUrl 与 :727-741 resolveLivePlayByUrl：findItemUrl → repo.get/sourceInfoFor/previewInfoFor → resolveVideoByUrl|resolveLiveByUrl → getDanmakuByUrl → { streams, danmaku }，除被调函数外逐行相同
  - 建议：抽 `resolveByUrl(itemId, subscriptionId, resolveFn)`，两个入口各传 resolver；注意保留两份不同的错误文案（resolvePlay/resolveLivePlay 的外层 catch 已分开）。
- **[low/small]** 日志开关仍靠 node 入口伪造 localStorage，@amoeba/log 没有 configureLog()
  - 来源：`docs/audit/refactor-candidates.md:215`
  - 证据：packages/log/src/env.ts:13-24 readSwitch 只读 `globalThis.localStorage`（无 process.env 分支）；packages/log/src 无 configureLog/setLogEnv 导出；apps/cli/src/host/log-shim.ts:6-10 仍被 apps/cli/src/host/node-host.ts:69 与 apps/cli/src/service/host.ts:37 加载（shim 写 localStorage 的 log="0"/"1"）
  - 建议：@amoeba/log 增加 `configureLog({ defaultEnabled?, env? })` 或让 readSwitch 在无 localStorage 时读 process.env.RSS_LOG；随后删 log-shim（注意 emit 时才读开关的现有不变量，core.ts:78）。
- **[low/small]** DB 文件名（rss.db/rss.dev.db/rss.release-debug.db）仍是 4 份手抄，无 parity check
  - 来源：`docs/audit/refactor-candidates.md:218`
  - 证据：apps/desktop/src/store/data-source.ts:22-24；packages/host/src/tauri/sqlite-storage-backend.ts:25-28；apps/src-tauri/src/service.rs:23 DEFAULT_DB + :80 白名单 + :454 生产名；scripts/tauri.ts:88。全仓 parity 检查只有 packages/resolve/src/example/media-referrer-parity.check.ts 一个
  - 建议：建一份共享清单（如 scripts/db-names.json 或 service-protocol 常量）+ `db-names-parity.check.ts` 比对 TS/Rust/scripts 三处；Rust 侧用 include_str!/生成常量，别再加第五份。
- **[low/small]** BROWSER_UI_URL/EDGE_UI_URL 与 targetParams() 仍在两个 driver 各一份
  - 来源：`docs/audit/refactor-candidates.md:222`
  - 证据：packages/host/src/node/browser-sidecar.ts:70 BROWSER_UI_URL（正则与 tauri 完全相同）、:130-133 isUsableTarget、:135-141 targetParams；packages/host/src/tauri/browser-backend.ts:44 EDGE_UI_URL + :47 EDGE_UI_HOST、:49-52 isEdgeUiTarget、:94-102 targetParams。packages/host/src/browser/backend.ts:61-70 只有接口声明
  - 建议：把 UI-target 正则与默认 targetParams 常量移到 packages/host/src/browser/backend.ts，两个 driver 只声明差异项（WebView2 的屏外坐标仍由 driver 给）。
- **[low/small]** YouTube InnerTube 的文本/缩略图解析仍是多份
  - 来源：`docs/audit/refactor-candidates.md:227`
  - 证据：packages/resolve/src/platform/youtube/channel.ts:76 textOf、:88 maxThumb；discover.ts:43 textOf、:54 thumbOf；client.ts:551 ytText、:562 ytThumb——三组同形实现并存，未收敛
  - 建议：抽到 youtube/innertube-text.ts（textOf + maxThumb），三处引用；保留各自导出的薄包装给已有 check 钉形状。
- **[low/small]** usePlayerNav 仍依赖 setTimeout(0) 与 /v loader 的隐式时序
  - 来源：`docs/audit/findings.md:95`
  - 证据：apps/desktop/src/views/player/usePlayerNav.ts:55 navigate 后 setTimeout(() => selectArticle(item), 0)；router.tsx:94-111 的 loader 同步 select() 会清 selectedArticleKey。
  - 建议：把选中意图随导航 state 传入，由 loader/路由 commit 后消费；不要用定时器给路由排序。
- **[low/small]** bili navCache 仍无 TTL，换号/wbi 轮换后可能复用旧 nav
  - 来源：`docs/audit/findings.md:18-19`
  - 证据：packages/resolve/src/platform/bili/client.ts:75-98 navCache 只在请求失败时逐出，无过期时间。
  - 建议：按 cookie key 加短 TTL，或 wbi 签名失败时主动 invalidate 并重取一次。
- **[low/small]** 「清除凭证」仍是先清浏览器 cookie 再清 settings，无备份/回滚
  - 来源：`docs/audit/findings.md:30-32`
  - 证据：apps/desktop/src/views/manage/AccountPage.tsx:223-233 clearCookies(hosts) 成功后 onSave("")；任一步失败只 toast，不恢复旧值。
  - 建议：先备份 settings 再清 cookie，失败时写回旧值或明确提示「浏览器已登出、设置未清，请重试」。
- **[low/small]** xhs 残留 user_id cookie 仍会被 isXhsLoggedIn 当作已登录（文档写的「轮询判据」已换成 loginState）
  - 来源：`docs/audit/findings.md:33-35`
  - 证据：packages/resolve/src/platform/xhs/client.ts:135-141 回退 !!c.user_id；crawler/channels/xhs/shared.ts:75 用它做抓取门禁；扫码轮询已改为 xhs/login.ts:59-80 的 loginState 基线比较，仍挡不住「过期但不同值」。
  - 建议：抓取门禁改为页面 SSR 证据优先、cookie 仅提示；抓取返回「需要登录」时回写登录态失效。文档同步改函数名。
- **[low/small]** R19：文档漂移清单自 2026-10-23 未再登记，本轮又发现多处新漂移
  - 来源：`docs/architecture/system/05-risks.md:31`
  - 证据：05-risks.md:188-190 只登记了 10-23 清掉的四处；本轮核实出 05-risks §6 依赖声明引用行错位（ui/package.json:11-13）、§4「桌面无 setInterval（grep 无命中）」不成立（HomeView.tsx:53）、00-overview:41 仍写 CLI 旁路 settings、03-flows:268 原生重试描述过期、00-overview:208「播放无自动化回归」过期。
  - 建议：把本轮 5 处漂移按「位置/注释说/代码是」补进 §7.3，并顺手改掉对应正文。
- **[low/small]** host 根入口仍是聚合 barrel，新代码误 import 会把三套后端拉进模块图
  - 来源：`docs/architecture/system/05-risks.md:97`
  - 证据：packages/host/src/index.ts:12-41 静态 re-export node/tauri/browser 全部后端（根入口已无 import 副作用，问题只是打包面）。
  - 建议：保持现状但在 lint/检查里禁止 `from "@amoeba/host"`（tsconfig paths 之外加规则），或把根入口缩成仅类型。
- **[low/small]** R6 残余：部分平台 client 仍抛普通 `Error`，消息不匹配时落 unknown
  - 来源：`docs/architecture/system/05-risks.md:116`
  - 证据：packages/crawler/src/channels/weibo/user.ts:119,121,125 仍 `throw new Error(平台 msg)`；errorKindOf 只能启发式归类。
  - 建议：按 02-contracts §9.7 逐个把平台 client 的抛错点换成 ResolveError(kind)，优先 auth/risk/rate-limit 三类。
- **[low/small]** 平台冷却错误把内部平台名/信号直接塞进用户文案，且可能遮蔽真实原因
  - 来源：`docs/architecture/system/05-risks.md:110`
  - 证据：packages/host/src/net/governor.ts:442,597 抛 `平台冷却中（${platform}，剩余 ${wait}，信号 ${cooldown.signal}）`，errorKindOf 归 rate-limit 后 UI 原样展示。
  - 建议：对外文案去掉平台键与 signal（留在日志/诊断），冷却原因与掉登录分开表达。
- **[low/small]** 「每 N 分钟刷新」文案仍暗示定时器，实际是 TTL 复用缓存（且 §4 的「grep 无 setInterval」已不成立）
  - 来源：`docs/architecture/system/05-risks.md:128`
  - 证据：apps/desktop/src/views/library/ArticlePane.tsx:122-124 显示「每 N 分钟刷新」；core 只在请求时判 TTL（packages/core/src/data-layer.ts:470-511），桌面无刷新定时器；但 HomeView.tsx:53 有 60s 时钟 setInterval，所以原文括号里的 grep 结论已过期。
  - 建议：把 pane 文案改成「间隔内复用缓存」语义（与设置页 Reading.tsx:35-36 的说明一致），并修正 §4 的括号证据。
- **[low/small]** 0 条保护只在「已有内容/缓存」时生效，首次抓取失败仍是空视图
  - 来源：`docs/architecture/system/05-risks.md:129`
  - 证据：packages/core/src/data-layer.ts:551-553 的保护条件要求缓存或 store 非空；无缓存时失败走 catch（:571-585）返回 error，desktop 只有 warn toast，列表位为空。
  - 建议：首抓失败时在列表/节点位复用 StateBlock 显示真实失败模式与重试，而不是留空列表。
- **[low/small]** TS paths 掩盖深层跨包直引（CLI align 直引 core 内部文件）
  - 来源：`docs/architecture/system/05-risks.md:158`
  - 证据：apps/cli/src/commands/align.ts:12 `import { deserializeFeed } from "../../../../packages/core/src/processing/deserialize.ts"`，绕过包导出。
  - 建议：给 core 开一个 `@amoeba/core/processing` 之类的子路径导出，或在检查脚本里禁止 `packages/*/src` 直引。
- **[low/small]** 抖音「登录解锁原画」仍未经真机验证，代码里也没有按登录态提档的分支
  - 来源：`docs/architecture/system/05-risks.md:148`
  - 证据：packages/resolve/src/platform/douyin/client.ts:55-59 登录 cookie 只用于取 ttwid/身份，stream.ts:196-241 的清晰度键序静态返回，未按登录态筛选。
  - 建议：用真机对比匿名/登录两态的 stream_url 档位；若登录无增益，把承诺从平台速查与文案里删掉。
- **[low/small]** `author.name` 为空时头像/句柄被一起丢弃
  - 来源：`docs/architecture/system/02-contracts.md:186`
  - 证据：packages/xml/src/serialize.ts:70-73 只写 authorAvatar/authorHandle（不依赖 name），但 packages/core/src/processing/deserialize.ts:344-346 的 toAuthor 在 name 为空时直接返回 undefined，读侧把有值字段一起扔了。
  - 建议：toAuthor 改为「name/avatar/handle 任一有值即保留」，MediaAuthor.name 允许空串或由 UI 显示占位。
- **[low/small]** 纯 HTML（仅图片）摘要 stripHtml 后为空串（原举例 bili:square 已过期）
  - 来源：`docs/architecture/system/02-contracts.md:188`
  - 证据：packages/core/src/processing/deserialize.ts:101-111,144；但 bili:square 现已改为纯文本 content（packages/crawler/src/channels/bili/square.ts:53-55），该举例不再是现网命中，外部 RSS 仍可能出现。
  - 建议：stripHtml 为空时回退到「有附件用类型名/取 media 标题」，并把文档举例换成现存场景。
- **[low/small]** `resolveLivePlay` 形参叫 roomId，实现按 item.id/url 查，按名传 roomId 会误报
  - 来源：`docs/architecture/system/03-flows.md:271`
  - 证据：packages/core/src/data-layer.ts:668-673,727-728 实际走 findItemUrl 按 id 命中；desktop 已统一传 item.id 或 url（PlayerPage.tsx:194-198），但签名/门面（store/types.ts:189）仍叫 roomId。
  - 建议：把形参改名为 itemIdOrUrl（与 resolvePlay 对齐），消除误导。
- **[low/small]** douyin 登录态保活完全未调研（表格写「未调研」）
  - 来源：`docs/platforms/login.md:17`
  - 证据：全仓无 douyin 过期/续期相关代码或文档结论；login.md 仅一行「— 未调研」
  - 建议：先只做「sessionid 有效期实测 + 失效时引导重登」，不追求自动续期；风险控制与抖音搜索调研共用一次专用小号探针
- **[low/small]** bili 账号服务未做：登录后不拉昵称/uid 展示
  - 来源：`docs/platforms/channels.md:320-321`
  - 证据：全仓 grep member/web/account 无命中；AccountPage.tsx 只有 cookie 手填/扫码与二维码，无账号资料区
  - 建议：扫码成功后调 /x/member/web/account 取 uname/uid，在「账号与凭证」卡片显示；失败不影响登录
- **[low/small]** B站合集/系列条目没有作者名（archives 里只有 mid，不回查用户资料）
  - 来源：`docs/platforms/channels.md:340-341`
  - 证据：packages/crawler/src/channels/bili/season.ts:11 注释与 :88-96 未传 owner；series.ts:89-99 同样未传 owner，但 :79 已拿到作者 mid；ugc() 本身支持 owner（video-common.ts:34,57）
  - 建议：series 每页已有 mid，可加一次 x/space/wbi/acc/info（或 nav）取 uname 后传给 ugc；season 需要先从 archive 的 mid 取，收益低可维持留空
- **[low/small]** passiveBuffer 未按 lane 过滤（当前仅 xhs:explore 声明 passive，同 lane 串行所以暂未出问题）
  - 来源：`docs/risk/crawler-risk-control.md:611-612`
  - 证据：packages/crawler/src/passive/buffer.ts:4-5 键只有 (platform, endpoint, 规范化 URL)，无 lane 维度；capture.ts 只在调用方持有 lane 时绑定 tab
  - 建议：在新增第二个 passive 渠道前补 lane 维度（PushInput 增加 lane 并进键），或直接把该条改成「等第二 passive 渠道再加」的决策注记
- **[low/small]** P1 被动采集仍需实机验证：xhs:explore 手动刷新是否真命中 passiveBuffer（未命中会走页面 SSR 兜底）
  - 来源：`docs/risk/crawler-risk-control.md:374-375`
  - 证据：文档 P1 写明「实机验证仍需重启应用后用真实页面跑一次」；CLAUDE.md TODO 仍列「xhs:explore 手动刷新命中 passiveBuffer」未勾选；passive 实机回归无提交记录
  - 建议：起桌面实例，手动刷新 xhs:explore，记录 passiveBuffer 命中日志/条数；命中后把 TODO 勾掉并写进 docs
- **[low/small]** 尺寸预取与显示未合并（sizeCache 只存尺寸，图片显示仍走独立下载）
  - 来源：`docs/ui/ui-conventions.md:253-255`
  - 证据：packages/resolve/src/utils/img-size.ts:89 sizeCache 仅存宽高，唯一消费方是 packages/resolve/src/platform/weibo/client.ts:11 的 fillImageSizes；packages/ui/src/renderers/atoms/MediaImage.tsx 完全不用 img-size
  - 建议：在回退路径把 Range 探测与首个字节块共享（或直接放弃预取，用 CSS aspect-ratio 占位）——先量化一次是否值得
- **[low/small]** CSS @layer 声明层序未做（仍靠 styles.css 的 @import 顺序 = 层叠顺序）
  - 来源：`docs/ui/ui-conventions.md:336-341`
  - 证据：apps/desktop/src/styles.css:13-29 只有按顺序 @import，文件头 :31-34 明确「顺序就是层叠顺序」；仅 apps/desktop/src/styles/10-tokens.css:441 有一个局部 @layer base
  - 建议：按文档半天方案在入口声明层序；⚠️ 10-tokens 只包选择器块，@theme/@keyframes/reset 留顶层
- **[low/small]** Radix 补丁升级未做（dialog 1.3.0→1.3.1、dropdown-menu 2.2.0→2.2.1，player 的 ^2.1.6 未对齐）
  - 来源：`docs/ui/ui-conventions.md:342-343`
  - 证据：bun.lock:330 解析 @radix-ui/react-dialog@1.3.0、:336 解析 @radix-ui/react-dropdown-menu@2.2.0；packages/player/package.json:11 仍是 ^2.1.6（desktop 已是 ^2.1.25）
  - 建议：bun update 两个补丁版本并把 player 声明对齐；升级后跑一次 tsc + 弹窗/菜单手测
- **[low/small]** CLI --log <域> 开关未实现，调试日志仍需 RSS_LOG=1 全开
  - 来源：`docs/ops/commands.md:173`
  - 证据：apps/cli/src/main.ts:116-120 全局选项只有 --browser/--no-browser/--via-service/--endpoint，无 --log；apps/cli/src/host/log-shim.ts:10 只读 RSS_LOG 决定全局 log=0/1；@amoeba/log 本身已支持 log:<域>（packages/log/src/env.ts:10-17）
  - 建议：给 CLI 加一个可重复 --log <域>，在 log-shim 建 store 时写入 log:<域>="1"（并在 env 命令里显示当前域开关）
- **[low/medium]** 四个直播渠道仍各写一套多房间抓取循环，factory 里没有 fetchRooms
  - 来源：`docs/audit/refactor-candidates.md:65`
  - 证据：packages/crawler/src/channels/bili/live.ts:91-97、douyu/live.ts:44-57、huya/live.ts:68-79、douyin/live.ts:103-112 各自 `roomIds.map(...catch 跳过)` + `if (!ok.length) throw 全部房间拉取失败` + `fetchedAt`；packages/crawler/src/channels/factory.ts 只有 serializeWithTotal:18 / apiFetch:35 / apiFetchItems:55 / makeApiChannel:97 / apiFetchMore:137，无 fetchRooms
  - 建议：在 factory.ts 加 `fetchRooms(roomIds, fetchOne, key)` 并保留「全失败才抛」护栏；douyin 的主页解析留在调用点。四个文件逐个替换，改完跑 bili-popular/twitch-live 等现有 check。
- **[low/medium]** douyin stream_data 键名变更时主路径静默返回空，降级链多 2 RTT 且可能降画质
  - 来源：`docs/audit/findings.md:87-88`
  - 证据：packages/resolve/src/platform/douyin/stream.ts:111-117 固定读 live_core_sdk_data.pull_data.stream_data；键名变化后 parseJsonSafe 为空，走 flv_pull_url 兜底再降 reflow/HTML。
  - 建议：解析前做多候选键探测；至少埋日志区分「字段缺失」与「无流」。
- **[low/medium]** governor 仍把 sso.douyin.com 算进 douyin 平台冷却，纯 HTTP 扫码会被冷却挡住
  - 来源：`docs/audit/findings.md:39-42`
  - 证据：packages/host/src/net/governor.ts:259-279 platformOf(host) 无白名单、588-601 按平台直接 reject；packages/resolve/src/platform/douyin/login.ts:94 走 appHost.http.request 未声明 policy，platform 表 douyin.com（packages/platform/src/index.ts:60-66）覆盖 sso 子域。login.ts:294-309 有浏览器回退兜底，故桌面可用但会多拉起 interactive Edge。
  - 建议：给登录域加冷却豁免（policy.cooldown:false 或 sso.* 白名单），与浏览器登录路径的豁免语义对齐。
- **[low/medium]** R14：进程级单钩子与门面 last-writer-wins（provider / setHostCaps）无回收
  - 来源：`docs/architecture/system/05-risks.md:26`
  - 证据：packages/resolve/src/platform/credentials.ts:25-30 只有模块级 lookup，后注册覆盖；packages/host/src/runtime.ts:112-137 setHostCaps 整体覆盖 _http/_browser 等，无 dispose。生产单服务实例下概率低。
  - 建议：至少给测试/多实例场景提供 dispose 或按实例注册；短期在注释和检查脚本里明确「仅单实例」。
- **[low/medium]** 退订级联仍是多次独立写，任一失败会留下部分残留
  - 来源：`docs/architecture/system/05-risks.md:130`
  - 证据：packages/core/src/data-layer.ts:1134-1168：repo.remove → store.clear → content+body 一次 batch → reading.deleteBySubscription 各自独立，后两步失败只记日志/静默。
  - 建议：把退订的订阅行与内容/正文/reading 合并成一个可回滚的批（或加补偿重试），失败时至少进诊断可见。
- **[low/medium]** 9 个公共渲染提示字段（aspectRatio/width/height/bitrate/streamingFormat/isLiveNow/lang 等）在本仓仍无生产者
  - 来源：`docs/architecture/system/02-contracts.md:185`
  - 证据：packages/core/src/processing/deserialize.ts:155-162 全部回读、packages/xml/src/serialize.ts:178-181 写出，但 packages/crawler 与 packages/resolve 全仓 grep 无赋值点；非 social 条目恒走 fallback。
  - 建议：要么让渠道真的产出（社交流/图文），要么按 R18 口径删掉无生产者的字段，别留「预留」。
- **[low/medium]** 缺失 url 被解析成空串，与「字段不存在」不可区分
  - 来源：`docs/architecture/system/02-contracts.md:187`
  - 证据：packages/xml/src/xml-parser.ts:47-65 asLink 对缺失值返回 ""，packages/core/src/processing/deserialize.ts:143 直接赋给 url（string? 却拿不到 undefined）。
  - 建议：asLink 区分缺失与空值，deserialize 只在有 href 时写 url；下游按 undefined 判空。
- **[low/medium]** publishedAt 只到秒且晚于现在+1 天的值被丢弃
  - 来源：`docs/architecture/system/02-contracts.md:189`
  - 证据：packages/core/src/processing/deserialize.ts:147,406-410（tryEpoch 上限 now+1d）；packages/core/src/types/query.ts:10 无 id tie-break，同秒条目排序不稳定。
  - 建议：契约上接受（预约发布沉底是刻意的），但补一个 id tie-break；若要保真，XML 侧加 `tpl:publishedAtMs`。
- **[low/medium]** 同档多线路没有 failover（按 rate 去重后只留第一条）
  - 来源：`docs/architecture/system/00-overview.md:169`
  - 证据：packages/player/src/hooks/useStreamSelection.ts:62-71 以 rate 为键首个胜出，丢同档其余线路；切档也只按 rate 找第一条（:73-79）。
  - 建议：同档保留多条候选，起播失败时在同 rate 内换线路；或在解析侧保证同 rate 只有一条。
- **[low/medium]** 凭证仍是扁平 cookie 字段（bilibiliCookie/weiboCookie/xhsCookie/douyinCookie），结构化凭证对象未实现
  - 来源：`docs/platforms/login.md:128-129`
  - 证据：packages/core/src/types/settings.ts:85-98,124-127 只有四个 string 字段；无 expiresAt/refreshToken 等结构
  - 建议：若不打算做保活调度，可把该条改成明确决策；否则凭证对象至少需要 expiresAt + refreshToken 两个字段才有续期依据
- **[low/medium]** 抖音登录态关键词搜索（真正的直播/综合搜索）未调研也未实现
  - 来源：`docs/platforms/platform-notes.md:101-104`
  - 证据：packages/resolve/src/platform/douyin/discover.ts:12-14 明确 Live search/general search 匿名 2483，只有 :181 的 partition/search 在跑；无 live/search 调用
  - 建议：按文档先决条件：专用小号 + 已登录 Edge 跑 1~2 次 CDP 被动探针，确认页面自然发 live/search 且能取 body，再决定是否实现
- **[low/medium]** YouTube 播放列表完整列表（InnerTube VL<playlistId>，100/页 + continuation）未实现
  - 来源：`docs/platforms/channels.md:335-336`
  - 证据：packages/crawler/src/channels/youtube/playlist.ts:4-7 明确只走官方 Atom feed、最多 15 条无翻页；全仓无 browseId=VL 的调用
  - 建议：仅当用户确实需要 >15 条时再补：新增 InnerTube browse VL + lockupViewModel 解析（channel.ts:63 已有 lockup 解析可复用）
- **[low/medium]** YouTube 直播分区只到栏目级，游戏级分区（/gaming 页 Top live games）未做
  - 来源：`docs/platforms/channels.md:337-338`
  - 证据：packages/resolve/src/platform/youtube/discover.ts 只有 Live 页 richShelf 栏目解析（slug hot/gaming/sports），无 /gaming 或频道 live tab 抓取
  - 建议：属二期增强，保持不做；若做，先补每个游戏频道 live tab 的 51 条抓取，再决定目录层级
- **[low/medium]** Twitch VOD / clip 路由未接（只支持直播与频道/分类列表）
  - 来源：`docs/platforms/channels.md:322-326`
  - 证据：packages/resolve/src/platform/twitch 只有 client.ts/live.ts/index.ts；无 /videos/<id>、/<login>/clip/<slug> 路由，normalizeTwitchLogin 对多段路径返回 null
  - 建议：二期再接：VOD/clip 路由必须排在频道名单段路径之前，避免把 VOD 当频道解析
- **[low/medium]** Twitch 聊天弹幕未接，宿主 ws 仍只能发 binary 帧（Twitch IRC 要 text 帧）
  - 来源：`docs/platforms/channels.md:329-330`
  - 证据：global.d.ts:142 WsLike.send(data: Uint8Array)，packages/host/src/node/node-ws.ts:18 直接 ws.send(Uint8Array)；全仓无 irc-ws/justinfan 代码
  - 建议：要接聊天先给 WsLike 增加 sendText（或 string 重载），再接 IRC justinfan 只读；否则保持不做
- **[low/medium]** Twitch 关键词搜索（频道/流）未做，文档标明依赖结构不稳的 persisted query、二期再评估
  - 来源：`docs/platforms/channels.md:331-332`
  - 证据：packages/resolve/src/platform/twitch 仅有流列表/分类/播放 token 查询，无 search persisted query
  - 建议：维持延期；真要做先探针验证 persisted query hash 可复现，再决定是否值得承担结构漂移风险
- **[low/medium]** 每平台传输策略 auto / browser-only 未实现
  - 来源：`docs/risk/crawler-risk-control.md:159,237`
  - 证据：文档明确标「未实现」；packages/core/src/types/settings.ts:48-58 只有 netLevel/netLevels/autoRefresh，全仓 grep browserOnly/transportPolicy 无命中
  - 建议：短期可不做（browser-only 不减请求）；若做，先定义消费方（哪些渠道允许切换）再动 settings 与 withBrowserOp 分流
- **[low/medium]** 用 Network.requestWillBeSent 逐平台确认 §3.11 的页面自然请求，仍未做（微博/斗鱼/虎牙仍是推断，抖音未确认）
  - 来源：`docs/risk/crawler-risk-control.md:369-370,524-527,556`
  - 证据：capture.ts:64 只在 xhs 路径消费 requestWillBeSent；§3.11 表格 :524-527 仍标「推断/未实测/未确认」，:556 明确只有小红书有源码证据
  - 建议：每个候选平台跑一次 lx-request-profile/lx-probe，记录页面是否自然发目标接口；确认前不要给这些平台加 passive
- **[low/medium]** 非 Windows 回退路径缺「图 URL → 字节」持久缓存（只有会话内 blob Map）
  - 来源：`docs/ui/ui-conventions.md:251-255`
  - 证据：packages/ui/src/renderers/atoms/MediaImage.tsx:48-69 proxyCache 只是 Map + BLOB_CACHE_MAX=300，进程结束即丢；无索引/磁盘缓存
  - 建议：桌面已走 WebView2 原生注入，收益只在非 Windows 回退；若做，优先用宿主 storage/KV 存字节并按 URL 哈希，别自己写文件缓存
- **[low/medium]** 浮层退场（Dialog/Menu/Toast）与 Accordion 高度过渡未做
  - 来源：`docs/ui/ui-conventions.md:344-346`
  - 证据：apps/desktop/src/styles 下 grep @starting-style/interpolate-size/grid-template-rows: 0fr 无命中；浮层样式在 70-overlays.css 只有静态过渡/动画，无退场编排
  - 建议：用 CSS @starting-style + transition-behavior: allow-discrete 做退场，受 data-motion 三档控制；Accordion 用 interpolate-size 或 grid 0fr→1fr
- **[low/large]** mpv 外部播放器接入（M0 spike / M1 launch / M2 IPC）完全未做
  - 来源：`docs/playback/mpv.md:181-194`
  - 证据：global.d.ts 无 player/PlayerHost，packages/host 无 mpv 代码；apps/cli/src/commands/play.ts:26 仅在 DASH 不可开时打印「mpv 落盘 .mpd 方案见 docs/playback/mpv.md」；git log --grep=mpv 只有调研文档提交 d2183aa
  - 建议：先做 M0 的 9 项 spike（尤其 SegmentBase MPD 与 osd-overlay），确认后再落 appHost.player 门面；不要先写 UI 开关


## stale（文档过期，待改）（8）

- **[medium/small]** 「原生分支点重试不重载媒体」已不成立：错误态会把 VideoShell 卸载，重试即重挂并重设 src
  - 来源：`docs/architecture/system/03-flows.md:268`
  - 证据：packages/player/src/PlayableMedia.tsx:389-409 playError 时整块返回 MediaState（VideoShell 卸载），:418-436 重试后重新挂载 VideoShell；src 写入在 packages/player/src/VideoShell.tsx:69-73 的挂载 effect，因此会重新加载。原结论只适用于「VideoShell 保持挂载」的假设。
- **[low/trivial]** 「无生产者的 latent 丢字段」描述已过期：raw 已有渠道产出，Live.quality 字段已删除，article.media[] 已双向透传
  - 来源：`docs/audit/findings.md:22-24`
  - 证据：packages/crawler/src/channels/weibo/hot.ts:50、apple/search.ts:45、apple/chart.ts:59、douyin/trend.ts:38 都写 Item.raw（serialize.ts 不写、crawler 内也无读者）；packages/xml/src/types.ts:155-156 明示 quality 字段已删；packages/xml/src/serialize.ts:159-196 写全部 media:content，core/processing/deserialize.ts:535-539 全部读回。
- **[low/trivial]** 「reading 调用端多以 void 发出、失败不可见」已部分过期：已读/星标/批量已读现在有 catch+回滚+toast
  - 来源：`docs/architecture/system/02-contracts.md:88`
  - 证据：现状：apps/desktop/src/store/actions/reading.ts:33-37,48-56,66-69 都有 .catch 回滚与错误 toast；只剩 setPosition/setScrollRatio（:91,109）是纯 void（可接受）。doc 描述与代码已不一致。
- **[low/trivial]** CLI「另有一条旁路 settings 读取」已过期：R15 已改走 core createSettingsRepository
  - 来源：`docs/architecture/system/00-overview.md:41`
  - 证据：apps/cli/src/info.ts:10,40-41 `createSettingsRepository(globalThis.appHost.storage)`，不再自己解析 settings blob；CLI 仍读自己的库（调试载具），但没有第二套 settings 实现。
- **[low/trivial]** 「私有收藏夹需登录」被列在剩余缺口里，但现在登录已实现且 favlist 已注入 cookie
  - 来源：`docs/platforms/channels.md:340`
  - 证据：packages/crawler/src/channels/bili/favlist.ts:39 已传 info.cookie，credentials provider 会注入扫码登录的 bilibiliCookie；登录能力已落地（docs/platforms/login.md:6）
- **[low/trivial]** 「预览弹窗里的房间只读、不能直接播」已过期：预览条目现在走 previewInfoFor + URL 兜底可正常播放
  - 来源：`docs/platforms/channels.md:259-260,342`
  - 证据：packages/core/src/data-layer.ts:695-704 previewInfoFor 给 preview:* 补默认 info；apps/desktop/src/views/library/MediaMain.tsx:87,406-408 预览网格用正常 MediaCard + usePlayerNav；apps/desktop/src/views/player/PlayerPage.tsx:68 注释说明预览条目走 url 兜底；docs/ui/ui-conventions.md:268-269 也写播放解析已支持
- **[low/small]** 「涉及浏览器或播放的路径没有自动化回归」已部分过期：播放侧已有 hook 级 check，浏览器/CDP 仍只有实机清单
  - 来源：`docs/architecture/system/00-overview.md:208`
  - 证据：scripts/check.ts:49-50 把 packages/player/src/hooks/useStreamSelection.check.ts、player-stats.check.ts 纳入 static 层；浏览器/CDP 确实仍无自动化（scripts/ui-probe.ts:8,17 依赖 9222 dev 实例）。
- **[low/medium]** serialize-contract.check 的盲区仍成立，但举例（quality/raw/media[]）已过期
  - 来源：`docs/audit/findings.md:43-45`
  - 证据：packages/core/src/example/serialize-contract.check.ts:46-56 只做「deserialize 读、serialize 不写」差集，确实查不到两侧都漏；但 quality 已删、media[] 已往返，raw 是 crawler 内部字段，原举例不再成立。


## decision（记录在案，不算待办）（21）

- **[low/trivial]** media-store.append 去重不合并的误报仍成立，未被本分支改回
  - 来源：`docs/audit/findings.md:66-68`
  - 证据：packages/core/src/store/media-store.ts:75-82 existingIds 过滤后直接追加；service-client/index.ts:354 复用同一实现。
- **[low/trivial]** 「扫码登录永久占死浏览器」误报仍不成立（30s 命令超时 + lane abort 仍在）
  - 来源：`docs/audit/findings.md:77-80`
  - 证据：packages/host/src/browser/channel.ts:15 CDP_CMD_TIMEOUT_MS=30_000；resolve/src/browser/scheduler.ts:24-27,42-51 lane 链 finally 释放；cdp.ts:115-124 登录走 login:* lane，abortTabs keepLogin 豁免。
- **[low/trivial]** 其余误报条目代码与文档一致，未被本分支重新引入（douyin 包裹层/推荐位、HLS 档位重锁、bili qnDescName、youtube chat poller、corrupt 单 key、danmaku %20、stripEm、maxBy）
  - 来源：`docs/audit/findings.md:49-76`
  - 证据：crawler/channels/douyin/live.ts:137-159 读 web_rid/room.title/owner 且无 is_recommend 过滤；player/hooks/useMediaStream.ts:104-108 重锁 max；resolve/platform/bili/live-play.ts:82-87 g_qn_desc；resolve/platform/youtube/client.ts:728-731 每次新建 poller；reading-repo.ts:59/subscription-repo.ts:61 单 :corrupt key；douyin/danmaku.ts:177 %20；bili/discover.ts:122-124 收紧正则；youtube/client.ts:400-405 maxBy 参数顺序。
- **[low/trivial]** mobile 冻结相关的存档项无人在动
  - 来源：`docs/audit/findings.md:91-93`
  - 证据：git log apps/mobile 最后一次 2026-10-23（e17a3a6，在 2026-10-26 冻结之前）；feat/heliu-redesign 与 master 的差异不含 apps/mobile 文件。
- **[low/trivial]** weibo/xhs 的「保活」实质是长效 cookie + 到期重登，无刷新接口
  - 来源：`docs/platforms/login.md:15-16,19`
  - 证据：SUB ~1 年、web_session Max-Age 1 年且无刷新接口；代码已有失效检测（packages/core/src/example/error-kind.check.ts:68 的 auth 分类，apps/desktop/src/store/actions/data.ts:254 刷新后提示需登录），但没有也不可能做自动续期
- **[low/trivial]** 抖音分区搜索只按分区名匹配，主播名与三级词（如「美食」）返空的局限
  - 来源：`docs/platforms/channels.md:311-314`
  - 证据：packages/resolve/src/platform/douyin/discover.ts:25,202,283 已写明「上游只认分区名 + 本地分区树匹配」；platform-notes.md:108-109 记录真实 Edge 复核：搜索本身需登录，browser 模拟解不了
- **[low/trivial]** 虎牙搜索不可分页（start 参数实测无效），只取首页、不声明 Pageable
  - 来源：`docs/platforms/channels.md:315-316`
  - 证据：文档记录 start=0 返 20 条、start>=20 返同一批 40 条；crawler 侧未声明 Pageable，属接口能力上限而非漏实现
- **[low/trivial]** B站「稍后再看」刻意不接（私有数据）
  - 来源：`docs/platforms/channels.md:339-340`
  - 证据：文档明确写「私有数据，不建议接」；crawler 无 watchlater 渠道
- **[low/trivial]** 自定义协议 media:// 明确不做（Tauri responder 仍要完整 body、绕开 Chromium 缓存、Android Range 有缺陷）
  - 来源：`docs/ui/ui-conventions.md:243-247`
  - 证据：文档写明两条替代路线都不做及理由；apps/src-tauri/tauri.conf.json 无 media 自定义协议；MediaImage 保留 blob 回退
- **[low/small]** view.total 仍只报已加载/本地筛选条数，渠道 total 写入 totals 但无 UI 读者
  - 来源：`docs/audit/findings.md:94`
  - 证据：apps/desktop/src/store/selectors.ts:194 total=list.length；views/library/MediaMain.tsx:288、ArticlePane.tsx:121 用 view.total；store/actions/data.ts:126 写 state.totals 但全仓无读取（只有 dl.totalOf 在数据层内部）。
- **[low/small]** 其余刻意暂缓项仍如文档：weibo 首次翻页重拉首页、removedSubs 墓碑无界、resolveKind 的 enclosure→audio 覆盖
  - 来源：`docs/audit/findings.md:20-21,89-90`
  - 证据：crawler/channels/weibo/user.ts:68-79 sinceId 为空时先 fetchItems 取 lastMid；core/data-layer.ts:237 removedSubs Set 只 add/delete；core/processing/deserialize.ts:58-79 顺序为 tpl:kind > audioFromEnclosure > ctx.kind。
- **[low/small]** 微博无纯 HTTP 扫码登录，weiboScanLogin 走 CDP 浏览器路径
  - 来源：`docs/platforms/channels.md:317-319`
  - 证据：packages/resolve/src/platform/weibo/login.ts 走 passport 页 CDP 二维码轮询；文档写明冷 cookie 几分钟失效、settings.weiboCookie 空按匿名，属已选定的实现方式
- **[low/medium]** core cursorMoved && addedCount===0 → ended 的语义仍刻意保留（两难）
  - 来源：`docs/audit/findings.md:36-38`
  - 证据：packages/core/src/data-layer.ts:887-889 原逻辑；channelHasMore===true 时已豁免（885-886）。
- **[low/medium]** 「不能删的兼容层」与 settings 预留字段仍成立
  - 来源：`docs/audit/findings.md:124-131,152`
  - 证据：apps/cli/src/info.ts:18,26-28 仍以 roomId 建直播订阅；apps/desktop/src/dev/seed.ts:43-52 info:{} + rss:hn；crawler/register.ts:146 注册 DouyinUserLiveChannel，DiscoverPage.tsx:105-108 用 live:*:user 判入口；deserialize.ts:173 contentFormat 兜底；core/types/settings.ts:29,43,71 的 viewMode/startMuted/defaultQuality 仍无消费者。
- **[low/medium]** 渠道能力用 `in` 谓词运行时探测，缺失时静默不可用（按钮消失/预览退化）
  - 来源：`docs/architecture/system/02-contracts.md:57`
  - 证据：packages/crawler/src/index.ts:140-142 等 isXxx 谓词即设计（00-overview.md:166「一切皆 RssChannel，渠道是纯描述」），文档写明代价并只要求人工核对。
- **[low/medium]** 仓库里存在不可构建的第二套桌面 UI（apps/new_desktop 原型）
  - 来源：`docs/architecture/system/05-risks.md:100`
  - 证据：docs 明说它「不在 workspaces、不被 scripts/tauri.ts 引用」，只作界面参考。
- **[low/medium]** `useLatestOnly` 只丢弃不取消；45s 超时只拒绝外层 Promise
  - 来源：`docs/architecture/system/05-risks.md:174`
  - 证据：packages/player 无关；apps/desktop/src/lib/useLatestOnly.ts:25-27 注释说明 appHost.http 无 abort；05-risks §7.1:174,179 明确列为有意决策，远端模式已用 job cancel 兜住（data.ts:206-212）。
- **[low/large]** xhs:explore 的 prepend 判定仍只识别纯前插/纯追加（刻意保留）
  - 来源：`docs/audit/findings.md:25-28`
  - 证据：packages/crawler/src/channels/xhs/explore.ts:152-164 首条 id 比较 + store.append 按 id 去重兜底，注释已写明已知上限与实测尾部追加。
- **[low/large]** `globalThis.appHost` 仍是隐式全局契约（不参与 import 图，靠初始化顺序）
  - 来源：`docs/architecture/system/05-risks.md:96`
  - 证据：docs 明确作为保留破例：00-overview.md:64、CLAUDE.md 硬契约「appHost 全局注入」；readme 与 05-risks §2 均写「剩余的是隐式全局契约」。属刻意设计，不是待办。
- **[low/large]** mobile 刷新错误被吞、PlayableMedia 不传 streams（播客 feed 直链不可用）
  - 来源：`docs/architecture/system/03-flows.md:494`
  - 证据：代码仍如此（apps/mobile/src/App.tsx:213-218 只传 resolve；store.ts 刷新 .catch 吞错），但 mobile 已于 2026-10-26 冻结（00-overview.md:23,40；CLAUDE.md），不为它做适配/回归。
- **[low/large]** Twitch 登录（OAuth「我的关注」）明确不建议近期做（需注册应用）
  - 来源：`docs/platforms/channels.md:331-332`
  - 证据：文档写明需注册应用、不建议近期做；代码中无 twitch 登录/OAuth 路径，Twitch 只走匿名 GraphQL



## 下一批建议（按收益/风险排序）

1. **A0 browser-sidecar 接 BrowserProcessExited**：浏览器崩溃/OOM 后 sidecar 不自愈，长跑服务
   后续所有浏览器渠道失败。只对浏览器进程退出回调，别用泛化 ProcessFailed。
2. **A1 服务端 diagnostics 归位 core**：clearAll 要取消在途 job、挂 removedSubs 墓碑，
   否则「清除后内容复活」。
3. **A4 取消/超时走 abortTabs**：被放弃的刷新仍占浏览器 lane（op:<platform>）。
4. **A0b runJob 用 abort race 结算**：cancel 后 job 条目立即消失（当前有界但会挂到操作结束）。
5. **B1–B4 性能**：patchMany、readingRecords 按 key 取、hydrate 复用 reading map、
   /v1/state 按 rev 缓存（含 gzip）。
6. **A-1 / A5 数据完整性**：B站收藏夹/合集会员标记（建议接受缺口并写清）、YouTube 频道
   author/duration。
7. **R13–R17 风险登记**：release-only 巡检缺口、cookieSnapshot 无版本、抓取浏览器无 lease、
   FLV 分支不带 headers、resolveDetail 零校验边界。
8. **8 条 stale 文档**：逐条改掉（本轮已改 RSSHub 那条）。

> 平台产品缺口（抖音搜索/登录、YouTube 播放列表与游戏分区、Twitch VOD/clip/chat、B站账号、
> bili 自动保活）属于新功能，不列入「收尾」；立项时看 docs/platforms/channels.md。
