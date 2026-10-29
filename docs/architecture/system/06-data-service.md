# 数据服务（CLI 载具）架构与落地计划

> 状态：阶段 0/1/2 已完成（2026-10-26 实机；安装包/签名/安装卸载/服务生命周期/备份回滚均已验）。
> 后续项见 §12（阶段 3 范畴与干净 VM 复核）。
> 范围：desktop + CLI。mobile 不参与，继续进程内 `createDataLayer()`。

## 0. 决策摘要

| 议题 | 决定 |
| --- | --- |
| 服务形态 | `rss` 二进制的 `--service` 模式；CLI 命令与 desktop 都是客户端 |
| 生命周期 | desktop 启动时 spawn/adopt，退出时带走；不做常驻 daemon / 自启 |
| 写权威 | 服务是 SQLite、迁移、crawler/resolve、浏览器、登录/cookie、governor、job 的唯一写者 |
| desktop | 保留 React store/selectors/views、prefs/queue、播放器、媒体 Referer、媒体 governor；不再 `createDataLayer()`、不直开 DB、不碰抓取浏览器 |
| 传输 | `127.0.0.1` 随机端口 HTTP/1.1 JSON + WebSocket 事件；token；loopback + Host/Origin 校验 |
| 快照 | 全量轻量投影（gzip 实测见 §9）；桌面保留同步 `allItems` 镜像 |
| 事件 | `epoch` + 连续 `rev`；合帧 = 合并成一次提交（rev 不跳号）；缺口 → 全量 resync |
| 断线 | fail-closed：只读镜像 + 禁用全部 mutation；v1 不做 outbox |
| 存储 | 沿用 desktop 现有库（WAL 已开）；v1 reading 仍是整 blob + 1s 合并写；行表留 v2 |
| profile | 归服务（cookie/登录态只在服务上，desktop/CLI 都是消费者）；复用 desktop `webview-profile` |
| 打包 | 小启动器 `amoeba-runtime.exe`（Rust）+ JS；Bun **全局优先、缺失自动下载**；`amoeba-browser.exe` 始终随包 |
| mobile | 不参与协议；不跑 v2 迁移，保持现有 blob 语义 |

**一句话**：服务是唯一写者，桌面只是带本地镜像的客户端；CLI 是同一服务的另一个客户端，也是这个服务的载具。

**服务不与 desktop 绑定**：desktop 只是当前最常见的「谁把服务拉起来」——CLI 也可以
`rss --service --db <同一份库> --profile-dir <同一份 profile>` 手动起，登录态与订阅
完全共享。生命周期管理（spawn / 退出带走）是 desktop 的实现细节，不是协议约束；
`rss login` 只要求「有服务在跑」，不要求桌面开着。

## 1. 目标与非目标

### 目标

- CLI 与 desktop 看到**同一份**订阅、条目、已读、设置、缓存与登录态。
- 抓取、冷却、去重、被动缓冲、分页游标只有一份，不再双倍打源站。
- desktop UI 保持现有同步 selectors 与渲染路径，不做全异步 store。
- 服务与桌面同生命周期，关掉桌面就没有后台进程。

### 非目标（v1 明确不做）

- mobile 跨设备同步；需要远程服务 + 认证 + 冲突解决，另立项。
- 关掉 desktop 仍定时刷新（常驻 daemon / 开机自启）。
- 服务端全文搜索、媒体字节代理、弹幕 WS 代理。
- Rust/Go 重写数据层（已单独评估并否决）。
- 多 desktop 实例共享一个服务（v1 要求 desktop 单实例）。

## 2. 进程模型与生命周期

### 2.1 四个进程

| 进程 | 职责 |
| --- | --- |
| `amoeba-runtime.exe` | 运行时引导（Rust）：解析/下载 Bun，spawn 并透传 stdio/退出码；不含业务逻辑 |
| `rss --service` | 数据层：SQLite、crawler/resolve、浏览器、登录、governor、jobs、事件 |
| `amoeba-browser.exe` | 浏览器载具：屏外 WebView2 + CDP；由服务按需 spawn |
| desktop (`amoeba.exe`) | UI：React store/selectors/views、播放器、媒体 Referer、本地偏好 |

`amoeba-runtime` 在服务存活期间保留（它是 Bun 的父进程），desktop 退出时随 Job / `--parent-pid`
一起收掉；它**只写 stderr**，stdout 原样留给服务的 `READY <port>`。

服务不再使用 Tauri 的抓取 WebView2（`webview_browser_*`）。主窗口的媒体 Referer 注入（`media_referer.rs`）保留。

### 2.2 desktop 启动顺序

1. Tauri `setup()` 启动；页面先渲染 skeleton。
2. Rust 解析路径（`apps/src-tauri/src/service.rs:resolve_paths`）：
   `dataDir=%LOCALAPPDATA%\app.amoeba.desktop\service`、
   `dbFile=%APPDATA%\app.amoeba.desktop\rss{,.dev,.release-debug}.db`、
   `profileDir=%LOCALAPPDATA%\app.amoeba.desktop\webview-profile`（复用旧桌面 profile，保登录态）。
