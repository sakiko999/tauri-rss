# 国内原生 feed 清单（2026-08 快照）

> 2026-08 的一次性可用性梳理，只用来查「哪些国内站有原生 feed」；渠道可用性以
> `docs/platforms/channels.md` 为准。当时判「不建议」的 weibo / 小红书已有正式渠道
> （`weibo:hot` / `xhs:explore` / `xhs:user`），相关旧结论已失效。

## 一、原生 feed 清单（curl 实测 200 + 真 XML）

| 平台 | 原生 RSS/Atom | feed URL | 备注 |
|---|---|---|---|
| **少数派 sspai** | ✅ | `https://sspai.com/feed` | RSS · 图文 |
| **36氪 36kr** | ✅ | `https://36kr.com/feed` | RSS · 图文 |
| **IT之家 ithome** | ✅ | `https://www.ithome.com/rss/` | RSS · 图文 |
| **开源中国 oschina** | ✅ | `https://www.oschina.net/news/rss` | RSS · 图文 |
| **InfoQ 中文** | ✅ | `https://www.infoq.cn/feed` | RSS · 图文 |
| **爱范儿 ifanr** | ✅ | `https://www.ifanr.com/feed` | RSS · 图文 |
| **极客公园 geekpark** | ✅ | `https://www.geekpark.net/rss` | RSS · 图文 |
| **cnBeta** | ✅ | `https://www.cnbeta.com.tw/backend.php` | RSS · 图文 |
| **新浪科技** | ✅ | `https://rss.sina.com.cn/tech/rollnews.xml` | 头部带 `xml-stylesheet`，grep 会误判成 HTML，实为真 RSS |
| **Solidot** | ✅ | `https://www.solidot.org/index.rss` | 已加入 |
| **bilibili** | ❌ 无原生 | — | 走公开 API + wbi 签名，已复刻 20+ 渠道（`bili:*`） |
| **weibo 微博** | ❌ 无原生 | — | `weibo:hot` 匿名热搜 / `weibo:user` 需登录 |
| **小红书** | ❌ 无原生 | — | `xhs:explore` / `xhs:user` 已实现，需登录 |
| **xueqiu 雪球** | ❌ WAF | — | 风险高，未做 |
| **zhihu 知乎** | ❌ 空响应 | — | 需 token，未做 |
| **豆瓣 / gitee / 腾讯 / 百度 / 公众号** | ❌ | — | 无原生 feed，未做 |

## 二、订阅来源

- 内置 RSS 直链全量清单：`packages/crawler/src/channels/rss/builtin.ts`（36 条，含上表多数源）。
- 首启种子订阅：`apps/desktop/src/dev/seed.ts` 的 `SEED_SUBSCRIPTIONS` / `SEED_GROUPS`（仅 dev）
  （**只在空库写入**，覆盖全部 kind 与平台）。⚠️ 这份清单会随开发调整，**以文件为准**，不在文档里
  再抄一份（曾抄过一版 19 条，很快失效）。
- ⚠️ YouTube `channel_id` 必须精确，误写会静默 404 或串到别的频道（可用 ID 以 `seed.ts` /
  `builtin.ts` 为准）。

> 平台能力（播放/弹幕）与渠道缺口见 `docs/platforms/channels.md`，平台行为见 `platform-notes.md`。