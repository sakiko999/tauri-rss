# desktop 爬虫服务化决策与调研（2026-08-25）

> **决策**：打破 desktop/mobile 完全一致性。desktop 数据供给走**独立爬虫服务**
> （本机 sidecar 或自部署服务，承载重反爬平台）；mobile 保持**内置 crawler**，
> 仅支持有限平台。本文记录决策依据（RSSHub / MediaCrawler 对照调研）与形态选型空间。

## 1. 决策背景与动机

- **反爬已升级到「浏览器级」**：xhs 需滚动驱动 + 验证码检测（`.fe-verify-box`）、
  weibo cookie 分钟级时效、签名 1 月~1 季度一改 + 按账号/会话灰度分发。
  这些手段需要桌面环境特权（spawn 系统浏览器、CDP、持久 profile、无沙箱限制），
  mobile 沙箱给不了（见 `docs/mobile-cdp-feasibility.md`：iOS 无 CDP、Android 依赖 PC/adb）。
- **移动端定位早已论证**（2026-08-16）：HTTP/SSR + 登录 cookie，不做浏览器模拟。
  本决策是该论证的自然延伸——既然两端环境能力分层是事实，不如显式承认。
- **架构红利**：crawler「XML 即天然类型」——channel 输出本就是 RSS 2.0 XML 字符串，
  服务化只是把进程内调用变 HTTP GET 返回同一字符串，core 层不动（自解析 XML 建
  MediaItem）。等于自造 mini-RSSHub，路由表 = channel 注册表。
- **旧文档前提变化**：`docs/xhs-signature-sidecar-eval.md` 推荐 RustPython 嵌入的
  主要理由是移动端兼容；desktop 服务化后**服务进程可直接跑 CPython xhshow**
  （不受 Tauri 移动端 sidecar 限制），签名恢复路径比 RustPython 更简单。

## 2. RSSHub / MediaCrawler 对照调研（2026-08-25，两只读 agent 实读代码）

### 2.1 RSSHub（lib/routes/xiaohongshu, lib/routes/weibo）

| 维度 | 小红书 | 微博 |
|---|---|---|
| 数据路径 | **全 SSR HTML**，无签名 API | **m.weibo.cn 容器 API**（getIndex/…），无签名 |
| 签名 | **无任何 x-s/webmsxyw 代码** | 无（仅 MWeibo-Pwa/X-Requested-With 固定头） |
| 浏览器 | Playwright 渲染 SSR（或 `XIAOHONGSHU_PROXY` 代理直连替代） | 仅用于拿**访客 cookie**（缓存+节流续期，`ok===-100`/432 触发换新） |
| cookie | `XIAOHONGSHU_COOKIE`，仅全文/收藏/check-cookie 必需 | `WEIBO_COOKIES`；公开路由可访客模式，私密路由强制 |
| 风控 | `.fe-verify-box` → CaptchaError | 432/`ok===-100` → 换访客 cookie 重试 |
| 匿名可用 | notes/board 匿名可跑（丢收藏，易验证码） | oasis 匿名；user/keyword/super-index/hot 访客模式可 |
| 路由稳定性 | **依赖 Playwright 运行时**（或 proxy），自部署不「免维护」 | 同左 |

### 2.1b RSSHub 运行时实测（2026-08-25，git bff8a52 + patchright chromium 1234）

本机起 dev 服务（`pnpm dev`，port 1200）实测 4 条路由，**零配置匿名**：

| 路由 | 结果 | 详情 |
|---|---|---|
| `/weibo/search/hot` | ✅ 200（2.2s） | 访客 cookie 自动 Playwright 拉取；「微博热搜榜」完整 RSS |
| `/weibo/user/1195230310` | ✅ 200（1.5s） | 「何炅的微博」完整 RSS（标题/图/链接），**无需配任何 cookie** |
| `/xiaohongshu/user/:id/notes` | ❌ 503（7s） | `小红书未返回用户数据`——匿名 SSR 的 `userPageData` 是空对象 `{}`（无 basicInfo）、`user.notes` 是 5 个空分组数组；Playwright 渲染也一样（页面骨架需要登录态） |
| `/xiaohongshu/board/:id` | ❌ 503（30s 超时） | `waitForSelector('.pc-container')` 超时——board 页 SSR 数据全空壳（`boardDetails:[]`、`boardFeedsMap[id].notes:[]`），`.pc-container` 已不存在（改版），**上游匿名模式当前就是坏的** |

对照探针（同机裸 fetch + 平衡括号提取 `__INITIAL_STATE__`）：**explore 匿名可用**
（`feed.feeds` 30 条，与我们 crawler `xhs:explore` 实测 31 条一致）；**user/board
匿名拿不到数据**——user 页匿名 SSR 空分组是已知结论（CLAUDE.md 已记），board 是
本次新发现（RSSHub 该路由等的选择器已过时 + 数据需登录态）。