3. 读 `dataDir\endpoint.json`；`/v1/hello` 存活且 protocol=1 → **adopt**，不 spawn。
4. 否则 spawn `amoeba-runtime.exe <service.js|service/main.ts> --service --data-dir ... --db ... --profile-dir ... --token-file ... --parent-pid <desktop pid>`。
5. 读 stdout 首行 `READY <port>`，上限 30s；启动先做每日 `VACUUM INTO` 备份再开库。
6. 读 `endpoint.json`（含 **clientToken**），通过 Tauri command `service_endpoint` 原样交给 renderer；owner token 留在 Rust。
7. renderer `createRemoteDataLayer`：`GET /v1/state` → 镜像 → `channels.list` → 连 `/v1/events`（hello 后 `subscribe {sinceRev}`）。
8. `ready=true`；`refreshAll` 仍由 desktop 逐订阅调 `refresh`（保留逐条 busy/超时 UI；服务端另有 `refreshAll` job 供 CLI/其它客户端）。

任何一步失败 → 全页错误 + 重试；**不创建本地 DataLayer、不打开 SQLite**。

### 2.3 发现、单实例与 token

- `instanceKey = sha256(canonical(dbFile) + "\0" + canonical(profileDir))` 只作日志标识（未按它分目录）；单实例由 `dataDir/instance.lock` 保证。
- `instance.lock`：`open(..., "wx")` 原子创建，内容 `{pid, bootId, startedAt}`；启动遇锁先探活，存活且协议兼容 → 打印 `ALREADY_RUNNING pid=<pid> bootId=<bootId>` 并以退出码 3 退出（`server.ts:343-346`；调用方按退出码转 attach）。
- 两种 token：
  - **owner token**：spawn 者持有（desktop 的 `service.rs`；手动 `rss --service` 时即它自己，落在 `--token-file`），可调 `/v1/shutdown`；
  - **client token**：endpoint.json 里的只读/命令 token，CLI attach 用，不能 shutdown。
- token 只经 `--token-file` 或 stdin 传入，**绝不进 argv、URL、日志、diagnostics**。
- HTTP `Authorization: Bearer`；WS 首帧 `{type:"auth", token}`；1s 内未认证断开。

### 2.4 CLI：只做 attach

- CLI 只做 attach：`rss attach`、`--via-service` 探针（`probe.*`）与 `rss login` 从 `--endpoint`、`AMOEBA_SERVICE_ENDPOINT` 或 `%LOCALAPPDATA%\app.amoeba.desktop\service\endpoint.json` 读 endpoint（`apps/cli/src/commands/attach.ts:26-49`），取不到就报错提示先起桌面或手动 `rss --service`；没有自动 spawn、`--no-spawn` 或 `--ephemeral`。
- attach 用 client token，不能 shutdown；只有 owner 能 shutdown；`rss --service` 前台运行服务。
- 不带 `--via-service` 时 `fetch/item/play/dm` 仍是本地只读探针（自己的 `apps/cli/.data/rss.db`）；`refresh` / `hot` 仍用进程内 `createDataLayer()` 写同一份 CLI 库（`refresh.ts:23`、`hot.ts:29`），它不是桌面库，不构成第二写者。

### 2.5 退出、崩溃与孤儿

- desktop 主窗口 `Destroyed` → `POST /v1/shutdown`（2s 预算）→ 关闭 `KILL_ON_JOB_CLOSE` Job → `exit(0)`。
- 服务优雅退出：停新命令 → 取消 job / abort CDP → 等写入链 ≤5s → 关 `amoeba-browser`（cookie flush ≤5s）→ `db.close()` → 删 endpoint/lock。
- 硬杀：SQLite WAL 恢复；`amoeba-browser` 由 `--parent-pid` 退出；profile 命名 mutex 防双开。
- renderer reload / HMR 不退出服务，只重连。
- 服务崩溃：desktop init 失败进错误页，点「重试」清 `initPromise` 重走 init（`apps/desktop/src/store/actions/data.ts` 的 `init`）；non-owner（CLI attach）直接报错。WS 事件通道断开由 `service-client` 以 500ms→10s 退避重连并全量 resync（`packages/service-client/src/index.ts:463-473`），不做进程级重拉。`bootId` 变化 → 全量 resync。

## 3. 传输与协议

### 3.1 为什么 HTTP + WS

- `127.0.0.1` 随机端口，`Bun.serve({ port: 0 })`；
- HTTP 给命令/快照，WS 给事件；
- 不用 stdio/命名管道：不可 attach、单客户端、无标准诊断工具。协议分层保留未来替换传输的能力。

### 3.2 端点

| 端点 | 用途 |
| --- | --- |
| `GET /v1/hello` | 协议、版本、bootId、pid、rev、features |
| `GET /v1/health` | 存活、写入链长度、job 数、DB 状态 |
| `GET /v1/state` | NDJSON 快照：meta → subscriptions/groups/settings/reading → items 分块 → `snapshot.end {lastRev}` |
| `GET /v1/events` | WS；首帧认证，`subscribe {sinceRev}` |
| `POST /v1/rpc` | `{method, params, opId?}`；统一命令入口 |
| `POST /v1/jobs/:id/cancel` | 取消单个 job |
| `POST /v1/shutdown` | 仅 owner |

