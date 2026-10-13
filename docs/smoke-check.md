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
| mobile 正文渲染 | `apps/mobile/src/html.check.ts` |
| OPML | `apps/xml` + `apps/desktop` 的 `opml.check.ts` |
| desktop UI 布局/隐藏 | `scripts/ui-probe.ts goto <node>` + `ui-console.ts` |
| 设计令牌/对比度 | `scripts/ui-design-audit.ts` |
| 改 `ui-design-audit.ts` 本身 | 跑一遍看全视图 contrastIssues 是否 0（含半透明徽标卡片，如 `s-video-bili`） |

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
