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
| desktop UI 布局/隐藏 | `scripts/ui-probe.ts goto <node>` + `ui-console.ts` |
| 侧栏分组树(展开态/键盘) | `apps/desktop/src/lib/rail-nav.check.ts` + `ui-probe.ts goto tab:all`;⚠️ 必验「焦点在树行按 ↑↓ **不**切文章」,见 `docs/rail-tree-accordion.md` |
| 设计令牌/对比度 | `scripts/ui-design-audit.ts` |
| 改 `ui-design-audit.ts` 本身 | 跑一遍看全视图 contrastIssues 是否 0（含半透明徽标卡片，如 `s-video-bili`） |
| 滚动条 / `scrollBarStyle:fluentOverlay` | CDP 量 `El.offsetWidth - clientWidth`：**必须 0**（>0 = 被 `::-webkit-scrollbar` 顶成经典条）。空白页对照法见下方结论记录 |

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
