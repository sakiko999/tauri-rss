# 平台现状与坑

> 从 `CLAUDE.md` 迁出（2026-10-21）。这里是各平台**实测行为与踩坑**的正文；
> `CLAUDE.md` 只留每个平台一两行结论。深挖文档：
> YouTube 播放解析 → `docs/platforms/youtube.md` · Twitch → `docs/platforms/twitch.md` ·
> 小红书签名 → `docs/platforms/xhs-signature.md` · 登录保活 → `docs/platforms/login.md` ·
> 能力缺口 → `docs/platforms/channels.md`。

## bilibili

- **UI 显示名统一「B站」**（2026-10-18）：平台标签、渠道名、账号页/引导/诊断文案都用
  「B站」；仅渠道 key（`bili:*`）、URL、API、代码标识保留 bilibili。
- **wbi 签名零登录可复刻**：`GET /x/web-interface/nav` 未登录（code:-101）仍返回
  `data.wbi_img`，无需 cookie/puppeteer，纯 `MD5(排序参数&wts&mixinKey)`。
  换位表 `MIXIN_KEY_ENC_TAB` 只在 `resolve/platform/bili/client.ts` 一处，`signWeb` / `signSpace` / 直播 / 视频 / 广场共用。
- **bili:dynamic**（`channels/bili/dynamic.ts`）：`GET /x/polymer/web-dynamic/v1/feed/space?host_mid={uid}`
  （⚠️ 非 dynamic_new——那个返回关注流）。**需登录 cookie**。转发展开 `orig`
  （⚠️ `module_dynamic` 在 `orig.modules.module_dynamic` 下，非 DynModule 层级）。
  实测 uid：半佛仙人 37663924（⚠️ 37883317 是「DILI念」勿用）
- **直播档位按实际值标注**：B 站对访客降档——匿名请求 `qn=10000`（原画）实测只给
  `current_qn=250`（超清），且多档请求会收敛到同一值。故读 `current_qn` 标注并按实际值去重
- ✅ **按分区列房**（2026-10-22，渠道 `bili:live:areas` 目录 + `bili:live:area` 列房）：
  `GET xlive/web-interface/v1/second/getList?platform=web&parent_area_id=&area_id=&sort_type=online&page=`
  **需登录态**——wbi 签名 + buvid3 之外还**必带 `w_webid`**（任意 live 页 HTML 里的
  `"access_id"`，短时效 token，`discover.ts` 模块级缓存 + -352 逐出重取）；
  匿名实测一律 `-352`（渠道翻译成「需要登录」文案）。20 条/页 + `has_more` 翻页。
  分区树 `Area/getList` 匿名可用（顶层条目 `areaId=0` 即整区列房）。
- ⚠️ **会员/付费字段各接口不一致**（2026-10-26 实测，7 个 `bili:user_video` 订阅）：
  - `space/wbi/arc/search`（`bili:user_video`）：vlist **没有 `rights`**，充电专属只在
    `is_charging_arc`（bool）——已修（`ugc({ charging })`）。
  - `popular` / `ranking`：vlist 带 `rights`（含 pay/arc_pay/ugc_pay），正常。
  - `favlist`（`x/v3/fav/resource/list` 的 medias）与 `season`/`series`（archives）：
    **都没有 `rights`**，充电专属仍漏标。列表侧没有可用字段——`is_upower_exclusive`
    只存在于 `view` 详情接口；`seasons_archives_list` 对充电视频返回的 `ugc_pay` 也是 0。
    要补只能按条目懒查详情（成本高，且卡片角标是抓取时快照，详情补标回不到列表）。
  - 数据侧参考：该用户 450 条 UP 投稿中 47 条 `is_upower_exclusive=true`，其余 `rights.*` 全 0。
- ✅ **UP 投稿翻页**（2026-10-27，`bili:user_video`）：`space/wbi/arc/search` 的 `pn` 递增
  （`ps` 固定 30），`data.page.count` 给真实总数。渠道原先写死 `pn=1` —— 实测 7 个订阅里
  6 个正好卡在 30 条上限（该用户 450 条投稿只看得到前 30 条）。现在
  `pageable: { first: 2, step: 1 }`，登录态连翻 3 页验证无重复、`hasMore` 按 `count` 判。
- ✅ **搜UP主**（2026-10-16，`searchBiliUsers` / 渠道 `bili:user`）：
  `search_type=bili_user` + **匿名 buvid3/4**（`biliClient.getJson(..., {buvid:true})`，
  裸请求 412）。与 `bili:user_video`（uid 投稿订阅）配对，走「添加订阅 → UP主 / 频道」
