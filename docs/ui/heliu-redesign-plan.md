# 桌面端「合流」改版计划（HELIU Redesign Plan）

> 状态：**草案，未排期**（2026-10-27）。分支 `docs/desktop-redesign-plan`。
> 来源原型：`X:\design\聚合多媒体看板原型`（合流 HELIU，纯静态 HTML/CSS/JS，单屏 demo + 假数据）。
> 测绘方法：11 个并行读码 agent 对外壳 / store / 列表视图 / 播放器 / 管理页 / 数据层 / 样式做测绘，
> 产出 IA / 数据 / 视觉三张差距矩阵 + 一轮契约红队；本文是该输出的收敛与裁决。
> 原型目录的 `DESIGN-HANDOFF.md` 声称「按导出像素优先」——本文 §7-D14 显式推翻其中与本仓冲突的部分。

---

## 0. 范围与已拍板决策

改造对象 = `apps/desktop` 的信息架构 + 视觉系统 + 首页新增。**不动**：crawler / resolve / host / player 四个包的功能面（唯一例外是 D13 的可选弹幕 `onDanmakuBatch` 加法），
**不动**：`/v/:nodeId` 路由语法（见 §3.1 决策 D1）、数据服务单写者边界、`/play/:itemId` 播放链。

用户已拍板（2026-10-27，不重议）：

| # | 决策 | 内容 |
| --- | --- | --- |
| P1 | **片库第一版不做** | 电影/剧集/动漫海报墙无任何数据来源（`MediaKind` 六值无 movie/series/anime，`packages/core/src/types/media-item.ts:15`），v1 不渲染导航位；`/library` 深链给 StateBlock 说明未开放。后续立项见 §7-D14 |
| P2 | **现有能力全量搬迁** | 热搜（weibo:hot）、短视频全屏流（short:*）、智能订阅（SMART 4 项）、分组树、发现页、命令面板**全部保留一级入口**。原型的五导航只是骨架，侧栏比原型满是预期形态 |

由此派生的「不可删清单」（红队 blocker #1）：`TABS` 6 + `SMART` 4 + `SHORT_MODES` 2 + `PAGES` 3 + `page:discover`
（`apps/desktop/src/store/nodes.ts:46-70`）一律保留节点语义；差距矩阵里的 drop 项只作为未来候选，本轮一律不删。
`rail-nav.check.ts` 目前只覆盖 `navAction`（删除节点无回归保护）——**M0 必须先补断言再动侧栏**。

## 1. 原型拆解（要还原什么）

### 1.1 界面与信息架构

| 原型界面 | 内容 | 现有对应 |
| --- | --- | --- |
| 侧栏 | 品牌 + 5 主导航 + 我的订阅 + 设置/同步页脚 | rail 四段（内容类型/智能订阅/模式/订阅树）+ 页脚三页 |
| 首页 | 今日焦点 hero / 正在直播 / 继续观看（进度条）/ 订阅更新 / 为你精选 / 片库新上 / 标签云 | **无**（`NodeType` 无 home，`nodes.ts:24`） |
| 阅读 | 订阅源列 + 文章列表 + 正文三栏，全部/未读/收藏 chip | `tab:article` → `ArticlePane` + `ReaderMain` 已是三栏 |
| 动态 | 瀑布流卡片（1-4 图 mosaic）+ 详情弹层 + 灯箱 | `tab:social` → `MasonryGrid` + `SocialDetailModal`（灯箱无） |
| 影音 | 直播 hero + 视频网格 + 播放页（章节/清晰度/剧场/实时评论） | `tab:video`/`tab:live` + `MediaMain` 已有直播横轨 + `PlayerPage` |
| 片库 | 海报墙 + 详情（季/集/评分/类型） | **无，P1 拍板不做** |
| 顶栏 | 全局搜索（⌘K）/ 主题 / 通知 / 头像 | 三列 titlebar：内联搜索（当前视图）+ 命令面板/离线/折叠/主题/设置 |
| 浮层 | 专注阅读 / 灯箱 / 全局搜索三个 `<dialog>` | Modal（radix）体系，无专注阅读、无灯箱 |

