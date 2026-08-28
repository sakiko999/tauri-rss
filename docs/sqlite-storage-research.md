# SQLite 存储接入调研与落地(2026-08-28)

> 动机:desktop 现用 webview localStorage(容量 ~5-10MB、同步阻塞、无查询能力),
> CLI 用 file-JSON。切 SQLite 是 P6 离线内容缓存的前置,也是 cli-plan §六既定路线
> (「file-JSON 起步,为 SQLite 切换留门」——repo 接口隔离让今天这次切换 repo 实现
> 零改动)。

## 一、选型:desktop 用 tauri-plugin-sql?

| 方案 | 说明 | 结论 |
|---|---|---|
| **tauri-plugin-sql(官方)** | sqlx 底层(sqlite feature),JS bindings `Database.load/execute/select` | ✅ **选定** |
| 自研 rusqlite command | `db_execute/db_select` 手写 command + JSON 绑定 + Mutex state(~100 行 Rust) | ❌ 插件就是这事的官方成品,自研零收益(除非要 SQLCipher 加密) |
| tauri-plugin-libsql / drizzle sqlite-proxy | ORM/加密/Turso 同步 | ❌ repo 接口已隔离 SQL,无 ORM 需求 |
| sql.js(wasm in webview) | 纯前端 | ❌ 性能差、持久化手动 |

**理由**:官方维护、桌面/移动全平台(mobile 将来直接受益)、API 面极小正对 KV 用法、
免写 Rust 样板。已知限制对本项目无影响:

- **IPC 开销**(plugins-workspace #2049:小查询也 ~ms 级)——KV 量级(3 个 key 的
  get/set)完全无感;内容缓存批量读写是未来场景,届时用单条 SQL 批量语句即可
- 无加密(sqlx 不支持 SQLCipher)、无 JS 侧事务——均不需要
- Windows MS Store 沙箱路径问题——不走商店分发

**关键取舍:migration 不用插件的(Rust 侧 `add_migrations`)**。插件的 migration 定义
落在 Rust,CLI(bun:sqlite)就得复制一份 SQL——正是 cli-plan §六禁止的「各写各的
SQL 导致漂移」。改为:DDL 归 **core(`packages/core/src/db/schema.ts`)**,两端启动时
各跑同一份幂等 DDL(`CREATE TABLE IF NOT EXISTS`)。P1 schema 极简(KV 一张表),
不需要版本化框架;`MIGRATIONS` 数组已就位,引入非幂等迁移时补版本表、两端复用同一
执行逻辑。

## 二、落地形态:KV-over-SQLite(repo 零改动)

三 repo(subscriptions/reading/settings)的数据形态就是三个 JSON blob,StorageBackend
(KV string)语义保持——**换的是 backend 实现,不是 repo**:

```
desktop:  injectTauriHost → SqliteStorageBackend(tauri-plugin-sql,appData/rss.db)
CLI:      setupHost       → sqliteStorage(bun:sqlite,apps/cli/.data/rss.db)
共用:     core db/schema.ts 的 KV_TABLE/KV_DDL/MIGRATIONS(唯一 DDL 权威)
不动:     三 repo / DataLayer / 命令层 / UI
```

将来需要结构化查询(阅读状态批量操作、缓存索引、全文搜索)时按 repo 逐个拆表——
repo 接口不变,只是 KV 实现换成 SQL 实现。

## 三、localStorage → SQLite 迁移(desktop)

`SqliteStorageBackend` 首次访问时惰性执行(进程内一次):
1. 建 KV 表(幂等 DDL)
2. 遍历 `subscriptions/reading/settings` 三个 localStorage key(`tauri-rss:` 前缀):
   sqlite 该 key **为空才写入**;随后**删除 local key**——无论哪种情况都移除,
   杜绝双源漂移(旧 local 值不是权威,sqlite 已有值优先)

## 四、验证状态

- ✅ CLI:bun:sqlite 全链(refresh 落库、幂等 update、env probe KV roundtrip、
  `rss.db` 文件 + kv 表 + subscriptions 行实测)
- ✅ Rust:`cargo check` 通过(插件注册 + sqlite feature 编译)
- ✅ 前端:全仓 tsc 七项目通过(含 desktop 编译 host 源码的 plugin-sql 类型)
- ⏳ desktop 运行时(Database.load + localStorage 搬迁)待下次 `bun run tauri` 实测
  ——编译层已验证,首次启动看点:appData/rss.db 生成、旧 localStorage 数据出现在
  sqlite 且 local key 被清

## 五、遗留/后续

- **WAL**:两端各自独立库文件(不共享),单进程顺序访问无并发诉求,暂不开
  `journal_mode=WAL`;将来 CLI 与 desktop sidecar 指向同一库文件时再开
  (cli-plan §六设想的「打开同一个文件」互通)
- desktop 运行时验证(上节 ⏳)
- P6 内容缓存接入时:新增 content 表走 MIGRATIONS,不在 KV 表里塞大 blob
