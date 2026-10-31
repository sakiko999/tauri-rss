# 重构候选（2026-10-21 审计）

> 用 remeda-master 的「形状视角」全仓扫了一遍 TS/TSX（5 个区域 + 对抗复核 + 遗漏补扫）。
> ⚠️ **`remeda` 不是本项目任何 workspace 包的依赖**，所以：不引入、不硬套；
> 下面所有建议都是**原生 TS/JS**，`remeda_fit` 只记录「若将来引入是否划算」。
>
> 判据只有一条：**数据变换**（可收敛成一次遍历/一次查表）才值得改；
> **副作用分发**（改 store、动 DOM、发请求）保持命令式。做完一条删一条。

## 总览

| 档 | 条目 | 净收益（估） |
| --- | --- | --- |
| A · 低风险、建议尽快 | 6 条（A2/A5 已完成，已删） | ~100 行 |
| B · 中风险、改到再动 | 5 条 | ~160 行 |
| C · 明确不改 | 3 条 | — |
| D · 已核实（可删） | 1 条 | — |

---

## A · 低风险，建议做

### A1. 串行队列在 4 个文件各写一份

- 位置：`packages/core/src/repo/subscription-repo.ts:37` · `reading-repo.ts:36` ·
  `settings-repo.ts:26` · `packages/core/src/data-layer.ts:618`（`serialized()`，共四处）
- 现状：四处都是 `let serial = Promise.resolve(); const next = serial.then(fn, fn)`；
  data-layer 还要额外维护 `Map<key, Promise>`。注释各写各的。body-cache 的串行队列已删，
  改为 `keysOf` 前缀扫描（`body-cache-repo.ts:47-51`）。
- 建议：新增 `packages/core/src/repo/serial.ts`，导出 `createSerialQueue()` 与
  `createKeyedSerialQueue()`，四处替换本地实现。纯 Promise 编排，不需要任何库。
- 风险：low ｜ 省 ~30 行 ｜ remeda_fit: bad（这是控制流，不是数据变换）

### A3. kind 的中文名/图标造了两份

- 位置：`apps/desktop/src/views/player/PlayerPage.tsx:335`（`kindName`）·
  `apps/desktop/src/views/palette/CommandPalette.tsx:83`（icon 四层三元）
- 现状：`store/nodes.ts:32` 的 `KIND_META` 已有全部 label+icon，两份副本**已经不一致**
  （`kindName` 缺 `category`）。`Cards.tsx` 的 `kindLabel` 已删。
- 建议：统一 `KIND_META[kind]?.label ?? kind` / `KIND_META[kind]?.icon ?? "rss"`，删两处本地实现。
- 风险：low ｜ 省 ~14 行

### A4. 可播判定 desktop 两处各写一遍（mobile 已冻结，不再动）

- 位置：`Cards.tsx:42`（唯一定义）· `store/selectors.ts:89`（`short:` 分支内联）·
  `apps/mobile/src/store.ts:150`（`isPlayable`，仅存档）
- 建议：把 `isPlayableKind` 下沉到 `apps/desktop/src/lib/media.ts`（或 core 的 kind 工具），
  desktop 两处统一引用；mobile 保留自己的。
- 风险：low ｜ 省 ~6 行 ｜ 价值在**契约一致**（新增 kind 时不会漏一处）

### A6. `selectors.ts` 有无调用者的导出

- 仍确认 **0 引用**：`unreadCount:185` · `subUnread:197` · `lastFetchedOf:217`
  （`itemsById` 已删；`heatOf` 已被 `sortItems` 内部使用，保留）。
- 建议：删除确认无用的导出；若想留作调试 API，加 `@internal` 注释，避免被当公共接口继续引用。
- 风险：low ｜ 省 ~35 行

### A7. 两条按 URL 解析的链路只差一行

- 位置：`packages/core/src/data-layer.ts:706` / `:727`
- 现状：`resolvePlayByUrl` 与 `resolveLivePlayByUrl` 除 resolver 调用外完全相同。
- 建议：`resolveByUrl(itemId, subscriptionId, resolveFn)` 共用。
- 风险：low ｜ 省 ~20 行

### A8. 四个直播渠道的抓取循环各写一遍