- ✅ **入站必刷**（2026-10-18，渠道 `bili:precious`）：
  `GET /x/web-interface/popular/precious` + 站内 Referer，匿名实测 98 条，无需
  wbi/cookie。原 RSSHub `/bilibili/precious` 是同一端点，已收编进 crawler；
  RSSHub 具名渠道（`rsshub:bili:*` / `weibo:*` / `youtube:*`）随之删除，只留
  `rsshub:feed` 泛用路由
- ✅ **合集 / 视频列表 / 收藏夹**（2026-10-20，均匿名可读 + `Pageable`）：
  `bili:season` 走 `x/polymer/web-space/seasons_archives_list`，**必须带 Referer**
  `https://www.bilibili.com/`（否则 `-352`），`mid` 可为 0，30 条/页；输入可粘视频
  链接（先读 `x/web-interface/view` 的 `data.ugc_season.id`）。
  `bili:series` 走 `x/series/archives`，⚠️ **分页参数是 `pn`/`ps`**（传
  `page_num=2` 会静默返回第 1 页，翻页永远重复首页），固定 20/页；`mid` 先由
  `x/series/series?series_id=` 的 `meta.mid` 得到，不要求用户输入。
  `bili:favlist` 走 `x/v3/fav/resource/list`（`fid` 与 `media_id` 同值），公开夹匿名、
  私有需登录，`attr != 0` 跳过，20/页。合集/系列条目没有作者名（archives 只带 `mid`）。
- **扫码登录**：纯 HTTP（`passport.bilibili.com` qrcode/generate + poll），不需
  `appHost.browser`。⚠️ 上游只给**二维码内容 URL**，编码在 UI 侧（`QrImage`）；
  `biliScanLogin` 必须复用已生成的码，否则它会自己再生成一个、轮询的 key 与你展示的不是同一个
- ⚠️ **扫码登录的 cookie 不含 buvid3/buvid4**（passport 只 Set-Cookie `SESSDATA` /
  `bili_jct` / `DedeUserID` / `DedeUserID__ckMd5` / `sid`，实测 5 项）→
  `biliClient.getJson({ buvid: true })` **即使带了 cookie 也要补匿名 buvid**，
  否则 `getListByArea`（直播热门）/ space 系接口直接 `-352`。曾写成「有 cookie 就跳过
  buvid」，症状是**扫码登录后**直播热门与直播播放解析从可用变成 352（全局 L0 也照报
  —— 那是平台返回码，不是冷却）。回归：`bili-buvid.check.ts`
- ⚠️ **space 系 wbi 接口（`/x/space/wbi/*`）2026-10 起收紧**：只带 wbi 签名 + buvid
  会被 WAF 间歇 **HTTP 412** / `-352`。必须 `biliClient.signSpace()` —— 在 signWeb
  基础上补 `dm_img_list` / `dm_img_str` / `dm_cover_img_str` / `dm_img_inter`
  客户端指纹参数（**参与签名**；形态对即可，RSSHub `addDmVerifyInfo` 同款）。
  且**必须带登录 cookie**：匿名 space 已基本不可用；`bili:user_video` 曾漏传
  `info.cookie`，登录用户也永远匿名 → 刷新报 412（本条修复）。回归：
  `bili-space-sign.check.ts`；真机验证登录态 `bili:user_video` 刷新。

## 斗鱼 / 虎牙 / 抖音

- **douyu `rate` 是档位 ID 不是清晰度** —— 按 rate 降序会把原画 2K60 排到末尾。
  保留服务端 multirates 顺序
- **huya**（`resolve/platform/huya/play.ts`）：数据源 `mp.huya.com/.../profileRoom` JSON API，
  flv+hls 双协议 × 多 CDN × 全档位，`multiLine[].url` 已含签名（`buildAntiCode` 已删）。
  ⚠️ **低档位只产 HLS**（`ratio=` 切档）；`ratio=` 低档 flv.js 播几秒断
- **douyin**（`crawler/src/channels/douyin/live.ts`；enter/stream_url 在 `resolve/src/platform/douyin/stream.ts`）：enter API ABogus 签名 → `stream_url`。
  ⚠️ `liveStatus ==2` 才是直播中（`==4` 是 roomId 一次性，需换 webRid）
- ✅ **抖音号可直接当 web_rid 用**（2026-10-18 实测）：`live:douyin` 的 `roomIds`
  支持用户抖音号（`unique_id`，如 `pvcyinse`）/ 数字 short_id / 直播间 URL 的
  `<web_rid>`；enter API 会解析到当前房间，**离线也返 offline 条目**，开播后刷新变
  live。⚠️ 不能填长 `room_id`（`4001038`）。`roomIds` 会自动归一 `@抖音号` /
  `抖音号：xxx` / `live.douyin.com/<id>` 链接。
