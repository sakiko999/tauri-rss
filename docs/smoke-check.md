# 端到端巡检清单（改完代码跑什么）

> 仓库无测试基建。本文件是**最小复验集合**：按「改了什么 → 跑什么」组织，每条都是
> 实测可用的命令。⚠️ 读代码判断不可靠 —— 本会话的 `hasPlayable` 误判 bili DASH 流
> （url 恒空串）、播客 `preload=none` 死锁，都只在**真机播放**才暴露。

## 一、改动 → 巡检对照

| 改了什么 | 跑什么 |
| --- | --- |
| **任何** 改动 | 6 包 `tsc --noEmit`（见下）+ 相关 `.check.ts` |
| crawler→core 字段 | `serialize-roundtrip.check.ts` + `serialize-contract.check.ts` |
| player 选流/兜底/autoplay | `scripts/ui-play-check.ts`（真机播放矩阵） |
| by-url 路由 | `packages/resolve/src/example/router.check.ts` |
| 文章正文提取 | `packages/crawler/src/example/extract.check.ts` |
| 正文持久缓存 | `packages/core/src/example/body-cache.check.ts` |
| 仓储并发/退订 | `packages/core/src/example/repo-concurrency.check.ts` |
| 续播进度落库（节流/近片尾清除） | `packages/core/src/reading-position.check.ts` |
| mobile 正文渲染 | `apps/mobile/src/html.check.ts` |
| OPML | `apps/xml` + `apps/desktop` 的 `opml.check.ts` |
| 新增/改动「回车提交」输入框 | `bun apps/desktop/src/lib/ime.check.ts`;⚠️ 守卫只挡 `keydown`,**不改中文输入法的组合行为**(实机验证仍需真 IME) |
| 弹幕 WS 重连(退避/熔断) | `bun run rss dm <在线房间> -s 5`;断线后看日志应是「第 N 次, 约 Xms 后」而非固定 1000·2ⁿ,且 10 次后打「放弃」 |
| desktop UI 布局/隐藏 | `scripts/ui-probe.ts goto <node>` + `ui-console.ts` |
| 侧栏分组树(展开态/键盘) | `apps/desktop/src/lib/rail-nav.check.ts` + `ui-probe.ts goto tab:all`;⚠️ 必验「焦点在树行按 ↑↓ **不**切文章」,见 `docs/rail-tree-accordion.md` |
| 组件拆分(移动/新建文件) | `tsc -p apps/desktop` + `ui-probe.ts goto page:settings` / `page:discover` 各走一遍;⚠️ tsc 查不出**循环 import 与渲染断链**,必须实机点 tab / 开弹窗 |
| 设计令牌/对比度 | `scripts/ui-design-audit.ts` |
| 改 `ui-design-audit.ts` 本身 | 跑一遍看全视图 contrastIssues 是否 0（含半透明徽标卡片，如 `s-video-bili`） |
| 滚动条 / `scrollBarStyle:fluentOverlay` | CDP 量 `El.offsetWidth - clientWidth`：**必须 0**（>0 = 被 `::-webkit-scrollbar` 顶成经典条）。空白页对照法见下方结论记录 |
| 改 `styles.css` 的 `@layer` / reset 结构 | CDP 量 tailwind 按钮的 `getComputedStyle(btn).padding`：**必须 `6px 12px`**（`0px` = reset 漏在层外，把 utility 压死了） |

## 二、类型检查（6 包，必须全 0）

```bash
for p in packages/xml packages/core packages/crawler packages/resolve apps/desktop apps/mobile; do
  ./node_modules/.bin/tsc -p $p/tsconfig.json --noEmit
done
```
⚠️ player 包 tsconfig 单独跑会报 `Cannot find type definition file for 'vite/client'`（历史配置问题，
非代码错）；用 `tsc -p apps/desktop` 会连带编译 player，能查到 player 的类型错。

## 三、播放矩阵（必须 4/4 起播）

需 `bun run tauri` 在跑（9222 已开）。
```bash
bun scripts/ui-play-check.ts
```
覆盖 video-bili（DASH）/ video-youtube（DASH）/ live（HLS）/ audio（原生）。断言 `currentTime > 0`。
⚠️ 用 CDP `Page.navigate` 而非 `location.href=`（后者被 react-router startTransition 接管，读到旧页）。

