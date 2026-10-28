/**
 * HomeFeature —— 首页「今日焦点」hero（纯 props）。
 *
 * ⚠️ 无图时**显式退化为纯文字块**（.home-feature-text）：留一块空的玻璃板
 * 会让用户以为图加载失败了，而这里根本没有图。
 */

import type { MediaItem } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"

import { Button } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { excerptOf, fmtAgo, mediaUrl } from "../../lib/media.ts"

export function HomeFeature({
  item,
  onRead,
  onLater,
}: {
  item: MediaItem
  onRead: (item: MediaItem) => void
  onLater: (item: MediaItem) => void
}) {
  const img = mediaUrl(item)
  const excerpt = excerptOf(item)
  return (
    <section className={`home-feature${img ? "" : " home-feature-text"}`} aria-labelledby="home-feature-title">
      {img ? (
        <div className="home-feature-media">
          <MediaImage src={img} alt="" ratio={16 / 9} fill loading="eager" />
        </div>
      ) : null}
      <div className="home-feature-body">
        <span className="home-kicker">今日焦点</span>
        <h2 id="home-feature-title" className="home-feature-title clamp-3">
          {item.title}
        </h2>
        {excerpt ? <p className="home-feature-excerpt clamp-2">{excerpt}</p> : null}
        <div className="home-feature-meta">
          {item.author?.name ? <span className="od-truncate">{item.author.name}</span> : null}
          {item.author?.name && item.publishedAt ? <span className="dot-sep" /> : null}
          {item.publishedAt ? <span>{fmtAgo(item.publishedAt)}</span> : null}
        </div>
        <div className="home-feature-actions">
          <Button size="sm" onClick={() => onRead(item)}>
            <Icon name="rss" size={13} /> 阅读
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={item.isStarred ? true : undefined}
            onClick={() => onLater(item)}
          >
            <Icon name="star" size={13} /> {item.isStarred ? "已稍后看" : "稍后看"}
          </Button>
        </div>
      </div>
    </section>
  )
}
