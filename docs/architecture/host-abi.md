# 宿主门面 appHost

> `CLAUDE.md` 只留「全局注入 + 必填/可选」三行；存储四态与 DDL 权威见 `docs/architecture/data-and-storage.md`，
> governor 见 `docs/risk/crawler-risk-control.md`。

宿主能力经全局 `globalThis.appHost` 注入，门面在 `packages/host/src/runtime.ts`。
`setHostCaps` / 各 `inject*Host` 内部幂等调用 `initAppHost()`；**根入口 import 不再有副作用**。
应用按环境取子路径（`@amoeba/host/{node,tauri,browser,runtime,governor,cdp}`），避免三套后端全进模块图。
类型声明在根 `global.d.ts`，经 `tsconfig.app.json` 的 `files` 传递。

- **注入**：desktop `injectTauriHost()`（main.tsx）· example/测试 `injectNodeHost()` ·
  纯前端调试 `injectBrowserHost()`（CORS 受限）
- **desktop 默认（数据服务模式）**：`injectTauriHost({nativeMediaReferer:true, storage:false, browser:false})`
  —— `storage:false` 注入「读写即抛错」的拒绝后端，`browser:false` 不构造 CDP 后端；
  两者都是**能力探测可见的关闭**（不是「注入了但命令失败」），保证 desktop 不再是第二写者。
  desktop 固定 `storage:false` / `browser:false`；进程内 DataLayer 回退（旧 `VITE_DATA_SERVICE=0`）已删除。
- **必填**：`http` / `js`（签名脚本执行）/ `storage`（数据服务模式下是拒绝后端）。未注入时访问抛清晰错误
- **可选**（未注入返回 undefined，消费侧据此降级）：`ws`（弹幕隧道）、`browser`（CDP 模拟）、`updater`
- **兜底**：`now`（Date.now）。日志不走门面（`appHost.log` 已删），统一用 `@amoeba/log`
- **`openExternal(url)`**：打开外链。⚠️ 桌面必须走它（Tauri opener 插件）—— WebView 会拦掉
  `window.open`，表现为「点了没反应」
- **`dataSaver`**：渲染管线开关（AppSettings 的镜像，ui 的 MediaImage 直读，
  避免层层传 props）。由 app 层在设置变化时写入
- **`net`**：网络治理门面（`configure` / `reportRisk` / `browserGate` / `governorStats`）。
  governor 是 host 内建能力，未注入 http 也恒可用；CDP 操作必须过 `browserGate` ——
  等级/冷却/统计见 `docs/risk/crawler-risk-control.md`
- **防盗链注入不暴露门面**：Windows 桌面 Rust 在 WebView2 网络层改写请求头（图片/
  视频 Referer、XHR/fetch Origin、媒体 UA 去 Edge 品牌，`apps/src-tauri/src/media_referer.rs`），
  消费侧（`MediaImage`、实况视频、播客音频）无感知、恒直连——`nativeMediaReferer`
  能力探测已删（2026-10-28），见 `docs/ui/ui-conventions.md`
- **媒体 403 的表象是 `Format error`**：被 ORB 拦掉的 403 text/html 在 `<audio>/<video>`
  上只报 `MEDIA_ELEMENT_ERROR: Format error`，看起来像解码失败。排查先看 CDP
  `Network.loadingFailed` 的 `net::ERR_BLOCKED_BY_ORB` 与原始响应状态，再查规则表。

**storage 四态（2026-10-26）**：数据服务 `sqliteStorage`（bun:sqlite，唯一写者）·
desktop 拒绝后端（`injectTauriHost({storage:false})`，读写即抛）· mobile `SqliteStorageBackend`
（tauri-plugin-sql，进程内 DataLayer）· example 内存版。
**DDL 唯一权威 = core `db/schema.ts`**（插件自带的 migration 机制不用，防漂移）。
**注入方式**：`StorageBackend` 可选 `setSchema?(schema: StorageSchema)`（`StorageSchema = { table, ddl, migrations, versioned? }`，
类型在根 `global.d.ts:268-279`）。core 在 `createDataLayer()` 首行调用
`appHost.storage.setSchema?.(STORAGE_SCHEMA)`（`packages/core/src/db/schema.ts:66-75` 的单一权威对象，含 `versioned`）；
SQL 后端（`SqliteStorageBackend` / CLI `sqliteStorage`）只保存并执行，首次读写前未注入即抛错；
建连后只接受同一份 schema，换 schema 会被拒绝。迁移表 `_migrations` 记录 version/name/applied_at/checksum，
checksum 不符拒绝启动（见 `data-and-storage.md`「单写者与迁移/备份」）。
KV/localStorage/内存后端不实现，调用方用 `?.` 保持 no-op。

**批量写（R10）**：可选 `batch?(ops: StorageOp[])`（set/delete 混合）。服务 bun:sqlite 用
`db.transaction`、内存后端同步循环；`SqliteStorageBackend`（tauri-plugin-sql）刻意不实现
——sqlx 连接池无法保证同一连接，靠 core 回退逐个调用（该后端只剩 mobile 的进程内路径）。

**内容缓存**：refresh 走 TTL 缓存（KV key `content:<subId>`，value = `{fetchedAt, xml}`）。
细则见 `docs/architecture/data-and-storage.md`。

**读取约定**：读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装；新直引前先问「能否经 core 门面」。
