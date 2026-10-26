# 数据服务（CLI 载具）架构与落地计划

> 状态：阶段 0（2026-10-26 决策；骨架与运行时启动器已落地）
> 范围：desktop + CLI。mobile 不参与，继续进程内 `createDataLayer()`。

## 0. 决策摘要

| 议题 | 决定 |
| --- | --- |
| 服务形态 | `rss` 二进制的 `--service` 模式；CLI 命令与 desktop 都是客户端 |
| 生命周期 | desktop 启动时 spawn/adopt，退出时带走；不做常驻 daemon / 自启 |
| 写权威 | 服务是 SQLite、迁移、crawler/resolve、浏览器、登录/cookie、governor、job 的唯一写者 |
| desktop | 保留 React store/selectors/views、prefs/queue、播放器、媒体 Referer、媒体 governor；不再 `createDataLayer()`、不直开 DB、不碰抓取浏览器 |
| 传输 | `127.0.0.1` 随机端口 HTTP/1.1 JSON + WebSocket 事件；token；loopback + Host/Origin 校验 |
| 快照 | 全量轻量投影（实测 2,494 条 = 0.48MB）；桌面保留同步 `allItems` 镜像 |
| 事件 | `epoch` + 连续 `rev`；合帧 = 合并成一次提交（rev 不跳号）；缺口 → 全量 resync |
| 断线 | fail-closed：只读镜像 + 禁用全部 mutation；v1 不做 outbox |
| 存储 | 沿用 desktop 现有库（WAL 已开）；v1 reading 仍是整 blob + 1s 合并写；行表留 v2 |
| profile | 归服务；阶段 0 验证从 desktop `webview-profile` 复制迁移 |
| 打包 | 小启动器 `amoeba-runtime.exe`（Rust）+ JS；Bun **全局优先、缺失自动下载**；`amoeba-browser.exe` 始终随包 |
| mobile | 不参与协议；不跑 v2 迁移，保持现有 blob 语义 |

**一句话**：服务是唯一写者，桌面只是带本地镜像的客户端；CLI 是同一服务的另一个客户端，也是这个服务的载具。

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
2. Rust 解析 `dataDir` / `dbFile`（dev / release-debug / prod 三个文件名）/ `profileDir`，算 `instanceKey`。
3. 读 `<LOCALAPPDATA>\app.amoeba.service\<instanceKey>\endpoint.json`；有存活服务 → `GET /v1/hello` 校验协议 → adopt。
4. 否则生成 owner token（32 字节 hex）写临时文件，spawn `rss --service --data-dir ... --db ... --profile-dir ... --port 0 --token-file ... --parent-pid <desktop pid>`。
5. 读 stdout 首行 `READY <port>`，上限 30s（boot 要跑迁移）。
6. `GET /v1/hello` 校验 pid / bootId / protocol / token。
7. `GET /v1/state`（NDJSON）建镜像；收到 `snapshot.end` 才原子替换。
8. 连 `/v1/events`，首帧认证后 `subscribe { sinceRev }`。
9. 通过 Tauri command `service_endpoint` 把 `{port, token, bootId, protocol}` 交给 renderer；renderer 建 `RemoteDataLayer`。
10. `ready=true`；`refreshAll` 以 job 触发。

任何一步失败 → 全页错误 + 重试；**不创建本地 DataLayer、不打开 SQLite**。

### 2.3 发现、单实例与 token

- `instanceKey = sha256(canonical(dbFile) + "\0" + canonical(profileDir))`；DB 与 profile 双重身份，避免「同 DB 不同 profile」的双写者。
- `instance.lock`：`open(..., "wx")` 原子创建，内容 `{pid, bootId, startedAt}`；启动遇锁先探活，存活且协议兼容 → `ALREADY_RUNNING <port>` 退出码 3（调用方转 attach）。
- 两种 token：
  - **owner token**：spawn 者持有（desktop / CLI `--ephemeral`），可调 `/v1/shutdown`；
  - **client token**：endpoint.json 里的只读/命令 token，CLI attach 用，不能 shutdown。
- token 只经 `--token-file` 或 stdin 传入，**绝不进 argv、URL、日志、diagnostics**。
- HTTP `Authorization: Bearer`；WS 首帧 `{type:"auth", token}`；1s 内未认证断开。

