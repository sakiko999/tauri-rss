# 系统架构文档集 · 索引

> 面向「整个 monorepo 怎么组织、跨包靠什么协作」的系统级文档。基于 2026-10-27 的 v0.7.0 快照；读完本页即可判断下一步打开哪一份。

## 这套文档回答什么

- 11 个库包 + 3 个 TypeScript 应用 + 3 个 Rust crate（`src-tauri` / `browser-sidecar` / `runtime`）——为什么这样切分，边界由哪条契约维持（`01-packages.md`）。
- 跨包流动的数据结构、类型与协议：`Item`、`MediaItem`、`tpl:*`、`RssChannel`、`DataLayer`、`MediaStream`、`AppHost`（`02-contracts.md`）。
- 数据从哪产生、经哪些步骤、最终落到哪：抓取、缓存重放、翻页、播放解析、登录与凭证（`03-flows.md`）。
- 新增渠道/平台/播放入口的完整改动面（`04-extension.md`）；显式约束、隐式约定、耦合与演进风险（`05-risks.md`）。

## 这套文档不回答什么

| 不在范围内 | 去看 |
| --- | --- |
| 单平台反爬细节与实测坑（签名/cookie/风控码） | `../../platforms/platform-notes.md`、`../../platforms/channels.md` |
| `appHost` 逐字段 ABI、注入生命周期；XML 通道事故与存储语义 | `../host-abi.md`、`../data-and-storage.md` |
| 抓取浏览器归谁/用什么载体（服务 spawn sidecar）；移动端为何不能复用 CDP | `../crawler-topology.md` |
| 播放器引擎内部与弹幕 codec；风控等级与 lane 调度 | `../../playback/playback.md`、`../../risk/crawler-risk-control.md` |
| UI 视觉与组件分层；命令与巡检清单 | `../../ui/ui-conventions.md`、`../../ops/smoke-check.md` |

## 文档清单

| 文件 | 内容 | 什么时候读 |
| --- | --- | --- |
| `00-overview.md` | 系统定位、五层分层（L0 协议 / L1 宿主·平台 / L2 渠道 / L3 编排 / L4 播放·原子）、运行时能力矩阵、数据管道与核心设计决策 | 第一次接触本仓 |
| `01-packages.md` | 每个包的职责、公共入口、真实依赖边与残留耦合（环已断）、包级不变量 | 判断改动该落在哪个包 |
| `02-contracts.md` | 跨包类型/接口的权威定义、镜像与投影、字段保真矩阵、契约缺口 | 改数据结构或接口签名前 |
| `03-flows.md` | 刷新/缓存/翻页/播放/登录/启动的端到端时序与状态迁移 | 排查「数据没到」或「状态不对」 |
| `04-extension.md` | 加渠道、加平台、加跨包字段、加播放引擎/格式、加视图/设置、加 storage 后端或 CLI 命令的分步 recipe | 动手写新功能 |
| `05-risks.md` | 架构约束、隐式约定、耦合点、文档与代码漂移清单 | 重构、评审、发版前 |
| `06-data-service.md` | 数据服务的目标、单写者边界、HTTP/WS 协议、事件/存储/客户端改造、打包与运行时（阶段 0-2 已完成） | 改协议/客户端或排查服务时 |

## 三条阅读路线

**新开发者**：本页 → `00-overview.md` → `01-packages.md` → `02-contracts.md` → `03-flows.md`，再补 `../data-and-storage.md` 与 `../host-abi.md`。可用 `bun run rss channels` 看注册表、`bun packages/core/src/example/data-layer.check.ts` 看编排。

**改 crawler 渠道或平台解析**：`01-packages.md`（crawler↔resolve 边界）→ `02-contracts.md`（`Item`/`tpl:*`/`Stream` 保真度）→ `04-extension.md` → `../../platforms/channels.md`。
关键事实：crawler 产出 `Item[]` 经 `serializeFeed` 出 XML（`packages/xml/src/serialize.ts:35`），core 只用 `parseFeed`+`deserializeFeed` 重建（`packages/core/src/processing/deserialize.ts:26`），两侧字段必须对称。