### 1.2 视觉契约（「编辑暗房」）

石墨底 + 纸白字 + 发丝线 + 信号橙 accent（`#FF5C38`），正文宋体（Noto Serif SC），深浅双主题共用 token，
媒体块（hero/海报/灯箱）在浅色主题下仍保持深底。完整 token 对照见 §2.3。

### 1.3 交互契约（要保留的手感）

⌘K/`/` 开全局搜索，↑↓+Enter 漫游，Esc 关闭；图片灯箱左右键翻页；专注阅读滚动进度条；
横向卡片轨 scroll-snap；`prefers-reduced-motion` 全局降级；主题切换只有颜色渐变、几何不动。

## 2. 现状差距（三张矩阵的收敛结论）

### 2.1 信息架构

| 项 | 状态 | 裁决 |
| --- | --- | --- |
| 首页 | **new** | 新增 `home` 节点 + HomeView，数据全部客户端派生（§3.3），零协议改动 |
| 阅读三栏 | **exists** | `ArticlePane`+`ReaderMain` 保留；原型 `.reader-sources` 列**不做**（与 rail 分组树重复，一个事实只说一次）；全部/未读/收藏 chip 落 `?filter=` |
| 动态视图 | **exists** | `MasonryGrid`+`SocialDetailModal` 保留；SocialCard 扩 1-4 图 mosaic；新增 Lightbox |
| 影音视图 | **exists** | 直播横轨提为通用 `media-rail`；新增直播 hero（取 online 最高）；视频卡换无边框 `.video-tile` |
| 播放页 | **extend** | `/play/:itemId` 不动；加剧场模式（宿主 CSS 单列）；章节/实时评论/清晰度见 §6 |
| 全局搜索 | **extend** | ⌘K 面板 = 「命令」+「内容」两段合一（现 CommandPalette 只搜前 400 条 title/author）；**独立 state，禁复用 `s.query`**（`select()` 会清空，`actions/view.ts:38`） |
| 通知铃铛 | **drop** | 无通知数据模型，硬造是假入口；槽位留给同步状态 chip |
| 专注阅读 | **new** | Modal 承载，与三栏共用同一 readingKey 写入口（双滚动容器互写会互相覆盖进度） |
| 灯箱 | **new** | 必须走 `MediaImage`（Referer/Blob 隧道）+ radix Modal；裸 `<img>` = 微博/小红书 403 破图 |

### 2.2 数据能力（关键裁决：v1 零协议改动）

镜像链路 desktop 只拿到投影（`apps/cli/src/service/server.ts:296` 剥掉 `article.content`，
当前快照 2,521 条 = 2.42MB raw / 616KB gzip，预算 ≤1MB gzip）。结论：

- **exists（直接做）**：直播 hero（`LiveItem.online`/`liveStatus`）、继续观看（`positionSec/durationSec/scrollRatio` + `lastReadAt` 排序）、
  今日计数（`publishedAt×kind`）、订阅更新（`subscriptionId` join + `sub.updatedAt`）、互动数（`likes/reposts/replies` 三渠道已填）、
  收藏/稍后看（`isStarred`）、相对时间、筛选 chips。
- **extend（v2，须过 `serialize-roundtrip.check.ts`）**：VOD 观看数（`tpl:viewCount`，直播已有 online）、热门标签（`tpl:tags`）、
  章节（`tpl:chapters`，仅 bili 有点播章节源）、动态 handle（逐渠道补）。
  ⚠️ 新字段只走 `resolveDetail` 不进列表快照，否则撞预算（红队 high）。
- **new（v1 一律不做）**：评分/年份/类型/季集/片长（片库域）、评论正文、评论/点赞**写**接口、通知模型、用户档案。
- **drop（界面说谎清单）**：问候语用户名「钟」、点赞本地 +1、评论输入框、播放页「喜欢」、通知红点。