### 3.3 认证与安全

- 只绑 `127.0.0.1`；校验 `Host` 与 `Origin`（Tauri 生产 Origin 阶段 0 实机确认）。
- 认证失败返回 401（不做限速）；错误不回显 token。
- 通用 CDP/evaluate 不暴露；客户端只能调 DataLayer 语义方法。
- cookie/QR/Authorization 不落日志、diagnostics、错误消息。

### 3.4 版本

- `protocol` 整数 + `serviceVersion` semver + `features[]`。
- 不兼容 → 426 `protocol-mismatch`；desktop 强制重启服务，CLI 拒绝 attach。
- 同 protocol 内只做加法。

## 4. API 面（47 个 RPC 方法）

### 4.1 分组

| 组 | 成员 | 处理 |
| --- | --- | --- |
| 本地镜像读（12） | `listChannels`、`channelKind`、`subscriptions.list/listGroups/get`、`reading.getAll/get`、`settings.get`、`store.all/query`、`canLoadMore`、`totalOf` | 快照 + 事件维护，客户端同步读 |
| 语义命令（14） | `subscriptions.add/update/remove/addGroup/updateGroup/removeGroup`、`reading.markRead/markManyRead/setStarred/setPosition/setScrollRatio`、`settings.set/setIfUnchanged/reset` | `POST /v1/rpc`，带 `opId` |
| 长任务（10） | `addSubscription`、`previewChannel`、`refresh`、`loadMore`、`resolveDetail`、`resolvePlay`、`resolveLivePlay`、`resolveHotWord`、`scanLogin`、`syncBrowserCookies` | job + progress 事件 |
| 弹幕订阅（2） | `danmaku.open`、`danmaku.close` | 服务端建连 + `danmaku.items` 推送（caller-only） |
| 客户端本地（2+） | `store.patch`（乐观镜像）、`store.subscribe`（本地事件） | 不上线 |

`reading.deleteBySubscription` 并入 `subscriptions.remove` 的服务端事务，不单独暴露。

**实际实现（2026-10-30）**：`RpcMethodMap` 共 47 个方法 = 36 个 DataLayer 语义方法
（12 镜像读 + 14 语义命令 + 10 长任务）+ `refreshAll` + 5 个 `diagnostics.*`（桌面设置页/
账号页不再直连 storage/browser；「清除凭证」也经服务浏览器；实现一律委托 core
`layer.diagnostics.*`，server 只清投影与广播）+ 3 个 `probe.*`（CLI 原始探针远端路径）
+ 2 个 `danmaku.*`（弹幕连接开在服务进程内：凭证不过界，需登录态的抖音直播弹幕因此可用）；
`store.patch/subscribe`（客户端本地）与 `hydrate()`（服务内部）不上线。
`hydrate()` 是 core 新增的「只读缓存水化」，服务 boot 时调用，保证首个快照就有内容；
desktop/移动的 init 仍走 `refreshAll(false)`。
CLI 的 `fetch/item/play/dm` 支持 `--via-service`（`probe.fetch/resolve/danmaku`，与订阅
抓取同一 cookie 注入/被动规则/governor 配额）；默认仍是本地只读探针。
`rss attach` 提供 status/list/refresh/rpc，覆盖数据写路径与跨客户端验证。

### 4.2 job 语义

- 所有网络型长操作 job 化；facade 保持原 Promise 签名，内部 await job 终态。
- `refresh`/`loadMore` 按订阅单飞；`refreshAll` 是服务端单 job（统一并发/汇总/取消）。
- **取消已实现（job 级）**：`POST /v1/jobs/:id/cancel` → `AbortSignal` 一路传到 core `refresh(…, {signal})`；
  抓取在途时 `Promise.race` 立即返回「刷新已取消」，不写 store/缓存；`refreshAll` 取消后停止遍历剩余订阅。
  客户端侧 `signal`（desktop 45s 超时）转成 `cancel(jobId)`，不再只 abort 本地 fetch。
  桌面不再持有抓取浏览器，desktop 侧的 `abortTabs` 调用已移除（host 仍保留该 API 供 CLI/浏览器路径；R5 的桌面部分已消解）。
- HTTP 断开不取消 job（job 正常结束由 `jobs.delete` 回收，`server.ts:509`）；caller-only 任务没有 lease/断开回收（未实现），只能显式调 `cancel(jobId)`。
- 超时仍在客户端：desktop 的 `REFRESH_TIMEOUT_MS = 45_000`（`apps/desktop/src/store/lib.ts:53`）经 `withTimeout` 转成 `cancel(jobId)`；服务端不另设 refresh 超时，靠客户端取消收敛。

### 4.3 幂等

