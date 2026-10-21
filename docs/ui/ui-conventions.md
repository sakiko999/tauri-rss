# UI / 样式 / 交互约定

> 合并自 ui-conventions.md + image-loading-referrer.md（2026-10-21 整理）。

> 从 `CLAUDE.md` 迁出（2026-10-21）。`CLAUDE.md` 只留目录结构与分层判据。
> 相关：`docs/ui/rail-tree-accordion.md`（侧栏树选型）、`docs/ui/numbered-ui-overlay.md`、
> `docs/audit/findings.md`。

## 样式组织

**样式拆成 `apps/desktop/src/styles/` 下的区块文件**（2026-10-15，原 styles.css 3858 行）：
`styles.css` 只留**入口与 @import 顺序**（顺序即层叠顺序，别按字母重排）；
`styles/10-tokens` 令牌+@theme · `15-base` 基础层/通用工具 · `20-shell` 外壳/侧栏 ·
`30-controls` 控件 · `40-pane`/`45-main` · `50-shortvideo`/`55-player` · `60-pages` ·
`70-overlays` 浮层 · `90-responsive`。加样式先判断属于哪个区块。

⚠️ **注释里别写类名通配**（星号紧跟斜杠那种）—— 那串字符是注释结束符，会提前终止注释块、
把后面文字变成裸 CSS。踩过两次。

⚠️ **样式拆成多文件后，同名类会跨文件叠加**：`.rail-head` 曾同时给**侧栏**和**直播区**
定义（侧栏那份是 `flex-direction: column`），叠加成 `column` + `wrap` → 子元素纵向堆叠
还横向换列，头部从 28px 涨到 **132px**。**新组件用模块前缀**（直播区用 `live-*`，与已有的
`.live-pulse` / `.live-online` 一致），别借侧栏命名空间。改样式前先 `grep` 类名在
`styles/` 下出现了几次。

⚠️ **元素级 reset 必须写在 `@layer base` 里**：`styles.css` 的 `@layer base{}` 一旦被
自己提前 `}` 收尾，后面的 `button/h1/ul` reset 就成了**无层规则** —— 而**无层 CSS 优先级
高于所有 `@layer`**（Tailwind 4 层序 `theme < base < components < utilities`）。后果：
`button{background:none;border:0;padding:0}` 把 packages 里所有 tailwind 按钮的
`bg-*`/`border-*`/`px-*`/`py-*` **全废掉**（渲染成无边框无内边距的裸按钮）。app 内看不出来
（desktop 用自己的 `.btn`/`.icon-btn`，同为无层、自己就能赢），受害的是 `packages/player`、
`packages/ui` 这类只靠 utility 的代码。2026-10-14 已全部移进 base 层。**改 styles.css 的
结构性规则后，务必用 CDP 量一次真实 computed style**（`getComputedStyle(btn).padding` 应为
`6px 12px` 而非 `0px`）。

⚠️ **app 的 `styles/` 是无层 CSS；Tailwind utility 在 `@layer utilities`**。同一属性若被
无层语义类设置（如 `.stack{gap}`、`.pane > .scroll-area{flex}`、`.article-body{...}`），
utility 会被压过，表现为「类写了但没生效」。给已有语义类元素加 utility 覆盖前先 grep 该
属性；必要时保留 inline 或改语义类，不要盲目加 `!`。

**Tailwind 动效工具类**：`10-tokens` 有**独立的非 inline `@theme` 块**注册
`--animate-*` / `--ease-*`（→ `animate-rise` / `ease-decel`）。三条实测：
① `--animate-*` 放进 `@theme inline` **不注册**；② `keyframes` 与 `--animate-*` 必须
**同块**且该块不能带 `inline`；③ Tailwind 4 **没有 `--duration-*` 命名空间**，
`duration-*` 只吃裸数值。

