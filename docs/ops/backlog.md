# 待办总表（Backlog）

> **唯一入口**。这里只列「还没做 / 待验证」的条目，每条指向权威文档；细节不在本表重复。
> 完成后：删掉本表这一行，并在权威文档对应位置改状态。
> 条件触发项（§G）不进日常排期，等信号再立项。
> 最后整理：2026-11-01（合并架构评审收尾、`docs/audit/doc-backlog-2026-10-27.md`
> 的「下一批建议」、各计划文档的遗留项）。

## A. 发布与验证（影响可交付）

- [ ] **发布产物自动门禁**〔11-01〕：构建后解包 `*-setup.exe`，断言含 `service/service.js`、
      `amoeba-runtime.exe`、`amoeba-browser.exe`；断言 release overlay 真的生效（漏 `--config`
      时 resources 静默为空）。→ `docs/ops/release-updater.md` §待补
- [ ] **干净 VM 复核**：安装/卸载、断网首启（Bun 缓存命中）、生产 WebView2 Origin。
      → `docs/architecture/system/06-data-service.md` §12
- [ ] **崩溃自愈真机验证**〔11-01〕：Tauri 下杀服务进程，确认 Rust `service_endpoint` 重新
      spawn + 渲染层换连（`remote-data-layer-check` 只覆盖了客户端换连逻辑，未覆盖真实
      `ensure_service` 重拉）。→ 06 §2.5 / `packages/service-client/src/index.ts`
- [ ] **WebView2 生命周期**：LRU 驱逐（`/json/close`）后 renderer 不残留；release 下 GPU 进程
      private 是否下降、关 lane 后 renderer 是否释放、空闲 3 分钟是否归零。
- [ ] **启动器兼容性**：Bun 自动下载在公司代理 / 杀软 / 无签名场景的表现（版本闸门已实现）。
      → 06 §12

## B. 主线：设计系统 → 播放器

- [ ] **F3 重复模式收敛**：`ListRow`（12 套行）、`Badge`（约 9 套）、`Progress`（约 8 套）→
      Skeleton/Avatar/SectionHeader/CardShell。→ `docs/ui/design-system-plan.md`（F1/F2 已完成）
- [ ] **F4 守卫与验收工具**：`ui-probe` 增加「全屏浮层可见」「模式切换」探针；可选 `/dev/ui` 陈列页。
- [ ] **F5 文案与语义修正**：分段控件 tablist/aria-pressed；播放器 chrome `title` → Tooltip。
- [ ] **播放器 P0a 地基**：`VideoShell` 插槽、`player/ui` 原语 + `getPlayerContainer()`、
      `PlayerPrefs`、WebView2 能力 spike（PiP / MediaSession / HEVC / 全屏 API）。
      → `docs/playback/player-parity-plan.md`
- [ ] **播放器 P0b**：媒体状态外置（取消 4Hz 全树重渲）、会话拆分、播放模式状态机。
- [ ] 其余 Radix 原语**随首个真实调用方落地**（Slider/Tooltip/ContextMenu/Popover 随 P0a；
      ToggleGroup/Tabs 随 F5），不预造空壳。

## C. 待实机验证（功能已实现，等真机/真数据）

- [ ] `xhs:explore` 手动刷新命中 `passiveBuffer`（未命中走页面 SSR 兜底）。
- [ ] 实况图：微博 `.mov` 在 WebView2 能否播、失败是否退回静态图；release 下 mp4 解码与
      暂停/续播（dev 已修 Referer 403 + ORB）。
- [ ] 真实微博 / xhs feed 图片网格（直连 + 回退）、滚动时缓存命中。
- [ ] 登录后实机复验：`weibo:user` 预加载第二页；阮一峰正文按 HTML 渲染。
- [ ] 干净 profile 扫码全流程（`rss --service --profile-dir <空目录>`：出码 → 扫码 → 成功）。
      → `docs/platforms/login.md`
- [ ] 界面文案：发现页与添加订阅弹窗跑一次 `bun run dev` 看布局。
- [ ] Referer 改造剩余：规则表抽共享 JSON；实况视频响应头注入（ORB 兜底）按需再做。
- [ ] `scripts/ui-design-audit.ts` oklch 解析 bug（>255 非法值导致 active chip 恒报 ~1.1:1
      误报；真实值已复算过 AA）。→ `docs/ops/smoke-check.md` 注记
- [ ] 系统文档正文细化：03 时序图 / 02 契约正文。
- [ ] heliu 改版收尾：M4 选中态 `?sub=&item=`（`usePlayerNav` 的 `setTimeout(0)` 补丁仍在）；
      M7 的 1440/1280/1080 三档实拍 + `smoke-check.md` 全走。
      → `docs/ui/heliu-redesign-plan.md`

## D. 平台渠道缺口（新功能；立项前看权威文档）

- [ ] **抖音登录态搜索调研**：先专用小号 + CDP 被动探针，再决定是否实现。
      → `docs/platforms/channels.md` §二
- [ ] **Twitch**：VOD / clip 路由、聊天弹幕（需宿主 `WsLike.send` 支持 text 帧）、关键词搜索、
      登录（OAuth 需注册应用，不建议近期）。
- [ ] **YouTube**：播放列表完整列表（InnerTube `VL<playlistId>`，解析器绑 `lockupViewModel`）、
      游戏级直播分区（当前只到栏目级）。
- [ ] **B 站**：合集/视频列表/收藏夹分页深度（私有收藏夹需登录；「稍后再看」不接；合集条目
      无作者名）；bili 账号服务（昵称/uid 展示）。