- ✅ **主页链接也走 `live:douyin`**（2026-10-19）：`roomIds` 接受
  `www.douyin.com/user/<sec_uid>`，先经匿名资料 API
  `aweme/v1/web/user/profile/other/?sec_user_id=...`（a_bogus+ttwid）换
  `unique_id`/`short_id`，再当 web_rid 走 enter。`live:douyin:user`
  （`channels/douyin/user.ts`）**保留给存量订阅**，新入口不再列出 —— 统一到
  `live:douyin` 后，新订阅才能和搜索添加/「并入已有订阅」共用同一个渠道。
- ✅ **抖音扫码登录**（2026-10-16，`resolve/platform/douyin/login.ts`）：纯 HTTP 走
  `sso.douyin.com` 通行证（get_qrcode → check_qrconnect 轮询 → redirect_url 落
  cookie），**实测被 JS 挑战页拦**（warmup 只给 `__ac_nonce`，无 JS 执行过不了
  `__ac_signature` 挑战 → get_qrcode 返 HTML）→ 自动回退 **CDP 浏览器路径**
  （douyin.com 点登录读弹窗 canvas 二维码，成功判据 = `sessionid` cookie）。两层
  都封装在 `douyinScanLogin`，channel 只做薄委托。⚠️ 社区实现靠 curl_cffi TLS
  指纹；宿主 reqwest 无伪装，纯 HTTP 层保留是为了协议变化时可能直连。
  ⚠️ **软封锁会返「假码 + 真 token」**（2026-10-30 实测）：`get_qrcode` 不报错，
  只是 `qrcode` 是一张抖音 logo 占位图，轮询永远等不到 status —— UI 上表现为
  「二维码是错的」。纯 HTTP 层因此加了一道探活（`check_qrconnect` 必须回
  1/2/3/5），假 token 直接抛错回退浏览器。浏览器路径同理：弹窗里同时有 40×41 的
  logo 和 512×512 的真码，`images:false` 下 `naturalWidth` 恒 0，判据改为**解码
  PNG 头尺寸**取 ≥200 的最大一张。
- ~~抖音登录 cookie 没有任何抓取/播放路径消费~~ **已接通（2026-10-21）**：登录成功写
  `settings.douyinCookie`，经 credentials provider 进入 `douyinCookie()`（抓取/播放/
  弹幕共用），登录档位（原画）待真机验证。真正的关键词搜索
  `aweme/v1/web/live/search` / `general/search/stream` 匿名返回 2483，**需要登录但未做
  调研与开发**；现有 `live:douyin:search` 只是匿名分区搜索。不要直接把主账号 cookie
  接进自动化搜索（4031/限流/账号标记风险）；要做先在有登录态的 Edge 上用**专用小号**
  做 1~2 次 CDP 被动探针，确认页面是否自然发 `live/search`、body 能否取到。
- **发现层**（分区/搜索，`resolve/platform/*/discover.ts`）：douyin 三路搜索只
  `partition/search` 匿名可用且只认游戏名级——但**顶层分区名恰是大类词**（舞蹈/音乐/聊天/
  二次元…），故 resolve 侧做「上游命中 ∪ 本地分区树 title 匹配」，0 → 20 条。
  ⚠️ **匿名搜抖音无解已用真实 Edge 复核**（路 1/2 仍 2483，搜索页被 verify-center 4031 拦）：
  登录硬门槛，**browser 模拟解不了**（xhs 是 TLS 指纹差异能解，抖音是账号门槛不能）。
  虎牙搜索/搜主播不可分页。✅ **抖音搜索渠道**（2026-10-18 调整）：
  `live:douyin:search` 本质是**分区搜索**（关键词 → 分区 → 列房），只认大类/游戏名，
  不搜主播/房间标题；`live:douyin:anchor` 已删除（本地过滤热门房间没有意义）。
  已登记进 `SEARCH_CHANNEL`（发现页/搜索面板的平台名显示「抖音分区」）；
  已知主播用 `live:douyin` + 抖音号/主页链接（发现页抖音卡片的「用户直播间」入口
  也预置 `live:douyin`）。缺口见 `docs/platforms/channels.md`

## YouTube（播放解析细节见 `docs/platforms/youtube.md`）

- 主力 client = **VISIONOS**（2026-10-21，链 = `VISIONOS → ANDROID_VR → WEB`）：
  免 POT，VOD 27 条 adaptive（avc1 全带 `initRange/indexRange`、**无 `n`/cipher**）、
  直播给 `hlsManifestUrl`。⚠️ 同批 5 条视频与 VR 对比 **status/最高档完全一致**（都 1080p），
  且**机房 IP 上同样被拦**（VR 失败的 6 条它也是 6/6 `LOGIN_REQUIRED`）——换 client
  救不了风控 IP，排前面只为跟上上游默认。⚠️ 原计划的 `WEB_EMBEDDED_PLAYER` 纯 HTTP
  复刻被 **embedder identity** 拦（补 `encryptedHostFlags`/cookies 仍 denied）。自检
  `packages/resolve/src/example/youtube-clients.check.ts`。