⚠️ **`scrollBarStyle:"fluentOverlay"` 会被 `::-webkit-scrollbar` 顶掉**（WebView2 155 实测）：
页面上只要**任何** `::-webkit-scrollbar` 规则命中某个滚动容器，Chromium 就给它切**自定义**
（经典、占布局）滚动条，fluentOverlay 整个失效。空白的 `overflow:auto` 盒对比：无规则
`offsetWidth-clientWidth=0`（overlay）；加 `::-webkit-scrollbar{width:10px}` → `10`。
`scrollbar-width:thin/auto` 不触发（实测仍 0）。`.scroll-area` 曾有一条 `width:10px`「纯前端
兜底」，注释还断言「对 WebView2 无效」——**说反了**，实测两处主滚动区 gutter 恒 9px。删掉后
归 0（侧栏 258→267px）。折叠栏那两条「滚动条吃 10px → 图标偏左 5px」的对齐补丁都是它的连锁
副产品。**改滚动条样式前先量 gutter，别用 `::-webkit-scrollbar`。**
✅ 2026-10-19 复核：overlay gutter=0；`::-webkit-scrollbar{width:10px}` → 10；
`scrollbar-width:none` → 0（**标准属性不切经典模式**，要隐藏 overlay 条用它）。即：
**能改样式但会失去 overlay**；想保留 fluentOverlay 就只能用 `scrollbar-width/color`。

- **字体**：IBM Plex 自托管（`apps/desktop/public/fonts`，~136KB，离线可用）。
  Sans=UI/标题，**Serif=正文**，Mono=数字/通道号。中文回落到系统栈（字体包太大不随包）。
- **视觉基调**：暖石墨中性（色相 72/75）+ 琥珀 accent；深/浅两套同色相，改一处要改两处。
  对比度用 `scripts/ui-design-audit.ts` 复测（目标 0 处低于 WCAG AA）。

## 组件与浮层

- ⚠️ **不用原生 `<select>`**：下拉面板由 WebView/系统渲染，深色主题下弹的是**亮色系统
  菜单**且 CSS 管不到。统一用 `components/Modal.tsx` 的 `Select`（radix，自带浮层）。
  同理 `Switch`/`Menu`/`Modal` 都在那个模块。原生 `<input>`/`<textarea>` 保留（可主题化）。
  ⚠️ **占位提示走 `placeholder`，不要塞进 `options`**（否则会渲染成可点击的 `role=option`，
  选它只是空操作）；无空值选项时 Root 的 `value` 必须是 `""` 才显示 placeholder —— 内部
  哨兵 `__none` 会被 Radix 当成已选值。选项可带 `disabled`。
- ⚠️ **浮层必须处理视口**：共享 `Menu`（Radix DropdownMenu）已配 `collisionPadding`，
  `.menu` 用 `--radix-dropdown-menu-content-available-height` 限高并内部滚动；不要在业务
  组件里自造 absolute 菜单/提示层，否则窗口底部会贴边或顶出视口。
- ⚠️ **`.menu` 必须是 Radix popper wrapper 的在流子元素**（2026-10-19）：Radix 的 floating
  元素是外层 `div[data-radix-popper-content-wrapper]`（`position:fixed; transform`），
  `.menu` 只是它的子节点。给 `.menu` 写 `position:fixed/absolute` 会脱离文档流 → wrapper
  量成 **0×0** → flip 不翻面、`--radix-popper-available-height` 按 0 高算、`align=end` 按
  0 宽对齐。症状：侧栏底部行的菜单被压成 122px 带滚动条的矮条，且向右溢出。
  修法 = `.menu` 不写 `position`。**这是「弹窗里为什么有滚动条」的根因，别再改回去。**
- ⚠️ **吐司的 grid 项必须 `min-width:0`**（2026-10-19）：`.toast-root` 是 grid，`.toast`
  是 grid item；默认 `min-width:auto` 时，错误文案里的长 URL 会把 min-content 撑到 **592px**，
  无视 `max-width:360px` 直接出视口。`.toast-body` 也要 `min-width:0`，`.toast-text` 加
  `overflow-wrap:anywhere`。governor 的冷却错误已去掉完整 URL（只留平台/剩余时间/信号）。
- ⚠️ **侧栏窄栏隐藏列表必须两份对齐**：`styles.css` 里 `.rail.rail-collapsed`（手动折叠）
  与 `@media (max-width:1080px)`（窄窗）各有一份 `display:none` 清单，**逐项必须一致**
  （`nav-label`/`nav-count`/`nav-warn`/`rail-empty`/`group-empty`/…）。曾漏掉 `group-empty`
  → 空分组提示文案在 64px 栏里被压成逐字竖排

## 滚动与虚拟化