- 位置：`packages/crawler/src/channels/{bili,douyu,huya,douyin}/live.ts`（约 :86 起）
- 现状：都是「并发 `fetchOne` → catch 跳过 → 全失败抛错 → 统一盖 `fetchedAt`」，
  以及 `roomIds/roomId` 参数拼接的三份副本。
- 建议：`channels/factory.ts` 加 `fetchRooms(roomIds, fetchOne, key, t)`；
  douyin 先做主页解析再传入。⚠️ 保留「全失败才抛错」的护栏语义。
- 风险：low ｜ 省 ~25 行

---

## B · 中风险，改到那块时顺手做

### B1. 缓存 XML 回填：helper 之外还有两处内联

- 位置：`packages/core/src/data-layer.ts` —— `restoreFromCache:250` · 自动刷新关闭 `:481` ·
  TTL 短路 `:499-507` · 失败回退 `:582-589` · 水化 `:612`
- 现状：三处重复 `deserializeFeedWithTotal → applyReadingState → replaceIfLive → pageCursors.delete`
  （helper + TTL 短路/失败回退两处内联；`:481` 与 `:612` 直接复用 helper）；
  且 **total 语义不一致**（停用路径 total 为 undefined 时不清旧值，TTL 路径会清）。
- 建议：抽 `applyCachedXml(subscriptionId, xml, kind)`，返回 `{ items, total }`；
  total 的 set/delete 仍由调用点决定，**不要顺手统一**（会改变停用/失败回退语义）。
- 风险：med ｜ 省 ~20 行

### B2. YouTube 四种 client 的请求体重复（~120 行）

- 位置：`packages/resolve/src/platform/youtube/client.ts` —— `getAndroidPlayerResponse:213` ·
  `getWebPlayerResponse:246` · `getIosPlayerResponse:271` · `getVisionosPlayerResponse:324`
- 现状：四份几乎相同的 context/videoId/cpn/contentCheckOk/racyCheckOk，只差 client 字段、端点、UA。
- 建议：`CLIENT_CONFIG` 表（clientName/version/device/os/端点/UA/headers）+ `playerBody(...)`
  + `requestPlayer(...)`；保留导出的 `visionosPlayerBody` 薄包装给 `youtube-clients.check.ts` 钉形状。
  ⚠️ WEB 的 referer、gapis 的 `t/id` 参数要作为配置项保留。
- 风险：med ｜ 省 ~45 行

### B3. 续播/进度/播完在 PlayableMedia 与 AudioShell 各写一遍

- 位置：`packages/player/src/PlayableMedia.tsx:271` · `AudioShell.tsx:74`
- 现状：约 45 行/处：`resumedRef` + `readyState≥1` 直接 seek / 否则等 `loadedmetadata`、
  `timeupdate` 上报、`ended` 上报。改一处漏一处 → 音视频行为分叉。
- 建议：`hooks/useMediaElementSync(ref, { enabled, startAtSec, onProgress, onEnded, resetKey })`。
- 风险：med ｜ 省 ~35 行 ｜ remeda_fit: bad（副作用）

### B4. 「按名查找或新建分组」写了三遍

- 位置：`apps/desktop/src/store/actions/subs.ts` —— `ensureKindGroup:22` ·
  `autoGroupByKind` 内的 `ensureGroup:184` · `importOpml` 的 `groupIdOfLeaf:250`
- 现状：三份「按标题找组，找不到就建」；组 id 拼接在 `addGroup:123` 与 `importOpml:249` 各写一次。
- 建议：抽 `ensureGroupByTitle(title)`；importOpml 若不想逐组 set state，让 helper 接一个
  create 回调以保留 dl 直连。
- 风险：med ｜ 省 ~25 行

### B5. `useMediaStream` 三个分支重复起播/清理（可选）

- 位置：`packages/player/src/hooks/useMediaStream.ts:188` 附近（HLS / FLV / DASH）
- 现状：每支都写 `video.muted = ...`、`canplay` once → `attemptPlayWithMuteFallback`、
  cleanup 里 removeEventListener，共 6 行 ×3。
- 建议：`armPlayback(video, play)` 返回 cleanup。收益一般，**改播放器时顺手做**。
- 风险：low ｜ 省 ~12 行

---

## C · 明确不改

### C1. `RailGroupTree.tsx:131-166` 的键盘 action switch（本次选中的代码）

**不改。** 理由：

