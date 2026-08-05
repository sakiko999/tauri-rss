/**
 * Built-in RSS/Atom direct-feed presets.
 *
 * 27 migrated verbatim from `apps/desktop/src/App.tsx` TEST_SUBSCRIPTIONS
 * (all kind-less = rss), plus 9 new candidates measured OK (curl 200 + XML) from
 * `docs/rsshub-catalog.md` native-feed direct passes.
 */
import type { RssPreset } from "./types.ts"

export const RSS_PRESETS = [
  // ── 文章 / 纯文 ──────────────────────────────────────────────
  { kind: "rss", id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage", tag: "RSS · 纯文" },
  { kind: "rss", id: "ruanyifeng", title: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/atom.xml", tag: "Atom · 纯文" },
  { kind: "rss", id: "v2ex", title: "V2EX", url: "https://www.v2ex.com/index.xml", tag: "Atom · 纯文" },

  // ── 图文新闻（带 thumbnail）──────────────────────────────────
  { kind: "rss", id: "bbc-world", title: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", tag: "RSS · 图文" },
  { kind: "rss", id: "nyt-home", title: "NYT Home", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", tag: "RSS · 图文" },

  // ── 视频（YouTube 官方 feed 直接 URL）────────────────────────
  { kind: "rss", id: "yt-ted", title: "TED Talks (YouTube)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC0RhatS1pyxInC00YKjjBqQ", tag: "Atom · 视频" },

  // ── 音频 / 播客（enclosure + itunes）────────────────────────
  { kind: "rss", id: "huberman", title: "Huberman Lab", url: "https://feeds.megaphone.fm/hubermanlab", tag: "RSS · 播客" },
  { kind: "rss", id: "changelog", title: "The Changelog", url: "https://feeds.simplecast.com/54nAGcIl", tag: "RSS · 播客" },
  { kind: "rss", id: "npr-upfirst", title: "NPR Up First", url: "https://feeds.npr.org/500005/podcast.xml", tag: "RSS · 播客" },

  // ── 文档 / 学术（PDF enclosure）──────────────────────────────
  { kind: "rss", id: "arxiv-cl", title: "arXiv · cs.CL", url: "https://export.arxiv.org/rss/cs.CL", tag: "RSS · 文档" },

  // ── 软件发布（tarball enclosure）─────────────────────────────
  { kind: "rss", id: "vue-releases", title: "Vue.js Releases", url: "https://github.com/vuejs/core/releases.atom", tag: "Atom · 发布" },

  // ── 科技 / 工程博客 ──────────────────────────────────────────
  { kind: "rss", id: "solidot", title: "奇客 Solidot", url: "https://www.solidot.org/index.rss", tag: "RSS · 科技" },
  { kind: "rss", id: "deepmind", title: "Google DeepMind Blog", url: "https://www.deepmind.com/blog/rss.xml", tag: "RSS · 科技" },
  { kind: "rss", id: "theverge", title: "The Verge", url: "https://www.theverge.com/rss/index.xml", tag: "RSS · 科技" },
  { kind: "rss", id: "vscoblog", title: "VS Code Blog", url: "https://code.visualstudio.com/feed.xml", tag: "Atom · 工程" },
  { kind: "rss", id: "nodejs-blog", title: "Node.js Blog", url: "https://nodejs.org/en/feed/blog.xml", tag: "RSS · 工程" },
  { kind: "rss", id: "zed-blog", title: "Zed Blog", url: "https://zed.dev/blog.rss", tag: "RSS · 工程" },
  { kind: "rss", id: "warp-blog", title: "Warp Blog", url: "https://www.warp.dev/blog/feed.xml", tag: "RSS · 工程" },

  // ── 国内平台（docs/domestic-feed-availability.md · 实测 200）──
  { kind: "rss", id: "sspai", title: "少数派", url: "https://sspai.com/feed", tag: "RSS · 国内" },
  { kind: "rss", id: "36kr", title: "36氪", url: "https://36kr.com/feed", tag: "RSS · 国内" },
  { kind: "rss", id: "ithome", title: "IT之家", url: "https://www.ithome.com/rss/", tag: "RSS · 国内" },
  { kind: "rss", id: "oschina", title: "开源中国", url: "https://www.oschina.net/news/rss", tag: "RSS · 国内" },
  { kind: "rss", id: "infoq-cn", title: "InfoQ 中文", url: "https://www.infoq.cn/feed", tag: "RSS · 国内" },
  { kind: "rss", id: "ifanr", title: "爱范儿", url: "https://www.ifanr.com/feed", tag: "RSS · 国内" },
  { kind: "rss", id: "geekpark", title: "极客公园", url: "https://www.geekpark.net/rss", tag: "RSS · 国内" },
  { kind: "rss", id: "cnbeta", title: "cnBeta", url: "https://www.cnbeta.com.tw/backend.php", tag: "RSS · 国内" },
  { kind: "rss", id: "sina-tech", title: "新浪科技", url: "https://rss.sina.com.cn/tech/rollnews.xml", tag: "RSS · 国内" },

  // ── catalog 新增（docs/rsshub-catalog.md native-feed · 实测 200 + XML）──
  { kind: "rss", id: "ntrblog", title: "NT Research", url: "https://ntrblog.com/atom.xml", tag: "Atom · 科技", meta: { region: "cn" } },
  { kind: "rss", id: "eprice-tw", title: "ePrice 比价王", url: "https://www.eprice.com.tw/news/rss.xml", tag: "RSS · 数码", meta: { region: "tw", lang: "zh" } },
  { kind: "rss", id: "onet-pl", title: "Onet Wiadomości", url: "https://wiadomosci.onet.pl/.feed", tag: "RSS · 新闻", meta: { region: "pl", lang: "pl" } },
  { kind: "rss", id: "economist-china", title: "The Economist · China", url: "https://www.economist.com/china/rss.xml", tag: "RSS · 财经", meta: { region: "uk", lang: "en" } },
  { kind: "rss", id: "foreignaffairs", title: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml", tag: "RSS · 国际关系", meta: { lang: "en" } },
  { kind: "rss", id: "yna-economy", title: "연합뉴스 경제", url: "https://www.yna.co.kr/rss/economy.xml", tag: "RSS · 财经", meta: { region: "kr", lang: "ko" } },
  { kind: "rss", id: "github-diygod", title: "DIYgod GitHub 动态", url: "https://github.com/DIYgod.atom", tag: "Atom · 动态", meta: { note: "用户动态 feed,URL 绑定用户 DIYgod" } },
  { kind: "rss", id: "npr-1001", title: "NPR News", url: "https://feeds.npr.org/1001/rss.xml", tag: "RSS · 新闻", meta: { lang: "en" } },
  { kind: "rss", id: "cnbc-top", title: "CNBC Top News", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", tag: "RSS · 财经", meta: { lang: "en" } },
] as const satisfies readonly RssPreset[]