三处文案级的诚实修正（有数据也要改说法）：
① 「今日 N 篇」→「今日有更新」（YouTube InnerTube / bili:precious 故意不设 `publishedAt`，`youtube/channel.ts:116`，精确数会漏计）；
② 「上次同步 2 分钟前」→「最近变更」（`sub.updatedAt` 是订阅记录更新时间，不是抓取完成时间）；
③ 「为你精选 · 按你的阅读习惯」→「按热度与时间混排」（无推荐模型；`heatOf` 的 online 与 likes 量纲不同，混排需按 kind 分组归一，`selectors.ts:97`）。

### 2.3 视觉系统（换值不换名）

| 项 | 裁决 |
| --- | --- |
| token 命名 | **不跟原型改名**（`--line/--text-2/--radius` 会牵动 70+ 处引用，零收益）。只做取值替换 + 新增缺失变量 |
| 换值 | `--bg/--surface-1..3/--border` 换成原型石墨系（hex→oklch）；accent 换信号橙（深/浅两套各算 accent-ink 与对比度，跑 `scripts/ui-design-audit.ts`） |
| 新增变量 | `--bg-elev`（侧栏/阅读栏）、`--text-body`（长文）、`--accent-text`（kicker/选中 chip）、`--gold`（评分星，可直接用 `--warning` 兼任）、`--shadow-pop`（弹层大投影）、`--r-card/--r-tile/--r-chip`（14/9/7）、`--ease-heliu`（原型曲线别名）。⚠️ `--radius` 已被 shadcn 桥接占用（`10-tokens.css:218`），**禁止**照抄原型命名，否则 packages/ui 的 rounded-lg 全体从 12 变 14 |
| 字体 | 不引 Google Fonts（Tauri 离线）、不自托管 Noto Serif SC 全量（3-8MB 进包）。保留 Plex 自托管三族，`--font-serif` 链首插入 `"Noto Serif SC","Source Han Serif SC"`（系统已装则命中），中文回落宋体；若 Windows 下标题用 SimSun 观感太旧，标题退回 `--font-sans`、衬线只留正文 |
| 媒体块恒深 | 采纳原型规则：hero/海报/灯箱在浅色下仍深底。提升现有 `--stage-bg`/`--on-media` 为统一取值，不再硬编码 `#101115`（浅色下 hero 深块是显式产品决策，需实拍确认） |
| 断点 | 统一为 {1500, 1320, 1280, 1180, 1080}（`tauri.conf.json` minWidth=1024）。原型 980/860/700/420 四档在桌面永不命中，**不移植**（含底部 tab bar）；原型「1320 收成 76px 图标栏」不采纳——1440 窗口会让侧栏过早塌陷，收栏保持 1080 档 64px |
| 状态语义 | 原型 `.is-active/.is-on/.is-liked` 一律翻译成 `[aria-pressed]/[aria-current]/[data-active]`，与 `30-controls.css` 既有写法一致，禁止两套状态类并存 |
| 丢弃项 | 原型 `::-webkit-scrollbar`（旁路 WebView2 fluentOverlay，`ui-conventions.md` 铁律）、原生 `<dialog>::backdrop`（与 `--scrim`/radix 双遮罩）、原生 `<select>`（深色弹亮色系统菜单）、原型单态 toast（丢队列语义）、原型空态（统一 `StateBlock`，要写真实失败模式） |
| 类名冲突 | 新组件一律带视图前缀：`.rail`（侧栏）≠ 原型横向轨 → 新名 **`.media-rail`**；`.mcard → .smosaic` 融入 SocialCard 的 data-count 分支。写样式前先 grep 类名在 `styles/` 出现次数（132px 侧栏事故案底） |

## 3. 目标设计

### 3.1 路由与节点语法（决策 D1）

**保留 `/v/:nodeId` 单一路由 + 新增 `/`（home）+ 预留 `/library`。** 不采纳「五路径根」（`/read//dynamic//media/...`）方案：