- ⚠️ **主区里不在滚动器内部的元素是「滚动死区」**：`body` 是 `overflow:hidden`，鼠标停在
  这些元素上找不到可滚祖先 → 滚轮完全无反应（用户会描述成「页面无法上下滑动」）。
  `MediaMain` 的 `.grid-head` / `.rail-block` 曾占掉 **59% 的视口**。
  ✅ **正解是把它们移进滚动器内部**（hasMix 走 `VirtuosoGrid` 的 `Header`；socialOnly 走
  `MasonryGrid` 的 `header` prop）—— 既消除死区，又让**头跟着一起滚**（整体滚动）。
  ❌ 不要用「捕获阶段转发 wheel」绕：那只是内容滚、**头依旧固定**，不是用户要的。
  ⚠️ **测滚动必须用真实滚轮**（CDP `Input.dispatchMouseEvent{type:"mouseWheel"}`）：
  合成 `WheelEvent` 在 Chromium 里**不触发滚动**，会得出假结论。⚠️ 也别 navigate 后**立刻**
  测 —— 启动骨架存活期（~900ms）与 masonic 的测量窗口期都会让容器「暂时不可滚」，**多采样
  几次**再下结论。判据要看**头部矩形是否随之移动**，不能只看 `scrollTop`。
- **列表虚拟化**：网格 = VirtuosoGrid，文章列表 = Virtuoso。⚠️ 尺寸走
  `listClassName`/`itemClassName`（CSS），**不要用 `components.List/Item` 覆盖** ——
  List 的 inline style 带 virtuoso 的虚拟化偏移（paddingTop/Bottom），覆盖会让滚动定位错乱
- **social 瀑布流**用 **masonic** 虚拟化（CSS columns 追加会重排已渲染卡片）。
  ⚠️ 内层滚动容器（masonic 默认绑 window）需用 `usePositioner + useMasonry` 手动喂
  `scrollTop/height`；append 保持 positioner，refresh 重建 layoutVersion
- ⚠️ **canvas 清屏别用 CSS 尺寸**（`DanmakuLayer`）：位图是 `round(w * dpr)`，dpr **非整数**
  时它比 `w * dpr` 大 —— 实测 dpr=1.875、w=516 时位图 968 列而 `516×1.875 = 967.5`，
  `clearRect(0,0,w,h)`（经 `setTransform(dpr)` 缩放）**漏掉最右那半列**。白色弹幕从右缘
  进入（`x = w`）画进去后永久残留 → 播放器右侧一条白竖边。正确写法：**复位变换 +
  `clearRect(0,0,canvas.width,canvas.height)`**，再设回 dpr 缩放。
  ⚠️ **只在非整数 dpr 下暴露**（Windows 150%/187.5% 缩放），dpr=1/1.25/1.5/2 都测不出 ——
  复现这类问题**先问用户 `devicePixelRatio`**，别只在默认 dpr 下扫。

## 交互

- ⚠️ **「回车提交」的输入框必须过 `lib/ime.ts` 的 `isImeComposing(e)`**：中文输入法候选
  未上屏时的回车是**选词**，不是提交。不拦的后果全是**静默错值** —— 会建出名叫 `fenzu` 的
  分组、搜索拿半截拼音发请求、订阅标题存成半截。曾散落 6 处、两种手写写法
  （`e.isComposing || keyCode===229` / `e.nativeEvent.isComposing`），2026-10-15 收口。
  ⚠️ **取值必须走 `nativeEvent`**：本仓 `@types/react` 只给原生事件声明了 `isComposing`，
  合成事件上直接 `e.isComposing` 编译不过（TS2339）。守卫只挡 keydown，不改输入法组合行为。
- ⚠️ **正文里的外链必须拦截**：`.article-body` 的委托 click 命中 `<a>` 要走
  `openExternalSafely`；不拦的话 WebView 会整页导航走（应用没配 Tauri `on_navigation`），
  界面被外部网页顶掉、只能重启才回来
- ⚠️ **JS 驱动的动画挡不住 `prefers-reduced-motion`**：`styles.css` 那条媒体查询只压
  CSS 的 animation/transition，对 `scrollIntoView({behavior:"smooth"})`、脚本编排的入场与
  形变**完全无效**。要在 JS 侧问偏好，用 `lib/motion.ts`（`prefersReducedMotion()` /
  `scrollBehavior()` / `motionDurationMs()`）。**等动画放完再卸载**时读
  `motionDurationMs()` 而非写死 —— 动效有三档，写死会让 `data-motion="off"` 白等。