- 每个 mutation 带 `opId`；服务内 5 分钟/1024 条 LRU 记录结果，重放返回原结果。
- `addSubscription` 由客户端生成订阅 id，崩溃重试不会重复建订阅。
- 服务重启后 LRU 丢失，但语义命令本身可重复（set/mark/remove 幂等），可接受。

### 4.4 MediaItem 构造与 XML

- 服务端 `deserializeFeed` + `applyReadingState`，构造 `MediaItem`；
- 跨进程只发**轻量投影**；正文/stream 按需 `item.get`；
- XML 契约仍在服务内部（crawler→core），CLI `fetch --xml` 走单独原始端点；
- 客户端不再 import crawler/resolve，桌面 bundle 可缩小。

### 4.5 settings 与 cookie

- settings 快照**包含 cookie 字段**：`AccountPage` 直接渲染/编辑，且服务端播放解析需要；
- cookie 同步在服务执行：服务 boot 后 1.5s 自动跑一次（`server.ts:1209-1219`）；desktop 的 `RemoteDataLayer.syncBrowserCookies()` 直接返回 `[]`（`packages/service-client/src/index.ts:806-808`），init 后那次调用是 no-op，不触发 RPC；
- `settings.set` 只写指定 key；服务收到后重配 governor/TTL/autoRefresh。

### 4.6 resolvePlay 归属

- 移到服务（job），返回 `ResolvedPlayback`/streams；
- desktop 不再需要 `setPlatformCookieLookup`，避免登录态播放静默降级；
- 媒体字节仍由 renderer 直接请求，媒体 governor 留在桌面；抓取 governor 只在服务。
- **弹幕连接同样归服务**：`ResolvePlayback.danmaku` 是函数，过 RPC 会被 JSON 丢掉；`danmakuRef`
  只是能力标记，客户端按它调 `danmaku.open`（服务端用订阅凭证建连），只收 `danmaku.items` 批次。
  凭证不出服务进程，「本地匿名重建」的做法已删除（桌面不再 import `@amoeba/resolve`）。

## 5. 事件与一致性

### 5.1 身份与版本

- `epoch`：每次服务启动生成；`bootId` 用于诊断。
- `rev`：全局单调提交号；**每个改变镜像状态的提交必须发一条事件**。
- 合帧：多种变更合并成**一次提交**（rev +1），不是丢弃中间 rev。这样 rev 连续，客户端不会误判缺口。
- caller-only 帧（progress/QR/job 结果/弹幕批次）不占 rev。

### 5.2 事件类型

- `subscriptions.changed`（全量或 patch）
- `items.replaced` / `items.appended` / `items.patched` / `items.cleared`
- `settings.changed`（按 key）
- `reading.changed`（按 key）
- `job.progress` / `job.done`（caller-only）
- `danmaku.items`（caller-only：`{subId, items}`；与 job.* 一样广播，客户端按自带的 `subId` 过滤）
- `service.shutdown`

### 5.3 应用规则

- 客户端只接受 `rev = appliedRev + 1`；乱序/缺口 → 停止应用并全量 resync。
- items 事件对未知 `subscriptionId` 忽略（等待 subscriptions 事件或 resync）。
- 合帧只靠「一次 commit 带多条事件」（同一 rev 共享）；唯一的定时窗口是 reading 变更 1s 合批（`READING_BATCH_MS`，`server.ts:400-415`）。items/subscriptions/settings 无额外窗口，progress 不做限速；replace/append/clear 仍不合帧且 FIFO。
- WS 积压：只丢可合并事件并制造 gap → resync；不可合并事件不丢。

### 5.4 快照

- 单读事务取 `lastRev` 与数据；`snapshot.end` 后原子替换镜像。
- 快照包含：subscriptions/groups/settings/reading 全量 + items 轻量投影。
- **gzip 传输**：`Accept-Encoding: gzip` 时服务端压缩（`content-encoding: gzip`，客户端 fetch 自动解压）。
  快照 gzip 实测见 §9（`scripts/service-snapshot-size.ts` 可复测）。
- v1 不做窗口化（selectors 需要全量 `allItems`）；items >10k 的服务端聚合/窗口化归阶段 3。

### 5.5 断线

- fail-closed：保留只读镜像，禁用 mutation，顶部横幅；重连后 resync。
- v1 不做 outbox；写操作在断线时直接失败并提示。

## 6. 存储与迁移

### 6.1 路径与现状

- desktop 库实际在 **Roaming**：`%APPDATA%\app.amoeba.desktop\rss.db` / `rss.dev.db` / `rss.release-debug.db`；**已是 WAL**（实测 db 4.26MB + wal 2.88MB）。
- CLI 库：`apps/cli/.data/rss.db`，只允许显式 `--import-db`；不自动合并。
- 服务原地打开 desktop 库；打开前 `VACUUM INTO` 每日一次（`dataDir/backups`，保留 7 份；
  实测 2.75MB）。备份失败只记 stderr，不阻止启动。

### 6.2 打开门禁

- 服务是唯一 opener；desktop 注入会抛错的 `RejectingStorage`，残留直写立即失败
  （`injectTauriHost({storage:false})`）。
