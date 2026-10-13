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
- [x] **[medium] `markRead` / `lastReadAt`** — 核实无缺口：reading-repo `patchMany` 每次 patch
      都自动写入 `lastReadAt: t`（line 78），标已读即记录时间。
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
      点播只触发一次；直播未见问题 → 待验。

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