- ⚠️ **共享元素形变走原生 View Transition，不引 motion**（2026-10-15 实测 Chromium 155
  支持 `startViewTransition`）。入口 `lib/viewTransition.ts`。三个**静默失败**的坑：
  1. **源元素在新状态里必须摘掉 `view-transition-name`** —— 与目标同名的话浏览器判定重复、
     **忽略整个过渡且不报错**（探针实测：伪元素动画为空数组）。这是最难查的一条。
  2. 回调里必须 `flushSync` —— React 的 setState 是异步的，不同步刷 DOM 则目标还没渲染。
  3. 别与元素的入场动画叠加（如 `.modal` 的 `modal-in`），过渡期间把它停掉。
  目标 name 用 **CSS 常驻声明**，别在过渡里动态挂/清（结束后清掉，下次就没形变了）。

## 卡片与列表的分流

- **可播判定 = kind 门控**：只有 `video`/`audio`/`live` 有可播流，`article`/`social`/
  `category` 不是。卡片的整卡点击与播放按钮都走 `Cards.tsx` 的 `isPlayableKind` ——
  article 显示 0 个播放按钮、点击进「打开文章」（`tab:article` 三栏读），social 进详情弹窗，
  `category`（分区目录条目）在右侧列表打开目标分区（`?open=`，用条目的 categoryChannel +
  categoryInfo 预览）。⚠️ 曾漏掉 article：点一下掉进「该条目不指向可解析的视频链接」的破碎
  播放页。
- ⚠️ **kind 门控不够**：`kind:"audio"` 也可能是**一个播客 feed**（Apple 榜单条目，`stream` 空）
  —— 判据是 `isFeedItem(item)`（`kind:"audio" && !stream`），主操作走 `onSubscribeFeed`
  （订成 `rss:podcast`），不出播放按钮、不进队列、不进播放页。见
  `docs/platforms/platform-notes.md` 的 Apple 播客段。
- ⚠️ **新增「播放」入口（卡片/命令面板）一律经 `usePlayerNav` 收口**。
- ⚠️ **卡片主操作按 kind 分流**：`MediaCard` 里 `social` 走「开详情弹窗」、其余走「播放」——
  social 无可播流，误当视频播会进「不指向可解析的视频链接」的破碎播放页。混合 feed
  （全部/分组/智能订阅）里的 social 走的是 `MediaCard`（只有**整屏都是 social** 才走
  `SocialCard` 瀑布流），所以这条分流必须在 `MediaCard` 里，不能只靠 `SocialCard`。
  `usePlayerNav.onPlay` 另有一道收口兜底。

## 图片加载与防盗链

> 2026-08。微博图床 403 触发：审计 `<img>` 图片加载的 Referer 处理，评估「Rust 层做
> Referer / 自定义协议代理」的可行性，结论：**维持 blob 隧道**，自定义协议列为未来
> mobile 接入时的独立优化。

### 背景：sinaimg 对空 Referer 也 403

新浪图床（`*.sinaimg.cn`）对**空 Referer 也返回 403**，只放行 `weibo.com` / `m.weibo.cn`
系 Referer（curl 实测：无 Referer 403，带 weibo.com 200）。而 `<img>` 原生加载**必带页面源
Referer**（桌面是 `tauri://localhost`），且 Referer 由 Referrer-Policy 控制、**与同源策略
（SOP）是两套独立机制** —— 关掉 webview 的 SOP 也救不了（`--disable-web-security` 只放开
fetch 读跨源响应体，改不了 img 发出的 Referer）。无免防盗链子域捷径（实测
n/tva/ws1.sinaimg.cn 等子域全部 403/404）。

唯一能让 Referer 正确的途径 = **带自定义 header 的请求**（Rust reqwest 可设任意 header）。

### 现行方案：blob 隧道（已落地）

命中防盗链图床的 src 经 `appHost.http`（Tauri 生产走 Rust `http_get`，node/browser 后端
同接口）带站内 Referer 拉取 `arraybuffer` → Blob URL → `<img>` 显示。

- 规则表 `mediaReferrerFor(url)` 收敛在 **host 层**（`packages/host/src/media-referrer.ts`，
  `sinaimg.cn → https://weibo.com/`）—— 唯一权威，ui 不写死任何域名，加图床只改这一处；