**实测结论**：RSSHub weibo 路由（访客 cookie 模式）开箱即用质量不错；xhs 路由匿名
全灭，配 `XIAOHONGSHU_COOKIE` 后 user/notes 才可能通（getUserWithCookie 分支），
board 大概率仍坏（等不到选择器）。另注意：RSSHub 已从 playwright 换 **patchright**
（反检测 fork），部署时浏览器二进制约 700MB（ms-playwright 缓存）。
（`pnpm install` 4min、`patchright install chromium` 必做、dev 启动 ~10s。）

### 2.2 MediaCrawler（media_platform/xhs, media_platform/weibo）

| 维度 | xhs | weibo |
|---|---|---|
| 请求 | **纯 httpx** 打 edith API，浏览器零业务请求 | **纯 httpx** 打 m.weibo.cn，浏览器仅在 432 异常时 goto 刷新 cookie |
| 签名 | **Python xhshow 纯算法**（`sign_with_xhshow`，xhshow>=0.2.0）——**已放弃浏览器内取签**，旧 JS 注入代码退化为遗留；浏览器仅作登录容器（扫码/验证码/cookie 注入） | 无签名，纯 cookie |
| 登录 | 扫码 / 手机验证码 / cookie（仅 web_session） | 扫码 / cookie（注 .weibo.cn）；登录后**强制 goto m.weibo.cn 切移动端 cookie** |
| 生命周期 | **常驻单例 BrowserContext**（整个爬取全程） + httpx 快照 cookie | 同左 |
| 反爬应对 | 461/471 读 Verifytype 抛异常，**手动过滑块**（默认非 headless） | 432 → goto 首页刷 cookie 重试（5 次） |
| IP | ProxyRefreshMixin 每请求前查代理池（kuaidaili 等） | 同左 |

### 2.3 两条行业路线的启示

1. **重反爬平台的供给 = 常驻服务进程 + 纯 HTTP 业务请求 + 浏览器仅作登录态容器**。
   没有任何人在这两个平台上把浏览器当业务请求通道（RSSHub 只用来渲染 SSR / 拿访客
   cookie，MediaCrawler 只用来登录 + 432 时刷 cookie）。我们的 browser-sim（CDP 页面内
   同源 fetch）已经比 RSSHub 更「浏览器原生」，比 MediaCrawler 少了纯算法签名。
2. **签名维护已行业性收敛到第三方库 xhshow**（Python，Cloxl 维护）——RSSHub 干脆
   不碰签名，MediaCrawler `pip install xhshow`。自研服务继承这条路径成本最低。
3. **微博解法是访客 cookie 池**（RSSHub）或常驻 context + 432 刷新（MediaCrawler），
   不是登录 cookie 长效化。我们的 weibo 浏览器路径已对齐 MediaCrawler 形态。
4. **自部署 RSSHub ≠ 免维护**：其 xhs/weibo 路由稳定性依赖 Playwright 运行时（或
   外部 proxy），且无签名能力（拿不到 homefeed/user_posted 等游标分页 API）——
   **能覆盖我们已复刻的 SSR/board，但覆盖不了分页翻页与登录态全量数据**。

## 3. 形态选型空间（待用户选型后补充最终结论）

| 方案 | 说明 | 优劣 |
|---|---|---|
| **A. 自研 sidecar** | crawler 包 + 薄 HTTP 层（Bun） + injectNodeHost | 代码 100% 复用；浏览器模拟/扫码登录/cookie 走 appHost.browser 同款路径；与 example/browser-sim 同构 |
| **B. RSSHub 自部署** | 桌面只消费 RSSHub 路由 | 路由现成但两平台同样要配 cookie；签名维护押注社区；与我们已复刻的 crawler 能力大面积重复；xhs 无签名 → 无分页 |
| **C. 混合** | 自研为主 + RSSHub 补充长尾平台 | A 的超集，按需开 |

**初步倾向 A**（代码全复用 + 反爬资产自持），RSSHub 可随时作为 C 叠加。**最终结论待用户选型**。

## 4. 切分边界（规划期细化）

- **服务化范围**：feed 层（fetch/fetchMore + 扫码登录）。`resolvePlay`/`getDanmaku`
  留在前端内置——直链解析是纯算法签名，WebView 跑得动；弹幕是长连接，经服务代理反而复杂。
- **channel 元数据**：`GET /channels` 端点，或前端保留元数据子集（mobile 仍直接 import）。
- **mobile 裁剪**：channel 加环境标记（xhs/weibo = desktop-only），mobile 构建时裁掉。
  实际能力损失小——丢的只有 xhs/weibo feed，rss 直链/bili/youtube/直播四平台全保留
  （纯算法或免登录）；mobile 播放/弹幕能力不受影响。
- **架构对齐**：`docs/core-architecture-refactor.md` 已有的 core 层 HTTP 化路线
  （feed 路由层）可与本决策合并落地。
- **签名恢复路径（若选 A）**：服务进程跑 CPython + `pip install xhshow`，失效时
  `pip install -U xhshow` 即恢复——比 RustPython 嵌入（16MB + 每平台打包链）简单，
  原评估结论的前提（移动端兼容）已随本决策消解。

## 5. 与文档体系的关系

