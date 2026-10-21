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
| A · 低风险、建议尽快 | 8 条 | ~150 行 |
| B · 中风险、改到再动 | 5 条 | ~160 行 |
| C · 明确不改 | 3 条 | — |
| D · 待确认 | 1 条 | — |

---

## A · 低风险，建议做

### A1. 串行队列在 5 个文件各写一份

- 位置：`packages/core/src/repo/subscription-repo.ts:37` · `reading-repo.ts:34` ·
  `settings-repo.ts:20` · `body-cache-repo.ts:42`（按 key 分组）· `packages/core/src/data-layer.ts:475`
- 现状：五处都是 `let serial = Promise.resolve(); const next = serial.then(fn, fn)`；
  data-layer/body-cache 还要额外维护 `Map<key, Promise>`。注释各写各的。
- 建议：新增 `packages/core/src/repo/serial.ts`，导出 `createSerialQueue()` 与
  `createKeyedSerialQueue()`，五处替换本地实现。纯 Promise 编排，不需要任何库。
- 风险：low ｜ 省 ~35 行 ｜ remeda_fit: bad（这是控制流，不是数据变换）

### A2. `previewChannel` 重抄了一份凭证合并规则

- 位置：`packages/core/src/data-layer.ts:805`
- 现状：手写了与 `sourceInfoFor()`（:253）相同的 rsshub baseUrl / 平台 cookie 合并，注释自认「同规则」。
  改一处会让「预览」和「正式抓取」用不同凭证。
- 建议：`const merged = await sourceInfoFor({ channelKey, info }, s)`，删掉 805–811。
- 风险：low ｜ 省 ~7 行

### A3. kind 的中文名/图标造了三份

- 位置：`apps/desktop/src/components/app/Cards.tsx:300`（`kindLabel`）·
  `apps/desktop/src/views/player/PlayerPage.tsx:325`（`kindName`）·
  `CommandPalette` 的 icon 四层三元
- 现状：`store/nodes.ts:32` 的 `KIND_META` 已有全部 label+icon，三份副本**已经不一致**
  （`kindName` 缺 `category`）。
- 建议：统一 `KIND_META[kind]?.label ?? kind` / `KIND_META[kind]?.icon ?? "rss"`，删两个本地函数。
- 风险：low ｜ 省 ~14 行

### A4. 可播判定 4 处各写一遍

- 位置：`Cards.tsx:42`（唯一定义）· `store/selectors.ts:89`（`short:` 分支内联）·
  `apps/mobile/src/store.ts:146`（`isPlayable`）
- 建议：把 `isPlayableKind` 下沉到 `apps/desktop/src/lib/media.ts`（或 core 的 kind 工具），
  desktop 三处统一引用；mobile 保留自己的（跨端不共享 app 代码，但可复用 core 常量）。
- 风险：low ｜ 省 ~6 行 ｜ 价值在**契约一致**（新增 kind 时不会漏一处）

### A5. 添加订阅弹窗的 filter 是死状态

- 位置：`apps/desktop/src/views/manage/AddSubscriptionDialog.tsx:77` + `:138`
- 现状：`const [filter] = useState("")` **没有 setter**，`shown` 的 useMemo 恒等于 `cands`；
  CandidateList 的「匹配 N / N」和空筛选分支都是死路径。发现页调用处直接传 `shown={cands}`。
- 建议：删 `filter`/`shown`，CandidateList 只收 `cands`，标签改成「N 项」。
  将来真要筛选，从外层传受控值。
- 风险：low ｜ 省 ~10 行

### A6. `selectors.ts` 有无调用者的导出

- 已确认 **0 引用**：`itemsById` · `subUnread` · `lastFetchedOf` · `unreadCount` · `heatOf`
  （`git grep` 排除定义文件后无命中）。
- 待确认：补扫 agent 还报了 nodes 的 2 个分组 helper、`media.fmtNum`、`LiveRailCard`（转发壳）。
- 建议：删除确认无用的导出；若想留作调试 API，加 `@internal` 注释，避免被当公共接口继续引用。
- 风险：low ｜ 省 ~35 行

### A7. 两条按 URL 解析的链路只差一行

- 位置：`packages/core/src/data-layer.ts:560` / `:581`
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

### B1. 缓存 XML 回填写了四遍（helper 反而闲置）

- 位置：`packages/core/src/data-layer.ts` —— `restoreFromCache:157` · 停用路径 `:318` ·
  TTL 短路 `:369` · 失败回退 `:448`
- 现状：四处重复 `deserializeFeedWithTotal → applyReadingState → replaceIfLive → pageCursors.delete`；
  且 **total 语义不一致**（停用路径 total 为 undefined 时不清旧值，TTL 路径会清）。
- 建议：抽 `applyCachedXml(subscriptionId, xml, kind)`，返回 `{ items, total }`；
  total 的 set/delete 仍由调用点决定，**不要顺手统一**（会改变停用/失败回退语义）。
- 风险：med ｜ 省 ~20 行

### B2. YouTube 四种 client 的请求体重复（~120 行）

- 位置：`packages/resolve/src/platform/youtube/client.ts` —— `getAndroidPlayerResponse:205` ·
  `getWebPlayerResponse:238` · `getIosPlayerResponse:263` · `getVisionosPlayerResponse:316`
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

- 位置：`apps/desktop/src/store/actions/subs.ts` —— `ensureKindGroup:21` ·
  `autoGroupByKind` 内的 `ensureGroup:178` · `importOpml` 的 `groupIdOfLeaf:244`
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

## D · 待确认

- `apps/desktop/src/store/nodes.ts` 的几个分组 helper、`lib/media.ts` 的 `fmtNum`、
  `LiveRailCard`（仅转发）是否还有调用者。删除前用 `git grep` 逐个确认（A6 已确认 5 个，
  这几个是补扫 agent 报的，尚未逐个核实）。

---

## 附：为什么没引入 remeda

- 它不是依赖；按 skill 门禁，不擅自引入。
- 本项目已有「零依赖叶子包」的取向（`log`、`xml` 只持一个解析器）。
- 真正适合 Remeda 的形态（多次遍历、分组计数、不可变更新）在仓库里**并不多**：
  核心逻辑大量是「副作用 + 平台协议解析」，数据变换多是单次 `map/filter`，原生写法更短。
- 若将来引入，A1/A2/A3/A7 这类**抽取共享函数**的收益与 remeda 无关，先做这些；
  `remeda_fit: good` 的条目为 0，也说明现在没有引入的动机。