1. **它是副作用分发，不是数据变换**。`focusRow` 操作真实 DOM（`querySelector` + `focus()` +
   `scrollIntoView`），`flip` 调 store 的 `toggleGroup`。换成 `conditional` 或查表只会把
   `out` 分支的两条 DOM 路径塞进闭包，可读性更差。
2. **switch 提供穷尽检查**。`NavAction["type"]` 新增成员时，`switch` 在 `noUnusedLocals`/
   类型检查下能暴露漏分支；表达式化后漏掉只会在运行时静默无响应。
3. **注释承载了不变量**（「expand 只展开不动焦点」「out 的两种 DOM 结构」）。
   表达式写法会把这些注释打散到互不相邻的 case 里。
4. 其余分支都是 `focusRow(rows[...])`，看起来像查表，但索引计算依赖 `idx`/`action.delta`，
   抽成 `Record<type, (rows, idx) => HTMLElement>` 反而多一层间接。

**结论**：`remeda_fit: bad`。这条是「Remeda 视角告诉你不用改」的典型样本，记下来防止以后再被误报。

### C2. `RowCtx` 的嵌套三元（:104-109）

三支映射到判别联合，TS 在 `kind === "group"` 分支能正确收窄。改成 `conditional` 需要给每个
case 写类型谓词，收益为负。

### C3. JSX 里的单次 `.map` / `.filter`

渲染结构本身，不是可复用的数据管道。保持原样。

---

## D · 已核实（可删，按需）

- ~~已核实：`lib/media.ts:155` 的 `fmtNum`、`Cards.tsx:301` 的 `LiveRailCard` 均 0 引用~~
  **已复核（2026-10-27）**：`fmtNum` 现在被首页/侧栏多处使用（不要删）；`LiveRailCard` 已删；
  `lib/subscriptions.ts` 的私有 `fmtNum` 仍存（与 `lib/media.ts` 的导出重复，可后续合并）。

---

## 2026-10-26：`feat/browser-driver` 合入前 review 遗留

2026-10-26 `feat/browser-driver` 合入前的 review 中 P0/P1 已修（见 git log）；下列为未修项，
按「改到再动」排序。

### A · 正确性/语义（优先）

- **A-1 B站收藏夹/合集的会员标记仍缺**（`crawler/src/channels/bili/favlist.ts:55`、`season.ts:95`、
  `series.ts:98`）：这三个接口的列表项没有 `rights`，充电专属不可判（详见
  `docs/platforms/platform-notes.md` 的 B站段）。已修的是 `user_video`（`is_charging_arc`）；
  这两个渠道要么接受缺口，要么按条目懒查 `view`（不建议）。
- ~~**A-2 「在播」判据两处各写一遍**~~ ✅ **已修（2026-10-27）**：`Cards.tsx` 已统一走
  `lib/media.ts` 的 `isLiveNow`（unknown 算在播、offline 不算，与首页/侧栏同判据）。

- **A0 `browser-sidecar` 没接 WebView2 进程退出事件**（`apps/browser-sidecar/src/main.rs:928` 只有
  500ms timer + tidy）：浏览器进程崩溃/OOM 后 sidecar 仍存活，CDP 端口消失但
  `SidecarDriver.ensureReady`（`host/src/node/browser-sidecar.ts:88`）只看子进程 exit，继续返回坏端口
  → 长跑的 `rss --service` 后续所有浏览器渠道都失败且不自愈。（历史注：当时桌面载具在 `webview_browser.rs` 有同款兜底，该分支已于 2026-11-01 删除。）
  ✅ 已修（2026-10-27）：主路 `ICoreWebView2Environment5::add_BrowserProcessExited` →
  `request_shutdown()`，sidecar 自行退出、由宿主 `ensureReady` 重启整载具；旧 Runtime（< 88）
  没有 Environment5 才降级 `add_ProcessFailed` + 只拦 `BROWSER_PROCESS_EXITED`（渲染进程失败
  WebView2 会自建，泛化会打断在途抓取）。真机验证：杀 sidecar 的 msedgewebview2 子进程 →
  sidecar 干净退出（exitCode 0）。