- 参数：WAL、`busy_timeout=5000`、`synchronous=NORMAL`、`foreign_keys=ON`、`wal_autocheckpoint=1000`、`journal_size_limit=64MB`
  （`apps/cli/src/store/sqlite-storage.ts`）。
- `_migrations(version,name,applied_at,checksum)` 已实现：DDL 唯一权威仍是 core
  `db/schema.ts` 的 `STORAGE_SCHEMA`；SQL 后端只执行。只向前；已应用版本 checksum
  变化 → 抛错拒绝启动（FNV-1a 32 位，非安全哈希）。两个后端（bun:sqlite /
  tauri-plugin-sql）各执行同一份注入 schema。

### 6.3 数据模型（v1）

- `reading` 继续整 blob；服务单写者 + 位置 1s 合并写，暂停/播完/关闭立即 flush。
- `subscriptions/groups/settings` 继续整 blob；语义命令 + 串行队列。
- `content/body` 缓存继续 KV；服务独占。
- tombstone 是**内存 Set**（`data-layer.ts:237`，`load()` 时清空）：服务单写者下退订即删内容，墓碑只防同进程在途刷新写回，不跨重启持久化。
- 行表（reading 按 item、body 拆表）只在实测超阈值后做（v2）。

### 6.4 写路径

- 服务单进程 + repo 内部串行链（subscriptions/reading/settings 各自）；KV 每条 mutation
  是单条 `INSERT … ON CONFLICT`，SQLite 语句级原子。v1 不额外包 `BEGIN IMMEDIATE`
  —— 单条 KV 写入不需要，显式事务留给 v2 行表。
- `markManyRead` 一次读改写、一次落盘；实测 5k = 6–7ms（阶段 0）。
- 位置/滚动：服务端 `reading.changed` 1s 合批；客户端仍按 5s 节流发 RPC。
- `opId` LRU 5min/1024，内存即可；长任务重复 opId 复用同一个 Promise。

### 6.5 迁移与回滚

- 以 desktop 库为基；每日 `VACUUM INTO` 单文件备份已实现。
- **回滚演练已验**（`service-data-check.ts`）：制造漂移 → 停服 → 删 `-wal/-shm` →
  备份覆盖 → 重启，settings 回到备份时点、`_migrations` 完好。bump epoch 由重启的
  新 `bootId` 天然提供（客户端 rev gap → resync）。
- settings 不字段合并；reading 按 `lastReadAt` 较新者胜；content/body 按 `fetchedAt` 较新者胜（未做自动合并，v1 CLI/desktop 共库）。
- 旧 desktop 构建打开已迁移库：新增 `_migrations` 表对旧构建无害（它只读写 `kv`）；
  checksum 门禁只在执行 `STORAGE_SCHEMA.versioned` 的后端生效。

## 7. desktop 客户端改造

### 7.1 RemoteDataLayer

- 与 `DataLayer` 同形；读走本地镜像，写走 RPC/job。实现在
  `packages/service-client`（desktop 与 CLI 共用），运行时不 import core 根入口，
  只从 `@amoeba/core/media-store|reading` 取实现。
- 镜像复用 `createMediaStore()`；`store.all/query/patch/subscribe/clear` 行为不变。
- 断线/rev gap → 关闭 WS → 重新 `GET /v1/state` 全量替换（不做事件补丁恢复）；
  镜像保留只读，写 RPC 失败由 desktop 回滚乐观 patch + toast。
- `subscriptions/groups/settings/reading` 用普通数组/对象镜像；selectors 不动。
- `canLoadMore/totalOf` 由快照与事件维护。

### 7.2 init

1. 取 endpoint（Tauri command）→ 建 client；
2. `GET /v1/state`，代理流式写入镜像；
3. `snapshot.end` 后一次性 `refreshView()`；
4. 连事件；
5. `refreshAll(false)`（本地 action，逐订阅调 `refresh`，保留逐条 busy/超时 UI）；
6. `ready=true`。

### 7.3 写与乐观更新

- `store.patch` 只改本地镜像，不入队。
- `reading.*` 动作先 patch，再发一条语义 RPC；失败回滚 patch + toast。
- `markAllRead`：一次 `store.patchMany` + 一次 `reading.markManyRead` + 一次 `refreshView`。
- 不做 outbox（v1）；断线时 mutation 直接失败。

### 7.4 性能

- `refreshView` 合帧：microtask 合并同一次事件突发里的多次调用（隐藏窗口 rAF 会停摆）。
- `refreshView` 单槽 memo（在 `ctx.ts`）：键 = `(itemsVersion, subscriptions, node, filter[node], sort[node], page[node], query, 日桶)`，
  全按引用/原始值比较；`itemsVersion` 由 `dl.store.subscribe` 自增（`store.all()` 每次返回新数组，不能拿数组身份当键）。
  命中则**整个 set 都跳过**（不触发 React 重渲染）；「今天」用日桶代替时间戳。
- 快照投影：gzip 实测见 §9（播客 `summary` 占大头，正文已剥离）；
  两阶段渲染（元数据先到，items 每 400 条分块）。