## 四、平台能力探针（CLI，无需 app）

```bash
bun run rss fetch bili:popular --json        # bili 视频列表
bun run rss fetch xhs:explore --json         # 小红书匿名流
bun run rss fetch douyin:trend --json        # 抖音热点榜（匿名，含热度/榜位）
bun run rss sug 王者                          # 抖音搜索联想词（匿名）
bun run rss play "https://live.douyin.com/<在线房间>"   # douyin 直播多档位
bun run rss dm   "https://live.douyin.com/<在线房间>" -s 6  # douyin 弹幕（需在线房间）
bun run rss item <url>                        # by-url 路由 + 全档位
```
⚠️ **固定房间会下播**：种子里的 bili/douyu/huya/douyin 房间硬编码，下播时流/弹幕为空
（`liveStatus:"offline"`）**非 bug**。取实时在线房间用 `live:douyin:hot` 等热门渠道。

## 五、已知「看似失败实为正常」

- **离线直播**：`resolveLivePlay` 返回空 / flv 404 / 0 弹幕 —— 房间已下播（查 `liveStatus`）。
- **xhs 详情裸 url**：`bun run rss detail <url>` 无 xsec_token 必失败（详情需列表项 token）；
  经 app 的 `resolveDetail(sub, itemId)` 才带 token。
- **浏览器路径（非 Tauri）**：`injectBrowserHost` 有 CORS 限制，平台抓取会失败，仅壳层可用。
- **douyin 弹幕 0 条**：房间离线时正常。

## 六、结论记录

- 2026-10-13 全会话复验：bili / douyu / huya / douyin / youtube / xhs / 播客 / RSS 全绿；
  播放矩阵 4/4；6 包 0 类型错误；9 `.check` 全通过；设计审计 0 真实对比度违规。
- 2026-10-13 审计轮复验：host/cli/xml/desktop+player 四轮审计 → 修 16 条真缺陷；
  8 包 0 类型错误；12 `.check` 全通过；播放矩阵 4/4；控制台 0 告警。抖音联想/热点榜 + `resume`
  智能订阅 + 发现页 5 处修复一并落地。
- 2026-10-13 审计轮二：resolve + crawler 两层审计 → 修 8 条真缺陷（bili 弹幕截断帧死循环 /
  斗鱼帧粘包只解首包 / youtube 解 n 抠错 videoId / bili buvid 缓存毒化 / 四平台直播全失败当成功 /
  huya 搜主播 online 假 0 / bili:square id 含下标 / douyin 重复 enter）+ 2 条复核纠正为误报。
  新增 2 守卫（danmaku-proto / douyu-frame）→ 14 `.check` 全通过；8 包 0 类型错误；播放矩阵 4/4；
  八路搜索矩阵全绿；控制台 0 告警。
- 2026-10-14 侧栏分组树改 Radix Accordion + 方向键导航（见 `docs/rail-tree-accordion.md`）：
  tsc 0 错；`rail-nav.check.ts` 全过；CDP 验「焦点在树行按 ↑↓ 不切文章」+ 焦点移出树后仍能切文章
  （反证）；折叠栏 64px 与窄窗 1024px 下方向键均可用；`ui-probe` 0 问题；无 React 告警；
  `ui-design-audit` contrastIssues 0、smallTargets 6 → 1。
- 2026-10-14 启动过渡期骨架屏（Vite 的 dev 脚本执行前有 ~1.1s 纯空白）：
  `#boot-skeleton`(index.html 静态) + `.boot-overlay`(App 兜底) 同一判据 `showSkeleton()` 同收；
  修掉「库读到前视图画『还没有订阅』假信息」与「静态骨架留在正常流把 #root 顶出首屏」两坑。
