import { useEffect, useState } from "react"
import {
  createDataLayer,
  getSource,
  type DataLayer,
  type MediaItem,
  type RefreshResult,
  type Subscription,
  type SubscriptionKind,
} from "@tauri-playground/core"
import { createTauriHost } from "./host/tauri-host"

/**
 * 一组测试订阅 —— 覆盖不同格式（Atom/RSS 2.0）与不同来源、不同媒体类型。
 *
 * 全部为**自带原生 RSS/Atom feed**的稳定源（curl 实测 200 + 正确 XML），
 * 直接走现有 RssSource 管线，无需任何抓取逻辑。
 *
 * 选源原则（参考 tmp/RSSHub 的 routes 目录，但只取「无 puppeteer / 无反爬 /
 * 无 requireConfig」的等价物——即站点自己暴露的 feed）：
 *   - 格式覆盖：RSS 2.0（BBC/NYT/arxiv/播客）+ Atom（GitHub/阮一峰/V2EX/YouTube）
 *   - 媒体覆盖：纯文（HN）、图（BBC/NYT）、视频（YouTube）、音频（播客）、文档（arxiv PDF）
 *  分类标签见 media，供后续 UI/分组/分类器联调用。
 */
type TestSub = {
  id: string
  title: string
  url?: string
  /** 人类可读的媒体/格式标注，仅用于测试展示，不进数据层。 */
  tag: string
  /** 订阅 kind，默认 "rss"；非 rss（如 bilibili-rank / bilibili / 插件 kind）走对应 adapter。 */
  kind?: SubscriptionKind
  /** bilibili 路由（kind="bilibili" 时用）。 */
  route?: "popular" | "ranking" | "weekly" | "user-video"
  /** ranking 分区（all/douga/…），user-video 的 uid。 */
  rid?: string
  uid?: string
  /** 插件 kind 的配置字段透传（kind 非内置时原样传给订阅）。 */
  [key: string]: unknown
}

/**
 * 由测试订阅描述构造 Subscription。
 * 1. 若注册表里有该 kind 的 adapter 且实现了 createSubscription，则用它拼接
 *    （这是「外部选渠道 → 填参数 → 拼出订阅」的正规路径，插件无需改这里）；
 * 2. 否则内置 kind 走精确分支；
 * 3. 未知(插件)kind 走开放兜底——kind 字符串 + 剩余配置字段透传。
 */
function buildSubscription(base: { id: string; title: string }, s: TestSub): Subscription {
  const fullBase = { ...base, enabled: true, createdAt: Date.now(), updatedAt: Date.now() }
  if (s.kind) {
    const adapter = getSource(s.kind)
    if (adapter?.createSubscription) {
      const { id, title, url, tag, kind, route, rid, uid, ...config } = s
      return adapter.createSubscription(fullBase, config)
    }
  }
  switch (s.kind) {
    case "bilibili-rank":
      return { ...fullBase, kind: "bilibili-rank" }
    case "bilibili":
      return {
        ...fullBase,
        kind: "bilibili",
        route: s.route ?? "popular",
        ...(s.rid ? { rid: s.rid } : {}),
        ...(s.uid ? { uid: s.uid } : {}),
      }
    case undefined:
    case "rss":
      return { ...fullBase, kind: "rss", url: s.url! }
    default:
      // 插件 kind 兜底：kind 字符串 + 配置字段透传（去掉已消费的展示字段）。
      const { id, title, url, tag, kind, route, rid, uid, ...rest } = s
      return { ...fullBase, kind: s.kind, ...rest }
  }
}