- 服务与 UI 并行启动；skeleton 不阻塞。

### 7.5 必改清单

- `apps/desktop/src/store/data-source.ts`：Tauri **只**走 `service_endpoint` → `createRemoteDataLayer`；
  非 Tauri（浏览器里跑 `bun run dev`）才回进程内 `createDataLayer`（纯前端调试）。
  桌面进程内回退（旧 `VITE_DATA_SERVICE=0`）已删除——它是唯一人为的第二写者入口。
- `ctx.ts`：`refreshView` 合帧（microtask；隐藏窗口 rAF 会停摆，不用 rAF）。
- `actions/subs.ts`、`actions/reading.ts`：写路径走服务；`markRead/markAllRead/toggleStar`
  失败回滚乐观 patch + toast 已加。
- `Diagnostics.tsx`、`dev/seed.ts`：已禁止直连 storage/browser；诊断走 `DataLayer.diagnostics`，
  seed 标记改 localStorage。
- `apps/src-tauri`：`service.rs`（spawn/adopt/READY/endpoint/shutdown）、`single-instance`、
  `tauri.conf.release.json` resources、`service_endpoint`；主窗口 Destroyed → 服务 shutdown。
- `webview_browser_*` / `TauriBrowserBackend` 保留给 mobile / 进程内调试（desktop 不注入）；
  服务接管路径不再注入 browser，`abortTabs` 调用已从 desktop 移除。

## 8. 打包与运行时

### 8.1 Tauri 的两种分发方式

- **`bundle.resources`**：把任意文件/目录（JS bundle、`bun.exe`、`amoeba-browser.exe`）复制进安装目录，运行时用 `resourceDir()` 定位。适合脚本/资源。
- **`bundle.externalBin`**：专为 sidecar 可执行文件设计，按 target triple 放到 app 同目录。

### 8.2 推荐：小启动器 + JS，不随包 Bun

**发布形态**：`amoeba-runtime.exe`（release 3.7MB）+ `dist/service/service.js`
（当前 1.2MB / 601 modules）+ `amoeba-browser.exe`（release 423KB）。启动器只做运行时
解析/下载，然后 spawn `bun service.js ...`；desktop 与 CLI 共用同一份 JS 与同一套解析逻辑。
安装包不再背 ~92MB 的 Bun；实测 NSIS 安装包 **7.14MiB**（含三件 sidecar 资源）。

**运行时顺序（2026-10-26 决策：全局优先 + 失败自动下载）**：

1. `AMOEBA_BUN` 显式路径（CI / 离线 / 特殊安装）；
2. 全局 PATH 里的 `bun`（版本闸门 `1.3 ≤ v < 2`）；
3. 随包 `bun.exe`（可选，离线发行版才塞；默认没有）；
4. 托管缓存 `%LOCALAPPDATA%\app.amoeba.runtime\bun-1.4.3\bun.exe`；
5. 自动下载固定版本 `1.4.3` → SHA256 校验 → 解压到缓存。

全失败才报错：「需要 Bun ≥1.3；可安装 Bun、设置 AMOEBA_BUN，或允许联网下载」。
**不静默回退 Node**：服务是 Bun-only（`bun:sqlite` / `Bun.serve` / `Bun.spawn` / `Bun.file`）。

理由：开发机直接吃全局 Bun；干净机器首次启动下载一次（44MB zip → 96MB exe），之后离线可用；
服务代码升级只替换几 MB 的 JS。代价：首次启动需要网络；全局 Bun 版本由用户环境决定（只做版本闸门）；
升级 Bun 需改启动器常量并重发（启动器很小）。

**回退**：`bun build --compile` 出 `rss.exe` 走 `externalBin`。零运行时依赖，但每次服务代码更新都要重打 92MB。

### 8.3 解析与下载契约

- **固定版本** `1.4.3`；全局 / `AMOEBA_BUN` 接受 `1.3.x–1.x`，版本不符时**跳过并继续**（不把「版本旧」误报成「找不到」）。
- `AMOEBA_BUN` 是显式覆盖：路径不存在或版本不合规 → **直接报错**，不静默改道。
- 下载源固定 HTTPS GitHub release；zip = 44,639,930 bytes，SHA256 =
  `0bf84e808552beea67bf1202a287a35c6c825d837b287b3f8e9dd513dba35d3d`；流式落盘同时算哈希，
  校验失败立即删除；大小上限 120MB。
- 只解压固定成员 `bun-windows-x64/bun.exe`（不按条目路径解压，避免 zip-slip）；先写 `.tmp`，
  再同卷原子 rename；落盘后跑一次 `bun --version` 复核。
- 缓存根 `%LOCALAPPDATA%\app.amoeba.runtime`；`AMOEBA_RUNTIME_DIR` 可覆盖；
  `AMOEBA_BUN_ZIP` 指向本地 zip 供离线/CI 测试（仍走校验和）。
- 两个客户端同时首次启动：`install.lock`（`create_new`，5 分钟 stale 回收）串行化；
  拿到锁后二次检查缓存，后到者不重复下载/覆盖。