- poToken 与机房 IP 的完整结论见 `docs/platforms/youtube.md` §6；一句话：机房 IP 上真浏览器 +
  游客会话也被页面级 `LOGIN_REQUIRED` 拦，「读 URL 的 `pot=` / 读 JSON 的
  `serviceIntegrityDimensions`」两条取 token 路径均已失效。
- 渐进式只到 itag 18（360p）→ **视频 1080p 走 DASH**：adaptiveFormats 自拼 SegmentBase
  MPD（共享 `utils/mpd.ts`）。360p 不混进返回数组（默认选流会落 360p），DASH 装配失败才 fallback
- ✅ **搜频道**（2026-10-16，`searchYouTubeChannels` / 渠道 `youtube:user`）：InnerTube
  `search` + `params:"EgIQAg=="`（仅频道过滤）匿名可用（WEB client + visitorData），
  解 `channelRenderer`。与 `youtube` 渠道（channelId 订阅）配对
- ✅ **搜直播间**（2026-10-18，`searchYouTubeLive` / 渠道 `youtube:live-search`）：同端点
  + `params:"EgJAAQ=="`（直播过滤，实为 protobuf field 8=1），匿名返回 18~20 条且全带
  LIVE badge，解 `videoRenderer`。搜索添加「直播间」→ 落地 `youtube:live`（参数 videoId）
- ✅ **直播热门 / 栏目**（2026-10-20，`youtube:live-hot` / `youtube:live-category`）：
  Live 页 `browseId=UC4R8DWoMoI7CAwX8_LjQHig` 匿名返回栏目；实测布局是
  `richGridRenderer.contents[].richSectionRenderer.content.richShelfRenderer`（旧版
  直接 `richShelfRenderer` 也兼容）。`Live Now` 12 条、News/Gaming/Sports 各 12，
  **无 continuation**。client 固定 `hl=en`/`gl=US`（栏目名是解析依据），只认
  `thumbnailOverlayTimeStatusRenderer.text === "LIVE"`（Recent/Upcoming 因此为空）；
  观看数只取 `"N watching"`（`views`/`waiting` 不算）。整页 ~800KB → 5 分钟 Promise
  缓存（并发去重），见 `resolve/platform/youtube/discover.ts`。
- ✅ **播放列表**（2026-10-20，`youtube:playlist`）：官方
  `feeds/videos.xml?playlist_id=` 匿名可用，**最多 15 条、无翻页**；条目结构与频道
  feed 同构（复用 `entryToVideo`）。`RD`/`WL`/`LL`/`LM` 前缀拒收（动态/私有/需登录）。
  完整列表（InnerTube `VL<playlistId>`，100/页 + continuation）未做。

## 小红书（签名细节见 `docs/platforms/xhs-signature.md`）

- ⚠️ **`web_session` 不是登录标志**（2026-10-19 实测 + 社区复核）：小红书对**匿名访客**
  首次打开页面就会签发一个游客 `web_session`（伴随 `a1`/`webId`/`sec_poison_id` 等）。
  按它判断登录会出现「还没扫码就显示已登录」，并把游客 cookie 当成账号凭证写进
  `settings.xhsCookie`。登录判据 = 页面 `__INITIAL_STATE__.user.loggedIn === true`
  / 侧栏「我」入口 / `user_id` cookie（后两者兜底）。权威接口是
  `/api/sns/web/v2/user/me` 的 `data.guest === false && data.user_id`。
- 主分支**全 SSR，且 2026-10-22 起要求登录（匿名态已移除）**：所有 xhs 渠道先过
  `assertXhsLoggedIn`（登录页优先 → 页面 `loggedIn` → 侧栏「我」→ `user_id` cookie），
  未登录直接抛可操作错误，不再退回匿名 SSR / 匿名详情。**笔记详情必须带列表项的
  xsec_token**（`tpl:xsecToken` → `SocialItem.xsecToken` → `resolveDetail`）。
- 为什么移除匿名：匿名数据路径不可靠且形态各异 —— `xhs:user` 的 profile SSR 渲染卡片却把
  noteId 定向抹空（无链接、无稳定 id，旧实现只能生成 `anon-<hash>` 虚拟条目）；`xhs:explore`
  在带 `web_session` 的会话里 SSR 只给空壳；连续滚动还会累积风控（见下）。统一登录后
  只剩一条可验证的数据路径。