- 消费方 `MediaImage`（`packages/ui/src/renderers/atoms/MediaImage.tsx`）内联
  `useProxiedImage`：命中未就绪返回 undefined（不挂原 src，避免先发必 403 的请求）；
  隧道失败回退原 src 走 `<img> onError` 占位；模块级 `proxyCache` 防重复请求；
- 跨三环境统一（tauri/browser/node），纯 TS 无 eval，CSP 安全；
- 已验证：node 环境带 weibo Referer 拉图 200（1.8MB 字节取回）。

**图片宽高**由单独一段解决：`resolve/src/utils/img-size.ts` Range 预取文件头解析
（PNG 64B / JPEG 1KB），失败退化 4:3。XML `tpl:image` 带 `@_url/@_width/@_height`。

### Rust 层替代方案评估

#### 方案 A：http_get command 内自动补 Referer

Rust 侧维护「host → Referer」表，请求进来自动带。代价小，但**前端仍需判断「这张图要不要
走隧道」** —— 判断依据和 Referer 规则是同一份知识，会在 TS（判断）与 Rust（补头）**分裂成
两份**，比现在的 `mediaReferrerFor`（host 层一份）更分散。**不值**。

#### 方案 B：自定义协议 `media://` 代理图片（彻底 Rust 化）

`<img src="media://…">`，Rust 注册 `register_uri_scheme_protocol` 带站内 Referer 拉图、
流式返回字节。img 原生加载，无 blob/base64 膨胀 / JS 隧道，性能显著更好（瀑布流多图时是
真实收益）。代价（「四件套」）：

1. tauri.conf 配 scheme + Rust handler；
2. 前端 URL 重写（`https://wx1.sinaimg.cn/...` → `media://...`），需跨平台分支（见下）；
3. browser 纯前端调试环境无 Rust scheme，需降级回原生 img / fetch；
4. **跨平台 scheme 形态差异 + 已知安全洞**（见下）。

### Tauri 自定义协议跨平台差异（官方 docs.rs 查证）

`register_uri_scheme_protocol` 把协议映射成两种形态：

| 平台 | 形态 | 原因 |
|---|---|---|
| macOS / iOS / Linux | 真 scheme：`media://localhost/<path>` | WebView 原生支持（WKURLSchemeHandler / WebKitGTK） |
| **Windows / Android** | **伪 scheme：`http://media.localhost/<path>`** | WebView2 / Android WebView **不能直接服务自定义 scheme**，Tauri 伪装成 `<scheme>.localhost` 域名 |

由此派生：

1. **URL 必须按平台分支**：同一套前端代码，`<img src>` 在 iOS 写 `media://localhost/xxx`，
   Android/Windows 得写 `http://media.localhost/xxx`（写 `media:` 会 ERR_UNKNOWN_URL_SCHEME，
   有开发者实测确认）。需一个跨平台 scheme URL 生成器。
2. **Origin 差异**：伪 scheme 页面 Origin 是 `http://media.localhost`，与主应用
   （`tauri://localhost` / `http://tauri.localhost`）跨源。`<img>` 显示无影响（图片可跨源）；
   若前端 `fetch` 读字节，Rust handler 响应须带 `Access-Control-Allow-Origin`。
3. **iOS 是最「规整」的移动端**：真 scheme，与 macOS 行为一致，无伪 scheme 问题。所以
   「移动端差异」主要就是 Android 那一套。

### 安全（GHSA-7gmj-67g7-phm9）

Windows/Android 伪 scheme 有**已公开漏洞**：`is_local_url()` 只校验第一个子域
（`split_once('.')`），导致 `http://<scheme>.evil.com` 这类攻击者域名被误判为本地源，
从而**调用本应为本地保留的 IPC command**。注册的自定义 scheme 越多、前端引用越广，
风险面越大。macOS/iOS 真 scheme 无此漏洞。

### 决策

- **维持 blob 隧道**。理由：规则已收敛（host 层一份）、跨平台统一、后端已跨平台
  （`http_get`）、无安全洞；自定义协议在桌面是小优化，在 Android 踩伪 scheme + 安全
  advisory + 跨平台 URL 分支三连坑，远超「Rust 层加个 Referer」的收益。
- **方案 B 列为未来独立优化**：当 mobile 真正接入 appHost/crawler、瀑布流多图成为性能瓶颈
  时，按平台评估真 scheme 方案（参考本节的差异表与安全提示）。