### 2.4 CLI：attach 还是临时拉起

- 默认 `--attach auto`：按命令的 `dataDir` 算 key → 有存活服务就 attach；否则 spawn `rss --service --ephemeral --parent-pid <cli pid>`，命令结束 shutdown。
- `--no-spawn`：只 attach，找不到就报错。
- `--service`：前台运行服务。
- 两个 CLI 抢锁：败者退出码 3 后重读 endpoint attach，不重复 spawn。
- attach 到 desktop 服务时 CLI 不 shutdown；只有 owner 能 shutdown。
- CLI 不再有进程内 `createDataLayer()` 调试模式（避免第二写者）。`fetch/item/play/dm` 也走服务。

### 2.5 退出、崩溃与孤儿

- desktop 主窗口 `Destroyed` → `POST /v1/shutdown`（2s 预算）→ 关闭 `KILL_ON_JOB_CLOSE` Job → `exit(0)`。
- 服务优雅退出：停新命令 → 取消 job / abort CDP → 等写入链 ≤5s → 关 `amoeba-browser`（cookie flush ≤5s）→ `db.close()` → 删 endpoint/lock。
- 硬杀：SQLite WAL 恢复；`amoeba-browser` 由 `--parent-pid` 退出；profile 命名 mutex 防双开。
- renderer reload / HMR 不退出服务，只重连。
- 服务崩溃：owner 重拉 3 次（0.5/1/2s 退避）；non-owner 直接 `service-unavailable`。`bootId` 变化 → 全量 resync。

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
- 认证失败限速；错误不回显 token。
- 通用 CDP/evaluate 不暴露；客户端只能调 DataLayer 语义方法。
- cookie/QR/Authorization 不落日志、diagnostics、错误消息。

### 3.4 版本

- `protocol` 整数 + `serviceVersion` semver + `features[]`。
- 不兼容 → 426 `protocol-mismatch`；desktop 强制重启服务，CLI 拒绝 attach。
- 同 protocol 内只做加法。

## 4. API 面（39 个 DataLayer 成员）

### 4.1 分组

| 组 | 成员 | 处理 |
| --- | --- | --- |
| 本地镜像读（12） | `listChannels`、`channelKind`、`subscriptions.list/listGroups/get`、`reading.getAll/get`、`settings.get`、`store.all/query`、`canLoadMore`、`totalOf` | 快照 + 事件维护，客户端同步读 |
| 语义命令（14） | `subscriptions.add/update/remove/addGroup/updateGroup/removeGroup`、`reading.markRead/markManyRead/setStarred/setPosition/setScrollRatio`、`settings.set/setIfUnchanged/reset` | `POST /v1/rpc`，带 `opId` |
| 长任务（10） | `addSubscription`、`previewChannel`、`refresh`、`loadMore`、`resolveDetail`、`resolvePlay`、`resolveLivePlay`、`resolveHotWord`、`scanLogin`、`syncBrowserCookies` | job + progress 事件 |
| 客户端本地（2+） | `store.patch`（乐观镜像）、`store.subscribe`（本地事件） | 不上线 |

`reading.deleteBySubscription` 并入 `subscriptions.remove` 的服务端事务，不单独暴露。

### 4.2 job 语义

- 所有网络型长操作 job 化；facade 保持原 Promise 签名，内部 await job 终态。
- `refresh`/`loadMore` 按订阅单飞；`refreshAll` 是服务端单 job（统一并发/超时/汇总/取消）。
- 取消按 job 隔离：`lane → jobId`，只 abort 本 job 的 CDP lane，替代全局 `abortTabs`（顺带修 R5）。
- HTTP 断开不取消 job；caller-only 任务（preview/detail/QR）在调用方断开后由 lease 超时回收。
- 超时在服务内部；45s refresh 预算不再放客户端。

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
- cookie 同步只由服务在 boot 后 1.5s 执行；desktop 不再调用；
- `settings.set` 只写指定 key；服务收到后重配 governor/TTL/autoRefresh。

### 4.6 resolvePlay 归属

- 移到服务（job），返回 `ResolvedPlayback`/streams；
- desktop 不再需要 `setPlatformCookieLookup`，避免登录态播放静默降级；
- 媒体字节仍由 renderer 直接请求，媒体 governor 留在桌面；抓取 governor 只在服务。