- 节点语法（tab:/s-\*/group:/smart/short:/page:）已经是「位置唯一权威」，5 处 `viewPath` 调用（另有 3 处 `previewPath`）、`?word=`/`?open=`/`?tab=` 三类 query、
  `router.tsx` loader 同步 `select()` 的机制全部免改；
- 双权威风险（红队 blocker）：路径根与 `nodeMeta.type` 会漂移（`/media/tab:article`），需要 assertRoot + redirect 层 + search 保真三件套，
  纯粹为了 URL 好看，不值。

```
/                    → home（新节点，首页看板）        DEFAULT_VIEW 改为 "home"
/v/:nodeId           → 现行全部节点（tab:/s-*/group:/smart/short:/page:），一字不改
/library             → StateBlock「片库未开放」（防 404，P1）
/play/:itemId?from&sub → 不动
```

改动收敛在：`nodes.ts` 增 `home` 分支（`nodeMeta` type:"home"）+ `navIdOf(nodeId)` 纯函数（节点 → 4 主导航高亮之一，
按 `channelKind` 派生：article 类订阅 → 阅读，social → 动态，video/live/audio → 影音，其余不高亮），
两者进 `rail-nav.check.ts` 断言。`navIdOf` 同时修掉现有缺陷「播放页不改 `selectedNodeId` → rail 高亮停在上一节点」。

### 3.2 侧栏终态（自上而下）

| 区块 | 内容 | 说明 |
| --- | --- | --- |
| 品牌区 | 合流 logo + 「合流」+ HELIU | 点击 → `/`；现 rail-head 三个动作迁移：添加订阅 → 「订阅」区块头 `+`；扫码登录 → 头像菜单；刷新全部 → 页脚「同步订阅」 |
| **主导航** | 首页 / 阅读 / 动态 / 影音 | 4 项（片库不渲染，P1）。NavRow 复用，**新增 live 红点槽位**（现只有 count/unread 双态，红点塞进 nav-count 会被数字语义污染）。「阅读/动态/影音」就是 tab:article/social/video 节点换标题 |
| 内容类型 | 全部 / 音频 / 直播 | `TABS` 其余三项升入主导航；`tab:all` 留在本段（退订落点、`subs.ts:104,152` 硬编码都指向它，语义不漂移） |
| 智能订阅 | 今日 / 未读 / 已星标 / 继续 | 原样保留（P2） |
| 模式 | 短视频 / 直播流 | 原样保留（P2） |
| 订阅 | RailGroupTree 分组树 | 原样保留：一层折叠、未分组伪分组、行尾健康槽（告警>停用>忙>未读）、更多菜单（刷新/编辑/启停/退订）。原型 `.src-row` 三元素行没有这些能力，**照抄会丢功能** |
| 页脚 | 发现 / 账号与凭证 / 设置 + 同步订阅 + 最近变更 | P2 保留一级入口；「同步订阅」= `refreshAll(true)` 单一入口（与顶栏 update-chip 只留一个同义按钮——update-chip 移除，状态并入页脚行） |

### 3.3 store / selectors 扩展（首页的数据面）

新增五个**纯函数** selectors（`store/selectors.ts`，输入 `{allItems, subscriptions, now}`，无副作用，各自带 `.check` 断言）：

| 函数 | 产出 | 防呆 |
| --- | --- | --- |
| `todayCounts` | 今日各 kind 计数 + 直播中数 | live 只算 `liveStatus==="live"`；文案「今日有更新」 |
| `selectLive` | 在播直播列表（online 降序，截 12） | `liveStatus==="unknown"` 不计入「正在直播」，逐条如实标注 |
| `resumeWithPct` | 继续观看（pct = positionSec/时长） | 时长取 `duration ?? durationSec`，非有限值整条过滤；直播不进 |
| `groupedBySub` | 每订阅最近 N 条 + 未读数 | 一次遍历，不用逐订阅全扫的 `subUnread` |
| `picksMix` | 精选混排 | 按 kind 分组轮转 + 组内归一化，防直播/大 VOD 霸榜 |

