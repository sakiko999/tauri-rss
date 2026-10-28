/**
 * HomeLivePanel —— 首页「正在直播」区块（纯 props）。
 *
 * 判据/排序由 selectLive 保证（只认 isLiveNow，online 降序）；这里只负责排版。
 * 无在播时**整块不渲染**（调用方判空返回 null）—— 空标题比空内容更误导。
 */
import type { MediaItem } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"

import { fmtNum, itemKey, mediaUrl, onlineOf } from "../../lib/media.ts"
import { HomeSection } from "./HomeSection.tsx"

export function HomeLivePanel({ items, onPlay }: { items: MediaItem[]; onPlay: (item: MediaItem) => void }) {
  if (items.length === 0) return null
  // 不标「N 场」：首页只取前 4 条，写条数会把「被截断的条数」当成在播总数。
  return (
    <HomeSection title="正在直播">
      <div className="home-live-list">
        {items.map((item) => {
          const online = onlineOf(item)
          return (
            <button key={itemKey(item)} className="home-live-row" onClick={() => onPlay(item)} title={item.title}>
              <span className="home-live-thumb">
                <MediaImage src={mediaUrl(item)} ratio={16 / 9} />
              </span>
              <span className="home-live-body">
                <span className="home-live-title clamp-1">{item.title}</span>
                <span className="home-live-meta">
                  <span className="status-dot" data-state="live" /> {online ? `${fmtNum(online)} 人在看` : "直播中"}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </HomeSection>
  )
}