- PATH 只接受绝对路径；PATH 上的 Bun 是用户可控的（用户明确选择全局优先），日志打印实际路径，
  下载/缓存路径不受 PATH 影响。
- 启动器日志一律 stderr；stdout 保留给服务的 `READY <port>`。下载进度只在 stderr。
- 自动下载目前仅 Windows x64；其他平台只走 1–3，失败给出手动安装提示。

### 8.4 阶段 0 打包实测

1. **已完成**：阶段 0/1 的启动器与 `service.js` 实跑记录见 §11「阶段 0」。
2. **已完成**：`tauri.conf.release.json` resources；NSIS 安装包（7.14MiB）内确认含
   `service\service.js`、`amoeba-runtime.exe`、`amoeba-browser.exe`；DB/profile 仍写
   `%APPDATA%`/`%LOCALAPPDATA%`；服务进程用 `CREATE_NO_WINDOW`。
3. **已完成（2026-10-26 本机实测）**：`TAURI_SIGNING_PRIVATE_KEY` 就位后 `tauri build` 产出
   `Amoeba_0.6.5_x64-setup.exe`（7.12MiB）+ `.exe.sig`，签名步骤通过（公钥已更新到
   `tauri.conf.json`，CI secret 同步）。
4. **已完成（本机替代 clean VM）**：`/S /D=<临时目录>` 静默安装 → 五个文件落盘（exe / runtime /
   browser / `service\service.js` / uninstall）→ 启动实机跑通（服务由**安装目录里的**
   `amoeba-runtime.exe` 拉起）→ 关主窗口后 app/runtime/browser 全退、endpoint/lock 清理 →
   静默卸载后目录、卸载注册表项、开始菜单快捷方式均无残留。硬杀主进程（模拟崩溃）也无孤儿。
   ⚠️ 仍待：干净 VM / 断网首启 / `externalBin` 编译版对比。

## 9. 性能预算（实测）

| 指标 | 实测 | 预算/动作 |
| --- | --- | --- |
| content 解析 | 40 key / 2,494 条 = **108–242ms**（冷/热缓存） | 服务 boot ≤500ms；超则加投影缓存/分订阅流式 |
| 全量 items JSON | **2.05MB** | 不作为快照 |
| 列表投影 JSON | **2.42MB 原始 / 616KB gzip**（2,521 条） | 预算按**传输量** ≤1MB；`service-snapshot-size.ts` 复测 |
| desktop KV | 2.6MB（content 2.6MB + subscriptions 10KB） | — |
| markManyRead 5k | **6–7ms** | 服务端一次事务 |
| markAllRead | 约 900 次 `refreshView`（1–3s） | 批量 patch + 合帧，目标 <50ms |
| 位置写 | 每 5s 整 blob 重写 | 服务端 1s 合批 |

阶段 0 脚本：`bun scripts/service-phase0.ts`（只读 dev 库 + 临时库；双写者丢更新已确定性复现，单写者对照不丢）。

## 10. 五个失败模式与防线

1. **reading 整 blob 丢更新**：服务单写者 + 语义命令 + 位置合批 + `lastReadAt` 拒绝过期写。
2. **subscriptions/settings 覆盖**：服务串行 + 语义命令 + settings 逐 key；cookie 同步只由服务写。
3. **游标/墓碑/TTL 分裂**：归服务；墓碑（内存）；按订阅单飞；写 content 前检查订阅存在。
4. **governor 分裂**：抓取 governor 只在服务；桌面只保留媒体 governor，平台桶不重叠。
5. **同步镜像不一致**：epoch/rev、合帧成一次提交、缺口 resync、写失败回滚、`patchMany` 批量。

## 11. 阶段计划

### 阶段 0：实测与骨架（3–5 天）

- **已完成（2026-10-26）**：
  - `scripts/service-phase0.ts` 全过——投影 0.48MB、解析 111ms、双写者丢更新已复现、
    单写者对照不丢、markManyRead 5k = 6ms。
  - 服务骨架 `apps/cli/src/service/server.ts`：`/v1/hello`、`/v1/health`、`/v1/state`
    （空快照）、`/v1/events`（WS 首帧认证）、`/v1/shutdown`、`instance.lock`、token；
    自检 `scripts/service-skeleton-check.ts` 13 项全过。
  - endpoint/lock/token 固定在 `--data-dir` 下：desktop 是 `%LOCALAPPDATA%\app.amoeba.desktop\service`，
    裸 `rss --service` 默认 `%LOCALAPPDATA%\app.amoeba.service\default`（`server.ts:114,330-331`）；
    未按 instanceKey 分目录，`instanceKey` 只做日志标识。
  - 运行时启动器 `apps/runtime`（`amoeba-runtime.exe`，release 3.7MB）：`AMOEBA_BUN` → PATH →
    随包 → 缓存 → 下载（SHA256/原子解压）；spawn Bun 并透传 stdio/退出码。
    已实测：全局命中、本地 zip 安装、真实 HTTPS 下载（44.6MB）、缓存命中、校验失败拒绝、
    `--no-download` 失败提示；`scripts/service-runtime-check.ts` 6 项全过。
  - 独立服务入口 `apps/cli/src/service/main.ts` → `bun run service:build` 出
    `dist/service/service.js`（阶段 0 仅 10KB / 3 modules），启动器跑打包产物同样 6 项全过。