## 5. 事件与一致性

### 5.1 身份与版本

- `epoch`：每次服务启动生成；`bootId` 用于诊断。
- `rev`：全局单调提交号；**每个改变镜像状态的提交必须发一条事件**。
- 合帧：多种变更合并成**一次提交**（rev +1），不是丢弃中间 rev。这样 rev 连续，客户端不会误判缺口。
- caller-only 帧（progress/QR/job 结果）不占 rev。

### 5.2 事件类型

- `subscriptions.changed`（全量或 patch）
- `items.replaced` / `items.appended` / `items.patched` / `items.cleared`
- `settings.changed`（按 key）
- `reading.changed`（按 key）
- `job.progress` / `job.done`（caller-only）
- `service.shutdown`

### 5.3 应用规则

- 客户端只接受 `rev = appliedRev + 1`；乱序/缺口 → 停止应用并全量 resync。
- items 事件对未知 `subscriptionId` 忽略（等待 subscriptions 事件或 resync）。
- 合帧窗口：items 100ms、subscriptions/settings 50ms、progress ≤4/s；replace/append/clear 不合帧且 FIFO。
- WS 积压：只丢可合并事件并制造 gap → resync；不可合并事件不丢。

### 5.4 快照

- 单读事务取 `lastRev` 与数据；`snapshot.end` 后原子替换镜像。
- 快照包含：subscriptions/groups/settings/reading 全量 + items 轻量投影。
- 全量投影实测 2,494 条 = 0.48MB；v1 不做窗口化（selectors 需要全量 `allItems`）。
- 上限：items ≤10k 且投影 ≤4MB 走全量；超过再设计服务端聚合/窗口化（v2）。

### 5.5 断线

- fail-closed：保留只读镜像，禁用 mutation，顶部横幅；重连后 resync。
- v1 不做 outbox；写操作在断线时直接失败并提示。

## 6. 存储与迁移

### 6.1 路径与现状

- desktop 库实际在 **Roaming**：`%APPDATA%\app.amoeba.desktop\rss.db` / `rss.dev.db` / `rss.release-debug.db`；**已是 WAL**（实测 db 4.26MB + wal 2.88MB）。
- CLI 库：`apps/cli/.data/rss.db`，只允许显式 `--import-db`；不自动合并。
- 服务原地打开 desktop 库；迁移前 `VACUUM INTO` 备份。

### 6.2 打开门禁

- 服务是唯一 opener；desktop 注入会抛错的 `RejectingStorage`，残留直写立即失败。
- 参数：WAL、`busy_timeout=5000`、`synchronous=NORMAL`、`foreign_keys=ON`、`wal_autocheckpoint=1000`、`journal_size_limit=64MB`。
- 新增 `_migrations(version,name,applied_at,checksum)`；只向前；checksum 变化拒绝启动。
- DDL 仍归 core `db/schema.ts`；迁移执行器放 host 工具。

### 6.3 数据模型（v1）

- `reading` 继续整 blob；服务单写者 + 位置 1s 合并写，暂停/播完/关闭立即 flush。
- `subscriptions/groups/settings` 继续整 blob；语义命令 + 串行队列。
- `content/body` 缓存继续 KV；服务独占。
- tombstone 持久化（KV `removed:<subId>` 或表）；在途 fetch 完成写入前检查订阅存在性。
- 行表（reading 按 item、body 拆表）只在实测超阈值后做（v2）。

### 6.4 写路径

- 单条串行队列 + `BEGIN IMMEDIATE`；每个 mutation 一个事务。
- `markManyRead` 一次事务；5k 条目标 ≤100ms。
- 位置/滚动：服务端 1s 合批；客户端不再 5s 一次 RPC。
- `opId` LRU 5min/1024，内存即可。

### 6.5 迁移与回滚

- 以 desktop 库为基；备份 `VACUUM INTO` 单文件；冷备份必须 db+wal+shm。
- 恢复前删除目标 `-wal/-shm` 并 bump epoch。
- settings 不字段合并；reading 按 `lastReadAt` 较新者胜；content/body 按 `fetchedAt` 较新者胜。
- 旧 desktop 构建打开已迁移库：schema 门禁拒绝并提示升级。