- **A0b `rss --service` 的 job 表可能残留**（`apps/cli/src/service/server.ts:488-514`）：`runJob` 的
  `jobs.delete` 只在 `finally`，被 cancel 但底层 await 未返回时条目与 AbortController 一直挂着。
  **2026-10-27 复核**：实际等待有界（core refresh 自带 abort race、CDP 命令 30s、HTTP 超时），
  不是永久泄漏；但 cancel 后到操作自然结束前条目仍在。低成本改法：`Promise.race(fn, abortSignal)`
  让 job 在取消时立即结算（`finally` 删除），语义与「取消 = 结束」一致。

- ~~**A1 服务端 diagnostics 内联了一份 core 实现**~~ ✅ **已修（2026-10-30）**：dispatch 5 个
  `diagnostics.*` 一律委托 `layer.diagnostics.*`（core 的 `clearAll` 清 `removedSubs`/`pageCursors`/
  `pageTotals` 并重置 netPolicy），返回受影响的 subscriptionId 供 server 清 `lastItems` 投影并广播
  `items.cleared`；server 另在 clearAll 前 abort 在途 job（`jobs.controller`）。回归
  `scripts/service-data-check.ts`（clearAll 返回 ids / 快照为空 / 设置回默认）。
- **A2 `projectItem` 剥掉 article 的 `content`**（`server.ts:294` / `service-client:209`）：
  镜像里 `content` 恒空 → `matchesQuery` 的 bodyText 部分在生产路径不生效。
  **2026-10-27 已修一半**：搜索空态文案改为「标题、作者与摘要；正文不在本地镜像里」
  （`ArticlePane.tsx`），不再承诺搜正文；卡片摘要读的是 summary，不受影响。
  **仍需产品决策**：投影保 content（体积↑，先跑 `service-snapshot-size.ts`），或搜索走服务端 /
  按需 `resolveDetail`。
- ~~**A3 扫码登录成功后读本地 settings 镜像再写回**~~ ✅ **已修（2026-10-27）**：
  `AccountPage` 直接用 `LoginResult.cookie` 同步 UI，不再重读可能滞后的镜像。
- **A4 刷新超时不再 `abortTabs`**：服务端 `withSignal` 只让 race reject，不中止底层请求，
  被放弃的抓取仍占浏览器 lane（`op:xhs`）直到 CDP 自身超时。desktop 侧 `abortTabs` 调用已移除。
- **A5 `channelVideoToItem` 缺 author/publishedAt/duration**（`crawler/.../youtube/channel.ts:119`）：
  「今天」节点恒空、时间排序退化、卡片把 summary 当作者名。设计上刻意不反推 publishedAt，
  但 author（频道名）与 duration（lockup 里有）可以补。
- ~~**A6 `contentCache.delete` 无调用**~~ ✅ **已修（2026-10-27）**：删除该方法；
  `bodyCache.deleteAll` 保留并在接口注释标注「仅自检」。

### B · 性能

- **B1 `store.patch` 逐条 = 逐次全表扫**：`markAllRead` 500 条 → 建议 `patchMany(entries)`。
- **B2 `readingRecords()` 为发事件整表读**（`server.ts:473`），每次续播落库多一次 O(R) 解析。
- **B3 `hydrate()` 串行 restoreFromCache**，且每轮重读整张 reading blob（`data-layer.ts:609`）。
- **B4 `/v1/state` 每次重建 + `JSON.stringify` + `gzipSync`（同步阻塞）**：可按 rev 缓存。
- **B5 `browser/backend.ts:445` 每条 CDP 命令都 `sweepJunk(await port())`**：端口可缓存。
- **B6 `eventLog` 按条数（512）封顶**：`items.replaced` 携整订阅条目 → 长跑常驻上百 MB。
- **B7 `loadMore` 两次 `store.query` + append 再滤一遍**（`data-layer.ts:854`）。

### C · 分层 / 一致性（本轮只做了一部分）

- **C1 日志开关仍靠 node 入口伪造 `localStorage`**：已抽成 `apps/cli/src/host/log-shim.ts`
  一份，但根因是 `readSwitch` 只认浏览器 API。建议 `@amoeba/log` 提供 `configureLog()`，
  node 下读 `process.env.RSS_LOG`，删掉 shim。
- **C2 DB 文件名（`rss.db`/`rss.dev.db`/`rss.release-debug.db`）4 份**：`data-source.ts`、
  `sqlite-storage-backend.ts`、Rust `service.rs` 白名单、`scripts/tauri.ts`。建议单一 owner
  + parity check（照 `media-referrer-parity.check.ts`）。
