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

⚠️ **元素级 reset 必须写在 `@layer base` 里**：`styles/10-tokens.css` 的 `@layer base{}` 一旦被
自己提前 `}` 收尾，后面的 `button/h1/ul` reset 就成了**无层规则** —— 而**无层 CSS 优先级
高于所有 `@layer`**（Tailwind 4 层序 `theme < base < components < utilities`）。后果：
`button{background:none;border:0;padding:0}` 把 packages 里所有 tailwind 按钮的
`bg-*`/`border-*`/`px-*`/`py-*` **全废掉**（渲染成无边框无内边距的裸按钮）。app 内看不出来
（desktop 用自己的 `.btn`/`.icon-btn`，同为无层、自己就能赢），受害的是 `packages/player`、
`packages/ui` 这类只靠 utility 的代码。2026-10-14 已全部移进 base 层。**改 `styles/10-tokens.css`
的结构性规则后，务必用 CDP 量一次真实 computed style**（`getComputedStyle(btn).paddingInlineStart`
应为 `12px` 而非 `0px`）。

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
- **视觉基调**：冷石墨表面 + 信号橙 accent（合流改版，2026-10-27）。
  深色表面 hue≈264–275（`--bg` 264 / `--surface-1..3` 275/271/267），浅色 hue≈106；
  accent 深 `oklch(0.686 0.205 34)`（#FF5C38）/ 浅 `oklch(0.553 0.174 38)`（#C2410C）。
  **深/浅两套是各自独立取色（浅色不是深色反转）**，改值要逐主题核对是否漏写覆盖；
  文字与 `--scrim`/`--stage-bg` 仍是近中性暖值（hue 72–80）。取值与实测对比度以
  `apps/desktop/src/styles/10-tokens.css` 的行内注释为准。
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
- **常驻播放浮层的层级**（2026-10-31）：`.mini-player`（播客迷你条）与 `.vmini`/`.vmini-listen`
  （视频会话小窗/听条）同用**手写 z-index 38**（低于 `--z-drawer:40`/`--z-modal:50`，高于
  正文——它们是内容伴生控件不是浮层令牌族）；右下角浮层 `bottom: calc(var(--sp-4) + 68px)`
  让位迷你条的 68px 底条（两浮层同显不叠，常量偏移不做条件判断）。机制见
  `docs/playback/playback.md` 视频会话与小窗节。
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
- ⚠️ **侧栏窄栏隐藏列表必须两份对齐**：`styles/20-shell.css` 里 `.rail.rail-collapsed`（手动折叠）
  与 `styles/90-responsive.css` 的 `@media (max-width:1080px)`（窄窗）各有一份 `display:none` 清单，**逐项必须一致**
  （`nav-label`/`nav-count`/`nav-warn`/`rail-empty`/`group-empty`/…）。曾漏掉 `group-empty`
  → 空分组提示文案在 64px 栏里被压成逐字竖排

## 滚动与虚拟化

- ⚠️ **主区里不在滚动器内部的元素是「滚动死区」**：`body` 是 `overflow:hidden`，鼠标停在
  这些元素上找不到可滚祖先 → 滚轮完全无反应（用户会描述成「页面无法上下滑动」）。
  `MediaMain` 的 `.grid-head` / `.live-block` 曾占掉 **59% 的视口**。
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
  `openExternalSafely`。漏拦时 Rust 侧的 nav-guard（`apps/src-tauri/src/plugins/nav_guard.rs`，
  2026-11-01）会取消主窗口导航并把 http(s) 交给系统浏览器，界面不会再被外站顶掉 ——
  但那是兜底：前端拦截才有失败 toast 与锚点滚动。
- ⚠️ **第三方正文 HTML 只能经 `lib/sanitize.ts` 的 `sanitizeFeedHtml` 渲染**（唯一消毒配置）：
  它在 DOMPurify 默认之上去掉 `<style>`（对整个应用文档生效）、表单族、带
  `position`/`z-index` 的内联样式。别在调用点直接 `DOMPurify.sanitize` 另起一份配置。
- ⚠️ **JS 驱动的动画挡不住 `prefers-reduced-motion`**：`styles/90-responsive.css` 里那条
  `@media (prefers-reduced-motion: reduce)` 只压
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

> 2026-08。微博图床 403 触发：审计 `<img>` 图片加载的 Referer 处理，当时结论是维持
> blob 隧道。**2026-10-25 更新**：桌面改为 WebView2 `WebResourceRequested` 原生注入。
> **2026-10-28 更新**：图片的 blob 隧道**删除**（过度防御）——图片恒直连，未注入环境
> 403 → ImageOff 占位；实况视频也恒直连（blob 回退已删）；XHR/fetch 的 Origin 改写（Twitch
> playlist 域）同批加入。自定义协议仍不做。

### 背景：sinaimg 对空 Referer 也 403

