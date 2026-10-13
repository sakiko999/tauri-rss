/**
 * ReaderMain —— 阅读视图的主区:工具栏 + 正文。
 *
 * ⚠️ 正文 HTML 一律经 DOMPurify 消毒(来自第三方 feed,是安全边界);纯文本走
 * 保留换行的 div。
 * 滚动进度条按主区绝对定位(styles.css 里 .main-region position:relative)。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import DOMPurify from "dompurify"
import { useDesktop } from "../../store/index.ts"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { MediaImage } from "@tauri-playground/ui"
import { fmtDate, heroWidth, mediaUrl, ratioOf } from "../../lib/media.ts"
import { openExternalSafely } from "../../lib/host.ts"
import { usePrefs } from "../../store/prefs.ts"

/** 正文最大宽度(阅读舒适度档位)。 */
const MEASURE_LABEL: Record<string, string> = { narrow: "窄", comfortable: "适中", wide: "宽" }

export function ReaderMain() {
  const selectedArticleId = useDesktop((s) => s.selectedArticleId)
  const allItems = useDesktop((s) => s.allItems)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const saveScrollRatio = useDesktop((s) => s.saveScrollRatio)
  const item = useMemo(() => allItems.find((i) => i.id === selectedArticleId) ?? null, [allItems, selectedArticleId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const fontSize = usePrefs((s) => s.fontSize)
  const measure = usePrefs((s) => s.measure)
  const setPrefs = usePrefs((s) => s.set)

  // 滚动进度条(直接改 DOM 宽度,不走 React 渲染)+ 阅读进度持久化。
  // saveScrollRatio 用 ref 持最新,effect 只随条目重挂(不因回调变化重建监听)。
  const saveRatioRef = useRef(saveScrollRatio)
  saveRatioRef.current = saveScrollRatio
  const itemRef = useRef(item)
  itemRef.current = item
  useEffect(() => {
    const el = scrollRef.current
    const bar = barRef.current
    if (!el || !bar) return
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight
      const ratio = max > 0 ? Math.min(1, el.scrollTop / max) : 0
      bar.style.width = `${ratio * 100}%`
      // 只对 article 记进度(store 侧另有 5% 节流)。
      const cur = itemRef.current
      if (cur && cur.kind === "article") saveRatioRef.current(cur, ratio)
    }
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [item?.id])

  // 切条目:恢复该条的阅读进度(有则跳,无则回顶)。等正文渲染出滚动高度再跳
  // (rAF 一帧足够;期间 progress-bar 的 onScroll 会用未跳的 0 覆盖?——不会,
  //  恢复跳转触发的 scroll 事件写回的是同一比例,节流后无副作用)。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ratio = item?.scrollRatio ?? 0
    const restore = () => {
      const max = el.scrollHeight - el.clientHeight
      el.scrollTo({ top: ratio > 0.02 && max > 0 ? ratio * max : 0 })
    }
    const raf = requestAnimationFrame(restore)
    return () => cancelAnimationFrame(raf)
  }, [item?.id])

  /**
   * 按需补全正文:通用 RSS 只带摘要(feed 没给全文),点开时抓原文页提正文。
   * 一次性副作用——补回的 full 不走 store.patch(避免每次渲染都更新),按 itemId 对位
   * 展示即可;key 变了自然丢弃。⚠️ 声明在所有 hook 之后、early return 之前。
   */
  const [full, setFull] = useState<{ id: string; content: string } | null>(null)
  const itemId = item?.id
  const curContent = item?.kind === "article" ? item.content ?? "" : ""
  useEffect(() => {
    if (!itemId || item?.kind !== "article") return
    if (curContent.length >= 400) return // feed 已带全文,不折腾
    const dl = useDesktop.getState().dl
    if (!dl) return
    const subId = item.subscriptionId
    let live = true
    void dl
      .resolveDetail(subId, itemId)
      .then((d) => {
        const text = d?.kind === "article" ? d.content ?? "" : ""
        if (live && text.length > curContent.length) setFull({ id: itemId, content: text })
      })
      .catch(() => {}) // 补全失败静默:原文页抓不到就照常显示摘要
    return () => {
      live = false
    }
  }, [itemId, curContent])

  const article = item?.kind === "article" ? item : null
  /** 展示用正文:补全结果优先(同一 itemId 时)。 */
  const shownContent = full && full.id === itemId ? full.content : curContent
  const html = article?.contentFormat === "html" || shownContent.includes("<")
  const cleanHtml = useMemo(
    () => (article && html ? DOMPurify.sanitize(shownContent) : ""),
    [article, html, shownContent],
  )

  if (!item) {
    return (
      <div className="scroll-area article-scroll">
        <StateBlock icon="columns" title="选择一篇文章开始阅读" text="在左侧列表里点任意条目。" />
      </div>
    )
  }

  const hero = mediaUrl(item)
  /** ⚠️ 桌面打开外链必须走宿主门面(WebView 拦 window.open);失败要有反馈。 */
  const openExternal = () => openExternalSafely(item.url)
  /**
   * 正文链接委托:命中 <a> 就拦下来交宿主打开,不让 WebView 自己导航。
   * 锚点(#开头)留在原地滚动,不交给系统浏览器。
   */
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a")
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute("href")
    if (!href || href.startsWith("#")) return
    openExternalSafely(href)
  }
  /** 复制链接:clipboard 可能不存在或被拒,失败不能报成功。 */
  const copyLink = async () => {
    if (!item.url) {
      useDesktop.getState().toast("warn", "这条内容没有链接")
      return
    }
    try {
      await navigator.clipboard.writeText(item.url)
      useDesktop.getState().toast("ok", "链接已复制")
    } catch (e) {
      useDesktop.getState().toast("error", "复制失败", e instanceof Error ? e.message : String(e))
    }
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
        <button className="icon-btn sm" aria-label="复制链接" title="复制链接" onClick={() => void copyLink()}>
          <Icon name="bookmark" size={15} />
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

          {/* ⚠️ hero 门槛:低清缩略图(如 320px 宽)拉满整栏会模糊占半屏,正文要滚动
              才看得到。只在原图够大(≥640px 宽)时当满栏头图,否则不渲染 —— 列表行
              已有缩略图,信息不丢。 */}
          {hero && heroWidth(item) >= 640 ? (
            <figure className="article-hero" style={{ aspectRatio: ratioOf(item) }}>
              <MediaImage src={hero} ratio={ratioOf(item)} fill />
            </figure>
          ) : null}

          {article ? (
            html ? (
              // ⚠️ 正文里的 <a> 必须拦截:不拦的话 WebView 会**整页导航走**(应用没配
              // Tauri on_navigation),界面被外部网页顶掉,只能重启应用才回来。
              <div className="article-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: cleanHtml }} />
            ) : (
              <div className="article-body" style={{ whiteSpace: "pre-wrap" }}>
                {shownContent || item.summary || "（该条目没有正文，请打开原文查看）"}
              </div>
            )
          ) : (
            <div className="article-body">{item.summary || "（该条目没有正文，请打开原文查看）"}</div>
          )}
          {/* feed 只带摘要时按需补全原文正文:补全前给「正在补全」提示,避免用户以为
              摘要就是全文而直接去开原文。 */}
          {article && !full && curContent.length < 400 && article.url ? (
            <p className="article-resolving t-micro t-dim">
              <Icon name="loader" size={13} className="animate-spin" /> 正在补全原文正文…
            </p>
          ) : null}

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