- **C3 `mergeProbeInfo`（`server.ts:309`）手抄 `sourceInfoFor` 的 cookie 合并规则**。
- **C4 `BROWSER_UI_URL` / `EDGE_UI_URL` 与 `targetParams()` 在两个 driver 各一份**：
  不是载具差异，应移到 `host/src/browser/backend.ts` 常量。
- ~~**C5 `scripts/check.ts` 是白名单**~~ ✅ **已修（2026-10-27）**：按文件系统发现
  `*.check.ts`，未登记直接失败；有 `tsconfig.json` 但不在 `TYPECHECK_PROJECTS` 的项目同样失败；
  `--filter` 空匹配改为 exit 1。（`service-client`/`service-protocol` 没有自己的 tsconfig，
  由消费方 desktop/cli 的 typecheck 覆盖，不是漏项。）
- **C6 YouTube InnerTube 文本/缩略图解析 4 份**（`channel.ts` 的 `textOf`/`maxThumb`、
  `discover.ts` 的 `textOf`/`thumbOf`、`client.ts` 的 `ytText`/`ytThumb`）。
- **C7 客户端只比 `hello.protocol`，不读 `minClientProtocol`**（`service-client/src/index.ts:104`）：
  将来服务端抬协议、老客户端仍能连上并按旧语义发 RPC。修法：连上后校验
  `minClientProtocol <= SERVICE_PROTOCOL`，不满足直接报错而不是静默降级。

### 已核实「不是缺陷」（review 反例，避免下次重复报）

- `service.rs` 的 `child.kill()` 只杀 `amoeba-runtime.exe`：服务进程按 `--parent-pid` 轮询
  Tauri 进程存活（`service.rs:242`），父进程消失后自行退出 —— 双保险已存在。

---

## 2026-10-27：合流改版收尾复核（docs 全量核对）

对 `docs/` 里全部「遗留/未做/待验证」条目做了一次逐条对码核对（120 条：open 89 / fixed 1 /
stale 9 / decision 21）。本轮修掉的：

- **[high] RSSHub provider 没在数据服务/CLI 注册**（00-overview 曾写「desktop/mobile 入口都 import」，
  数据服务化后那句已够不到 DataLayer）：服务与 CLI 入口补 `import "@amoeba/core/source/rsshub"`，
  `probe.fetch` 改走 `@amoeba/core/source` 的聚合注册表；`service-data-check` 钉住
  `channels.list` 含 `rsshub:feed`。
- **[med] 单订阅 TTL 清不回 0**：`undefined` 在 RPC JSON 里丢失 → 旧值保留。
  新增 `SubscriptionPatch`（`null` = 清除），repo 侧删除键；dialog 改发 `null`；
  `service-data-check` 钉「可写 / 可用 null 清除」。
- **[trivial] 扫码登录后用滞后的 settings 镜像回写 cookie**（A3，见上）。
- **[low] 直播会写续播位置**：`savePosition` 统一在入口拦 `kind === "live"`（原只在部分调用点讨论）。
- **[low] 死代码/重复**：`contentCache.delete`、`LiveRailCard`、`selectors` 三个无调用导出已删；
  kind 名称/图标两处本地副本改为 `KIND_META`。
- **[low] 检查入口假绿**：`scripts/check.ts` 增加未登记检查文件/未纳入 typecheck 项目的守卫，
  `--filter` 空匹配退出 1。
- **AI 文案**：搜索空态不再承诺「搜正文」（A2）。

> 其余 open 项按本文分档排期（A1 diagnostics 归位、A4 abortTabs、
> B 段性能、C 段分层）——都不属于合流改版的收尾范围，单独开轮做。
> （A0 browser-sidecar 退出事件已于 2026-10-27 落地，见上。）

## 附：为什么没引入 remeda

- 它不是依赖；按 skill 门禁，不擅自引入。
- 本项目已有「零依赖叶子包」的取向（`log`、`xml` 只持一个解析器）。
- 真正适合 Remeda 的形态（多次遍历、分组计数、不可变更新）在仓库里**并不多**：
  核心逻辑大量是「副作用 + 平台协议解析」，数据变换多是单次 `map/filter`，原生写法更短。
- 若将来引入，A1/A3/A7 这类**抽取共享函数**的收益与 remeda 无关，先做这些；
  `remeda_fit: good` 的条目为 0，也说明现在没有引入的动机。