- `docs/xhs-signature-research.md`：461 根因 + xhs 签名降级决策——**仍有效**，
  本决策的「desktop 服务化」正是其「未来若需恢复」的载体。
- `docs/mobile-cdp-feasibility.md`：移动端不做浏览器模拟——**仍有效**，是本决策
  移动侧的依据。
- `docs/core-architecture-refactor.md`：core 层 HTTP 化路线——**仍有效**，第 4 节已对齐。
- `docs/platform-login-research.md`：三平台扫码登录全可行——**仍有效**，登录能力
  随服务化沉淀到服务侧。
- `docs/folo-architecture-research.md`：Folo 云端聚合不能照搬的前提已变——现在可以
  拿它的生产者/消费者分离，服务放本机。**前提变化**，结论可部分翻案。
- `docs/xhs-signature-sidecar-eval.md`：RustPython 推荐结论的前提（移动端兼容）消解，
  但其运行时形态对比表仍有效。

## 6. 后续落地需回答（规划另起任务）

sidecar 生命周期（Tauri spawn/端口协商/随 app 退出）、core 的 feed 路由层、
channel 环境标记与 mobile 裁剪、HTTP 端点设计（与 crawler fetch/fetchMore 契约对齐）。

## 7. 落地记录（2026-08-25 → 2026-08-26 反转）

### 7.0 结论反转（2026-08-26）

**「内置 rsshub npm 包 + sidecar」方案废弃**，改 **RSSHub 作可选外挂 HTTP 服务器**：

- 移除：`package.json` 的 `rsshub` 依赖、`scripts/rsshub-server.ts`（已删）、
  `scripts/tauri.ts` 的 `rsshubSidecar()`。
- RSSHub 定位 = 「外挂实例」：`settings.rsshubBaseUrl`（默认公网 `https://rsshub.app`，
  订阅级 `info.baseUrl` 覆盖），`source/rsshub.ts` 直连外部实例，只做信息抓取。
- **crawler 为主供给**：youtube/bili/播客/直播全走 crawler 自解析，零外部依赖。
- 保留 1 条 rsshub 示例订阅（`s-article` Hacker News → `rsshub:feed /hackernews`）。
- 原因：内嵌成本高（依赖大、`request()` 进程内 API 需自序列化、bili 风控需 cookie、
  youtube 需 YOUTUBE_KEY、xhs 失效、sidecar 生命周期），收益与预想不符。
  详见 `docs/rsshub-vs-crawler.md`「历史决策教训」。

### 7.1 历史（2026-08-25 内嵌方案，已废弃，仅存档）

- **`tmp/RSSHub` 仅是探针，不属依赖**。曾依赖钉版：
  `package.json` → `dependencies: "rsshub": "^1.0.0-master.0a5fb34"`（已移除）。
- `rsshub` 包是**进程内 API**：`init(conf)` + `request(path)` 返回 **RSS 2.0 JS 对象**
  （`{title, link, description, item[]}`），**无自带 HTTP 端口**。
- `scripts/rsshub-server.ts`（已删）：曾自起 HTTP `1200`——
  - `GET /healthz` / `GET /url?u=` 泛代理 / `GET /<rsshub-route>` 序列化标准 RSS。
- `scripts/tauri.ts` 曾 `spawnParallel([rsshubSidecar(), viteDev(), tauriDev()])`。

### 7.3 消费契约（外挂模式，core 层保持）

- `packages/core/src/source/rsshub.ts` 仍 `httpText(baseUrl+route)`，`baseUrl` 默认
  `https://rsshub.app`（公网外挂）；`sourceInfoFor` 对 `rsshub:` 注入 baseUrl **不附 cookie**。
- `deserializeFeed` 已兼容标准 RSS + Atom + media:* 增强，crawler(tpl:) 与 rsshub(标准)
  被同一加工层消费（`verify-alignment.ts` 断言成立）。播放统一走 resolver by-url。

### 7.4 desktop 渠道（crawler 为主）

- `apps/desktop/src/components/AddFeedDialog.tsx`：隐藏 crawler `rss:*` 渠道
  （`hiddenPrefixes=["rss:"]`）——原始 RSS 直链不常用；crawler 包内仍注册，mobile 兜底。
- `apps/desktop/src/subscriptions.ts`：crawler 为主（youtube/bili:popular/bili:weekly/
  rss:podcast/4×live 等）+ 1 条 rsshub 示例（`s-article` → `/hackernews`）。

### 7.5 验证（反转后）

- `verify-alignment.ts`：crawler(tpl:) video + rsshub(标准+media:) article 同 deserialize ✓
- 全量 tsc（core/desktop/crawler）零错。
- 外挂链路：`httpText(baseUrl+route)` → 外部实例标准 RSS → deserialize → 播放 resolver。

### 7.6 遗留

- release 构建侧：用户手动起 sidecar / 外部实例；Rust `RunEvent::Exit` 的 spawn 形态
  留作后续（如需完全内建）。
- RSSHub bilibili/ranking 偶发 503（上游间歇），非本项目问题；weibo/search/hot 稳定。
