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
import { useEffect, useState } from "react"
import { useDesktop } from "../store/index.ts"
import { Modal } from "./Modal.tsx"
import { Icon } from "./Icon.tsx"
import { MediaImage, fmtCount } from "@tauri-playground/ui"
import { fmtAgo, mediaUrl } from "../lib/media.ts"

export function SocialDetailModal() {
  const detail = useDesktop((s) => s.socialDetail)
  const close = useDesktop((s) => s.closeSocialDetail)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const toast = useDesktop((s) => s.toast)
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
    if (!multi) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setImgIndex((i) => (i - 1 + imgs.length) % imgs.length)
      else if (e.key === "ArrowRight") setImgIndex((i) => (i + 1) % imgs.length)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [multi, imgs.length])

  if (!detail || !item) return null

  const text = (item as { content?: string }).content ?? item.summary ?? ""
  /** 媒体源兼容:SocialItem 走 images[0];article 类兜 thumbnail/poster。 */
  const cover = mediaUrl(item, imgIndex)
  const stepImg = (d: number) => setImgIndex((i) => (i + d + imgs.length) % imgs.length)
  const likes = (item as { likes?: number }).likes
  const replies = (item as { replies?: number }).replies
  const reposts = (item as { reposts?: number }).reposts
  /**
   * 是否在补全中。⚠️ 不能用 `full === null` 判断——resolveSocialDetail 对**无详情能力**
   * 的源(bili/weibo,列表数据已完整)原样返回 item,`full` 永远停在 null,
   * 那样会把完整内容一直显示成「正在补全」。只有 xhs 靠 xsec_token 拉详情。
   */
  const resolving = detail.full === null && !!(item as { xsecToken?: string }).xsecToken

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      size="wide"
      flush
      title={item.title || item.author?.name || "详情"}
      desc={item.author?.name ? `${item.author.name} · ${fmtAgo(item.publishedAt)}` : fmtAgo(item.publishedAt)}
      footer={
        <>
          <button
            className="btn btn-secondary"
            onClick={() => {
              addToQueue(item.id)
              toast("ok", "已加入播放队列", item.title)
            }}
          >
            <Icon name="queue" size={14} /> 加入队列
          </button>
          {item.url ? (
            /* ⚠️ 走宿主门面(WebView 拦 window.open)。 */
            <button className="btn btn-quiet" onClick={() => void globalThis.appHost.openExternal(item.url!)}>
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
          <div className="social-detail-media">
            {cover ? (
              <>
                {imgs.length > 1 ? (
                  <>
                    <span className="social-detail-count num">
                      {imgIndex + 1} / {imgs.length}
                    </span>
                    <button
                      className="social-detail-nav"
                      data-dir="prev"
                      aria-label="上一张"
                      onClick={() => stepImg(-1)}
                    >
                      <Icon name="back" size={16} />
                    </button>
                    <button
                      className="social-detail-nav"
                      data-dir="next"
                      aria-label="下一张"
                      onClick={() => stepImg(1)}
                    >
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </>
                ) : null}
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
            ) : (
              <p className="social-detail-text">{text}</p>
            )}
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
            {/* 源站补全说明:脚注形态,不与正文争权重。 */}
            <p className="social-detail-note">
              {resolving ? <Icon name="loader" size={13} className="animate-spin" /> : <Icon name="info" size={13} />}
              <span>{resolving ? "正在向源站补全详情…" : "列表页只带封面与标题；详情按列表项的 xsec_token 补全，匿名可读全文与多图。"}</span>
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
