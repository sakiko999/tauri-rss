# 架构评审改进清单 · 完成记录（2026-11-01）

> 来源：2026-11-01 全仓架构评审（9 维度审计 + 7 个对抗核验 agent）。本文只记录
> 「清单做了什么 / 哪些故意不做 / 怎么验收」，实现细节看 `git log`（范围
> `v0.14.0..v0.15.0`）与对应的系统文档。结论性取舍同步在 `audit/findings.md`。

## 一、完成情况

| # | 项目 | 状态 | 落点 |
| --- | --- | --- | --- |
| P0-1 | `cn()` 吞类名（`text-ui` 被当颜色） | ✅ | `apps/desktop/src/lib/cn.ts` + `cn.check.ts` |
| P0-2 | 已删除的样式类仍被引用 | ✅ | 清理 6 处死类 + `lib/css-classes.check.ts`（含 cva、反向校验） |
| P0-3 | 发布前不跑检查；`check --filter` 假绿；`scripts/` 无类型检查 | ✅ | `.github/workflows/release.yml`、`scripts/check.ts`、`scripts/tsconfig.json` |
| P0-4 | 首屏包混入抓取代码 / 播放引擎 | ✅ | `@amoeba/core/pure` 子路径、rsshub 仅浏览器 dev 注册、dash/hls/flv 动态 import（主 chunk 3.34MB → 990KB） |
| P1-5 | 单写者锁按数据目录而非库文件；adopt 不校验 dbFile | ✅ | `apps/cli/src/store/db-lock.ts`、`server.ts`（退出码 4）、`service.rs` 的 `endpoint_matches` |
| P1-6 | 不可信 feed HTML 只有一层防护 | ✅（CSP 除外） | `lib/sanitize.ts` 显式配置、`plugins/nav_guard.rs`、桌面收回 `sql` 权限、删除 `webview_browser_*` |
| P1-7 | client token 拥有全部权限 | ✅ | `server.ts` 的 `OWNER_ONLY`（清库/重置设置/清凭证/关停） |
| P1-8 | 备份/导出/清理无人管 | ✅ | 备份清理、`rss restore --list/--db`、全量导出（不含凭证）、`body:` 缓存计入诊断与清理 |
| P2-9 | 契约只写在文档里 | ✅ | RPC 返回值 `Json` 编译期约束、dispatch 覆盖检查、可播判定收口 `core/pure`、`syncSubscriptions` 自修 `selectedNodeId` |
| P2-10 | 文档写死层数/行数/检查项数 | ✅ | 改为引用 `bun run check --list` / `RpcMethodMap` / 脚本名 |
| P3-11 | 服务：无变化也重播、无背压、不能取消、崩溃需重载、日志不落盘 | ✅（取消见下） | 结构化条目签名 diff、WS 8MB 背压、RPC 默认超时、`service.log` 轮转、客户端 `resolveEndpoint` 换连自愈 |
| P3-12 | core `data-layer.ts` 职责过多；reading 单块反复解析 | ✅ | `packages/core/src/internal/{async,cookies,net-policy,pagination,playback,reading-state}.ts`；reading blob 按原始字符串缓存 |
| P3-13 | 每个条目事件全量重算视图；播放进度重渲染整树 | ✅ | `media-store` 的 `progress` 事件（原地更新）；desktop 跳过 `queryView` |
| P3-14 | 抖音 486KB 签名脚本无校验 | ✅ | FNV-1a64 校验和 `assertMsdkIntegrity()` + `AMOEBA_DOUYIN_DANMAKU=0` |
| — | 浏览器分支 deprecated | ✅ | `3da9607` 删除 Tauri 内嵌抓取浏览器与 `webview_browser_*` |

## 二、刻意不做（附理由，避免下次重开）

> 这些取舍已登记到 `docs/ops/backlog.md` §F（低优先/长期悬置）与 §G（条件触发）。

- **CSP**：用户明确「安全有基本保障即可」。现有消毒 + 导航守卫 + 权限收口已挡住已知路径；
  抖音/斗鱼签名脚本依赖 `eval`，收紧 CSP 需要逐个平台验证。
- **`loadMore` / `resolve*` 的服务端取消**：客户端已有 120–180s 默认超时，界面不会永久转圈；
  真取消需要给这些 RPC 接 job 取消通道，收益不抵复杂度。`refresh` 已可取消。
- **CI action 固定到 SHA**：现用 `@v4` / `@v1` 标签；仓库为单人维护，暂不引入 Dependabot/SHA pin 的维护成本。
- **`progress` 的实时边界**：停留在「继续」视图且迷你播放器在播时，列表不实时重排（切走再回来会刷新）。
  这是「不 set state」换来的；播放页/卡片不依赖该实时性。

## 三、验收

- `bun run check`：全层通过（static / contract / state / style / typecheck）。
- `bun run check --layer service`：服务骨架、数据链路、远端镜像（含崩溃 fail-closed、
  宿主重建后自动换连、快照收敛）全过。
- 真机播放回归：斗鱼直播间点击播放后 `currentTime` 推进（2K60 档），确认 playback 拆分与
  引擎懒加载未破坏解析链路。
- 发布：`v0.15.0`（见 `docs/ops/release-updater.md` 的发版步骤；tag 触发 CI）。
