/**
 * SocialDetailModal —— 社交条目详情弹窗(点瀑布流卡片打开)。
 *
 * bili/weibo 的列表数据已完整,xhs 缺详情 → store.openSocialDetail 会异步
 * 调 resolveSocialDetail 补全,这里在 full 未就绪时显示「正在补全」。
 */
import { useDesktop } from "../store/index.ts"
import { Modal } from "./Modal.tsx"
import { Icon } from "./Icon.tsx"
import { MediaImage, fmtCount } from "@tauri-playground/ui"
import { fmtAgo, httpsify } from "../lib/media.ts"

export function SocialDetailModal() {
  const detail = useDesktop((s) => s.socialDetail)
  const close = useDesktop((s) => s.closeSocialDetail)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const toast = useDesktop((s) => s.toast)
  if (!detail) return null

  const item = detail.full ?? detail.item
  const imgs = (item as { images?: Array<{ url: string; width?: number; height?: number }> }).images ?? []
  const text = (item as { content?: string }).content ?? item.summary ?? ""
  const likes = (item as { likes?: number }).likes
  const replies = (item as { replies?: number }).replies
  const reposts = (item as { reposts?: number }).reposts

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      size="wide"
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
      <div className="social-detail">
        <div className="social-detail-media">
          {imgs.length > 0 ? (
            imgs.map((img, i) => (
              <MediaImage
                key={i}
                src={httpsify(img.url)}
                ratio={img.width && img.height ? img.width / img.height : 4 / 5}
                loading="eager"
              />
            ))
          ) : (
            <div className="cover-missing" style={{ position: "relative", aspectRatio: "4 / 5" }}>
              <Icon name="image" size={24} />
            </div>
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
          <p className="social-detail-text">{text}</p>
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
          {detail.full === null ? <p className="t-micro t-dim">正在补全详情…</p> : null}
        </div>
      </div>
    </Modal>
  )
}
