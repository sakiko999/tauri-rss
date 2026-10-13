/**
 * SocialDetailModal —— 社交条目详情弹窗(点瀑布流卡片打开)。
 *
 * bili/weibo 的列表数据已完整,xhs 缺详情 → store.openSocialDetail 会异步
 * 调 resolveSocialDetail 补全,这里在 full 未就绪时显示「正在补全」。
 *
 * ⚠️ 布局契约(照 new_desktop):flush 弹窗**不滚不 pad**,高度沿容器链传导到
 * `.social-detail` → 图片区/信息列。媒体框必须有**确定的 height**,图片百分比
 * 尺寸才有基准(只给 max-height → 容器退化 auto → 图按自然尺寸画完再被
 * overflow:hidden 裁掉 ≡ 撑满 + 截断)。竖图/横图都由 object-fit:contain 装进
 * 同一可用高度,不再按源比例撑高把正文挤到图片下方。
 */
import { useEffect, useMemo, useState } from "react"
import DOMPurify from "dompurify"
import { useDesktop } from "../store/index.ts"
import { Modal } from "./Modal.tsx"
import { Icon } from "./Icon.tsx"
import { MediaImage, fmtCount } from "@tauri-playground/ui"
import { fmtAgo, mediaUrl, socialRatio } from "../lib/media.ts"
import { openExternalSafely } from "../lib/host.ts"

