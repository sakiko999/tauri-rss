/**
 * ReaderMain —— 阅读视图的主区:工具栏 + 正文。
 *
 * ⚠️ 正文 HTML 一律经 DOMPurify 消毒(来自第三方 feed,是安全边界);纯文本走
 * 保留换行的 div。消毒**只在这里做一次**:专注阅读浮层拿到的是同一棵已经消毒的
 * 节点(见 FocusReader 的 children),不复制第二份 DOMPurify 配置。
 * 滚动进度条按主区绝对定位(styles.css 里 .main-region position:relative)。
 */

import { MediaImage } from "@amoeba/ui"
import DOMPurify from "dompurify"
import { useEffect, useMemo, useRef, useState } from "react"

import { FocusReader } from "../../components/app/FocusReader.tsx"
import { Button, IconButton } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { openExternalSafely } from "../../lib/host.ts"
import { looksLikeHtml, visibleLength } from "../../lib/html.ts"
import { fmtDate, heroWidth, itemKey, mediaUrl, ratioOf } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useDesktop } from "../../store/index.ts"
import { usePrefs } from "../../store/prefs.ts"

/** 正文最大宽度(阅读舒适度档位)。 */
const MEASURE_LABEL: Record<string, string> = { narrow: "窄", comfortable: "适中", wide: "宽" }

/** 补全正文 + 它的格式(`html` 来自 feed 原样透传,`text` 来自原文页提取,两者都可能)。 */
interface FullBody {
  /** 复合键(itemKey):同一个 body 只对位同一订阅下的同一条目。 */
  id: string
  content: string
  /** 按 HTML 渲染(消毒后 innerHTML),否则纯文本保留换行。 */
  html: boolean
}

/** 会话级正文缓存:同一条目来回打开不重复抓原文页(内存,刷新即失效)。
 *  ponytail: 简单 LRU-ish(超限弃最旧);要跨会话持久再落 KV。 */
