/**
 * RssSource's built-in subscriptions — curated public RSS/Atom feeds.
 *
 * Migrated from the old presets layer: every source now ships its own built-in
 * subscriptions, so consumers enumerate `source.builtinSubscriptions` instead of
 * a separate presets catalog.
 *
 * 27 migrated verbatim from `apps/desktop/src/App.tsx` TEST_SUBSCRIPTIONS,
 * plus 9 measured OK (curl 200 + XML) from `docs/rsshub-catalog.md`.
 * (`meta` region/lang hints from the old presets are dropped — `tag` carries the
 * display label.)
 */
import type { BuiltinSubscription } from "../source-adapter.ts"

export const RSS_BUILTIN_FEEDS: readonly BuiltinSubscription[] = [
  // ── 文章 / 纯文 ──────────────────────────────────────────────
  { id: "hn", title: "Hacker News", tag: "RSS · 纯文", config: { url: "https://hnrss.org/frontpage" } },
  { id: "ruanyifeng", title: "阮一峰的网络日志", tag: "Atom · 纯文", config: { url: "https://www.ruanyifeng.com/blog/atom.xml" } },
  { id: "v2ex", title: "V2EX", tag: "Atom · 纯文", config: { url: "https://www.v2ex.com/index.xml" } },

  // ── 图文新闻（带 thumbnail）──────────────────────────────────
  { id: "bbc-world", title: "BBC World", tag: "RSS · 图文", config: { url: "https://feeds.bbci.co.uk/news/world/rss.xml" } },
  { id: "nyt-home", title: "NYT Home", tag: "RSS · 图文", config: { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" } },

  // ── 视频（YouTube 官方 feed 直接 URL）────────────────────────
  { id: "yt-ted", title: "TED Talks (YouTube)", tag: "Atom · 视频", config: { url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC0RhatS1pyxInC00YKjjBqQ" } },

  // ── 音频 / 播客（enclosure + itunes）────────────────────────
  { id: "huberman", title: "Huberman Lab", tag: "RSS · 播客", config: { url: "https://feeds.megaphone.fm/hubermanlab" } },
  { id: "changelog", title: "The Changelog", tag: "RSS · 播客", config: { url: "https://feeds.simplecast.com/54nAGcIl" } },
  { id: "npr-upfirst", title: "NPR Up First", tag: "RSS · 播客", config: { url: "https://feeds.npr.org/500005/podcast.xml" } },

  // ── 文档 / 学术（PDF enclosure）──────────────────────────────
  { id: "arxiv-cl", title: "arXiv · cs.CL", tag: "RSS · 文档", config: { url: "https://export.arxiv.org/rss/cs.CL" } },

  // ── 软件发布（tarball enclosure）─────────────────────────────
  { id: "vue-releases", title: "Vue.js Releases", tag: "Atom · 发布", config: { url: "https://github.com/vuejs/core/releases.atom" } },

  // ── 科技 / 工程博客 ──────────────────────────────────────────
  { id: "solidot", title: "奇客 Solidot", tag: "RSS · 科技", config: { url: "https://www.solidot.org/index.rss" } },
  { id: "deepmind", title: "Google DeepMind Blog", tag: "RSS · 科技", config: { url: "https://www.deepmind.com/blog/rss.xml" } },
  { id: "theverge", title: "The Verge", tag: "RSS · 科技", config: { url: "https://www.theverge.com/rss/index.xml" } },
  { id: "vscoblog", title: "VS Code Blog", tag: "Atom · 工程", config: { url: "https://code.visualstudio.com/feed.xml" } },
  { id: "nodejs-blog", title: "Node.js Blog", tag: "RSS · 工程", config: { url: "https://nodejs.org/en/feed/blog.xml" } },
  { id: "zed-blog", title: "Zed Blog", tag: "RSS · 工程", config: { url: "https://zed.dev/blog.rss" } },
  { id: "warp-blog", title: "Warp Blog", tag: "RSS · 工程", config: { url: "https://www.warp.dev/blog/feed.xml" } },

  // ── 国内平台（docs/domestic-feed-availability.md · 实测 200）──
  { id: "sspai", title: "少数派", tag: "RSS · 国内", config: { url: "https://sspai.com/feed" } },
  { id: "36kr", title: "36氪", tag: "RSS · 国内", config: { url: "https://36kr.com/feed" } },
  { id: "ithome", title: "IT之家", tag: "RSS · 国内", config: { url: "https://www.ithome.com/rss/" } },
  { id: "oschina", title: "开源中国", tag: "RSS · 国内", config: { url: "https://www.oschina.net/news/rss" } },
  { id: "infoq-cn", title: "InfoQ 中文", tag: "RSS · 国内", config: { url: "https://www.infoq.cn/feed" } },
  { id: "ifanr", title: "爱范儿", tag: "RSS · 国内", config: { url: "https://www.ifanr.com/feed" } },
  { id: "geekpark", title: "极客公园", tag: "RSS · 国内", config: { url: "https://www.geekpark.net/rss" } },
  { id: "cnbeta", title: "cnBeta", tag: "RSS · 国内", config: { url: "https://www.cnbeta.com.tw/backend.php" } },
  { id: "sina-tech", title: "新浪科技", tag: "RSS · 国内", config: { url: "https://rss.sina.com.cn/tech/rollnews.xml" } },

  // ── catalog 新增（docs/rsshub-catalog.md native-feed · 实测 200 + XML）──
  { id: "ntrblog", title: "NT Research", tag: "Atom · 科技", config: { url: "https://ntrblog.com/atom.xml" } },
  { id: "eprice-tw", title: "ePrice 比价王", tag: "RSS · 数码", config: { url: "https://www.eprice.com.tw/news/rss.xml" } },
  { id: "onet-pl", title: "Onet Wiadomości", tag: "RSS · 新闻", config: { url: "https://wiadomosci.onet.pl/.feed" } },
  { id: "economist-china", title: "The Economist · China", tag: "RSS · 财经", config: { url: "https://www.economist.com/china/rss.xml" } },
  { id: "foreignaffairs", title: "Foreign Affairs", tag: "RSS · 国际关系", config: { url: "https://www.foreignaffairs.com/rss.xml" } },
  { id: "yna-economy", title: "연합뉴스 경제", tag: "RSS · 财经", config: { url: "https://www.yna.co.kr/rss/economy.xml" } },
  { id: "github-diygod", title: "DIYgod GitHub 动态", tag: "Atom · 动态", config: { url: "https://github.com/DIYgod.atom" } },
  { id: "npr-1001", title: "NPR News", tag: "RSS · 新闻", config: { url: "https://feeds.npr.org/1001/rss.xml" } },
  { id: "cnbc-top", title: "CNBC Top News", tag: "RSS · 财经", config: { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" } },
]
