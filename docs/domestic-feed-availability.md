# 测试数据源可用性梳理（国内平台重点）

> 结论依据：`scripts/rsshub-catalog.ts` 静态摘录（tmp/RSSHub）+ 逐 URL `curl` 实测。
> 「可用」= 能直接出 RSS/Atom feed 或纯 `ofetch` 无反爬可复刻。

## 一图速览

| 平台 | 原生 RSS/Atom | 简单路由(可复刻) | 实测结论 | 建议 |
|---|---|---|---|---|
| **少数派 sspai** | ✅ `sspai.com/feed` | 10 | feed 直接可用 | **直接用** |
| **36氪 36kr** | ✅ `36kr.com/feed` | ✅ | feed 直接可用 | **直接用** |
| **IT之家 ithome** | ✅ `ithome.com/rss/` | ✅ | feed 直接可用 | **直接用** |
| **开源中国 oschina** | ✅ `oschina.net/news/rss` | ✅ | feed 直接可用 | **直接用** |
| **InfoQ 中文** | ✅ `infoq.cn/feed` | ✅ | feed 直接可用 | **直接用** |
| **爱范儿 ifanr** | ✅ `ifanr.com/feed` | ✅ | feed 直接可用 | **直接用** |
| **极客公园 geekpark** | ✅ `geekpark.net/rss` | ✅ | feed 直接可用 | **直接用** |
| **cnBeta** | ✅ `cnbeta.com.tw/backend.php` | — | feed 直接可用 | **直接用** |
| **新浪科技** | ✅ `rss.sina.com.cn/tech/rollnews.xml` | — | feed 直接可用 | **直接用** |
| **Solidot** | ✅ | ✅ | 已入 App | ✅ 已用 |
| **bilibili** | ❌ 无原生 | ✅ **29** | 走 API 无反爬 | **可复刻** |
| **xueqiu 雪球** | ❌ WAF | ✅ 5 | API+需破 WAF | 风险高 |
| **baidu** | ❌ | ✅ 空 | 热搜榜 | 低价值 |
| **weibo 微博** | ❌ 反爬 | ❌ 0 | 需 puppeteer | 不建议 |
| **wechat 公众号** | ❌ | ⚠️ 4（第三方） | 需 TG/第三方 | 不建议 |
| **zhihu 知乎** | ❌ 空响应 | ❌ 0 | 需 token | 不建议 |
| **douban 豆瓣** | ❌ | ❌ 0 | 反爬 | 不建议 |
| **gitee** | ❌ | ❌ 0 | — | 不建议 |
| **qq 腾讯网** | ❌ | ❌ 0 | — | 不建议 |

## 二、立即可用的原生 feed（已 curl 实测 200 + 真 XML）

可直接塞进 `App.tsx` 的 `TEST_SUBSCRIPTIONS`，无需任何抓取逻辑，走现有 `RssSource`：

| # | 平台 | feed URL | 类型 |
|---|---|---|---|
| 1 | 少数派 | `https://sspai.com/feed` | RSS · 图文 |
| 2 | 36氪 | `https://36kr.com/feed` | RSS · 图文 |
| 3 | IT之家 | `https://www.ithome.com/rss/` | RSS · 图文 |
| 4 | 开源中国 | `https://www.oschina.net/news/rss` | RSS · 图文 |
| 5 | InfoQ中文 | `https://www.infoq.cn/feed` | RSS · 图文 |
| 6 | 爱范儿 | `https://www.ifanr.com/feed` | RSS · 图文 |
| 7 | 极客公园 | `https://www.geekpark.net/rss` | RSS · 图文 |
| 8 | cnBeta | `https://www.cnbeta.com.tw/backend.php` | RSS · 图文 |
| 9 | 新浪科技 | `https://rss.sina.com.cn/tech/rollnews.xml` | RSS · 图文 |
| 10 | Solidot | `https://www.solidot.org/index.rss` | RSS · 科技（已加入） |

> 新浪科技返回的头部带 `xml-stylesheet`，grep 会误判为 HTML，实为**真 RSS**（含 15 条 `<item>`）。

## 三、重点候选复刻：bilibili（走 API，无反爬）

catalog 显示 bilibili **29 个简单路由**，全走 `ofetch` API 且 `antiCrawler:false`——是这几个大平台里**最值得复刻**的。已确认的可复刻路由：

| path | 名称 | 说明 |
|---|---|---|
| `/app/:id?` | 更新情报 | 应用更新 |
| `/user/article/:uid` | UP 主图文 | 结合本项目 live 的 bilibili 平台可复用 |
| `/audio/:id` | 歌单 | |
| `/precious/:embed?` | 入站必刷 | |
| `/user/coin/:uid` | UP 主投币视频 | |
| `/user/fav/:uid/:fid` | UP 主收藏夹 | |
| `/video/danmaku/:bvid/:pid?` | 视频弹幕 | 注意：catalog 抓的 `comment.bilibili.com/${cid}.xml` 是**弹幕 XML 非 feed** |
| `/hot-search` | 热搜 | 可直接做「hometab」级测试源 |

## 四、不建议碰的（反爬 / 无原生）

- **微博 weibo**：多数路由 `requirePuppeteer:true`，catalog 里 0 简单。要 cookie，不定。
- **知乎 zhihu**：`/rss` 空响应，需 `x-zu-token`，反爬。
- **微信公众平台**：无个人公众号 feed，仅第三方（Telegram 频道 / 优读 / Wechat2RSS）间接来源，不稳定。
- **雪球**：阿里云 WAF，返回 `textarea` 反爬挑战。
- **豆瓣 / gitee / 腾讯**：无原生 feed，catalog 0 简单。

## 五、用法

- 直接可用的一批（第二节）可随时并入 `TEST_SUBSCRIPTIONS`（参照 `cnBeta`/`新浪` 已验证）。
- bilibili 复刻 → 参考 `tmp/RSSHub/lib/routes/bilibili/**`（本项目 live 层已有 bilibili 平台实现，可对齐 API 签名）。
- 新源可用性 → 鼓励跑 `bun run scripts/rsshub-catalog.ts` 重新生成 catalog，再用脚本探测。

> 记：catalog 的「原生 feed 直传」对**中文源覆盖差**（仅 solidot/bilibili弹幕），大量国内源是**简单 scraper**而非直传，需到仓库看 handler 是否纯 `ofetch`。