新浪图床（`*.sinaimg.cn`）对**空 Referer 也返回 403**，只放行 `weibo.com` / `m.weibo.cn`
系 Referer（curl 实测：无 Referer 403，带 weibo.com 200）。而 `<img>` 原生加载**必带页面源
Referer**（桌面是 `tauri://localhost`），且 Referer 由 Referrer-Policy 控制、**与同源策略
（SOP）是两套独立机制** —— 关掉 webview 的 SOP 也救不了（`--disable-web-security` 只放开
fetch 读跨源响应体，改不了 img 发出的 Referer）。无免防盗链子域捷径（实测
n/tva/ws1.sinaimg.cn 等子域全部 403/404）。

唯一能让 Referer 正确的途径 = **在网络层改写请求头**：桌面用 WebView2
`WebResourceRequested`，其他环境用 Rust reqwest 代理（可设任意 header）。页面里的
`fetch` / `<img referrerpolicy>` 都改不了跨源 Referer。

### 现行方案：桌面原生注入，图片无 JS 回退（2026-10-28）

**桌面（Windows/WebView2）**：Rust 在 `setup` 里注册 `WebResourceRequested`，按请求
context 改写请求头、不接管响应（`apps/src-tauri/src/media_referer.rs`）：

- `IMAGE`/`MEDIA`（图片/实况视频）→ 改 `Referer` 为站内值；
- `XML_HTTP_REQUEST`/`FETCH`（hls.js manifest 等 XHR）→ 改 `Origin`（Twitch playlist
  域拒页面源 `*.tauri.localhost`，2026-10-28 curl 实测钉死）。

图片/实况直接走原生 `<img>` / `<video>`，保留 HTTP 缓存、HTTP/2、Range 与渐进解码。
**无 JS 隧道、无能力探测**：图片与实况视频均恒直连（`nativeMediaReferer` 及两套
blob 回退已于 2026-10-28 删除）；未注入环境（纯浏览器调试）防盗链图 403 → ImageOff
占位，实况视频播放失败 → 退回静态图 + 重试按钮。

- 规则表收敛在 **resolve 层**（`packages/resolve/src/media-referrer.ts`）：图片/视频
  `mediaReferrerFor` / `videoReferrerFor`（`sinaimg.cn → https://weibo.com/` 等），
  XHR Origin `xhrOriginFor`（`playlist.ttvnw.net → https://www.twitch.tv`，**不带尾斜杠**）、
  XHR UA `xhrUserAgentFor`（`hls.huya.com → HYSDK…` 播放器 UA，浏览器 UA 403）—— 唯一
  权威；Rust 侧为了拦截回调保留一份常量，`media-referrer-parity.check.ts` 守住
  两边一致（四张表 + UA 去品牌 host 列表）；
- `MediaImage`（`packages/ui/src/renderers/atoms/MediaImage.tsx`）已无隧道/探测逻辑：
  恒直连（Windows 由 Rust 注入兜住），失败走 ImageOff 占位；
- 跨三环境统一（tauri/browser/node），纯 TS 无 eval，CSP 安全；
- 实机验证（2026-10-25）：CDP `requestWillBeSentExtraInfo` 显示 sinaimg 与 xhscdn
  请求的实际 Referer 分别为 `https://weibo.com/` 与 `https://www.xiaohongshu.com/`；
  白名单外 host 保持页面源 Referer，不被改写。

**图片宽高**由单独一段解决：`resolve/src/utils/img-size.ts` Range 预取文件头解析
（PNG 64B / JPEG 1KB），失败退化 4:3。XML `tpl:image` 带 `@_url/@_width/@_height`。

### Tauri 自定义协议跨平台差异（官方 docs.rs 查证）

> 评估过用自定义协议 `media://` 替代隧道，结论是**不做**（见「决策」）；本节与下节「安全」是评估依据。

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

- **桌面优先 WebView2 原生注入，blob 保留为回退与跨平台路径**。理由：原生注入不改
  响应体，缓存/Range/渐进解码全部保留；Windows 之外没有等价的可写 header 拦截点
  （Android WebView 只能造响应，不能改请求头），所以回退路径必须保留。
- **不做自定义协议 `media://`**：Tauri 的 responder 仍要求完整 body，wry 会整块复制
  进内存流，不是真流式；且自定义协议基本绕开 Chromium 缓存，Android 的 Range 还有
  已知缺陷（形态差异与安全洞见上文两节）。**两条替代路线都不做**：`http_get` 自动补
  Referer 会把同一份规则分裂成 TS/Rust 两份；`media://` 的原生 img 加载收益已被桌面
  WebView2 原生注入覆盖。

### 图片加载性能（2026-08 实测；2026-10-25 起只剩回退路径）

桌面走 WebView2 原生注入后不再有隧道瓶颈（跨重启复用 Chromium HTTP 缓存）。旧瓶颈只剩
非 Windows 回退路径：整图下载（无渐进）、`proxyCache` 只活一个会话、无磁盘缓存、尺寸预取
多一次 Range 往返（`sizeCache` 只存尺寸，见 `resolve/src/utils/img-size.ts`）。