const bodyCache = new Map<string, FullBody>()
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
  /** 专注阅读浮层。**同一时刻只有一个滚动所有者**:打开期间这份三栏不写进度,
   *  由浮层独占写 saveScrollRatio;关闭时本文件的恢复 effect 把三栏对到同一进度。 */
  const [focusOpen, setFocusOpen] = useState(false)
  const focusOpenRef = useRef(focusOpen)
  focusOpenRef.current = focusOpen
  /** 专注阅读最后一次滚动位置,关闭时三栏按它归位。带条目复合键:换文章后不能拿
   *  上一篇的位置套到这一篇上。
   *  ⚠️ 不能只读 item.scrollRatio:读到结尾(≥95%)store 会**刻意清掉**记录
   *  (saveScrollRatio),那时三栏会弹回顶部 —— 而用户刚在浮层里读到文章结尾。
   *  三栏自己一滚动就清空它(见 onScroll),以 store 为准。 */
  const focusRatioRef = useRef<{ key: string; ratio: number } | null>(null)

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
      // 专注阅读打开期间**不写**:两个滚动容器各写一份会互相覆盖(阅读进度只有一个值)。
      const cur = itemRef.current
      if (!pendingRestoreRef.current && !focusOpenRef.current && cur && cur.kind === "article") {
        focusRatioRef.current = null // 三栏自己动了,进度以 store 为准
        saveRatioRef.current(cur, ratio)
      }
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
  const curContent = item?.kind === "article" ? (item.content ?? "") : ""
  /** 可见文本长度(<400 触补全;用可见长度而非原始 HTML——图片密集摘要会虚高)。 */
  const curVisible = visibleLength(curContent)
  const [full, setFull] = useState<FullBody | null>(null)
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
        if (d?.kind !== "article") return
        const text = d.content ?? ""
        if (live && text.length > curContent.length) {
          // ⚠️ 格式随正文一起存:`resolveDetail` **不保证纯文本**——feed 已带全文时
          // raw.ts 原样返回条目(content 是 HTML、contentFormat="html")。按「补全恒为
          // 纯文本」写死 → 阮一峰这类自带全文的 Atom 源在正文区显示 `<p>…` 标签源码
          // (桌面镜像会剥掉 article 的 content,所以这条补全路径每次都会走)。
          const body: FullBody = {
            id: itemCacheKey!,
            content: text,
            html: d.contentFormat === "html" || (d.contentFormat === undefined && looksLikeHtml(text)),
          }
          if (bodyCache.size >= BODY_CACHE_MAX) bodyCache.delete(bodyCache.keys().next().value as string)
          bodyCache.set(itemCacheKey!, body)
          setFull(body)
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
   *  ⚠️ 补全结果**不走 store.patch**(只在本地 full/cache),故格式判定跟着 `complete`
   *  走(见上),不能读 item.contentFormat —— 那是 store 里(被镜像剥过 content 的)条目。
   */
  const complete = full && full.id === itemCacheKey ? full : cached
  const shownContent = complete?.content ?? curContent
  /** 本条目是否已拿到补全正文(对位复合键,不是「任意条目补全过」)。 */
  const hasFull = !!complete
  // 补全结果按它自带的格式渲染;未补全时才依据 store 的 contentFormat / 标签探测决定。
  // ⚠️ 补全结果若是纯文本,不能靠 looksLikeHtml 猜:文本里的裸 `<`(数学/代码/
  // `<https://…>`)会被命中而走 innerHTML,把内容当标签吞掉且丢段落换行。
  const html = complete ? complete.html : article?.contentFormat === "html" || looksLikeHtml(shownContent)
  const cleanHtml = useMemo(
    () => (article && html ? DOMPurify.sanitize(shownContent) : ""),
    [article, html, shownContent],
  )

  // 切条目 / 补全正文到达后:按当前 scrollHeight 恢复阅读进度(有则跳,无则回顶)。
  // ⚠️ deps 含 hasFull:补全是异步的,到达后 scrollHeight 变长,须按最终高度**再定位一次**,
  // 否则落在按旧(摘要)高度算出的像素处(读了比保存进度更靠前的位置)。
  // ⚠️ deps 含 focusOpen:关掉专注阅读时,三栏要对到浮层期间写下的进度 —— 否则三栏
  // 停在旧位置,用户下一次在这儿滚动就会用旧比例覆盖浮层刚存的值(进度倒退)。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    pendingRestoreRef.current = true // 恢复前先屏蔽写回
    // 浮层刚记录的位置优先(见 focusRatioRef 的注释);否则用 store 里的进度。
    // 只在**浮层关着**时取:打开期间这条记录还在被浮层更新,拿去挪三栏没有意义。
    const focusMark = focusRatioRef.current
    const fromFocus = !focusOpen && focusMark && focusMark.key === itemCacheKey ? focusMark.ratio : null
    if (fromFocus !== null) focusRatioRef.current = null // 用一次就消费掉:只负责浮层 → 三栏这一次归位
    const ratio = fromFocus ?? item?.scrollRatio ?? 0
    const raf = requestAnimationFrame(() => {
      const max = el.scrollHeight - el.clientHeight
      el.scrollTo({ top: ratio > 0.02 && max > 0 ? ratio * max : 0 })
      pendingRestoreRef.current = false // 恢复完成,允许写回
    })
    return () => cancelAnimationFrame(raf)
  }, [item?.id, hasFull, focusOpen])

  // 选中条目被刷新事件删掉时收起浮层:浮层此时已随空态卸载,而 focusOpen 还是 true,
  // 下一条一选中它会自己弹出来(用户没点)。
  useEffect(() => {
    if (!item) setFocusOpen(false)
  }, [item])

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

  /**
   * 文章标签。
   *
   * ⚠️ v1 数据面**没有** tags 字段(`tpl:tags` 是 v2,见 heliu 计划 §5):这里读可选
   * 字段,现在恒为空、一个标签都不渲染。**不要**拿来源/kind/作者拼假标签充数。
   */
  const tags = ((item as { tags?: string[] }).tags ?? []).filter((t) => typeof t === "string" && t.trim() !== "")

  /**
   * 文章内容(标题 / 署名 / 标签 / 正文 / 页脚) —— **一个节点,两处渲染**:
   * 三栏的 `<article class="article">` 与专注阅读浮层。
   *
   * ⚠️ 这样正文只消毒一次(上面的 cleanHtml),浮层不会出现第二份 DOMPurify 配置
   * ——两份配置迟早漂移,漏掉一个标签就是一处 XSS 面。标题/署名/页脚也不会两处写法不同。
   */
  const articleContent = (
    <>
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

      {tags.length ? (
        <div className="article-tags">
          {tags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
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
        <Button variant="secondary" onClick={() => toggleStar(item)}>
          <Icon name="star" size={14} /> {item.isStarred ? "取消星标" : "星标"}
        </Button>
        {item.url ? (
          <Button variant="quiet" onClick={openExternal}>
            <Icon name="external" size={14} /> 打开原文
          </Button>
        ) : null}
      </div>
    </>
  )

  return (
    <>
      <div className="progress-bar" aria-hidden>
        <span ref={barRef} />
      </div>
      <header className="detail-head" {...overlayBlock("reader-head", "reader:head")}>
        <IconButton
          size="sm"
          className="narrow-only"
          aria-label="返回列表"
          onClick={() => useDesktop.getState().selectArticle(null)}
        >
          <Icon name="back" size={15} />
        </IconButton>
        <span className="spacer" />
        <IconButton
          size="sm"
          aria-label={item.isStarred ? "取消星标" : "星标"}
          aria-pressed={!!item.isStarred}
          onClick={() => toggleStar(item)}
        >
          <Icon name="star" size={15} />
        </IconButton>
        <IconButton size="sm" aria-label="复制链接" title="复制链接" onClick={() => void copyLink()}>
          <Icon name="bookmark" size={15} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="减小字号"
          disabled={fontSize <= 13}
          onClick={() => setPrefs({ fontSize: fontSize - 1 })}
        >
          <span style={{ fontSize: 11, fontWeight: 650 }}>A−</span>
        </IconButton>
        <IconButton
          size="sm"
          aria-label="增大字号"
          disabled={fontSize >= 24}
          onClick={() => setPrefs({ fontSize: fontSize + 1 })}
        >
          <span style={{ fontSize: 13, fontWeight: 650 }}>A+</span>
        </IconButton>
        <IconButton
          size="sm"
          aria-label={`阅读宽度:${MEASURE_LABEL[measure] ?? measure}`}
          title={`阅读宽度：${MEASURE_LABEL[measure] ?? measure}`}
          onClick={() =>
            setPrefs({
              measure: measure === "narrow" ? "comfortable" : measure === "comfortable" ? "wide" : "narrow",
            })
          }
        >
          <Icon name="type" size={15} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="专注阅读"
          title="专注阅读"
          onClick={() => {
            focusRatioRef.current = null // 上一次浮层的位置不属于这一回
            setFocusOpen(true)
          }}
        >
          <Icon name="fullscreen" size={15} />
        </IconButton>
        {item.url ? (
          <IconButton size="sm" aria-label="打开原文" title="打开原文" onClick={openExternal}>
            <Icon name="external" size={15} />
          </IconButton>
        ) : null}
      </header>

      <div className="scroll-area article-scroll" ref={scrollRef} {...overlayBlock("reader-scroll", "reader:scroll")}>
        <article className="article" {...overlayBlock("reader-article", "reader:article")}>
          {articleContent}
        </article>
      </div>

      {/* 专注阅读:同一份内容节点进浮层(正文不再消毒第二遍),浮层打开期间上面这份
          三栏不写阅读进度 —— 见 focusOpenRef 的门控。 */}
      <FocusReader
        open={focusOpen}
        onOpenChange={setFocusOpen}
        item={item}
        onRatio={(r) => {
          if (itemCacheKey) focusRatioRef.current = { key: itemCacheKey, ratio: r }
        }}
      >
        {articleContent}
      </FocusReader>
    </>
  )
}
