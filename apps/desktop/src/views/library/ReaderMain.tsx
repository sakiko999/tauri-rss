/**
 * ReaderMain —— 阅读视图的主区:工具栏 + 正文。
 *
 * ⚠️ 正文 HTML 一律经 DOMPurify 消毒(来自第三方 feed,是安全边界);纯文本走
 * 保留换行的 div。
 * 滚动进度条按主区绝对定位(styles.css 里 .main-region position:relative)。
 */
import { useEffect, useMemo, useRef } from "react"
import DOMPurify from "dompurify"
import { useDesktop } from "../../store/index.ts"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { MediaImage } from "@tauri-playground/ui"
import { fmtDate, mediaUrl, ratioOf } from "../../lib/media.ts"
import { usePrefs } from "../../store/prefs.ts"

/** 正文最大宽度(阅读舒适度档位)。 */
const MEASURE_LABEL: Record<string, string> = { narrow: "窄", comfortable: "适中", wide: "宽" }

export function ReaderMain() {
  const selectedArticleId = useDesktop((s) => s.selectedArticleId)
  const allItems = useDesktop((s) => s.allItems)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const item = useMemo(() => allItems.find((i) => i.id === selectedArticleId) ?? null, [allItems, selectedArticleId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const fontSize = usePrefs((s) => s.fontSize)
  const measure = usePrefs((s) => s.measure)
  const setPrefs = usePrefs((s) => s.set)

  // 滚动进度条(直接改 DOM 宽度,不走 React 渲染)。
  useEffect(() => {
    const el = scrollRef.current
    const bar = barRef.current
    if (!el || !bar) return
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight
      bar.style.width = max > 0 ? `${Math.min(100, (el.scrollTop / max) * 100)}%` : "0%"
    }
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [item?.id])

  // 切条目时回到顶部。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [item?.id])

  const article = item?.kind === "article" ? item : null
  const html = article?.contentFormat === "html" || (article?.content ?? "").includes("<")
  const cleanHtml = useMemo(
    () => (article && html ? DOMPurify.sanitize(article.content ?? "") : ""),
    [article, html],
  )

  if (!item) {
    return (
      <div className="scroll-area article-scroll">
        <StateBlock icon="columns" title="选择一篇文章开始阅读" text="在左侧列表里点任意条目。" />
      </div>
    )
  }

  const hero = mediaUrl(item)
  /** ⚠️ 桌面打开外链必须走宿主门面(WebView 拦 window.open)。 */
  const openExternal = () => {
    if (item.url) void globalThis.appHost.openExternal(item.url)
  }

  return (
    <>
      <div className="progress-bar" aria-hidden>
        <span ref={barRef} />
      </div>
      <header className="detail-head">
        <button
          className="icon-btn sm narrow-only"
          aria-label="返回列表"
          onClick={() => useDesktop.getState().selectArticle(null)}
        >
          <Icon name="back" size={15} />
        </button>
        <span className="spacer" />
        <button
          className="icon-btn sm"
          aria-label={item.isStarred ? "取消星标" : "星标"}
          aria-pressed={!!item.isStarred}
          onClick={() => toggleStar(item)}
        >
          <Icon name="star" size={15} />
        </button>
        <button
          className="icon-btn sm"
          aria-label="复制链接"
          onClick={() => {
            if (item.url) void navigator.clipboard?.writeText(item.url)
            useDesktop.getState().toast("ok", "链接已复制")
          }}
        >
          <Icon name="external" size={15} />
        </button>
        <button
          className="icon-btn sm"
          aria-label="减小字号"
          disabled={fontSize <= 13}
          onClick={() => setPrefs({ fontSize: fontSize - 1 })}
        >
          <span style={{ fontSize: 11, fontWeight: 650 }}>A−</span>
        </button>
        <button
          className="icon-btn sm"
          aria-label="增大字号"
          disabled={fontSize >= 24}
          onClick={() => setPrefs({ fontSize: fontSize + 1 })}
        >
          <span style={{ fontSize: 13, fontWeight: 650 }}>A+</span>
        </button>
        <button
          className="icon-btn sm"
          aria-label={`阅读宽度:${MEASURE_LABEL[measure] ?? measure}`}
          title={`阅读宽度：${MEASURE_LABEL[measure] ?? measure}`}
          onClick={() =>
            setPrefs({
              measure: measure === "narrow" ? "comfortable" : measure === "comfortable" ? "wide" : "narrow",
            })
          }
        >
          <Icon name="type" size={15} />
        </button>
        {item.url ? (
          <button className="icon-btn sm" aria-label="打开原文" title="打开原文" onClick={openExternal}>
            <Icon name="external" size={15} />
          </button>
        ) : null}
      </header>

      <div className="scroll-area article-scroll" ref={scrollRef}>
        <article className="article">
          <div className="article-kicker">
            {item.author?.name ? <span>{item.author.name}</span> : null}
            {item.author?.name ? <span className="dot-sep" /> : null}
            <span>{fmtDate(item.publishedAt)}</span>
          </div>

          <h1 className="article-title">{item.title}</h1>

          {item.author?.name ? (
            <div className="article-byline">
              <span className="article-avatar">{(item.author.name[0] ?? "?").toUpperCase()}</span>
              <span className="article-byline-text">
                <span className="article-author">{item.author.name}</span>
                <span className="t-micro t-dim">{item.author.handle ?? "订阅来源"}</span>
              </span>
            </div>
          ) : null}

          {hero ? (
            <figure className="article-hero" style={{ aspectRatio: ratioOf(item) }}>
              <MediaImage src={hero} ratio={ratioOf(item)} fill />
            </figure>
          ) : null}

          {article ? (
            html ? (
              <div className="article-body" dangerouslySetInnerHTML={{ __html: cleanHtml }} />
            ) : (
              <div className="article-body" style={{ whiteSpace: "pre-wrap" }}>
                {article.content || item.summary || "（该条目没有正文，请打开原文查看）"}
              </div>
            )
          ) : (
            <div className="article-body">{item.summary || "（该条目没有正文，请打开原文查看）"}</div>
          )}

          <div className="article-foot">
            <button className="btn btn-secondary" onClick={() => toggleStar(item)}>
              <Icon name="star" size={14} /> {item.isStarred ? "取消星标" : "星标"}
            </button>
            {item.url ? (
              <button className="btn btn-quiet" onClick={openExternal}>
                <Icon name="external" size={14} /> 打开原文
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </>
  )
}