**改播放或桌面数据流**：`03-flows.md`（播放解析与刷新两条主链）→ `02-contracts.md`（`MediaStream`/`ResolvePlayback`）→ `../../playback/playback.md`。
关键事实：`PlayableMedia` 是唯一播放入口（`packages/player/src/PlayableMedia.tsx:113`），选流 = `streams[0]`，由 resolve 侧排序保证。

## 依赖总图

权威依赖图见 `01-packages.md` §1.1（按 desktop / mobile / cli 分节点绘制；三端声明的依赖集合不同，例如 CLI 不依赖 `player`/`ui`、desktop 不直接依赖 `crawler`），逐格子矩阵见 §1.2。本页不复刻，避免出现第二份会漂移的图。

**依赖图已恢复 DAG（2026-10-23）**：`host → core` 已删除（DDL 由 core 经 `storage.setSchema?()` 注入），`resolve → host` 随 Referer 规则下沉到 `resolve/media-referrer.ts` 消失，host 根入口不再有 import 副作用并拆出 `./runtime|governor|node|tauri|browser|cdp` 子路径。剩余的是隐式全局契约 `globalThis.appHost`（不参与 import 图）。详见 `01-packages.md` 与 `05-risks.md` R2。

## 维护协议

| 代码变更 | 同步改哪份 | 验证 |
| --- | --- | --- |
| `xml/serialize.ts` ↔ `core/deserialize.ts` 任何 `tpl:*` 字段 | `02-contracts.md`、`03-flows.md` | `bun packages/core/src/example/serialize-roundtrip.check.ts` + `serialize-contract.check.ts` |
| `DataLayer` 方法面、存储 key、repo 语义、被动采集 | `02-contracts.md`、`03-flows.md` | `data-layer.check.ts`、`media-store.check.ts`、`repo-concurrency.check.ts`、`body-cache.check.ts`、`passive-mode.check.ts`、`cookie-sync.check.ts` |
| 新包 / 依赖边 / 包内入口变化 | `01-packages.md`（含依赖图） | 12 个 tsc 工程（`bun run check --layer typecheck`，列表见 `scripts/check.ts:89`） |
| `RssChannel` 能力、注册表、crawler↔resolve 分工、resolve 路由 | `01-packages.md`、`04-extension.md` | `bun run rss channels`、`bun run rss fetch <key> --json`、`router.check.ts`、`credentials.check.ts`、`scheduler.check.ts` |
| `ErrorKind` / `ResolveError` / UI 失败文案 | `02-contracts.md` §1/§9.7、`03-flows.md` §10 | `passive-mode.check.ts` + 断网/403/未登录三种文案 |
| 可播判定 / 选流 / 引擎分发 | `03-flows.md` | `useStreamSelection.check.ts` + `scripts/ui-play-check.ts` |
| `AppHost` 能力与注入 | `02-contracts.md` §9.6 + `../host-abi.md` | `host-check.ts` + `governor.check.ts` + 真机 |

原则：**先跑测绘再改文**——以源码为准，不按记忆补全；改了公共契约而不改文档，等于留下第二份会漂移的真相。

## 准确性约定

- 所有结论基于 2026-10-27 的 v0.7.0 快照；括号内的 `path:line` 是**阅读锚点**，重构后行号会漂移，文件与符号名优先。
- 冲突时**以代码为准**，并登记到 `05-risks.md` 的漂移清单，而不是两处各说一套。
- 本集只描述**跨包视角**；单平台行为、UI、风控数值等细节一律外链，避免复制后失同步。

## 延伸阅读

- 同目录：`00-overview.md` · `01-packages.md` · `02-contracts.md` · `03-flows.md` · `04-extension.md` · `05-risks.md` · `06-data-service.md`
- 现有细节：`../host-abi.md` · `../data-and-storage.md` · `../crawler-topology.md`
- 运维：`../../ops/commands.md`（命令与自检）· `../../ops/smoke-check.md`（改了什么 → 跑什么）
- 播放与风控：`../../playback/playback.md` · `../../risk/crawler-risk-control.md`