⚠️ 失效键（红队 high）：`refreshView` 的 memo 键只含当前节点，`ctx.ts` 的 `itemsVersion` 是闭包变量——
首页五聚合要么把 `itemsVersion` 暴露进 state，要么收进 `createCtx` 同一 memo。**必须**用「未读→已读的等长 patch」验证区块恰好重算一次，
否则首页展示陈旧数据且无报错。

全局搜索：⌘K 面板两段（命令组 + 内容组）共用同一键盘 index 空间；内容组跑 `matchesQuery` 按 kind 分组、每组截断+计数；
**独立 state（`s.globalQuery`）**，最近搜索落 localStorage（仿 `store/lib.ts` ui-queue 样板）；
v1 文案注明「搜索标题/作者/摘要」（镜像剥了 content，全文搜索是 v2 服务端 `MediaQuery.q` 加法，见 §5）；
`previewDetail.items`/`hotWord.items` 不在 allItems，显式声明排除，防「有时灵有时不灵」。
所有结果键、去重、稍后看写入一律 `itemKey(subId, id)` 复合键（`lib/media.ts:69`）——裸 id 跨订阅串条目是既有案底。

### 3.4 组件与样式组织

- 新视图 `views/home/HomeView.tsx` + 区块件（业务件层 `components/app/`）：
  `HomeFeature`（今日焦点 hero，无图显式回退纯文字块，不留空玻璃板）、`HomeLivePanel`、`HomeResumeRail`、`HomeFeedRows`、`HomePicks`。
  首页内嵌瀑布流**不用** `MasonryGrid`（自带 h-full 内滚 + loadMore，嵌进首页=区块内二次滚动）；精选用有上限的 grid。
- 通用件：`.media-rail`（横向 scroll-snap 轨，`live-track` 改为其变体）、`Lightbox`（radix + `MediaImage` contain）、
  `FocusReader`（专注阅读弹层，复用同一 ArticleReader 组件、`active` 者才写 scrollRatio）。
- `SocialCard` 扩 mosaic：data-count 1-4 分支，比例在组件层算好传 `MediaImage` 的 ratio（CSS 决定比例会与占位骨架跳变）；
  `MasonryGrid.estimateItemHeight` 按图数分档，否则追加时瀑布流跳动。
- 卡片新类 `.video-tile`（无边框图文块），**不动** `.card`（被网格/全屏流/热榜复用，改结构波及整个 `50-shortvideo.css`）。
- 样式落位：token → `10-tokens`；外壳 → `20-shell`；新控件 → `30-controls`；首页/动态/影音区块 → 新文件 `65-home.css`（按区块拆分惯例，入口 `styles.css` 只加 @import）。
- 几何变更联检清单：`--rail 268→244`、`--header-h 52→64`（若采纳原型几何，见 D16）必须同批改
  `public/boot-skeleton.css`（手抄了 52/268）+ `boot-skeleton.check.ts`（加 header-h 断言）+ `.col-pane` 表头（`40-pane.css:22`）+ 短视频全屏 top（`50-shortvideo.css:124`）+ `.boot-overlay` 的 top/left（`20-shell.css:31-41`），漏一处 = 首帧骨架/表头错位。

### 3.5 数据与协议策略

**v1 零协议、零快照、零 XML 改动。** 聚合/搜索全在客户端镜像上算。
上限（v2）：加**可选** RPC/字段 + `hello.features` 能力探测 + 失败降级；**不升** `SERVICE_PROTOCOL` 整数、不加 required snapshot 行
（旧客户端忽略未知行、新客户端缺行会抛「快照不完整」）。片库若立项走 §7-D14。

## 4. 分阶段实施（M0–M7）

> 每阶段独立可验收、可停在任意里程碑发布（中间态 = 旧 IA + 新 token，允许）。
> 通用回归：`bun run check`（61 项）+ 改动对应包 `.check` + `bun scripts/ui-probe.ts goto tab:all` + 1440/1280/1080 三档实拍。