- ⚠️ **SSR 就绪 ≠ 列表就绪**（2026-10-22 实测）：登录态会话的 `/explore` 文档可能是
  **空壳**——`feed.feeds` 为 `[]`，列表由页面自己的 XHR 在导航后约 0.4–1.1s 填回
  `__INITIAL_STATE__`。被动采集取的是**文档响应体**，于是会拿到空壳、serialize 出 0 条 →
  core 报「本次抓取解析出 0 条」（不抛异常、console 无日志，只在错误表里可见）。
  修法 = `shared.ts` 的 `waitXhsListNonEmpty`：读 state 前先等列表非空；
  `fetchXhsPassivePage` 在**捕获体解析为空时同样回退读页面 state**（原来只在缓冲缺失时回退）。
- **匿名滚动翻页不可靠（2026-10-22 实测，匿名态已移除的历史依据）**：匿名访客 `/explore`
  首屏 SSR 在 headless 与 WebView2 下都正常（26–34 条）。滚动翻页：
  - **headless Edge**：首轮就撞 `error_code=300012`「IP存在风险」、`.fe-verify-box`、feed 归零；
  - **WebView2**：首轮能滚到 34 → 53 → 72 → 88 条，**同一 profile 连续第二轮**撞
    `error_code=300011`「账号异常」、`rejectUrl=…/api/sns/web/v1/homefeed` + verify。
  结论：**风控是累积的，与浏览器形态无关** —— 匿名翻页最多撑一两轮；这是移除匿名态的直接原因。
- **headless 无收益**：首屏条数与 headed 相同，UA 暴露 `HeadlessChrome`，内存也不省
  → 继续 headed + 隐藏窗口（现由数据服务侧 `amoeba-browser` WebView2 宿主承载，屏外窗口）。
- **渠道策略（2026-10-22）**：列表 / 详情都是**被动**——导航后读页面 `__INITIAL_STATE__`
  或 Network 捕获，不构造平台 API 请求。
  - `xhs:explore` 声明 `passive`（导航 + 读 SSR + 页面自然请求）；`fetchMore` 为滚动驱动。
  - `xhs:user` 刻意**不声明** `passive`：翻页要 interactive 滚动，不是纯导航采集；
    数据仍只读页面 state。
  - 登录判据统一走 `isXhsLoggedIn`（页面 `loggedIn` + 侧栏「我」+ `user_id` cookie），
    **不能看 `web_session`**（游客也有）；**登录页优先于登录位**（失效会话跳登录页时
    页面里的 `loggedIn` 可能是残留 true）。
  - `xhs:explore` 的 `fetchMore`（滚动驱动）。⚠️ 翻页**不能整页重载**：增量只能从页面累计的
    `feed.feeds` 里切，重载会让 state 回到首屏。判据只比 `pathname`（`shared.ts` 的
    `ensureXhsPath`，入口包成 `ensureXhsPageReady`）—— SPA 会往地址栏写 query，完整 `href`
    永不相等，用 `cdpNavigate` 自带的同址判据会每次都重载。⚠️ `feed.feeds` 是**扁平数组**
    （`flat()` 对它是 no-op），滚动加载的新条目**追加在尾部**（实测 862 → 915 → 968）；
    prepend 判断只是防御，不是常态。
  - 详情：登录态导航详情页读 `noteDetailMap`；撞登录页 / 未登录统一报「重新扫码」。
    补全失败（登录失效 / 风控 / `noteDetailMap` 空）**抛错并进入弹窗失败态**，不再
    静默回退摘要（core `resolveDetail` 重新抛出，列表内容仍照常显示）。
    游客/过期会话的登录墙只拦顶层导航（同源 `fetch` 带 `credentials:"omit"` 仍能读到
    `noteDetailMap`）——这只解释「为什么匿名详情不能当兜底」，该路径已随匿名支持移除。
    explore/user 的详情实现收敛在 `channels/xhs/shared.ts`。
  - 无浏览器（mobile / CLI）：`xhs:user` 可走 HTTP SSR（必须带登录 cookie，`requireXhsCookie`）；
    `xhs:explore` 直接报 `XHS_EXPLORE_NEEDS_BROWSER`（登录态 HTTP SSR 只给空壳）。
    显式空串（强制匿名）直接报「需要登录」，不回落 provider。
  - 策略层入口 = `shared.ts` 的 `fetchXhsList`：导航 → 等 SSR → 风控框 → **登录闸门** →
    读列表；SSR 列表读取统一走 `readXhsStateList` / `flatXhsStateList`（逐层解 `_rawValue`
    + flat）；`ensureXhsPath` 同址判据**同时校验 origin**（共享抓取 webview 可能停在别的域）。
    回归：`bun packages/crawler/src/example/xhs-strategy.check.ts`。