## 7. desktop 客户端改造

### 7.1 RemoteDataLayer

- 与 `DataLayer` 同形；读走本地镜像，写走 RPC/job。
- 镜像复用 `createMediaStore()`；`store.all/query/patch/subscribe` 行为不变。
- `subscriptions/groups/settings/reading` 用普通数组/对象镜像；selectors 不动。
- `canLoadMore/totalOf` 由快照与事件维护。

### 7.2 init

1. 取 endpoint（Tauri command）→ 建 client；
2. `GET /v1/state`，代理流式写入镜像；
3. `snapshot.end` 后一次性 `refreshView()`；
4. 连事件；
5. `refreshAll` job；
6. `ready=true`。

### 7.3 写与乐观更新

- `store.patch` 只改本地镜像，不入队。
- `reading.*` 动作先 patch，再发一条语义 RPC；失败回滚 patch + toast。
- `markAllRead`：一次 `store.patchMany` + 一次 `reading.markManyRead` + 一次 `refreshView`。
- 不做 outbox（v1）；断线时 mutation 直接失败。

### 7.4 性能

- `refreshView` 合帧：microtask/rAF 合并同一帧多次事件。
- `queryView` memo：按 `(itemsRev, subscriptionsRev, filter, sort, page, query, node)` 缓存。
- 快照投影 0.48MB；两阶段渲染（元数据先到，items 分块）。
- 服务与 UI 并行启动；skeleton 不阻塞。

### 7.5 必改清单

- `apps/desktop/src/store/actions/data.ts`：`createDataLayer` → `createRemoteDataLayer`；`syncBrowserCookies` 移除。
- `ctx.ts`：`refreshView` 合帧。
- `actions/subs.ts`、`actions/reading.ts`：写路径改 RPC；批量。
- `Diagnostics.tsx`、`dev/seed.ts`、`AccountPage.tsx`、`data.ts:197`：禁止直连 storage/browser，改服务端点。
- `apps/src-tauri`：spawn 服务、externalBin/resources、single-instance、shutdown、`service_endpoint`。
- 删除 `webview_browser_*` / `TauriBrowserBackend` / `withBrowserGlobal` / `abortTabs`（在服务接管浏览器并通过 parity 后）。

## 8. 打包与运行时

### 8.1 Tauri 的两种分发方式

- **`bundle.resources`**：把任意文件/目录（JS bundle、`bun.exe`、`amoeba-browser.exe`）复制进安装目录，运行时用 `resourceDir()` 定位。适合脚本/资源。
- **`bundle.externalBin`**：专为 sidecar 可执行文件设计，按 target triple 放到 app 同目录。

### 8.2 推荐：小启动器 + JS，不随包 Bun

**发布形态**：`amoeba-runtime.exe`（Rust，release 3.7MB）+ `dist/service/service.js`（阶段 0 10KB）
+ `amoeba-browser.exe`。启动器只做运行时解析/下载，然后 spawn `bun service.js ...`；
desktop 与 CLI 共用同一份 JS 与同一套解析逻辑。安装包不再背 ~92MB 的 Bun。

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

1. 启动器三个来源各跑一次：全局 PATH、托管缓存、下载（本地 zip 模拟）；确认 stdout 干净。
2. 用真实服务（含 `bun:sqlite`、动态渠道 import、`amoeba-browser` 路径）跑一次 clean VM 安装/卸载，
   断网走缓存、首次联网走下载。
3. Tauri `resources` 发 JS + 启动器 + `amoeba-browser.exe`；确认安装目录只读时 DB/profile 仍写
   `%APPDATA%`/`%LOCALAPPDATA%`，且无控制台闪窗。
4. `externalBin` 编译版对比安装包体积、冷启动、updater 替换。

## 9. 性能预算（实测）

| 指标 | 实测 | 预算/动作 |
| --- | --- | --- |
| content 解析 | 40 key / 2,494 条 = **108–242ms**（冷/热缓存） | 服务 boot ≤500ms；超则加投影缓存/分订阅流式 |
| 全量 items JSON | **2.05MB** | 不作为快照 |
| 列表投影 JSON | **0.48MB** | 快照 ≤1MB；实测可接受 |
| desktop KV | 2.6MB（content 2.6MB + subscriptions 10KB） | — |
| markManyRead 5k | **6–7ms** | 服务端一次事务 |
| markAllRead | 约 900 次 `refreshView`（1–3s） | 批量 patch + 合帧，目标 <50ms |
| 位置写 | 每 5s 整 blob 重写 | 服务端 1s 合批 |

