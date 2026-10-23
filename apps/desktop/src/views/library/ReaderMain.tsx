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
import { MediaImage } from "@amoeba/ui"
import { fmtDate, heroWidth, itemKey, mediaUrl, ratioOf } from "../../lib/media.ts"
import { openExternalSafely } from "../../lib/host.ts"
import { looksLikeHtml, visibleLength } from "../../lib/html.ts"
import { usePrefs } from "../../store/prefs.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"

/** 正文最大宽度(阅读舒适度档位)。 */
const MEASURE_LABEL: Record<string, string> = { narrow: "窄", comfortable: "适中", wide: "宽" }

/** 会话级正文缓存:同一条目来回打开不重复抓原文页(内存,刷新即失效)。
 *  ponytail: 简单 LRU-ish(超限弃最旧);要跨会话持久再落 KV。 */
const bodyCache = new Map<string, string>()
const BODY_CACHE_MAX = 64

export function ReaderMain() {
  const selectedArticleKey = useDesktop((s) => s.selectedArticleKey)
  const allItems = useDesktop((s) => s.allItems)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const saveScrollRatio = useDesktop((s) => s.saveScrollRatio)
  const item = useMemo(
    () => allItems.find((i) => itemKey(i) === selectedArticleKey) ?? null,
    [allItems, selectedArticleKey],
  )
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
  /** 进度恢复完成前**屏蔽写回**:切条目时 DOM 里还残留上一条的 scrollTop,若此刻
   *  onScroll 写回,会把上一条的位置当成新条目的进度存下(静默篡改续读位置)。
   *  scroll effect 声明在 restore effect **之前**(先跑),故恢复前各回调均被屏蔽。 */
  const pendingRestoreRef = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    const bar = barRef.current
    if (!el || !bar) return
    // ⚠️ 本 effect 声明在 restore effect **之前**(先跑),setup 里会立即 onScroll()。
    // 切条目那一刻 DOM 还是上一条的 scrollTop,而 itemRef 已指向新条目 → 不先置 true
    // 就会把上一条的位置写进新条目。restore effect 完成后才放开。
    pendingRestoreRef.current = true
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight
      const ratio = max > 0 ? Math.min(1, el.scrollTop / max) : 0
      bar.style.width = `${ratio * 100}%`
      // 只对 article 记进度(store 侧另有 5% 节流);恢复完成前不写回。
      const cur = itemRef.current
      if (!pendingRestoreRef.current && cur && cur.kind === "article") saveRatioRef.current(cur, ratio)
    }
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [item?.id])

  /**
   * 按需补全正文:通用 RSS 只带摘要(feed 没给全文),点开时抓原文页提正文。
   * 补回的 full 不走 store.patch(避免每次渲染都更新),按 itemId 对位展示 + 会话缓存。
   * ⚠️ 所有 hook 在此块末尾、early return(下方 `if (!item)`)之前调用,顺序稳定。
   */
  const itemId = item?.id
  /** 会话缓存的键必须带订阅维度（同 id 跨订阅会串正文）。 */
  const itemCacheKey = item ? itemKey(item) : undefined
  const curContent = item?.kind === "article" ? item.content ?? "" : ""
  /** 可见文本长度(<400 触补全;用可见长度而非原始 HTML——图片密集摘要会虚高)。 */
  const curVisible = visibleLength(curContent)
  const [full, setFull] = useState<{ id: string; content: string } | null>(null)
  /** 渲染期读缓存:命中则直接用(无闪屏);未命中交给 effect 抓。 */
  const cached = itemCacheKey ? bodyCache.get(itemCacheKey) : undefined
  /** 补全进行中(界面提示用)。⚠️ 用显式态而非 `!full`:补全返回与摘要等长的内容时
   *  full 不会置位,若靠它判「正在补全」会**永久转圈**(无 ItemDetailSource 的源如
   *  bili:square 恰好原样返回 → 永远 full===null)。 */
  const [resolving, setResolving] = useState(false)
  useEffect(() => {
    if (!itemId || !itemCacheKey || item?.kind !== "article") return
    if (curVisible >= 400) return // feed 已带全文,不折腾
    if (bodyCache.has(itemCacheKey)) return // 会话缓存命中,不重复抓
    const dl = useDesktop.getState().dl
    if (!dl) return
    const subId = item.subscriptionId
    let live = true
    setResolving(true)
    void dl
      .resolveDetail(subId, itemId)
      .then((d) => {
        const text = d?.kind === "article" ? d.content ?? "" : ""
        if (live && text.length > curContent.length) {
          if (bodyCache.size >= BODY_CACHE_MAX) bodyCache.delete(bodyCache.keys().next().value as string)
          bodyCache.set(itemCacheKey, text)
          setFull({ id: itemCacheKey, content: text })
        }
      })
      .catch(() => {}) // 补全失败静默:原文页抓不到就照常显示摘要
      .finally(() => {
        if (live) setResolving(false)
      })
    return () => {
      live = false
      setResolving(false)
    }
  }, [itemId, itemCacheKey, curContent, curVisible])

  const article = item?.kind === "article" ? item : null
  /** 展示用正文:补全结果优先(同 itemId),其次会话缓存,最后 feed 自带。
   *  ⚠️ 补全结果**不走 store.patch**(只在本地 full/cache),故判定格式必须依据**当前
   *  展示的那段文本**,而不是 item.contentFormat —— 后者是 store 里的原始摘要格式,
   *  对补全的纯文本恒错(曾据此写 `contentFormat==="text"` 但当保护从未生效)。 */
  const shownContent = full && full.id === itemCacheKey ? full.content : cached ?? curContent
  /** 本条目是否已拿到补全正文(对位复合键,不是「任意条目补全过」)。 */
  const hasFull = (full?.id === itemCacheKey) || !!cached
  // ⚠️ 补全正文恒为**纯文本**(raw.ts 强制 contentFormat="text"),hasFull 时直接按纯文本
  // 渲染,不再猜格式——否则补全文本里的裸 `<`(数学/代码/`<https://…>`)会被 looksLikeHtml
  // 命中而走 innerHTML,把内容当标签吞掉且丢段落换行。仅未补全时才依据 store 的
  // contentFormat / 标签探测决定。
  const html = !hasFull && (article?.contentFormat === "html" || looksLikeHtml(shownContent))
  const cleanHtml = useMemo(
    () => (article && html ? DOMPurify.sanitize(shownContent) : ""),
    [article, html, shownContent],
  )

  // 切条目 / 补全正文到达后:按当前 scrollHeight 恢复阅读进度(有则跳,无则回顶)。
  // ⚠️ deps 含 hasFull:补全是异步的,到达后 scrollHeight 变长,须按最终高度**再定位一次**,
  // 否则落在按旧(摘要)高度算出的像素处(读了比保存进度更靠前的位置)。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    pendingRestoreRef.current = true // 恢复前先屏蔽写回
    const ratio = item?.scrollRatio ?? 0
    const raf = requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight
      el.scrollTo({ top: ratio > 0.02 && max > 0 ? ratio * max : 0 })
      pendingRestoreRef.current = false // 恢复完成,允许写回
    })
    return () => cancelAnimationFrame(raf)
  }, [item?.id, hasFull])

  if (!item) {
    return (
      <div className="scroll-area article-scroll" {...overlayBlock("reader-empty", "reader:empty")}>
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
      <header className="detail-head" {...overlayBlock("reader-head", "reader:head")}>
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

      <div className="scroll-area article-scroll" ref={scrollRef} {...overlayBlock("reader-scroll", "reader:scroll")}>
        <article className="article" {...overlayBlock("reader-article", "reader:article")}>
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
              <div className="article-body whitespace-pre-wrap">
                {shownContent || item.summary || "（该条目没有正文，请打开原文查看）"}
              </div>
            )
          ) : (
            <div className="article-body">{item.summary || "（该条目没有正文，请打开原文查看）"}</div>
          )}
          {/* feed 只带摘要时按需补全原文正文:补全前给「正在补全」提示,避免用户以为
              摘要就是全文而直接去开原文。 */}
          {article && resolving && !hasFull ? (
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