- [ ] **分区目录**：预览弹窗里的房间只读（预览条目无真实订阅，不能直接播）。
- [ ] **bili 登录自动保活**：已有 `refresh_token` 但无续期调度（仅 bili 可行）。
      → `docs/platforms/login.md`
- [ ] **外部 mpv 播放器接入**（Phase 1 spawn-only → Phase 2 JSON IPC）。
      → `docs/playback/mpv.md`

## E. 数据与架构收尾（低风险，改到相关代码时顺手做）

- [ ] 串行队列仍有 3 份 repo 本地实现（subscription/settings/reading）；统一用
      `packages/core/src/internal/async.ts` 的 `createSerialized()`。
      → `docs/audit/refactor-candidates.md` A1
- [ ] `resolvePlayByUrl` / `resolveLivePlayByUrl` 只差 resolver 调用，合并。
      → refactor-candidates A7（新位置 `packages/core/src/internal/playback.ts`）
- [ ] 四个直播渠道的并发抓取循环共用 factory（保留「全失败才抛错」护栏）。
      → refactor-candidates A8
- [ ] `PlayerPage.kindName` 与 `KIND_META` 重复（前者缺 `category`）。
      → refactor-candidates A3
- [ ] 缓存 XML 回填 helper 之外的两处内联（TTL 短路 / 失败回退），注意 total 语义不要顺手统一。
      → refactor-candidates B1
- [ ] YouTube 四种 client 请求体表驱动（~120 行 → 配置表）。
      → refactor-candidates B2
- [ ] 续播/进度/播完在 `PlayableMedia` 与 `AudioShell` 各写一遍（B3）；`loadMore` 两次
      `store.query` + append 再滤（B7）。
- [ ] 服务端下一批：`loadMore/resolve*` 的取消要真正归还浏览器 lane（`abortTabs`）；cancel 后
      job 条目立即消失（runJob 用 abort race 结算）；HTTP 断开不取消 job / caller-only 任务无
      lease；`/v1/state` 按 rev 缓存；`reading.changed` 按 key 取（不扫整张 map）。
      → `docs/audit/doc-backlog-2026-10-27.md` §下一批建议 / 06 §187
- [ ] 抓取浏览器：每平台传输策略 `auto / browser-only`（§2.7，未实现）；`passiveBuffer` 按 lane
      过滤（当前仅 xhs:explore 声明 passive，同 lane 串行）。
      → `docs/risk/crawler-risk-control.md`
- [ ] 图片管线剩余优化：回退路径加「图 URL → 字节」持久缓存；尺寸预取与显示合并。
      → `docs/ui/ui-conventions.md`（含 `@layer` 层序、浮层退场/Accordion 过渡两个可选项）
- [ ] 数据服务阶段 3（>10k 条的服务端聚合/窗口化、reading 行表、body 拆表、outbox、常驻
      daemon）；`refreshAll` 改走服务端 job（收益低于逐条 busy/超时 UI，暂不切）。→ 06 §12

## F. 安全与长期悬置（明确低优先，不主动推进）

- [ ] **CSP**〔11-01〕：用户明确「基本保障即可」；抖音/斗鱼签名脚本依赖 `eval`，收紧需逐平台验证。
- [ ] **CI action 固定 SHA**〔11-01〕：现用 `@v4`/`@v1` 标签，单人仓库暂不引入维护成本。
- [ ] **`loadMore` / `resolve*` 服务端取消**〔11-01〕：客户端 120–180s 超时已兜底，真取消需接
      job 取消通道（`refresh` 已可取消）。
- [ ] **`progress` 的实时边界**〔11-01〕：停留在「继续」视图且迷你播放器在播时，列表不实时
      重排（切走再回来会刷新）。这是「不 set state」换来的，播放页/卡片不依赖该实时性。
- [ ] live 按平台二次聚合的 UI 侧（收益不抵复杂度）。

## G. 条件触发（等信号，不排期）

- bili 自动续期接口参数（`cookie/refresh` 的 refresh_token 是否够、要不要 csrf）— `platforms/login.md`
- bili `navCache` TTL（wbi key 轮换/换号后可能复用旧 nav）— `audit/findings.md`
- 微博首次翻页多 2 次往返（要省需跨调用缓存 lastMid）— `audit/findings.md`
- xhs prepend 判定（已见 id 集）与「清除凭证」失败回滚顺序 — `audit/findings.md`
- 抖音 `stream_data` 非 JSON 时清晰度按位置 join（主路径正常）— `platforms/channels.md` §三
- 虎牙 Tars token 租约（平台开始限流时）— `platforms/channels.md` §三
- 斗鱼 `getH5PlayV1` 迁移（旧接口下线时）— `platforms/channels.md` §三
- YouTube poToken provider（被迫迁 `mweb` 时）— `platforms/youtube.md`
- Twitch 聊天（宿主 ws 支持 text 帧后）— `platforms/channels.md`
- 真同步时间戳（D12 升级路径）与 web 版多视口矩阵 — `ui/heliu-redesign-plan.md` 附录

## H. 快照类文档（不逐条搬运，按需重新核对）

- `docs/audit/doc-backlog-2026-10-27.md`：120 条核对快照（其中 A1 已在 2026-11-01 修掉；
  其余 open 项按本文 §E 收敛/重新核对）。
- `docs/audit/refactor-candidates.md`：A/B 剩余见 §E；C（明确不改）/D（已核实）是结论。
- `docs/audit/findings.md`：故意不改 / 误报证伪 / 兼容补丁 —— 是决策记录，不是待办。
- `docs/audit/improvements-2026-11-01.md`：本轮评审清单的完成记录与取舍（§F 来源）。