- 2026-10-14 **`scrollBarStyle:"fluentOverlay"` 被 `.scroll-area::-webkit-scrollbar{width:10px}` 旁路**：
  实测（WebView2 155）`.rail-scroll` / `.main-region > .scroll-area` 的 `offsetWidth-clientWidth` 恒为 **9**
  —— 是**经典**滚动条、占布局。判定法：**空白页最小对比**（`overflow:auto` 的 300px 盒，
  量 `offsetWidth-clientWidth`）：无任何滚动条 CSS → `0`（overlay 生效）；加一条
  `::-webkit-scrollbar{width:10px}` → `10`（切经典）。`scrollbar-width:thin/auto` 则保持 `0`。
  故**只要 `::-webkit-scrollbar` 匹配上就会切经典模式**，fluentOverlay 失效。
  删掉那条规则后 gutter 归 0，`--rail` 268px 下侧栏 258→**267px**、主区宽 9px。
  ⚠️ 折叠栏图标对齐（-5px）与 `.group-head` 的 -6.3/5.1px 偏移都是这条规则的连锁副产品
  （滚动条吃 10px → 行 38px vs 48px）；「补 5px」类注释已更正为根因记录。
  回归：`tsc` 0 错；`ui-probe audit` issueCount 0；`ui-design-audit` contrastIssues 0；
  折叠栏图标中心 vs 侧栏中心 delta = -0.3px。
- 2026-10-14 **组件分层 + 大文件拆分**（纯重构，零行为变更）：
  - 分层：`components/` = 功能件（纯 props），`components/app/` = 业务件（读 store / 吃 domain 类型）；
    移动 8 个文件 + 13 处 import 路径批量修正。
  - 拆文件：Rail 461→125（+RailGroupTree 356 / NavRow 51）· AddSubscriptionDialog 591→392
    （+AddPanels 262）· SettingsPage 555→52（5 个 tab 各一文件）· DiscoverPage 429→155
    （+PlatformBrowser 218 / BoardList 69 / platforms 15）。
  - 回归：`tsc` 0 错；`ui-probe` tab:all / page:settings / page:discover 各 issueCount 0；
    设置 **17 个 tab 按钮**逐个点过、发现页 4 section、添加弹窗两模式、
    侧栏树方向键（焦点 group→member、defaultPrevented=true）全部实测通过；无 React 告警。
  - ⚠️ 手抄 store 动作签名会踩返回值：`addGroup` 返 `string|null`、`autoGroupByKind` 返 `number`
    —— 拆出的子组件一律用 `Store = ReturnType<typeof useDesktop.getState>` 派生，别手写。
- 2026-10-14 **重命名 + 两个收敛点**：
  - `cards.tsx → Cards.tsx`、`ui/atoms/icons.tsx → Icons.tsx`（全仓 tsx 统一 PascalCase，
    仅 `main.tsx`/`router.tsx` 入口例外）。
  - `store/index.ts` 新增 `syncSubscriptions()`（「重读订阅+分组 → 重绘」），收敛 8 处重复；
    `lib/useLatestOnly.ts` 取代 2 处手写 `genRef`。
  - ⚠️ **重构中引入并修掉的两个顺序 bug**（`syncSubscriptions` 内含 `refreshView`）：
    `removeSubscription` / `removeGroup` 原本是 `set → 改 selectedNodeId → refreshView`，
    改完若把 `syncSubscriptions` 放前面，就会**拿刚删的 id 重算视图**。实测路径：删掉
    *当前选中* 的分组 → 断言 `selectedNodeId==='tab:all'` 且视图非空（实测 120 条）。
  - ⚠️ `toggleSubEnabled` **故意不收敛**（启停不改内容集，多调 refreshView 是白重算）——
    实测 `view.list` 60→60 不变。
  - 回归：6 包 tsc 0 错；14 个 `.check` 全过；`ui-probe` issueCount 0；实机验证建组/改名/
    删选中组/停用/切平台连点/弹窗切模式全通过，无 React 告警。