- 被动模式的 `fetchPassive` 对未登录用户会抛「需要登录」，不再返回 null 静默回退缓存。
- ⚠️ 登录态 SSR 的 JSON 混入 JS 表达式（`"noteDetailMap":new Map([])`）——
  `extractInitialState` 用**平衡大括号截纯 JSON** + 空容器归一
- ⚠️ **不要手拼 user_posted fetch**（页面内 `_webmsxyw` 只返回部分头 → 300011 风控）。
  `xhs:user` 分页是**滚动驱动**（浏览器路径），已加窗口化 + 验证码检测
- 签名方案当前**不在主分支**（`signApiHeaders` 直接抛错降级）；曾经的 `packages/xhshow/`
  fork 与 `feat/xhs-rustpython` 分支**在本仓库已不存在**（纯算法处于上游失效期，故维持全 SSR）。
  若要重启签名移植，参照 `docs/platforms/xhs-signature.md` 的 Python xhshow 0.2.0

## 实况图（Live Photo）：小红书 / 微博（2026-10-22 实测）

两家都不是服务端下发的系统级 Live Photo 容器，而是「静态图 + 一段 2–3s 短视频」两份独立
资源（iOS 那种 Live Photo 文件是客户端本地合成的）。**静态图就是 poster**，不要用视频首帧
替代；小红书那条的静态图不一定比视频分辨率高（实测同一条里也有 1080×1440 对 1080×1440）。

- **小红书**（只在**详情**里出现；`/explore` 的 noteCard 只有 cover，列表拿不到）：
  `imageList[i].livePhoto === true`，视频在 `imageList[i].stream.<codec>[0].masterUrl`。
  ⚠️ codec 键实测是 **`EF4`**（`EF5/EF6/EF7` 可能是空数组），**别写死 `h264`** —— 取第一个
  非空数组。`masterUrl` 带 `sign&t`，`backupUrls[0]` 不带签名。mp4、约 3s、无音轨、右下角
  有烧录 Logo（`WEB_LIVEPHOTO_19`）；非实况元素是 `livePhoto:false` + `stream:{}`，所以判定
  只能看 `livePhoto`。Web 通道拿不到无水印原片（那要 App 签名）。
- **微博**：`m.weibo.cn` 的 `pics[].type === "livephoto"` + `pics[].videoSrc`。
  ⚠️ 顶层 `live_photo[]` 与 `pics[]` **下标不对应**，普通图与实况混排时不能用它配对。
  桌面 `weibo.com/ajax/statuses/show` 是 `pic_infos.<pid>.type/video`，`video` 为
  `video.weibo.com/media/play?livephoto=…` 的 302 包装器（去 token 会现场重签，适合落库）；
  本体是 .mov（H.264/AAC、约 3s、几 MB），CDN 本次实测 `ACAO:*`、Range GET 不需要 Referer。
- **契约**：`SocialImage.liveVideo`（单值；poster 即 `url`），XML 走
  `media:content@tpl:liveVideo`。回归：`serialize-roundtrip.check.ts`（边界）+
  `packages/resolve/src/example/live-photo.check.ts`（两家映射）。
- **UI**：瀑布流封面加「实况」角标；详情里**点击才加载** `<video muted loop>`（不自动播，
  省流量），失败退回静态图。

## 视频帖：小红书视频笔记 / 微博视频微博（2026-10-30）

普通视频帖（区别于上面的实况图）的视频直链。契约 = `Social.video`（帖子级单值直链），
XML 走 `tpl:video`；详情弹窗用原生 `<video controls>` 直连播放。

- **小红书**：直链**只在详情页 SSR 里**（`note.type === "video"`；列表 noteCard 只有封面，
  拿不到流 → 视频天然是详情懒解析）。流在 `note.video.media.stream.<codec>[0]` 的
  `masterUrl`（带 `sign&t`）或 `backupUrls[0]`；codec 键是 `h264/h265/h266/av1` ——
  **必须按 h264 优先选**（参考实现把 av1 排最前，按 JSON 键序取会产出 AV1 mp4，WebView2
  解码不稳）。stream 缺失时回退 `video.consumer.originVideoKey` →
  `sns-video-al.xhscdn.com/<key>`。poster = `imageList[0].urlDefault`。
  实测（2026-10-30）：详情直链带站内 Referer → 206 / `video/mp4`。
