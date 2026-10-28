/**
 * HomePicks —— 首页「为你精选」网格（纯 props）。
 *
 * 混排策略在 picksMix（动态按热度、影音按时间，分池轮转）；这里不重排。
 * 副标写「按热度与时间混排」而不是「按你的阅读习惯」—— 没有推荐模型，
 * 后者是编出来的承诺（§2.2 文案修正 ③）。
 *
 * ⚠️ 不用 MasonryGrid：它自带内滚 + loadMore，嵌进首页会变成区块内二次滚动。
 * 这里用有上限的普通 grid。
 */
import type { MediaItem } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"

import { fmtAgo, fmtNum, itemKey, mediaUrl } from "../../lib/media.ts"
import { HomeSection } from "./HomeSection.tsx"

export function HomePicks({ items, onOpen }: { items: MediaItem[]; onOpen: (item: MediaItem) => void }) {
  if (items.length === 0) return null
  return (
    <HomeSection title="为你精选" sub="按热度与时间混排">
      <div className="home-pick-grid">
        {items.map((item) => {
          const img = mediaUrl(item)
          const likes = (item as { likes?: number }).likes
          const meta = item.kind === "social" ? (likes ? `${fmtNum(likes)} 赞` : "") : fmtAgo(item.publishedAt)
          return (
            <button key={itemKey(item)} className="home-pick" onClick={() => onOpen(item)} title={item.title}>
              {img ? (
                <span className="home-pick-media">
                  <MediaImage src={img} ratio={16 / 9} />
                </span>
              ) : null}
              <span className="home-pick-body">
                <span className="home-pick-title clamp-2">{item.title}</span>
                {meta ? <span className="home-pick-meta">{meta}</span> : null}
              </span>
            </button>
          )
        })}
      </div>
    </HomeSection>
  )
}