export function SocialDetailModal() {
  const detail = useDesktop((s) => s.socialDetail)
  const close = useDesktop((s) => s.closeSocialDetail)
  const item = detail?.full ?? detail?.item
  const imgs = (item as { images?: Array<{ url: string }> } | undefined)?.images ?? []
  const multi = imgs.length > 1
  /** 当前展示第几张(仅多图时有意义)。 */
  const [imgIndex, setImgIndex] = useState(0)
  /**
   * ⚠️ 所有 hook 必须在 `if (!detail) return null` **之前**调用。
   * 曾把 useState/useEffect 放在 early return 之后:detail 为 null 时提前返回(少调),
   * 有值时多调 → React 抛「Rendered more/fewer hooks than expected」,弹窗整块崩掉打不开。
   */
  useEffect(() => setImgIndex(0), [item?.id])
  useEffect(() => {
    // ⚠️ 只在弹窗真正打开时挂监听:本组件常驻在 App 里,无条件监听会让 ←/→ 在
    // 任何页面(阅读视图、播放页)被吞掉 —— 播放页的左右键是跳转/快进。
    if (!detail || !multi) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setImgIndex((i) => (i - 1 + imgs.length) % imgs.length)
      else if (e.key === "ArrowRight") setImgIndex((i) => (i + 1) % imgs.length)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [detail, multi, imgs.length])
  /**
   * 正文可能是原始 HTML(weibo 的 text 带 `<a href=…>`/`<br />`)——直接 `{text}` 会把
   * 标签当字面量显示(用户看到 `<a href="...">@xxx</a> <br />` 一串源码)。经 DOMPurify
   * 消毒后按 HTML 渲染。⚠️ useMemo 必须在 early return **之前**(hook 顺序稳定)。
   */
  const rawContent = ((detail?.full ?? detail?.item) as { content?: string } | undefined)?.content ?? ""
  const bodyHtml = useMemo(
    () => (/<[a-z][\s\S]*>/i.test(rawContent) ? DOMPurify.sanitize(rawContent) : ""),
    [rawContent],
  )

  if (!detail || !item) return null

  /** 正文 <a> 一律拦下交宿主打开(同 ReaderMain:不拦的话 WebView 会整页导航走)。 */
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a")
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute("href")
    if (!href || href.startsWith("#")) return
    openExternalSafely(href)
  }

  const text = (item as { content?: string }).content ?? item.summary ?? ""
  /** 媒体源兼容:SocialItem 走 images[0];article 类兜 thumbnail/poster。 */
  const cover = mediaUrl(item, imgIndex)
  const stepImg = (d: number) => setImgIndex((i) => (i + d + imgs.length) % imgs.length)
  /** 当前图片真实比例。容器比例 === 图片比例时 contain 恰好填满,不留缝也不裁切。 */
  const imgRatio = (() => {
    const it = item as { aspectRatio?: number; width?: number; height?: number; images?: Array<{ width?: number; height?: number }> }
    return socialRatio(it.images?.[imgIndex] ?? { width: it.width, height: it.height })
  })()
  const likes = (item as { likes?: number }).likes
  const replies = (item as { replies?: number }).replies
  const reposts = (item as { reposts?: number }).reposts
  /**
   * 是否在补全中。⚠️ 不能用 `full === null` 判断——resolveSocialDetail 对**无详情能力**
   * 的源(bili/weibo,列表数据已完整)原样返回 item,`full` 永远停在 null,
   * 那样会把完整内容一直显示成「正在补全」。只有 xhs 靠 xsec_token 拉详情。
   */
  const resolving = detail.full === null && !detail.error && !!(item as { xsecToken?: string }).xsecToken
  const resolveFailed = !!detail.error
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      size="wide"
      flush
      title={item.title || item.author?.name || "详情"}
      desc={item.author?.name ? `${item.author.name} — ${fmtAgo(item.publishedAt)}` : fmtAgo(item.publishedAt)}
      footer={
        <>
          {/* ⚠️ 社交条目没有可播流,`addToQueue` 会**拒绝**它(入队收口处有护栏)——
              原按钮点了不生效却弹「已加入播放队列」(说谎)。这里不摆队列按钮。 */}
          {item.url ? (
            /* ⚠️ 走宿主门面(WebView 拦 window.open)。 */
            <button className="btn btn-quiet" onClick={() => openExternalSafely(item.url)}>
              <Icon name="external" size={14} /> 打开原文
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn btn-secondary" onClick={close}>
            关闭
          </button>
        </>
      }
    >
      <div id="social-detail">
        <div className="social-detail">
          {/* ⚠️ 缩略图条**不能**放在 media 与 info 之间:它 grid-column:1/-1 会占满
              第一行两列,把 info 自动推到第三行。放在 info 之后,自动放置才会是
              media=1/1 → info=1/2 → thumbs=第二行整行。 */}
          {/* 媒体列的宽度按**当前图片的比例**反推(--detail-media-ratio),media
              容器再按同一比例定宽。这样网格的 1.4fr/1fr 折中值就不会把竖图挤成一条。
              比例异常的图(超长截图 / 超宽 banner)在 CSS 里被 clamp 到 0.5~1.9,
              此时 contain 留一点缝是有意的(完整显示 > 填满裁剪)。 */}
          <div className="social-detail-media" style={{ "--detail-media-ratio": String(imgRatio) } as React.CSSProperties}>
            {cover ? (
              <>
                {imgs.length > 1 ? (
                  <div className="social-detail-controls">
                    <button
                      className="social-detail-nav"
                      data-dir="prev"
                      aria-label="上一张"
                      onClick={() => stepImg(-1)}
                    >
                      <Icon name="back" size={15} />
                    </button>
                    <span className="social-detail-count num">
                      {imgIndex + 1} / {imgs.length}
                    </span>
                    <button
                      className="social-detail-nav"
                      data-dir="next"
                      aria-label="下一张"
                      onClick={() => stepImg(1)}
                    >
                      <Icon name="chevronRight" size={15} />
                    </button>
                  </div>
                ) : null}
                {/* ⚠️ style 上的比例必须与图片**真实比例**一致:每张图换比例,
                    媒体列的宽度就跟着变。 */}
                <MediaImage src={cover} alt={item.title} loading="eager" contain />
              </>
            ) : (
              <span className="cover-missing">
                <Icon name="image" size={24} />
              </span>
            )}
          </div>

          <div className="social-detail-info">
            <div className="social-detail-head">
              <span className="social-avatar social-avatar-letter avatar-round" style={{ width: 34, height: 34 }}>
                {(item.author?.name?.[0] ?? "?").toUpperCase()}
              </span>
              <span className="stack" style={{ gap: 0 }}>
                <span style={{ fontWeight: 560 }}>{item.author?.name ?? "未知作者"}</span>
                <span className="t-micro t-dim">{fmtAgo(item.publishedAt)}</span>
              </span>
            </div>
            {resolving ? (
              <span className="stack" style={{ gap: "var(--sp-2)" }}>
                <span className="skeleton sk-line" style={{ width: "92%" }} />
                <span className="skeleton sk-line" style={{ width: "78%" }} />
                <span className="skeleton sk-line" style={{ width: "64%" }} />
              </span>
            ) : bodyHtml ? (
              <div className="social-detail-text" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : text ? (
              <p className="social-detail-text">{text}</p>
            ) : (
              // 空正文占位:没有这一支时,正文区是一大片空白,用户分不清
              // 「还在加载」还是「本来就没正文」。
              <p className="social-detail-text t-dim">（这条没有正文，只有图片）</p>
            )}
            {/* 三项统计全为 0/缺失时不渲染 —— 否则只剩一条纯噪声的横线。 */}
            {likes || replies || reposts ? (
              <div className="social-detail-stats">
                {likes ? (
                  <span>
                    <Icon name="heart" size={13} /> {fmtCount(likes)}
                  </span>
                ) : null}
                {replies ? (
                  <span>
                    <Icon name="message" size={13} /> {fmtCount(replies)}
                  </span>
                ) : null}
                {reposts ? (
                  <span>
                    <Icon name="refresh" size={13} /> {fmtCount(reposts)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {/* 源站补全说明:脚注形态,不与正文争权重。 */}
            <p className="social-detail-note">
              {resolving ? (
                <Icon name="loader" size={13} className="animate-spin" />
              ) : resolveFailed ? (
                <Icon name="alert" size={13} />
              ) : (
                <Icon name="info" size={13} />
              )}
              <span>
                {resolving
                  ? "正在向源站补全详情…"
                  : resolveFailed
                    ? `详情补全失败：${detail.error}（列表页只带封面与标题）`
                    : "列表页只带封面与标题；详情按列表项的 xsec_token 补全，匿名可读全文与多图。"}
              </span>
            </p>
          </div>

          {/* 多图缩略图条:直接点选,不必靠左右键一张张翻。放在 info 之后是刻意的
              ——它横跨整行,插在 media 与 info 之间会把 info 挤到第三行。 */}
          {imgs.length > 1 ? (
            <div className="social-detail-thumbs" role="tablist" aria-label="图片">
              {imgs.map((img, i) => (
                <button
                  key={`${img.url}-${i}`}
                  className="social-detail-thumb"
                  role="tab"
                  aria-selected={i === imgIndex}
                  aria-label={`第 ${i + 1} 张`}
                  onClick={() => setImgIndex(i)}
                >
                  <MediaImage src={mediaUrl(item, i)} ratio={1} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