### 性能现状：微博图片加载慢（2026-08 实测）

**现象**：桌面端瀑布流微博图片加载明显慢（skeleton 持续时间长、图片逐个缓慢浮现）。

**原因分析**（按影响排序）：

1. **隧道每次全量下载** —— 命中 sinaimg 的图经 `appHost.http` 拉**完整图字节**
   （arraybuffer，原图可达 1.8MB 级），一次性取回后才显示；`<img>` 原生加载本可按需渐进，
   隧道路径丢了这个能力。
2. **缓存只活一个会话** —— `MediaImage` 的 `proxyCache`（src → blob URL）是**模块级内存
   Map**，应用重启 / HMR 后即清空，瀑布流全部微博图**重新隧道下载**。crawler 层
   `fetchImageSize` 的 `sizeCache` 只缓存**尺寸**（Range 文件头 ~1KB），不缓存图内容。
3. **无并发上限** —— 瀑布流多图各自独立发起隧道请求，无批大小限制；几十张图同时走 Rust
   隧道（reqwest 线程池）排队时放大总耗时。
4. **尺寸预取是额外往返** —— 缺宽高的图先发一个 Range 请求（~1KB），再发全量隧道请求，
   两段式；微博图没有 API 宽高，每张都要走（小红书 SSR 自带宽高、bili 动态 API 自带宽高，
   不受此影响）。

**已有缓解**：`sizeCache`（crawler）缓存尺寸、`proxyCache`（ui）会话内缓存图 → 同一会话内
滚动重挂载不重复拉图。**跨重启无缓存**是主要短板。

**优化方向**（未来，均未做）：

- **方案 B 自定义协议 `media://`**（见上文）：Rust 侧流式返回、`<img>` 原生加载，无 blob
  膨胀 / JS 隧道，瀑布流多图是真实收益 —— 本慢问题的主要解法；
- 或隧道层加**磁盘缓存**（图 URL → 字节，持久化，重启复用）；
- 或 `proxyCache` 加 **LRU 上限**防长期会话内存膨胀；
- 或隧道请求加**并发批大小上限**（如 ≤6 并发）。

## 发现页与添加订阅

- **发现页能力矩阵只显示已实现入口**：不再渲染「无渠道」灰行；没有分区/搜索能力的平台整卡
  不出现（微博/小红书走「可订阅榜单」）；切平台时视图自动落到该平台支持的第一个能力
  （`DiscoverPage` 的 `pickPlatform` + `caps` 效应）。平台卡用 `flex-direction:column` +
  `.chip-row{margin-top:auto}`，能力行数不同也把操作按钮固定在卡片底部。
  ⚠️ **分区目录本身是一个订阅**（`twitch:categories` 等，产 `kind:"category"` 条目），不是
  发现页的一次性目录。它出现在「可订阅榜单」里，点分类卡片 → URL 变 `?open=` → 右侧**用
  正常网格**列出该分区内容（条目自带的 `categoryChannel` + **完整 `categoryInfo`** 调
  `previewChannel`，苹果播客式二级）→ 表头「订阅该分区」。
  ⚠️ 预览条目的 `subscriptionId` 是 `preview:<channelKey>`、没有订阅记录 —— 播放解析在 core
  里按这个前缀补默认 info（`previewInfoFor`），否则会误报「不指向可解析的直播链接」。
  ⚠️「浏览分区」入口（已知分区 ID 直接取内容）用显式 `CATEGORY_CHANNEL` 表，不按
  `<platform>:category` 命名约定 —— `youtube:live-category` 不在约定里；手输参数**逐字段
  渲染 `sourceInfoTpl`**（抖音 `partition + partitionType` 双参不会漏）。
- **发现页搜索与「添加订阅」同形态**：两者共用 `AddPanels.tsx` 的 `CandidateList`
  （缩略图 + label/sub/meta + 选中态 + 已订阅标记）。发现页（分区/搜索/搜主播）的结果都
  转成候选，选中后可直接 `addSubscription`（roomId/videoId 单值），不用再开弹窗；
  「订阅该搜索词」仍走 `AddSubscriptionDialog`。
