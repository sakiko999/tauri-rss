/**
 * 媒体卡片族 —— video/audio/live 的网格卡、紧凑小卡、社交瀑布流卡、直播横滑卡。
 *
 * 结构照 new_desktop 的 components.js(mediaCard/cardMini/socialCard),但图片走
 * ui 包的 MediaImage(自带防盗链隧道 + 骨架 + 失败占位),不再自己写 <img>。
 */
import type { MediaItem } from "@tauri-playground/core"
import { MediaImage, fmtCount } from "@tauri-playground/ui"
import { Icon } from "../Icon.tsx"
import { fmtAgo, fmtTime, httpsify, mediaUrl, onlineOf, platformOf, socialRatio, PLATFORM_LABEL } from "../../lib/media.ts"
import { rememberSocialSource } from "../../lib/viewTransition.ts"

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
 * 这张卡的主操作是「播放」吗?
 *
 * ⚠️ 只有 video / audio / live 有可播流。article 与 social 点「播放」都会掉进
 * 「该条目不指向可解析的视频链接」的破碎播放页 —— 主操作必须是「打开原文」
 * (article)/「打开详情」(social),封面也不该摆播放按钮(参考实现
 * `new_desktop/js/components.js` 的 cardMini 只给 video/audio 出 play 图标)。
 */
export function isPlayableKind(kind: MediaItem["kind"]): boolean {
  return kind === "video" || kind === "audio" || kind === "live"
}

/**
 * 卡片脚注的「加入队列」按钮。
 *
 * ⚠️ 之前只有一个 + 大小的裸图标:没有 aria-label,屏幕阅读器只念「按钮」;
 * 而且和整卡点击(播放)是两个完全不同的动作,必须点明。
 */
function QueueButton({ item, onQueue }: { item: MediaItem; onQueue: (item: MediaItem) => void }) {
  return (
    <button
      className="icon-btn sm"
      aria-label="加入播放队列"
      title="加入播放队列"
      onClick={(e) => {
        e.stopPropagation()
        onQueue(item)
      }}
    >
      <Icon name="plus" size={13} />
    </button>
  )
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
  // ⚠️ 这张卡也会收到 article/social(混合 feed:「全部」/分组/智能订阅)。它们**没有
  // 可播流**,主操作必须是「打开原文/详情」而不是播放 —— 否则点一下必然跳到
  // 「该条目不指向可解析的视频链接」的破碎播放页。(整屏社交走 SocialCard/MasonryGrid。)
  const playable = isPlayableKind(item.kind)
  const isLiveNow = live && (item as { liveStatus?: string }).liveStatus !== "offline"
  const dur = (item as { durationSec?: number; duration?: number }).durationSec ?? (item as { duration?: number }).duration
  const online = onlineOf(item)
  const platform = platformOf(item)
  const b = badged(item, actions)
  // article 同 social:没有可播流,整卡点击应是「打开原文」而不是播放。
  const primary = playable ? () => actions.onPlay(item) : () => actions.onOpen?.(item)

  return (
    <article
      className="card"
      role="button"
      tabIndex={0}
      aria-label={item.title}
      onClick={(e) => {
        // 社交卡片:记下源图,供「缩略图 → 全屏」形变用(见 lib/viewTransition.ts)。
        // 只对 social 记 —— 其它 kind 的主操作是播放/打开原文,没有形变目标。
        if (item.kind === "social") rememberSocialSource(e.currentTarget.querySelector("img"))
        primary()
      }}
      onKeyDown={(e) => {
        // 卡片内的「加入队列」按钮的 Enter/Space 会冒泡到这里 —— 不区分 target 会把
        // 加队列的键盘操作变成开播。
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          primary()
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
        {/* 续播进度条(看过一半的条目一眼可辨)。仅非直播、有位置与时长时。 */}
        {!isLiveNow && dur && item.positionSec ? (
          <span className="card-progress" aria-hidden>
            <span style={{ width: `${Math.min(100, (item.positionSec / dur) * 100)}%` }} />
          </span>
        ) : null}
        {/* .card-play 是 pointer-events:none(整卡可点),内层要自己接管点击,
            否则「播放」按钮形同虚设。article/social 没有可播流 → 不摆播放按钮。 */}
        {playable ? (
          <span className="card-play">
            <span onClick={b.onSelect} role="presentation" style={{ pointerEvents: "auto" }}>
              <Icon name="play" size={18} />
            </span>
          </span>
        ) : null}
      </div>
      <div className="card-body">
        <span className="card-title clamp-2">{item.title}</span>
        {/* 作者 + 时间不再用 `·` 连接;时间贴右,作者名超长省略。 */}
        <span className="card-meta">
          {item.author?.name ? <span className="card-author">{item.author.name}</span> : <span className="spacer" />}
          <span className="card-time">{fmtAgo(item.publishedAt)}</span>
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
          {/* 队列是播放特性:不可播的 kind(article/social)加进去也播不出。 */}
          {actions.onQueue && playable ? <QueueButton item={item} onQueue={actions.onQueue} /> : null}
        </span>
      </div>
    </article>
  )
}

/** 紧凑小卡(同源推荐 / 搜索结果;文章也走这里 —— 见 isPlayableKind)。 */
export function CardMini({ item, actions }: { item: MediaItem; actions: CardActions }) {
  const img = mediaUrl(item)
  const playable = isPlayableKind(item.kind)
  return (
    <button className="card" onClick={() => (playable ? actions.onPlay(item) : actions.onOpen?.(item))} aria-label={item.title}>
      <div className="card-media" style={{ aspectRatio: "16 / 9" }}>
        <MediaImage src={img} ratio={16 / 9} fill />
        {playable ? (
          <span className="card-play">
            <span>
              <Icon name="play" size={16} />
            </span>
          </span>
        ) : null}
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
    <button
      className="social-card"
      onClick={(e) => {
        // 缩略图形变的源(瀑布流卡片**不会**被卸载,弹窗是叠加层 —— 故必须显式记源)。
        rememberSocialSource(e.currentTarget.querySelector("img"))
        actions.onOpen?.(item)
      }}
      aria-label={item.title}
    >
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