| 阶段 | 范围 | 验收 |
| --- | --- | --- |
| **M0 回归保护**（前置，半天） | `rail-nav.check.ts` 补 SMART/SHORT/PAGES 断言 + `navIdOf` 表驱动自检；`boot-skeleton.check.ts` 加 `--header-h` 断言；建立「字段矩阵」文档（字段→tpl key→类型→产生渠道→消费视图，v2 用） | `bun run check` 全绿；删任一 SMART 节点的演练被断言拦住 |
| **M1 视觉基座**（1 天） | §2.3 全部 token 换值 + 新增变量 + @theme 注册；主题切换颜色过渡白名单进 `[data-motion]` 门控（写死 .25s 会绕过动效开关）；浅色逐项覆盖对表（漏写会继承深色值） | `scripts/ui-design-audit.ts` 0 处低于 AA；三档实拍；`bun run check --layer static` |
| **M2 外壳重构**（2 天） | 双列模型：titlebar 收进主列、品牌区 + 主导航 section 进侧栏、内容类型段缩为 全部/音频/直播、页脚同步行；NavRow live 槽位；头像菜单（账号/设置/关于，扫码入口迁入且关闭仍 `AbortController.abort`，否则浏览器锁卡满 5 分钟）；⌘K 合一（两段共用 index 空间，IME 守卫保留）；删铃铛与 update-chip；`home` 节点 + `/` 路由 + `DEFAULT_VIEW="home"`；`navIdOf` 高亮（修播放页高亮缺陷） | 启动骨架不跳（boot-skeleton 同批改）；旧深链 `/v/...`、`?word/?open/?tab` 全部实测；Alt+Left 行为不变；`rail-nav.check` 绿 |
| **M3 首页**（2 天） | 五个 selectors + 五个 `.check`；`itemsVersion` 失效键改造 + 等长 patch 验证；HomeView 五区块 + `.media-rail` 通用轨 + `65-home.css`；空态全部走 StateBlock | 首页五区块在 无订阅/空库/离线 三态下不出现假信息；等长 patch 恰好重算一次；滚动死区实测（头部随滚） |
| **M4 阅读换装**（1-2 天） | `ViewFilter.starredOnly` + 阅读列表 `?filter=unread\|starred` chips（loader 写入 filter 并复位 page）；选中态 `?sub=&item=` 两参数（**禁** `?item=<sub>:<id>` 单参数——itemRefKey 不反解，preview 伪订阅与含冒号 id 都会解析错）；删 `usePlayerNav` 的 `setTimeout(0)` 补丁（选中态由 URL 派生）；`FocusReader` 弹层（同一 readingKey 单写入口） | 刷新/分享 URL 还原同一条文章；双滚动互写自检（切换后 progress 不变）；IME 回车守卫保留 |
| **M5 动态换装**（1-2 天） | SocialCard mosaic 1-4 + `estimateItemHeight` 分档；动态 chips（图文/多图/视频/文字，客户端 filter）；`Lightbox`（MediaImage contain + radix，键盘左右翻页）；详情弹层加灯箱入口；外链一律 `openExternalSafely`（裸 `<a>` = WebView 整页被顶掉） | 微博/小红书实图回归（直连+回退）；灯箱在 9334 CDP 实测翻页；`ui-probe` 无裸 href 断言 |
| **M6 影音与播放**（2 天） | 影音 tabs（视频/直播/音频；`tab:video` 直达、`tab:live/audio` 落对应 tab）；直播 hero（`selectLive` top1）；`.video-tile` 卡；播放页宿主：右栏 336px、剧场模式 data-attr 单列（与 1280 断点用 data-attr 区分，不新增类名）；「播放器无圆角」契约不动（`VideoShell.tsx:114`） | `ui-play-check.ts` 起播矩阵绿；剧场模式与窄窗单列不互压；清晰度仍走 `MediaQualityButton`（<2 档不显示，不自造菜单） |
| **M7 收尾**（1 天） | 发现页瘦身（搜索型入口统一到 AddSubscriptionDialog，页内只留榜单/平台矩阵）；热搜确认为订阅派生视图（无改动，验证 `?word=` 链路）；响应式断点统一到 §2.3 五档；文档更新（本文状态、`ui-conventions.md`、`docs/README.md`、CLAUDE.md 目录段） | `bun run check` 全绿；`smoke-check.md` 走一遍；旧 `/v/tab:all` 等 3 类旧链 redirect 断言 |

