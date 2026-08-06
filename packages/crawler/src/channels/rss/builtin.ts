/**
 * 内置 RSS 直链清单(复刻 producer 的 rss/builtin-feeds.ts)。
 *
 * 36 条:27 迁移自 App.tsx + 9 catalog 实测 200。crawler 用它们批量注册
 * RawRssChannel(key 形如 "rss:{id}")。
 */
import type { Kind } from "@tauri-playground/xml"

export interface BuiltinRssFeed {
  id: string
  title: string
  tag: string
  url: string
  /** 该 feed 产出的 item 默认 kind。 */
  kind: Kind
}

export const RSS_BUILTIN_FEEDS: readonly BuiltinRssFeed[] = [
  // ── 文章 / 纯文 ──────────────────────────────────────────────
  { id: "hn", title: "Hacker News", tag: "RSS · 纯文", url: "https://hnrss.org/frontpage" , kind: "article" },
  { id: "ruanyifeng", title: "阮一峰的网络日志", tag: "Atom · 纯文", url: "https://www.ruanyifeng.com/blog/atom.xml" , kind: "article" },
  { id: "v2ex", title: "V2EX", tag: "Atom · 纯文", url: "https://www.v2ex.com/index.xml" , kind: "article" },

  // ── 图文新闻 ──────────────────────────────────────────────────
  { id: "bbc-world", title: "BBC World", tag: "RSS · 图文", url: "https://feeds.bbci.co.uk/news/world/rss.xml" , kind: "article" },
  { id: "nyt-home", title: "NYT Home", tag: "RSS · 图文", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml" , kind: "article" },

  // ── 视频(YouTube 官方 feed 直链)──────────────────────────────
  { id: "yt-ted", title: "TED Talks (YouTube)", tag: "Atom · 视频", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC0RhatS1pyxInC00YKjjBqQ", kind: "video" },

  // ── 音频 / 播客 ──────────────────────────────────────────────
  { id: "huberman", title: "Huberman Lab", tag: "RSS · 播客", url: "https://feeds.megaphone.fm/hubermanlab", kind: "audio" },
  { id: "changelog", title: "The Changelog", tag: "RSS · 播客", url: "https://feeds.simplecast.com/54nAGcIl", kind: "audio" },
  { id: "npr-upfirst", title: "NPR Up First", tag: "RSS · 播客", url: "https://feeds.npr.org/500005/podcast.xml", kind: "audio" },

  // ── 文档 / 学术 ──────────────────────────────────────────────
  { id: "arxiv-cl", title: "arXiv · cs.CL", tag: "RSS · 文档", url: "https://export.arxiv.org/rss/cs.CL" , kind: "article" },

  // ── 软件发布 ──────────────────────────────────────────────────
  { id: "vue-releases", title: "Vue.js Releases", tag: "Atom · 发布", url: "https://github.com/vuejs/core/releases.atom" , kind: "article" },

  // ── 科技 / 工程博客 ──────────────────────────────────────────
  { id: "solidot", title: "奇客 Solidot", tag: "RSS · 科技", url: "https://www.solidot.org/index.rss" , kind: "article" },
  { id: "deepmind", title: "Google DeepMind Blog", tag: "RSS · 科技", url: "https://www.deepmind.com/blog/rss.xml" , kind: "article" },
  { id: "theverge", title: "The Verge", tag: "RSS · 科技", url: "https://www.theverge.com/rss/index.xml" , kind: "article" },
  { id: "vscoblog", title: "VS Code Blog", tag: "Atom · 工程", url: "https://code.visualstudio.com/feed.xml" , kind: "article" },
  { id: "nodejs-blog", title: "Node.js Blog", tag: "RSS · 工程", url: "https://nodejs.org/en/feed/blog.xml" , kind: "article" },
  { id: "zed-blog", title: "Zed Blog", tag: "RSS · 工程", url: "https://zed.dev/blog.rss" , kind: "article" },
  { id: "warp-blog", title: "Warp Blog", tag: "RSS · 工程", url: "https://www.warp.dev/blog/feed.xml" , kind: "article" },

  // ── 国内平台 ──────────────────────────────────────────────────
  { id: "sspai", title: "少数派", tag: "RSS · 国内", url: "https://sspai.com/feed" , kind: "article" },
  { id: "36kr", title: "36氪", tag: "RSS · 国内", url: "https://36kr.com/feed" , kind: "article" },
  { id: "ithome", title: "IT之家", tag: "RSS · 国内", url: "https://www.ithome.com/rss/" , kind: "article" },
  { id: "oschina", title: "开源中国", tag: "RSS · 国内", url: "https://www.oschina.net/news/rss" , kind: "article" },
  { id: "infoq-cn", title: "InfoQ 中文", tag: "RSS · 国内", url: "https://www.infoq.cn/feed" , kind: "article" },
  { id: "ifanr", title: "爱范儿", tag: "RSS · 国内", url: "https://www.ifanr.com/feed" , kind: "article" },
  { id: "geekpark", title: "极客公园", tag: "RSS · 国内", url: "https://www.geekpark.net/rss" , kind: "article" },
  { id: "cnbeta", title: "cnBeta", tag: "RSS · 国内", url: "https://www.cnbeta.com.tw/backend.php" , kind: "article" },
  { id: "sina-tech", title: "新浪科技", tag: "RSS · 国内", url: "https://rss.sina.com.cn/tech/rollnews.xml" , kind: "article" },

  // ── catalog 新增(实测 200 + XML)──────────────────────────────
  { id: "ntrblog", title: "NT Research", tag: "Atom · 科技", url: "https://ntrblog.com/atom.xml" , kind: "article" },
  { id: "eprice-tw", title: "ePrice 比价王", tag: "RSS · 数码", url: "https://www.eprice.com.tw/news/rss.xml" , kind: "article" },
  { id: "onet-pl", title: "Onet Wiadomości", tag: "RSS · 新闻", url: "https://wiadomosci.onet.pl/.feed" , kind: "article" },
  { id: "economist-china", title: "The Economist · China", tag: "RSS · 财经", url: "https://www.economist.com/china/rss.xml" , kind: "article" },
  { id: "foreignaffairs", title: "Foreign Affairs", tag: "RSS · 国际关系", url: "https://www.foreignaffairs.com/rss.xml" , kind: "article" },
  { id: "yna-economy", title: "연합뉴스 경제", tag: "RSS · 财经", url: "https://www.yna.co.kr/rss/economy.xml" , kind: "article" },
  { id: "github-diygod", title: "DIYgod GitHub 动态", tag: "Atom · 动态", url: "https://github.com/DIYgod.atom" , kind: "article" },
  { id: "npr-1001", title: "NPR News", tag: "RSS · 新闻", url: "https://feeds.npr.org/1001/rss.xml" , kind: "article" },
  { id: "cnbc-top", title: "CNBC Top News", tag: "RSS · 财经", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114" , kind: "article" },
]