- 2026-10-14 **播放舞台改黑底 + 揪出 `@layer base` 提前收尾的仓库级 bug**：
  - `PlayableMedia.tsx`:`MediaState` 从主题变量(`bg-[var(--surface-2)]` + `text-[var(--text)]`)
    改成写死黑底白字,并用 `bg-(--surface-2)`→`bg-black` 的 Tailwind 4 简写;顺手把两处
    原生浅色块(`red-300`/`zinc-300` 边框)一并收进 `MediaState`(三处配色原本各不相同)。
    理由:播放器末尾的未知流兜底分支本来就是 `bg-black`,舞台一贯是黑的。
  - **根因 bug**:`styles.css` 的 `@layer base{}` 只覆盖 `*` + `body`,**被自己提前 `}` 收尾**;
    后面的 `h1..figure`/`ul,ol`/`img`/`button,input,select,textarea`/`button` reset 全成了
    **无层规则**,而**无层优先级高于所有 `@layer`** → `button{background:none;border:0;padding:0}`
    把 packages 里 tailwind 按钮的 `bg-*`/`border-*`/`px-*`/`py-*` 全废掉。
    旧 `MS_BTN` 的边框/内边距其实**从来没生效过**,一直被这条掩盖。
  - 修法:把 8 组 reset 全部移进 `@layer base`。**运行时证明**(CDP 从活体 CSSOM 删掉那条
    无层规则 → `padding` 立刻从 `0px` 变 `6px 12px`、`bg` 变 `white/10`、`border` 出现;
    再插回 base 层,结果相同)—— 层序修复正确。
  - ⚠️ 测这层东西**不能只信源码**:Vite 对该文件的 transform 缓存一度卡住,服务端持续发
    旧 CSS(第二段 `@layer base` 恒 283 字节)。判据用**服务端 CSS 长度**或直接量 computed style,
    别用源码 diff。tailwind 的注释会被剥掉,也不适合当探针。
  - ⚠️ 另有环境坑:**重启 `bun run tauri` 会引发 WebView2 CDP 端口重绑**,正在跑的实例
    连不上 9222(本次即因此中断);诊断脚本别依赖跨重启的 CDP 会话。
  - 回归:6 包 tsc 0 错。
- 2026-10-15 **IME 守卫收口 + 弹幕重连加 jitter/熔断**(源自对 open-claude-ui 逆向库的调研):
  - **IME 守卫**:本仓已有两种手写写法(`CommandPalette` 的 `e.isComposing || keyCode===229`、
    `mobile/App.tsx` 的 `e.nativeEvent.isComposing`),但另有 **5 处裸 `key === "Enter"`** ——
    `AddPanels:84`(搜索)/`PlatformBrowser:181`(发现页搜索)/`EditSubscriptionDialog:88`(标题)/
    `settings/Subscriptions:193`(**新建分组名**)/`settings/Reading:64`(RSSHub 地址)。
    中文输入法下回车是**选词**,不拦会建出名叫 `fenzu` 的分组、搜到一半拼音就发请求 —— 全是静默错值。
    新增 `apps/desktop/src/lib/ime.ts` 收口 6 处(含 CommandPalette)。
    ⚠️ **必须取 `nativeEvent.isComposing`**:本仓 `@types/react` 只给**原生**事件声明了该字段,
    合成事件上 `e.isComposing` 直接编译不过(`TS2339`)—— `apps/mobile` 的写法正是因此。
    `keyCode===229` 保留为兜底(上屏那一下 `isComposing` 可能已 false),mobile 那处一并补上。
    自检 `apps/desktop/src/lib/ime.check.ts`(6 条:合成/原生两条路径 × 正常/229/普通)。
  - **弹幕重连**:`resolve/danmaku/stream.ts` 原来只有 `min(1000·2ⁿ, max)`,**无限重试**。
    加 ±15% Full Jitter(多直播间同时断线时错开重连,避免自造流量尖峰)+ `maxAttempts`(默认 10)
    熔断,超限打 `wsReconnectGaveUp` 后放弃(连接成功清零计数,长期在线后仍有全额)。
    ⚠️ 未做 `Retry-After` header 优先 —— WS 握手失败拿不到响应头,收益近乎零。
  - ⚠️ 另有 JS 侧 reduced-motion 缺口:`styles.css` 的媒体查询只压 CSS 动画,
    `ShortVideoView` 的 `scrollIntoView({behavior:"smooth"})` 不受影响 → 新增
    `apps/desktop/src/lib/motion.ts`(`prefersReducedMotion()` / `scrollBehavior()`),已接上短视频切条。
    **引动画库后这条会抬头**(JS 驱动的入场/形变全部绕过媒体查询),Motion 用
    `<MotionConfig reducedMotion="user">` 兜底。
  - 回归:desktop / resolve / mobile tsc 0 错;ime.check 全过。