## 5. v1 删减清单（原型有 → 本版不做）

问候语用户名 / 片库全套（含首页「片库新上」）/ 通知铃铛 / 动态点赞写与评论区 / 评论与聊天输入框 /
播放页「喜欢」/ 章节（无渠道产出，UI 会长期空态）/ VOD 观看数（无字段，`youtube` 把 viewsText 拼进 summary、bili ugc 不收 stat）/ 热门标签词云（全渠道无 tags 字段）/ 阅读时长（列表态无 content，只能正文加载后客户端估算，不进字段）/ 「1320 收窄侧栏」与 860 以下响应式。

对应的数据面 extend（v2 候选，按序）：`tpl:viewCount` → `tpl:tags` → `tpl:chapters`（仅 bili，走 `resolveDetail` 不进列表快照）→ 全文搜索服务端化。
每项 serialize+deserialize 成对写并过 `serialize-roundtrip.check.ts`，且现有 roundtrip 是手写样例——**先补「一个 fixture 填满全部可选字段」的 deep-equal 断言**再加字段（红队 high）。

## 6. 风险登记

| 级别 | 风险 | 缓解 |
| --- | --- | --- |
| blocker | 差距矩阵的 drop 项与 P2「全量搬迁」冲突，误删节点无回归保护 | §0 不可删清单 + M0 先补断言 |
| blocker | 新路径/节点只换渲染不调 `select()` → 「旧数据渲染新布局」（仓库已有同型故障记录，`App.tsx:44`） | 所有 loader 走同一 `applyRoute(nodeId, search)`；`home` 也走 `select("home")`；表驱动自检覆盖「路径→节点→nodeMeta.type→viewType」 |
| high | 选中态/队列/搜索去重用裸 id 跨订阅串条目 | 一律 `itemKey` 复合键；自检覆盖 `preview:` 伪订阅与含冒号 id |
| high | 首页聚合失效键缺失 → 陈旧区块 | §3.3 itemsVersion 方案 + 等长 patch 验证 |
| high | 快照预算：新字段进列表把 616KB→>1MB | v2 字段只走 `resolveDetail`；进列表前跑 `scripts/service-snapshot-size.ts` |
| high | 灯箱/新卡片绕过 `MediaImage` → 防盗链 403 | 灯箱与 mosaic 全走 `MediaImage`；`ui-probe` 断言无裸 img/href |
| high | 全局搜索复用 `s.query` 被 `select()` 清空 | 独立 `globalQuery` state |
| high | 播放入口绕过 `usePlayerNav` → article/social 掉进破碎播放页 | grep 约束 `playPath` 只出现在 usePlayerNav/router；新卡片只调 `usePlayerNav()` |
| high | 外链未拦截 → WebView 整页导航走 | 委托 `openExternalSafely`，M5 验收项 |
| medium | 几何 token 变更首帧跳（boot-skeleton 手抄值） | §3.4 联检清单 + check 断言 |
| medium | mobile 已冻结但仍被 `check --layer typecheck` 覆盖 | 共享包只做加法（可选字段/props），不新增 MediaKind 值，不改 DataLayer 既有签名 |
| medium | 精选 heatOf 三量纲互比霸榜 | kind 分组轮转 + 归一化；heatOf 不接纳 viewCount |
| medium | 原型色值直接照抄掉 AA（浅色 text-dim、live 白字） | 只换值后必跑 `ui-design-audit`；live 角标改深色 ink |
| medium | 专注阅读双滚动容器互写 scrollRatio | 单写入口 + `active` 门控 + 切换自检 |
| medium | 与 react-router v7 data router 的 history 记账不兼容 | 浮层返回用 router `navigate` + state / `useBlocker`，禁直写 `window.history` |

