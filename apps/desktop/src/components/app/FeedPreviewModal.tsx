/**
 * FeedPreviewModal —— 播客 feed 的**临时单集列表**。
 *
 * 给 Apple 榜单/搜索那类条目用:它们是**节目**(`kind:"audio"` 但没有流,
 * `url` 是节目的 RSS feed),不是一集音频。点开 → 拉一次该 feed → 列出最近若干集,
 * 选一集直接播。同时给「订阅该节目」按钮 —— 用户点它可能想听、也可能想订阅。
 *
 * ⚠️ 这批单集是**临时预览**:`previewChannel` 不写缓存、不落 store、不建订阅。
 * 它们只存在 store 的 `feedPreview` 里,关掉弹窗即清;播放页靠回退查这份数据
 * 才找得到条目(见 PlayerPage 的 item 查找)。
 */
import { useEffect, useState } from "react"
import type { MediaItem } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"
import { useDesktop } from "../../store/index.ts"
import { Modal } from "../Modal.tsx"
import { Icon } from "../Icon.tsx"
import { StateBlock } from "../StateBlock.tsx"
import { fmtAgo, fmtTime, mediaUrl } from "../../lib/media.ts"
import { usePlayerNav } from "../../views/player/usePlayerNav.ts"

export function FeedPreviewModal() {
  const preview = useDesktop((s) => s.feedPreview)
  const close = useDesktop((s) => s.closeFeedPreview)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const toast = useDesktop((s) => s.toast)
  const { onPlay } = usePlayerNav()
  const [subscribing, setSubscribing] = useState(false)
  /** 列表只渲染前若干条 —— feed 动辄几百集,全渲染白卡顿。 */
  const [shown, setShown] = useState(20)

  // 换了节目就重置展开量。
  // ⚠️ hook 必须在任何 early return **之前** —— SocialDetailModal 曾把 useState 放
  // early return 之后,弹窗整个崩掉(「Rendered more/fewer hooks than expected」)。
  const feedUrl = preview?.feedUrl ?? ""
  useEffect(() => setShown(20), [feedUrl])

  if (!preview) return null
  const { title, items } = preview
  const list: MediaItem[] = items.slice(0, shown)

  return (
    <Modal
      open
      onOpenChange={(o) => (o ? undefined : close())}
      title={title}
      desc={`共 ${items.length} 集，选一集收听；也可以订阅该节目持续收更新。`}
      size="wide"
      footer={
        <>
          <span className="t-micro t-dim" style={{ flex: 1 }}>
            单集为临时读取，不会写进订阅列表。
          </span>
          <button className="btn btn-secondary" onClick={close}>
            关闭
          </button>
          <button
            className="btn btn-primary"
            disabled={subscribing}
            onClick={() => {
              setSubscribing(true)
              void addSubscription("rss:podcast", title, { url: feedUrl })
                .catch((e: unknown) => toast("error", "订阅失败", e instanceof Error ? e.message : String(e)))
                .finally(() => setSubscribing(false))
            }}
          >
            {subscribing ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="rss" size={14} />}{" "}
            订阅该节目
          </button>
        </>
      }
    >
      {items.length === 0 ? (
        <StateBlock icon="loader" tight title="正在读取单集…" text="首次读取要拉一次该节目的 feed。" />
      ) : (
        <>
          <div className="stack" style={{ gap: "var(--sp-2)" }}>
            {list.map((it) => {
              const dur = (it as { duration?: number }).duration
              return (
                <button
                  key={it.id}
                  className="queue-row"
                  // 直接播这**一集**:它带 enclosure 直链(stream),播放页不解析、直接播。
                  onClick={() => {
                    close()
                    onPlay(it)
                  }}
                >
                  <span className="queue-thumb">
                    <MediaImage src={mediaUrl(it)} ratio={16 / 9} fill />
                  </span>
                  <span className="queue-body">
                    <span className="queue-title clamp-2">{it.title}</span>
                    <span className="queue-sub">
                      {fmtAgo(it.publishedAt)}
                      {dur ? ` · ${fmtTime(dur)}` : ""}
                    </span>
                  </span>
                  <span className="queue-flag">
                    <Icon name="play" size={12} />
                  </span>
                </button>
              )
            })}
          </div>
          {items.length > shown ? (
            <div style={{ padding: "var(--sp-3)", textAlign: "center" }}>
              <button className="btn btn-quiet btn-sm" onClick={() => setShown((n) => n + 40)}>
                再显示 40 集（还有 {items.length - shown}）
              </button>
            </div>
          ) : null}
        </>
      )}
    </Modal>
  )
}