阶段 0 脚本：`bun scripts/service-phase0.ts`（只读 dev 库 + 临时库；双写者丢更新已确定性复现，单写者对照不丢）。

## 10. 五个失败模式与防线

1. **reading 整 blob 丢更新**：服务单写者 + 语义命令 + 位置合批 + `lastReadAt` 拒绝过期写。
2. **subscriptions/settings 覆盖**：服务串行 + 语义命令 + settings 逐 key；cookie 同步只由服务写。
3. **游标/墓碑/TTL 分裂**：归服务；墓碑持久化；按订阅单飞；写 content 前检查订阅存在。
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
  - 阶段 0 骨架的 endpoint/lock/token 放在 `--data-dir` 下；阶段 1 起按 instanceKey
    移到 `%LOCALAPPDATA%\app.amoeba.service\<key>\`。
  - 运行时启动器 `apps/runtime`（`amoeba-runtime.exe`，release 3.7MB）：`AMOEBA_BUN` → PATH →
    随包 → 缓存 → 下载（SHA256/原子解压）；spawn Bun 并透传 stdio/退出码。
    已实测：全局命中、本地 zip 安装、真实 HTTPS 下载（44.6MB）、缓存命中、校验失败拒绝、
    `--no-download` 失败提示；`scripts/service-runtime-check.ts` 6 项全过。
  - 独立服务入口 `apps/cli/src/service/main.ts` → `bun run service:build` 出
    `dist/service/service.js`（阶段 0 仅 10KB / 3 modules），启动器跑打包产物同样 6 项全过。
- 待做：Tauri resources/externalBin 打包；WebView2 loopback；profile 复制迁移。
- 产出：测量报告 + go/no-go。
- 停止条件：投影 >1MB 或 boot >500ms；WebView2 被 CSP/混合内容挡住；resources/externalBin 都不可行；profile 必须重扫且不接受。

### 阶段 1：单写者数据服务（3–4 周）

- 服务接管 DB/迁移/crawler/browser/login/governor/jobs。
- 快照 + 事件 + RemoteDataLayer + 镜像；desktop 用 `AMOEBA_DATA_SERVICE=1` 开关切换。
- 迁移 desktop 库、备份、回滚开关。
- 验收：双客户端并发不丢更新；CLI refresh → desktop 事件；desktop 标已读 → CLI 可见；UI parity。

### 阶段 2：收口与发布（1–2 周）

- 删除 desktop 直连 storage/browser 的残留；去 `tauri-plugin-sql`（mobile 保留）。
- 打包（启动器 + JS；编译版作回退）、single-instance、版本协商、updater、回滚演练。
- 验收：安装包可启动；旧服务/新 UI 强制重启；安全 checklist。

### 阶段 3（可选，按实测）

- reading 行表、body 拆表、服务端聚合/窗口化、outbox、常驻 daemon。

## 12. 待决问题

- Tauri 生产 WebView2 的 Origin 是 `http://tauri.localhost` 还是 `https://tauri.localhost`（mixed content 风险）。
- 启动器自动下载在公司代理/杀软/无签名场景的表现；Bun 1.4.3 之外版本的兼容闸门。
- profile 复制迁移是否保留 xhs/weibo 登录态（阶段 0 实测）。
- 全量镜像上限：items >10k 时的窗口化/服务端聚合方案。
- `refreshAll` 服务端单 job 与现有 desktop 编排的替换细节。

## 13. 验收清单

- [ ] 服务唯一写者，desktop 直写会抛错。
- [ ] 双客户端并发 reading/subscriptions/settings 不丢更新。
- [ ] CLI 与 desktop 看到同一订阅/已读/设置/缓存。
- [ ] 快照 ≤1MB、boot ≤500ms、首屏不白屏。
- [ ] markAllRead <50ms。
- [ ] 服务崩溃/重启后镜像 resync 收敛。
- [ ] profile 复用或一次性迁移，登录态不丢。
- [ ] 安装包包含服务与浏览器载具，卸载/更新无残留。