const TEST_SUBSCRIPTIONS = [
  // ── 文章 / 纯文 ──────────────────────────────────────────────
  { id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage", tag: "RSS · 纯文" },
  { id: "ruanyifeng", title: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/atom.xml", tag: "Atom · 纯文" },
  { id: "v2ex", title: "V2EX", url: "https://www.v2ex.com/index.xml", tag: "Atom · 纯文" },

  // ── 图文新闻（带 thumbnail）──────────────────────────────────
  { id: "bbc-world", title: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", tag: "RSS · 图文" },
  { id: "nyt-home", title: "NYT Home", url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", tag: "RSS · 图文" },

  // ── 视频 ──────────────────────────────────────────────────────
  { id: "yt-ted", title: "TED Talks (YouTube)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC0RhatS1pyxInC00YKjjBqQ", tag: "Atom · 视频" },

  // ── 音频 / 播客（enclosure + itunes）────────────────────────
  { id: "huberman", title: "Huberman Lab", url: "https://feeds.megaphone.fm/hubermanlab", tag: "RSS · 播客" },
  { id: "changelog", title: "The Changelog", url: "https://feeds.simplecast.com/54nAGcIl", tag: "RSS · 播客" },
  { id: "npr-upfirst", title: "NPR Up First", url: "https://feeds.npr.org/500005/podcast.xml", tag: "RSS · 播客" },

  // ── 文档 / 学术（PDF enclosure）──────────────────────────────
  { id: "arxiv-cl", title: "arXiv · cs.CL", url: "https://export.arxiv.org/rss/cs.CL", tag: "RSS · 文档" },

  // ── 软件发布（tarball enclosure）─────────────────────────────
  { id: "vue-releases", title: "Vue.js Releases", url: "https://github.com/vuejs/core/releases.atom", tag: "Atom · 发布" },

  // ── 科技 / 工程博客（经 B 脚本从 RSSHub 摘录 + curl 实测 200）──
  { id: "solidot", title: "奇客 Solidot", url: "https://www.solidot.org/index.rss", tag: "RSS · 科技" },
  { id: "deepmind", title: "Google DeepMind Blog", url: "https://www.deepmind.com/blog/rss.xml", tag: "RSS · 科技" },
  { id: "theverge", title: "The Verge", url: "https://www.theverge.com/rss/index.xml", tag: "RSS · 科技" },
  { id: "vscoblog", title: "VS Code Blog", url: "https://code.visualstudio.com/feed.xml", tag: "Atom · 工程" },
  { id: "nodejs-blog", title: "Node.js Blog", url: "https://nodejs.org/en/feed/blog.xml", tag: "RSS · 工程" },
  { id: "zed-blog", title: "Zed Blog", url: "https://zed.dev/blog.rss", tag: "RSS · 工程" },
  { id: "warp-blog", title: "Warp Blog", url: "https://www.warp.dev/blog/feed.xml", tag: "RSS · 工程" },

  // ── 国内平台（docs/domestic-feed-availability.md · curl 实测 200 原生 feed）──
  { id: "sspai", title: "少数派", url: "https://sspai.com/feed", tag: "RSS · 国内" },
  { id: "36kr", title: "36氪", url: "https://36kr.com/feed", tag: "RSS · 国内" },
  { id: "ithome", title: "IT之家", url: "https://www.ithome.com/rss/", tag: "RSS · 国内" },
  { id: "oschina", title: "开源中国", url: "https://www.oschina.net/news/rss", tag: "RSS · 国内" },
  { id: "infoq-cn", title: "InfoQ 中文", url: "https://www.infoq.cn/feed", tag: "RSS · 国内" },
  { id: "ifanr", title: "爱范儿", url: "https://www.ifanr.com/feed", tag: "RSS · 国内" },
  { id: "geekpark", title: "极客公园", url: "https://www.geekpark.net/rss", tag: "RSS · 国内" },
  { id: "cnbeta", title: "cnBeta", url: "https://www.cnbeta.com.tw/backend.php", tag: "RSS · 国内" },
  { id: "sina-tech", title: "新浪科技", url: "https://rss.sina.com.cn/tech/rollnews.xml", tag: "RSS · 国内" },

  // ── 热门平台（bilibili 走 API，零登录；YouTube 走官方 RSS）──
  { id: "bili-hot", title: "bilibili 热搜", url: "https://www.bilibili.com/", tag: "API · 热搜", kind: "bilibili-rank" },
  { id: "bili-popular", title: "bilibili 综合热门", url: "https://www.bilibili.com/", tag: "API · 视频", kind: "bilibili", route: "popular" },
  { id: "bili-ranking", title: "bilibili 排行榜·全站", url: "https://www.bilibili.com/", tag: "API · 视频", kind: "bilibili", route: "ranking", rid: "all" },
  { id: "bili-weekly", title: "B站每周必看", url: "https://www.bilibili.com/", tag: "API · 视频", kind: "bilibili", route: "weekly" },
  { id: "bili-3b1b", title: "3Blue1Brown (B 站)", url: "https://www.bilibili.com/", tag: "API · UP主", kind: "bilibili", route: "user-video", uid: "511068914" },
  { id: "yt-3b1b", title: "3Blue1Brown (YouTube)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw", tag: "API · 频道", kind: "youtube", channelId: "UCYO_jab_esuFRV4b17AJtAw" },
  { id: "yt-lex", title: "Lex Fridman (YouTube)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCSHZKyawb77ixDdsGog4iWA", tag: "API · 频道", kind: "youtube", channelId: "UCSHZKyawb77ixDdsGog4iWA" },
  { id: "yt-kenjee", title: "Ken Jee (YouTube)", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCiT9RITQ9PW6BhXK0y2jaeg", tag: "API · 频道", kind: "youtube", channelId: "UCiT9RITQ9PW6BhXK0y2jaeg" },
] as TestSub[]

interface FeedState {
  sub: TestSub
  result?: RefreshResult
  items: MediaItem[]
}

export default function App() {
  const [dl, setDl] = useState<DataLayer | null>(null)
  const [feeds, setFeeds] = useState<FeedState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDl(createDataLayer(createTauriHost()))
  }, [])

  async function fetchFeeds() {
    if (!dl) return
    setBusy(true)
    setError(null)
    try {
      // 先订阅（幂等：已存在则跳过），再逐个刷新。
      for (const s of TEST_SUBSCRIPTIONS) {
        const existing = await dl.subscriptions.get(s.id)
        if (!existing) {
          await dl.subscriptions.add(buildSubscription({ id: s.id, title: s.title }, s))
        }
      }
      const next: FeedState[] = []
      for (const s of TEST_SUBSCRIPTIONS) {
        const result = await dl.refresh(s.id)
        const items = dl.store.query({ subscriptionId: s.id })
        next.push({ sub: s, result, items })
      }
      setFeeds(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <main className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">RSS Reader · 数据层抓取</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Rust <code>http_get</code> 透传（绕 CORS）→ <code>PlatformHost</code> →{" "}
            <code>createDataLayer</code> → <code>store.query()</code>
          </p>
        </header>

        <button
          onClick={fetchFeeds}
          disabled={!dl || busy}
          className="mb-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "抓取中…" : "抓取测试订阅"}
        </button>

        {error && (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            错误：{error}
          </div>
        )}

        {feeds.map(({ sub, result, items }) => (
          <section key={sub.id} className="mb-8">
            <h2 className="mb-1 text-lg font-semibold">
              {sub.title}
              <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {sub.tag}
              </span>
              <span className="ml-2 text-xs font-normal text-zinc-400">{sub.url}</span>
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              {result?.error
                ? `刷新失败：${result.error}`
                : result
                  ? `刷新成功：${result.itemCount} 条 (fetchedAt=${new Date(result.fetchedAt).toLocaleTimeString()})`
                  : "未刷新"}
            </p>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {items.slice(0, 8).map((it) => (
                <li key={it.id} className="py-2">
                  <div className="flex items-start gap-2">
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {it.title}
                    </a>
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      {it.kind}
                    </span>
                  </div>
                  {it.thumbnail && (
                    <img
                      src={it.thumbnail}
                      alt=""
                      className="mt-2 max-h-24 rounded object-cover"
                      loading="lazy"
                    />
                  )}
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {it.summary ?? "(无摘要)"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    {it.publishedAt ? new Date(it.publishedAt).toLocaleDateString() : ""}
                    {it.kind === "article" && "media" in it && it.media?.length
                      ? ` · ${it.media.length} 个媒体附件`
                      : ""}
                  </p>
                </li>
              ))}
              {items.length === 0 && !result?.error && (
                <li className="py-2 text-sm text-zinc-400">（无内容）</li>
              )}
            </ul>
          </section>
        ))}
      </main>
    </div>
  )
}