## 7. 决策记录（D1–D16）

| # | 决策 | 采纳 | 理由与放弃项 |
| --- | --- | --- | --- |
| D1 | 路由形态 | **保留 `/v/:nodeId`，新增 `/` 与 `/library`** | 放弃五路径根：双权威漂移 + redirect 层 + search 保真三件套成本，只为 URL 语义化 |
| D2 | 首页与 tab:all 关系 | **并存**：首页=看板，`tab:all` 保留为混合列表（内容类型段） | 退订落点（`subs.ts:104,152`）与 5 处 `viewPath` 调用语义不漂移 |
| D3 | 侧栏 IA 终态 | 主导航常驻，其余段全部保留（§3.2） | P2 拍板；不删任何节点 |
| D4 | 短视频入口 | 侧栏「模式」段原样保留 | P2；`ShortVideoView` 对 `selectedNodeId` 的依赖不动 |
| D5 | 发现页 | 页脚一级入口保留；页内搜索入口统一到 AddSubscriptionDialog | 防双轨搜索 |
| D6 | 片库 | v1 不做；`/library` → StateBlock | P1；长期方案见 D14 |
| D7 | 全局搜索 v1 | 标题/作者/摘要 + 最近搜索；全文搜索 v2 走服务端 `MediaQuery.q` | 客户端取消 content 投影会撞 616KB 快照预算，拒绝 |
| D8 | 当前列表搜索 | 保留在视图 filterbar（⌘F 聚焦），⌘K 只做全局 | 两层搜索职责分离 |
| D9 | 文章选中态 | `?sub=&item=` 两参数 | `?item=<sub>:<id>` 不可反解（itemRefKey 契约） |
| D10 | 阅读 chip | 扩 `ViewFilter.starredOnly`，URL 写入 | 不新增节点、刷新可还原 |
| D11 | 续播时长 | UI 侧 `duration ?? durationSec` + 非有限值过滤 | bili 只有 `duration`；不为此加必填字段 |
| D12 | 「上次同步」 | 文案改「最近变更」，取 `max(sub.updatedAt)` | 不为一行假新鲜度加协议字段 |
| D13 | 章节 / 实时评论 | 章节 v1 不做；弹幕只读列表**可选**做（须 `PlayableMedia` 加 additive 的 `onDanmakuBatch` 共享订阅，侧栏禁止二次调 `danmaku()`；无流整块隐藏，文案写「弹幕」不写「评论」） | `DanmakuStream` 调用即订阅，二次调用双倍拉流 |
| D14 | 片库长期 | 展示层=随包静态 JSON + localStorage 片单（零协议）；可播=新 channel 走 XML；跨设备收藏=library.* RPC（唯一满足单写者+跨设备）。**禁止 desktop 直写 KV/SQLite（第二写者）** | 触发条件：真实片源/元数据源确定时立项 |
| D15 | 主题取值 | 采纳信号橙 + 媒体块浅色恒深；两套主题分别核算对比度；保留现有 system 三态入口 | 三态入口已存在（设置→外观 `Appearance.tsx:12`），M2 只迁入新几何、不新增 |
| D16 | 顶栏/侧栏几何 | M2 先收 titlebar 进主列（结构改），`--rail 244/--header-h 64` 数值对齐放 M1 一次做完，boot-skeleton 同批 | 几何与结构分离，各自可回滚 |

---

## 附：本计划未覆盖但已知的后续项

- 真同步时间戳（新 RPC/state 字段，非 XML）——D12 的升级路径。
- `rail-nav.check.ts` 若未来允许删节点，须先把「节点清单快照」断言写进 check。
- 原型 `DESIGN-HANDOFF.md` 的多视口矩阵（360-1920）不适用于桌面（minWidth=1024）；若未来做 web 版再启用。