- **微博**：直链就在**列表数据**里（`m.weibo.cn` container 的 `mblog.page_info`，
  `type === "video"`）→ 随抓取落库（快照会过期，失败退封面重试）。字段偏好：
  `urls.mp4_720p_mp4 > mp4_hd_mp4 > media_info.stream_url_hd/stream_url > mp4_ld_mp4 >
  hevc_mp4_hd`（hevc 是另一套解码支持，排最后）；封面 `page_pic.url`（`pics` 为空时
  兜底进 `images[0]`，否则卡片是「无图纯文字」）。实测（2026-10-30）：720p 直链带
  Referer → 206；**CDN 不支持 HEAD**（403），验证要用带 Range 的 GET。
- **防盗链**：两家都在 `VIDEO_REFERRERS`（`xhscdn.com` / `weibocdn.com` → 站内 Referer），
  Rust 在 MEDIA context 注入 → 原生 `<video>` 直连可播；**不能走 hls.js/dash.js**
  （XHR context 不注入 Referer，JS 也设不了）。
- **回归**：`packages/resolve/src/example/video-post.check.ts`（两家映射 + 流偏好）+
  `serialize-roundtrip.check.ts` 的 `Social.video` 往返。
- **UI**：卡片角标「视频」（瀑布流封面 / 混合流 MediaCard）；详情弹窗 `<video controls
  autoPlay muted>`（静音起播，可开声），失败退封面 + 重试。视频帖**刻意不进播放页/队列/
  短视频流**：那需要放宽 kind 门控（social 不可播）与新增 by-url 解析路由，按需另做。

## 时间戳单位

- ⚠️ **平台的 `time` 字段单位会变**，别无条件 `* 1000`。xhs 从**秒**改成**毫秒**后，
  旧代码把它放大 1000 倍 → 落到**公元 5 万年** → 按时间倒序时**永久钉在最前**
  （实测「全部」页前 12 条全是 social，本该置顶的直播被挤到第 112 位）。判别统一走
  `resolve/platform/xhs/client.ts` 的 `toEpochMs()`。⚠️ 秒/毫秒的判据方向相反，
  **别写成三元**（那条件我写反过两次，`xhs-time.check.ts` 就是为它留的）。
- ⚠️ **core 解析层有「未来时间」上限**（`tryEpoch`，现在 + 1 天）：上游给错单位会产出
  极端错值，`new Date` 照收不误，会污染排序 / `fmtAgo`（「22 万年以前」）/ `isToday`。
  宁可判 `undefined` 沉底。
- ⚠️ **直播没有 `publishedAt`**（实测 210 条 live 无一条有）→ `?? 0` 会把它们全沉底。
  `sortItems` 用 `publishedAt ?? fetchedAt` 兜底，否则直播永远进不了首屏窗口，
  `MediaMain` 的 `hasMix` 恒假 → **「正在直播」横滑轨从来不渲染**。

## Apple 播客

- 目录是**元数据源**：`apple:podcast-chart`（热门榜）/ `apple:podcast-search`（关键词）。
  产出 `kind:audio`，`url` = 该节目的 **RSS feed** → 接进既有 `rss:podcast`，不另造解析器。
  每集 enclosure **不在榜单里**，故榜单条目的 `stream` 留空。⚠️ **留空 ≠ 可播**：
  `isPlayableKind("audio")` 恒真，卡片会摆播放按钮，但 resolver 只认平台域名、feed 域名
  路由不上 → 点必碎（「该条目不指向可解析的视频链接」）。
  这批条目的主操作是 **`isFeedItem()`**（`kind:"audio" && !stream`，`Cards.tsx`）判出的
  「**在右侧列出单集**」：点开 → URL 变 `?open=<itemId>` → `dl.previewChannel("rss:podcast", {url})`
  拉一次该 feed（**复用播客渠道，不另造解析器**；`previewChannel` 不写缓存不落库）→
  **`MediaMain` 用与正常订阅同一套网格/卡片**列出单集，只把表头换成「返回 / 订阅该节目」，
  点一集直接播（单集带 enclosure 直链，`PlayableMedia` 走 `streams` prop 不解析）。
  ⚠️ 预览单集**不落库、不建订阅**，只活在 store 的 `previewDetail` 里；
  **`PlayerPage` 的 item 查找必须回退查它**，否则「找不到这条内容」。
  `rss:podcast` 的条目**必有 enclosure**（没 enclosure 的 item 在建 Audio 时就被丢），
  故 `isFeedItem` 不会误伤真正的单集
- ⚠️ **榜单不含 `feedUrl`**（旧 iTunes RSS 只给 `im:id`）→ 必须再 Lookup 一次换 feedUrl。
  Lookup 返回顺序**不保证**与请求一致，按榜单原序重排；**没 feedUrl 的条目直接丢**（只能显示不能订阅）
- ⚠️ **搜索渠道刻意不声明 `defaultInfo`**：发现页「可一键订阅」判据 `!!defaultInfo || 无必填项`，
  **空对象是 truthy** → 写 `= {}` 会让需要 `q` 的渠道被误列进去（同 `bili:search`）