**剩余优化（未做）**：回退路径加「图 URL → 字节」持久缓存；尺寸预取与显示合并；自定义协议
`media://` 仍不推荐（见「决策」）。

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
- ⭐ **抓取浏览器的 CDP**：桌面已封 `browser`（`injectTauriHost({browser:false})`），抓取浏览器
  由数据服务 spawn 的 `amoeba-browser` sidecar 承载，**端口不固定**（sidecar 输出 `READY <port>`，
  见 `docs/architecture/crawler-topology.md`）；固定 9334 只属于 Tauri 内嵌路径（宿主未封 `browser` 时）。
  拿到端口后 `GET http://127.0.0.1:<port>/json/list` → page target → WebSocket `Runtime.evaluate`。
  验证 browser 侧行为（页面 state / 滚动 / 翻页方向）不必往产品代码加日志：前后两次读
  `__INITIAL_STATE__` 对比即可（2026-10-20 用它定位了 explore 分页方向）。⚠️ 两个测量陷阱：
  ① state 树里有**循环引用**（`user.loggedIn` 可能是对象），`JSON.stringify` 整棵树抛
  「Converting circular structure」
  —— 只挑标量/字符串再序列化，布尔判据写 `=== true` 或解 `_rawValue`；② 虚拟列表
  `scrollTo(0,0)` 后**立即**读 `innerText` 拿到的是滚动前的卡片（Virtuoso/masonic 重渲染是
  异步），等 ~1s 再读，否则会把「顶部没变」误判成「顶部被换掉」。
- **Numbered UI Overlay**（`apps/desktop/src/dev/ui-overlay/`，dev-only）：`Ctrl+Shift+U` 开关，
  区块用 `lib/uiOverlay.ts` 的 `overlayBlock()` 声明。编号语义、400 上限、稳定键优先级与重置规则见
  `docs/ui/numbered-ui-overlay.md`。

## UI 组件/样式/动画库选型（2026-10-27 评估，结论：不换库）

四条硬约束决定匹配度：样式能对接**手写 CSS + 现有 token**、能活在**虚拟列表**（Virtuoso/masonic）里、
动效受 **`data-motion` 三档**控制、包体/启动敏感（桌面安装包 7.4MB）。按此筛过一轮主流候选，
**没有任何组件库值得替换**；匹配度 high 的只有 CSS 原生能力。

| 层 | 候选 | 结论 |
| --- | --- | --- |
| 行为 | `radix-ui` 聚合伞包 | 同一份代码的打包形态，**零收益**（多约 25 个未用 primitive、锁死版本号） |
| 行为 | Base UI 1.9.0 | 同类最契合（无样式/CSS 变量/`data-*`/MIT/React 19），但**同面 +28KB gzip、零功能增益** |
| 行为 | Ark UI / React Aria / Headless UI | 迁移面或 API 距离更大；Headless UI 的 Select 只是原生 `<select>` 包装（系统菜单） |
| 样式 | **CSS `@layer` 声明层序** | 唯一 high：把「`@import` 顺序 = 层叠顺序」改成显式层声明 |
| 样式 | Panda / vanilla-extract / Open Props / UnoCSS / CSS Modules | 会造第三个 token 权威，或只改善那 8.7% 的 utility |
| 动画 | **CSS 原生**（`@starting-style` / `interpolate-size` / View Transition） | 唯一 high，零依赖，正好补浮层退场 |
| 动画 | `motion/mini`（**不是** `motion/react`） | 可预留：~3KB，补 FLIP/可中断编排；`lib/motion.ts` 已留入口 |
| 动画 | Motion One | ⚠️ monorepo **已归档**（最后版本 2024-06），别按旧名引入 |
| 动画 | AutoAnimate / anime.js / tw-animate-css | 不认 `data-motion` 三档 / 体积 10–40KB / 绑定 Tailwind 固定时长 |
| 部件 | sonner / cmdk / react-resizable-panels / TanStack Virtual | 自研更贴合（token 时序、IME 守卫、grid 折叠补间、Virtuoso 动态高度） |

判据数字（实测）：903 个 className token 里 utility 仅 84（**9.3%**），自维护语义类 359 个；
Radix 触点仅 **7 条 import / 4 个文件**；样式 11 文件 4087 行。换库只会动到外壳、拿不到功能收益。

可做但**未做**（按性价比排序）：

1. `@layer` 层序（半天）：`styles.css` 顶部声明
   `@layer theme, base, components, utilities, app.tokens, …, app.responsive;`。
   ⚠️ `10-tokens.css` **只包选择器块**（`:root`/`[data-theme]`/`[data-density]`/`[data-motion]`），
   `@theme`/`@keyframes`/`@font-face` 与元素 reset 必须留顶层——包错是静默大面积变色。
2. Radix 补丁升级：`dialog 1.3.0→1.3.1`、`dropdown-menu 2.2.0→2.2.1`；`packages/player`
   的 `^2.1.6` 对齐到 `^2.1.25`（消版本漂移）。
3. 浮层退场（Dialog/Menu/Toast）+ Accordion 高度过渡（0.5–1 人日，纯 CSS，
   受 `data-motion` 三档控制）。
