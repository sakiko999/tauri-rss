# 宿主门面 appHost

> 从 `CLAUDE.md` 迁出（2026-10-21）。`CLAUDE.md` 只留「全局注入 + 必填/可选」三行。
> 存储三态与 DDL 权威见 `docs/architecture/data-and-storage.md`；governor 见 `docs/risk/crawler-risk-control.md`。

宿主能力经全局 `globalThis.appHost` 注入，门面在 `packages/host/src/runtime.ts`。
`setHostCaps` / 各 `inject*Host` 内部幂等调用 `initAppHost()`；**根入口 import 不再有副作用**。
应用按环境取子路径（`@amoeba/host/{node,tauri,browser,runtime,governor}`），避免三套后端全进模块图。
类型声明在根 `global.d.ts`，经 `tsconfig.app.json` 的 `files` 传递。

- **注入**：desktop `injectTauriHost()`（main.tsx）· example/测试 `injectNodeHost()` ·
  纯前端调试 `injectBrowserHost()`（CORS 受限）
- **必填**：`http` / `js`（签名脚本执行）/ `storage`。未注入时访问抛清晰错误
- **可选**（未注入返回 undefined，消费侧据此降级）：`ws`（弹幕隧道）、`browser`（CDP 模拟）
- **兜底**：`log`（console）、`now`（Date.now）
- **`openExternal(url)`**：打开外链。⚠️ 桌面必须走它（Tauri opener 插件）—— WebView 会拦掉
  `window.open`，表现为「点了没反应」
- **`imageProxy` / `dataSaver`**：渲染管线开关（AppSettings 的镜像，ui 的 MediaImage 直读，
  避免层层传 props）。由 app 层在设置变化时写入
- **`net`**：网络治理门面（`configure` / `reportRisk` / `governorStats`）。governor 是 host
  内建能力，未注入 http 也恒可用 —— 等级/冷却/统计见 `docs/risk/crawler-risk-control.md`

**storage 三态**：desktop `SqliteStorageBackend`（tauri-plugin-sql，appData/rss.db）·
CLI `sqliteStorage`（bun:sqlite）· example 内存版。
**DDL 唯一权威 = core `db/schema.ts`**（插件自带的 migration 机制不用，防漂移）。
**注入方式**：`StorageBackend` 新增可选 `setSchema?(schema: StorageSchema)`（`StorageSchema = { table, ddl, migrations }`，
类型在根 `global.d.ts`）。core 在 `createDataLayer()` 首行调用
`appHost.storage.setSchema?.({ table: KV_TABLE, ddl: KV_DDL, migrations: MIGRATIONS })`；
SQL 后端（`SqliteStorageBackend`）只保存并执行，首次读写前未注入即抛错；建连后只接受同一份 schema，换 schema 会被拒绝。
KV/localStorage/内存后端不实现，调用方用 `?.` 保持 no-op。CLI 的 `sqliteStorage` 仍是 app 层直接 import core
并执行 `MIGRATIONS`（未接 `setSchema`）。

**内容缓存**：refresh 走 TTL 缓存（KV key `content:<subId>`，value = `{fetchedAt, xml}`）。
细则见 `docs/architecture/data-and-storage.md`。

**读取约定**：读取端（crawler/core）直接访问 `globalThis.appHost.*`，不各自包装。
曾有例外「desktop 直引 resolve 的 `fetchDouyinSuggestions`」—— 2026-10-16 已删（发现页每键
联想改为手动搜索；该函数仅剩 CLI `rss sug` 消费）。**新直引前先问「能否经 core 门面」。**
