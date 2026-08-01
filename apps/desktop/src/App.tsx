import { useEffect, useState } from "react"
import {
  createDataLayer,
  type DataLayer,
  type MediaItem,
  type RefreshResult,
} from "@tauri-playground/core"
import { createTauriHost } from "./host/tauri-host"

/** 一组测试订阅 —— 覆盖不同格式（Atom/RSS 2.0）与不同来源。 */
const TEST_SUBSCRIPTIONS = [
  { id: "ruanyifeng", title: "阮一峰的网络日志", url: "https://www.ruanyifeng.com/blog/atom.xml" },
  { id: "hn", title: "Hacker News", url: "https://hnrss.org/frontpage" },
  { id: "coolshell", title: "酷壳 CoolShell", url: "https://coolshell.cn/feed" },
] as const

interface FeedState {
  sub: (typeof TEST_SUBSCRIPTIONS)[number]
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
          await dl.subscriptions.add({
            id: s.id,
            kind: "rss",
            title: s.title,
            enabled: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            url: s.url,
          })
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