- **已完成（2026-10-26）**：Tauri resources（`tauri.conf.release.json`）与 NSIS 安装包；
  真实 Tauri dev 实例通过 WebView2 loopback 连服务（CORS/WS/Origin 校验全过）；
  profile 直接复用 `%LOCALAPPDATA%\app.amoeba.desktop\webview-profile`，不重扫。
- 产出：测量报告 + go/no-go（go）。

### 阶段 1：单写者数据服务（已完成 2026-10-26）

- 服务接管 DB/迁移/crawler/browser/login/governor/jobs；
  `apps/cli/src/service/{server,host}.ts` + `packages/service-protocol`。
- 快照 + rev 事件环形缓冲 + `RemoteDataLayer`（`packages/service-client`）+ 本地镜像；
  desktop Tauri 只走服务（进程内回退已删）。
- desktop 库原地迁移；每日 `VACUUM INTO` 备份；`_migrations` checksum 门禁。
- **验收实测**：
  - `scripts/service-data-check.ts` 48 项全过（快照/事件 rev/阅读合批/settings/refresh/
    preview/loadMore/probe/cacheStats/幂等/退订清理/token 权限/迁移表/每日备份/回滚演练/
    job 取消/并发写）。
  - `scripts/remote-data-layer-check.ts` 38 项全过（镜像读/写 RPC/事件/诊断/退订/取消/
    崩溃 fail-closed/重启快照收敛）。
  - `scripts/service-snapshot-size.ts`：快照 gzip 实测见 §9。
  - 真机 Tauri：`remote=true`、53 订阅/2525 条目/ready=true；UI 标已读 → 服务落库；
    CLI `attach rpc reading.markRead` → 桌面事件立即变已读；反向同样可见。
  - 正常关窗：服务退出、endpoint/lock 清理、无残留进程。

### 阶段 2：收口与发布（已完成 2026-10-26）

- ✅ desktop 远端模式 `injectTauriHost({storage:false,browser:false})`；Diagnostics/seed 不再直连。
- ✅ single-instance（第二个实例只聚焦主窗口）、protocol=1 握手/426 门禁、`service_endpoint`。
- ✅ 安装包（启动器 + JS + 浏览器 sidecar 进 resources；NSIS 7.12MiB）+ updater 签名（`.sig`）。
- ✅ 本机静默安装/卸载（临时目录）验证无残留；实际安装版启动/关窗/硬杀均无孤儿进程。
- ⚠️ `tauri-plugin-sql` 保留（mobile 的进程内 DataLayer 仍用），未从 desktop 发布路径移除。
- 回滚演练已验：备份覆盖恢复 → settings 回到备份时点。

### 阶段 3（可选，按实测）

- reading 行表、body 拆表、服务端聚合/窗口化、outbox、常驻 daemon。

## 12. 后续（阶段 3 范畴，非本计划未完成项）

- 环境相关、需在干净目标机上复核：WebView2 Origin 白名单、断网首启、`externalBin` 编译版对比。
- 阶段 3 才做：items >10k 的服务端聚合/窗口化、reading 行表、body 拆表、outbox、常驻 daemon。
- `refreshAll`：服务端 job 已实现，但 desktop 仍逐订阅调 `refresh` 以保留逐条 busy/超时 UI
  （切换收益低于 UI 复杂度，暂不切）。
- 启动器自动下载在公司代理/杀软/无签名场景的表现待观测（Bun 版本闸门 1.3 ≤ v < 2 已实现，见 `apps/runtime/src/lib.rs:31-33`）。

## 13. 验收清单

- [x] 服务唯一写者，desktop 直写会抛错（`storage:false` → RejectingStorage；Diagnostics/seed 走 RPC）。
- [x] 双客户端并发 reading/settings 不丢更新（`service-data-check` 并发段：两条 markRead +
      一条 settings.set 同时发出，全部落库；真机双向可见另验）。
- [x] CLI 与 desktop 看到同一订阅/已读/设置/缓存。
- [x] 快照 ≤1MB（gzip 传输量，实测见 §9）、首屏不白屏；
      boot 实测 306ms（spawn → READY，含 `hydrate()`；`service-snapshot-size.ts` 可复测）。
- [x] markAllRead <50ms（服务端 5k 条 6–7ms）。
- [x] 服务崩溃/重启后镜像收敛：kill 进程 → status 离线 + 写 fail-closed → 同库重启 →
      新客户端快照恢复订阅/已读/星标（`remote-data-layer-check`）；回滚演练另验。
- [x] profile 复用 desktop `webview-profile`，登录态不丢。
- [x] 安装包包含服务与浏览器载具；静默安装→启动→关窗→卸载全流程无残留（本机实测；干净 VM 未跑）。