- **搜索添加有两类目标**（2026-10-16）：搜房间（`SEARCH_CHANNEL` → live 渠道，roomIds 列表
  参数可「并入已有」）与搜用户（`USER_SEARCH_CHANNEL` → `bili:user_video`/`youtube`，
  uid/channelId **单值参数无并入**，targets 恒空自动隐藏「添加到」区块）。⚠️ 用户模式的
  落地参数名用**显式表 `USER_SUB_PARAM`**，不能取 `sourceInfoTpl[0]` —— `youtube` 渠道首参
  是 videoId（订阅单视频），频道订阅是第二参 channelId。候选值从 **url 解析**
  （`candidatesFromUsers`：`space.bilibili.com/<mid>` / `channel/<UC...>`）—— raw 不穿 XML
  边界，粉丝/订阅数走 summary 字段。
- **手工添加直播房间也能并入已有订阅**（2026-10-19）：`AddSubscriptionDialog` 手工模式下，
  `roomIds` 列表型参数会列出同渠道已有订阅；提交时用 `splitValues` 合并去重，不新建。
  搜索模式的「添加到」同义。
- ⚠️ **`AddSubscriptionDialog` 的 `rss:` 过滤器只放行两个**：`rss:url`（任意直链）与
  `rss:podcast`（播客，解 enclosure → 可播条目）。其余 `rss:*` 是 36 条种子清单，列出来太噪。
  ⚠️ 曾把整个 `rss:` 前缀滤掉 → **手工加外部 feed / 订阅播客都没有入口**
- **`loginable` 是「支持扫码登录」，不是「必须登录」**：抖音直播/分区搜索等匿名也可用。
  渠道 chip 用紧凑 QR 标记（13px + accent-soft pill），并按**平台**聚合 —— 同平台任一渠道
  支持登录就给该平台所有 chip 同一标记；不要用文字 tag「需登录/可扫码登录」（太小读不懂、
  像警告）。选中渠道后另有登录说明，入口统一在「账号与凭证」（2026-10-19 修正）。

## 调试工具

- ⚠️ **UI 自动化的 CDP target 必须按 URL 过滤**：DevTools 自己也是 `type: "page"`，取第一个
  会连到 DevTools 而不是应用页面（曾因此截了一堆 DevTools 的图当「应用截图」）。
- ⭐ **抓取用 Edge 的 CDP 端口固定 9223，可从外部脚本直连**（`GET http://127.0.0.1:9223/json/list`
  → page target → WebSocket `Runtime.evaluate`）。验证 browser 侧行为（页面 state / 滚动 /
  翻页方向）不必往产品代码加日志：前后两次读 `__INITIAL_STATE__` 对比即可（2026-10-20 用它
  定位了 explore 分页方向）。⚠️ 两个测量陷阱：① state 树里有**循环引用**
  （`user.loggedIn` 可能是对象），`JSON.stringify` 整棵树抛「Converting circular structure」
  —— 只挑标量/字符串再序列化，布尔判据写 `=== true` 或解 `_rawValue`；② 虚拟列表
  `scrollTo(0,0)` 后**立即**读 `innerText` 拿到的是滚动前的卡片（Virtuoso/masonic 重渲染是
  异步），等 ~1s 再读，否则会把「顶部没变」误判成「顶部被换掉」。
- **Numbered UI Overlay**（`apps/desktop/src/dev/ui-overlay/`，dev-only）：`Ctrl+Shift+U`。
  扫描**已挂载 + 视口内**的候选 = **组件显式声明的区块**（`data-ui-overlay-block`）+ 自动
  发现的可交互控件。区块用 `lib/uiOverlay.ts` 的 `{...overlayBlock("kind", "可选业务 key")}`
  声明（DEV 之外返回 `{}`，生产无属性）；区块 = 绿色标签 + **整个区块的绿色描边边界框**
  （随滚动实时重定位），控件 = 琥珀标签；工具栏可「仅区块」。`400` 是**同屏标签上限**，
  不是编号上限（编号可超 400，超出部分只显示 `+N`，**区块优先保留**）。同一元素/条目在本
  路由会话内编号固定：稳定 key 优先取 `data-ui-overlay-key` / React fiber 业务 id
  （`item.subscriptionId:id` / `sub.id` / `group.id`），其次 data-* / 唯一 id / 列表标题；
  虚拟列表滚出滚回、DOM 重建都复用同号。路由变化重置，隐藏/显示不重置。
  见 `docs/ui/numbered-ui-overlay.md`。
