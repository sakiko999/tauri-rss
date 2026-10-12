/**
 * 媒体卡片族 —— video/audio/live 的网格卡、紧凑小卡、社交瀑布流卡、直播横滑卡。
 *
 * 结构照 new_desktop 的 components.js(mediaCard/cardMini/socialCard),但图片走
 * ui 包的 MediaImage(自带防盗链隧道 + 骨架 + 失败占位),不再自己写 <img>。
 */
import type { MediaItem } from "@tauri-playground/core"
import { MediaImage, fmtCount } from "@tauri-playground/ui"
import { Icon } from "./Icon.tsx"
import { fmtAgo, fmtTime, httpsify, mediaUrl, onlineOf, platformOf, socialRatio, PLATFORM_LABEL } from "../lib/media.ts"

/** 播放器回调:交给宿主(MediaMain/PlayerPage)决定如何开播。 */
export interface CardActions {
  onPlay: (item: MediaItem) => void
  onOpen?: (item: MediaItem) => void
  onQueue?: (item: MediaItem) => void
}

function badged(item: MediaItem, actions: CardActions) {
  return {
    onSelect: (e: React.MouseEvent) => {
      e.stopPropagation()
      actions.onPlay(item)
    },
  }
}
/**
 * 网格媒体卡(video / audio / live 通用;live 加在线与脉冲角标)。
 *
 * ⚠️ 封面**一律 16:9 裁切**,不用条目真实比例——混排的 4:3 竖图 / 方图会让网格
 * 参差不齐(只有社交瀑布流才该保留原始比例,见 SocialCard)。
 */
export function MediaCard({ item, actions }: { item: MediaItem; actions: CardActions }) {
  const img = mediaUrl(item)
  const live = item.kind === "live"
  const isLiveNow = live && (item as { liveStatus?: string }).liveStatus !== "offline"
  const dur = (item as { durationSec?: number; duration?: number }).durationSec ?? (item as { duration?: number }).duration
  const online = onlineOf(item)
  const platform = platformOf(item)
  const b = badged(item, actions)

  return (
    <article
      className="card"
      role="button"
      tabIndex={0}
      aria-label={item.title}
      onClick={() => actions.onPlay(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          actions.onPlay(item)
        }
      }}
    >
      <div className="card-media" style={{ aspectRatio: "16 / 9" }}>
        <MediaImage src={img} ratio={16 / 9} fill />
        {isLiveNow ? (
          <span className="live-pulse">
            <span className="status-dot" data-state="live" /> LIVE
          </span>
        ) : dur ? (
          <span className="card-duration num">{fmtTime(dur)}</span>
        ) : null}
        {live && online ? <span className="live-online num">{fmtCount(online)} 人在看</span> : null}
        {/* .card-play 是 pointer-events:none(整卡可点),内层要自己接管点击,
            否则「播放」按钮形同虚设。 */}
        <span className="card-play">
          <span onClick={b.onSelect} role="presentation" style={{ pointerEvents: "auto" }}>
            <Icon name="play" size={18} />
          </span>
        </span>
      </div>
      <div className="card-body">
        <span className="card-title clamp-2">{item.title}</span>
        <span className="card-meta">
          {item.author?.name ? <span className="od-truncate">{item.author.name}</span> : null}
          {item.author?.name ? <span className="dot-sep" /> : null}
          <span>{fmtAgo(item.publishedAt)}</span>
        </span>
        <span className="card-foot">
          {platform ? (
            <>
              <Icon name="radio" size={11} />
              <span className="od-truncate">{PLATFORM_LABEL[platform] ?? platform}</span>
            </>
          ) : (
            <span className="od-truncate">{kindLabel(item.kind)}</span>
          )}
          <span className="spacer" />
          {actions.onQueue ? (
            <button
              className="icon-btn sm"
              aria-label="加入队列"
              onClick={(e) => {
                e.stopPropagation()
                actions.onQueue?.(item)
              }}
            >
              <Icon name="plus" size={13} />
            </button>
          ) : null}
        </span>
      </div>
    </article>
  )
}

/** 紧凑小卡(同源推荐 / 搜索结果)。 */
export function CardMini({ item, actions }: { item: MediaItem; actions: CardActions }) {
  const img = mediaUrl(item)
  return (
    <button className="card" onClick={() => actions.onPlay(item)} aria-label={item.title}>
      <div className="card-media" style={{ aspectRatio: "16 / 9" }}>
        <MediaImage src={img} ratio={16 / 9} fill />
        <span className="card-play">
          <span>
            <Icon name="play" size={16} />
          </span>
        </span>
      </div>
      <div className="card-body" style={{ padding: "var(--sp-3)" }}>
        <span className="card-title clamp-2" style={{ fontSize: "var(--fs-small)" }}>
          {item.title}
        </span>
        <span className="card-meta">
          <span>{fmtAgo(item.publishedAt)}</span>
        </span>
      </div>
    </button>
  )
}

/** 社交瀑布流卡(图片按原始比例,不裁切)。 */
export function SocialCard({ item, actions }: { item: MediaItem; actions: CardActions }) {
  const imgs = (item as { images?: Array<{ url: string; width?: number; height?: number }> }).images ?? []
  const cover = imgs[0]
  const text = (item as { content?: string }).content ?? item.summary ?? ""
  const likes = (item as { likes?: number }).likes
  const replies = (item as { replies?: number }).replies
  const video = /视频|video/i.test(String((item as { raw?: { type?: string } }).raw?.type ?? ""))
  return (
    <button className="social-card" onClick={() => actions.onOpen?.(item)} aria-label={item.title}>
      {cover ? (
        <span className="social-media" style={{ aspectRatio: socialRatio(cover) }}>
          <MediaImage src={httpsify(cover.url)} ratio={socialRatio(cover)} loading="eager" />
          {video ? (
            <span className="social-video-badge">
              <Icon name="play" size={11} /> 视频
            </span>
          ) : null}
        </span>
      ) : null}
      <div className="social-body">
        <span className="social-title clamp-3">{text || item.title}</span>
        <div className="social-foot">
          <span className="social-author">
            <span className="social-avatar social-avatar-letter">{(item.author?.name?.[0] ?? "?").toUpperCase()}</span>
            <span className="social-author-name od-truncate">{item.author?.name ?? "未知作者"}</span>
          </span>
          <span className="social-stats">
            {likes ? (
              <span>
                <Icon name="heart" size={11} /> {fmtCount(likes)}
              </span>
            ) : null}
            {replies ? (
              <span>
                <Icon name="message" size={11} /> {fmtCount(replies)}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </button>
  )
}

/** 横向轨道的直播卡(比网格卡宽)。 */
export function LiveRailCard({ item, actions }: { item: MediaItem; actions: CardActions }) {
  return <MediaCard item={item} actions={actions} />
}

function kindLabel(kind: string): string {
  return { article: "文章", video: "视频", audio: "音频", live: "直播", social: "社交" }[kind] ?? kind
}
