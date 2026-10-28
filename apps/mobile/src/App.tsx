/**
 * Mobile App —— 极简「看内容」闭环:未读列表 → 点开播放/阅读。
 *
 * 复用三件套:core(订阅/抓取/阅读态)· player `PlayableMedia`(懒解析+选流+弹幕)·
 * ui `MediaImage`(防盗链隧道)。含基础订阅管理(RSS 直链增删);不做频道发现/rail/
 * 播放器控件 —— 那些归 desktop 工作台。
 */

import type { MediaItem } from "@amoeba/core"
import { PlayableMedia } from "@amoeba/player"
import { MediaImage } from "@amoeba/ui"
import { useEffect, useState } from "react"

import { displayBody } from "./html.ts"
import { isPlayable, useMobile } from "./store.ts"

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

  // 未读优先;全部已读时回退展示全部(而非空列表)—— 移动端「极简看内容」,
  // 全读完就空屏会让用户以为源坏了。刻意不做中间态提示(那是工作台的事)。
  const unread = items.filter((i) => i.isUnread)
  const list = unread.length ? unread : items
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
            <FeedRow key={`${it.subscriptionId}:${it.id}`} item={it} />
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
          onKeyDown={(e) =>
            e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229 && void submit()
          }
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
              {/* ⚠️ 副标题显示 feed 地址,不是 s.channelKey —— mobile 只加 rss:url,
                  显示 channelKey 会让每行副标题都是字面量 "rss:url"(零信息量)。 */}
              <span className="row-sub">{s.info?.url ?? s.channelKey}</span>
            </span>
            <button
              className="btn btn-quiet"
              onClick={() => {
                // 触屏误触率高 + 退订会连带清内容/正文/缓存(不可撤销)→ 二次确认。
                if (window.confirm(`退订「${s.title}」?本地内容缓存也会一并删除。`)) void removeSub(s.id)
              }}
            >
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
      {item.thumbnail ? (
        <MediaImage src={item.thumbnail} className="row-thumb" ratio={1} />
      ) : (
        <span className="row-thumb ph" />
      )}
      <span className="row-main">
        <span className="row-title">{item.title}</span>
        <span className="row-sub">
          {item.author?.name ? `${item.author.name} · ` : ""}
          {item.kind === "live"
            ? "直播"
            : item.kind === "video"
              ? "视频"
              : item.kind === "audio"
                ? "音频"
                : item.kind === "social"
                  ? "动态"
                  : item.kind === "category"
                    ? "分区"
                    : "文章"}
        </span>
      </span>
      {isPlayable(item) ? <span className="row-play">▶</span> : null}
    </li>
  )
}

function Detail({ item }: { item: MediaItem }) {
  const closeItem = useMobile((s) => s.closeItem)
  const dl = useMobile((s) => s.dl)
  const savePosition = useMobile((s) => s.savePosition)
  const [body, setBody] = useState(item.kind === "article" ? (item.content ?? "") : "")
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
        if (live && d?.kind === "article" && (d.content ?? "").length > (item.content ?? "").length)
          setBody(d.content ?? "")
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
      {playable && dl ? (
        <PlayableMedia
          className="stage"
          resolve={() =>
            item.kind === "live"
              ? dl.resolveLivePlay(item.subscriptionId, item.id)
              : dl.resolvePlay(item.subscriptionId, item.id)
          }
          startAtSec={item.kind === "live" ? undefined : item.positionSec}
          onProgress={(sec, dur) => savePosition(item, sec, dur)}
        />
      ) : null}
      <h1 className="detail-title">{item.title}</h1>
      {item.author?.name ? <p className="detail-by">{item.author.name}</p> : null}
      {item.kind === "category" ? (
        // 分区目录条目不是内容本身:移动端不做分区预览(桌面工作台职责),
        // 至少给出明确说明而不是落到空的文章视图。
        <div className="article-body">
          {item.summary ? `${item.summary}\n\n` : ""}
          分区目录条目。请在桌面端打开，预览并订阅该分区。
        </div>
      ) : item.kind === "article" ? (
        // ⚠️ 正文可能是 HTML(feed 带全文)—— 按纯文本渲染会露出 <p>/<a> 标签。
        // displayBody 判 HTML 则剥标签(mobile 无 sanitizer,富文本让位安全)。
        <div className="article-body">{displayBody(body) || item.summary || "（这条只带了标题，打开原文查看）"}</div>
      ) : null}
      {/* 打开原文:正文取不到时(SPA/反爬占位页)的兜底出口。⚠️ 走 appHost.openExternal
          (Tauri opener)——WebView 会拦 window.open(桌面同理),点了没反应。 */}
      {item.url ? (
        <button
          className="btn btn-secondary open-original"
          onClick={() => {
            try {
              void Promise.resolve(globalThis.appHost.openExternal(item.url!)).catch(() => {})
            } catch {
              /* 宿主未注入:忽略(移动端无 toast,失败静默) */
            }
          }}
        >
          打开原文 ↗
        </button>
      ) : null}
      {resolving ? <p className="hint">正在补全原文正文…</p> : null}
    </div>
  )
}