- 端点：旧 `itunes.apple.com/{cc}/rss/toppodcasts` / `search?media=podcast`（**直接给 feedUrl**）/
  `lookup?id=` 全可用；新 `rss.applemarketingtools.com` **504**。均匿名，但要带 UA

## Twitch（细节见 `docs/platforms/twitch.md`）

- 公开 web Client-ID 的 **GraphQL**（`gql.twitch.tv/gql`）匿名可用 → `PlaybackAccessToken`
  （persisted query）→ `usher.ttvnw.net` HLS；官方 Helix 匿名 401，不走。
- ⚠️ **master 没有 `Access-Control-Allow-Origin`** → resolver 必须经 `appHost.http` 拉 master，
  把 **variant playlist URL** 交给播放器；master variant 顺序不是高→低，需按高度/带宽降序。
- ⚠️ **流列表翻页必须用 Android app 公开 Client-ID**（网页 ID 带 `after` 会 `IntegrityCheckFailed`）；
  `twitch:categories` 目录渠道已实现，VOD / clip / 聊天弹幕 / 关键词搜索 / 登录未做。

## cookie / 登录

- 登录态统一存 settings(`bilibiliCookie/weiboCookie/xhsCookie/douyinCookie`),消费经
  **credentials provider**(`resolve/platform/credentials.ts`):core DataLayer 与 CLI 入口
  注册同一 settings 快照,client 在调用点未显式传 cookie 时自动回落。显式**空串 = 强制
  匿名**(CLI `--kv cookie=` 依赖；xhs 会因此直接报「需要登录」)。旧「bilibili-cookie.ts
  本地手动占位 + skip-worktree」机制已移除(2026-10-21)。
  匿名行为：bili 视频列表稳定、直播 250 超清封顶；weibo 热搜列表可用但 user/词流需登录；
  **xhs 全渠道需登录（匿名态已移除）**；douyin 直播可用、原画档位需登录
- ⚠️ **抖音渠道前缀是 `live:douyin*`**：权威是 `@amoeba/platform` 的 `PLATFORMS` ——
  `douyin.prefixes` 同时登记 `live:douyin` 与 `douyin`，长前缀优先
  （`packages/platform/src/index.ts:113-126`）；core `cookieFieldFor` 只是查表包装。
- 恢复登录：扫码（scanLogin 写 settings）或在「账号与凭证」里手填 cookie 字段；
  **勿把真实 cookie 提交进仓库**（settings 落 SQLite，不进 git）
- ⚠️ **`clearCookies` 的域匹配必须按标签边界**（2026-10-20）：裸 `endsWith("xiaohongshu.com")`
  会把 `notxiaohongshu.com` 这类第三方 cookie 一起删掉。判据 = `d === host || d.endsWith("." + host)`。
- 扫码登录是 **channel 级能力 `Loginable`**（平台级操作，不依赖 info 实例化）。
  `emitQr` 载荷语义：`data:image/...`（浏览器路径已编码）**或**待编码文本（纯 HTTP 路径）。
  ⚠️ `opts.signal`（2026-10-20）：UI 关闭二维码弹窗必须 abort —— 登录在 `withScanLoginLock`
  （cdp.ts，xhs/weibo hidden / douyin interactive，douyin 二维码是 canvas 绘制 hidden 画不出）
  里跑在专属 `login:<platform>` lane（独立 tab，不持全局锁，不阻塞其它浏览器操作）；
  关窗仍必须 abort，否则登录 tab 会一直轮询到超时，白耗风控配额。
  ⚠️ xhs 登录的**初始检测只用页面证据**（`user.loggedIn`/侧栏「我」，cookie 完全不参与）；
  轮询判据是 `user_id` **相对基线变化** —— 服务端 session 失效时残留的旧 user_id 不算登录。
  ⚠️ `cdpEvaluate` 的表达式在**页面里**执行，必须是纯 JS：写 `(n as HTMLElement)` 这类
  TS 断言 tsc 不报错，运行时炸 `SyntaxError: Unexpected identifier 'as'`（xhs 点「登录」
  按钮曾因此出不了码）。
- **「清除凭证」会真正登出浏览器账号**（2026-10-19）：xhs/weibo/抖音抓取用的是
  抓取浏览器（数据服务侧 `amoeba-browser` WebView2）profile 的登录态，只清
  `settings.*Cookie` 等于没退。账号页先发 `dl.diagnostics.clearCookies(hosts)`
  （服务 RPC，`AccountPage.tsx:226`），由服务侧按域精确删除（`backend.ts:549`，
  `d === host || d.endsWith("." + host)`），成功后再清 settings；中途失败则 settings 保持不动。
