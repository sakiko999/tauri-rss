/**
 * Mobile App —— 极简「看内容」闭环:未读列表 → 点开播放/阅读。
 *
 * 复用三件套:core(订阅/抓取/阅读态)· player `PlayableMedia`(懒解析+选流+弹幕)·
 * ui `MediaImage`(防盗链隧道)。不做订阅管理/发现/rail —— 那些归 desktop 工作台。
 */
import { useEffect, useState } from "react"
import { PlayableMedia } from "@tauri-playground/player"
import { MediaImage } from "@tauri-playground/ui"
import type { MediaItem } from "@tauri-playground/core"
import { useMobile, isPlayable } from "./store.ts"

export function App() {
  const dl = useMobile((s) => s.dl)
  const items = useMobile((s) => s.items)
  const subs = useMobile((s) => s.subs)
  const initError = useMobile((s) => s.initError)
  const open = useMobile((s) => s.open)
  const tab = useMobile((s) => s.tab)
  const init = useMobile((s) => s.init)
  const refresh = useMobile((s) => s.refresh)
  const setTab = useMobile((s) => s.setTab)

  useEffect(() => {
    void init()
  }, [init])

  if (initError) {
    return (
      <div className="page state">
        <h1>初始化失败</h1>
        <p className="err">{initError}</p>
        <p className="hint">宿主未注入,或存储不可用。</p>
      </div>
    )
  }
  if (open) return <Detail item={open} />
  if (!dl) return <div className="page state">正在加载…</div>

  const list = items.filter((i) => i.isUnread).length ? items.filter((i) => i.isUnread) : items
  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">订阅内容</span>
        <button className="btn" onClick={() => void refresh()}>
          刷新
        </button>
      </header>
      <nav className="tabs">
        <button className={tab === "feed" ? "tab on" : "tab"} onClick={() => setTab("feed")}>
          内容 {items.length ? `· ${items.filter((i) => i.isUnread).length || items.length}` : ""}
        </button>
        <button className={tab === "subs" ? "tab on" : "tab"} onClick={() => setTab("subs")}>
          订阅 · {subs.length}
        </button>
      </nav>
      {tab === "feed" ? (
        <ul className="feed">
          {list.map((it) => (
            <FeedRow key={it.id} item={it} />
          ))}
          {list.length === 0 ? (
            <li className="empty">
              还没有内容。
              <button className="link" onClick={() => setTab("subs")}>
                添加订阅源 →
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <SubsPane />
      )}
    </div>
  )
}

/** 订阅管理:添加 RSS 直链 + 列出/移除订阅(移动端不做频道发现,那属桌面工作台)。 */
function SubsPane() {
  const subs = useMobile((s) => s.subs)
  const addFeed = useMobile((s) => s.addFeed)
  const removeSub = useMobile((s) => s.removeSub)
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const submit = async () => {
    const u = url.trim()
    if (!u) return
    setBusy(true)
    setErr("")
    try {
      await addFeed(u)
      setUrl("")
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="subs">
      <div className="add-row">
        <input
          className="input"
          type="url"
          inputMode="url"
          placeholder="粘贴 RSS / Atom 直链"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void submit()}
        />
        <button className="btn btn-primary" disabled={busy || !url.trim()} onClick={() => void submit()}>
          {busy ? "添加中…" : "添加"}
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
      <ul className="feed">
        {subs.map((s) => (
          <li key={s.id} className="row">
            <span className="row-main">
              <span className="row-title">{s.title}</span>
              <span className="row-sub">{s.channelKey}</span>
            </span>
            <button className="btn btn-quiet" onClick={() => void removeSub(s.id)}>
              移除
            </button>
          </li>
        ))}
        {subs.length === 0 ? <li className="empty">还没有订阅。粘贴上面的 RSS 直链添加。</li> : null}
      </ul>
    </div>
  )
}

function FeedRow({ item }: { item: MediaItem }) {
  const openItem = useMobile((s) => s.openItem)
  return (
    <li className="row" onClick={() => openItem(item)}>
      {item.thumbnail ? <MediaImage src={item.thumbnail} className="row-thumb" ratio={1} /> : <span className="row-thumb ph" />}
      <span className="row-main">
        <span className="row-title">{item.title}</span>
        <span className="row-sub">
          {item.author?.name ? `${item.author.name} · ` : ""}
          {item.kind === "live" ? "直播" : item.kind === "video" ? "视频" : item.kind === "audio" ? "音频" : item.kind === "social" ? "动态" : "文章"}
        </span>
      </span>
      {isPlayable(item) ? <span className="row-play">▶</span> : null}
    </li>
  )
}

function Detail({ item }: { item: MediaItem }) {
  const closeItem = useMobile((s) => s.closeItem)
  const dl = useMobile((s) => s.dl)
  const [body, setBody] = useState(item.kind === "article" ? item.content ?? "" : "")
  const [resolving, setResolving] = useState(false)

  // 文章正文按需补全(feed 只带摘要时抓原文页;core 侧有 KV 持久缓存)。
  useEffect(() => {
    if (item.kind !== "article" || !dl) return
    if ((item.content ?? "").replace(/<[^>]*>/g, "").length >= 400) return
    let live = true
    setResolving(true)
    void dl
      .resolveDetail(item.subscriptionId, item.id)
      .then((d) => {
        if (live && d?.kind === "article" && (d.content ?? "").length > (item.content ?? "").length) setBody(d.content ?? "")
      })
      .catch(() => {})
      .finally(() => live && setResolving(false))
    return () => {
      live = false
    }
  }, [item, dl])

  const playable = isPlayable(item)
  return (
    <div className="page detail">
      <header className="topbar">
        <button className="btn" onClick={closeItem}>
          ← 返回
        </button>
      </header>
      {playable ? (
        <PlayableMedia
          className="stage"
          resolve={() => (item.kind === "live" ? dl!.resolveLivePlay(item.subscriptionId, item.id) : dl!.resolvePlay(item.subscriptionId, item.id))}
          startAtSec={item.kind === "live" ? undefined : item.positionSec}
          onProgress={(sec) => void dl?.reading.setPosition(item.id, sec)}
        />
      ) : null}
      <h1 className="detail-title">{item.title}</h1>
      {item.author?.name ? <p className="detail-by">{item.author.name}</p> : null}
      {item.kind === "article" ? (
        <div className="article-body">{body || item.summary || "（没有正文，点下方「打开原文」）"}</div>
      ) : null}
      {resolving ? <p className="hint">正在补全原文正文…</p> : null}
    </div>
  )
}
