/**
 * HomeResumeRail —— 首页「继续观看」横滑轨（纯 props）。
 *
 * pct 由 resumeWithPct 算好（时长缺失的条目已被整条丢弃，不会出现「已观看 0%」）。
 * ⚠️ 类名用 `.home-rail` 而不是通用的 `.media-rail`：影音视图那条横向轨由 M6 落地，
 * 两边共用改名会让后续样式互相覆盖（仓库有 132px 侧栏的同型事故）。
 */
import type { MediaItem } from "@amoeba/core"
import { MediaImage } from "@amoeba/ui"
import { itemKey, mediaUrl } from "../../lib/media.ts"
import type { ResumeEntry } from "../../store/selectors.ts"
import { HomeSection } from "./HomeSection.tsx"

export function HomeResumeRail({ entries, onOpen }: { entries: ResumeEntry[]; onOpen: (item: MediaItem) => void }) {
  if (entries.length === 0) return null
  return (
    <HomeSection title="继续观看">
      <div className="home-rail">
        {entries.map(({ item, pct }) => {
          const percent = Math.round(pct * 100)
          return (
            <button key={itemKey(item)} className="home-resume" onClick={() => onOpen(item)} title={item.title}>
              <span className="home-resume-media">
                <MediaImage src={mediaUrl(item)} ratio={16 / 9} />
                <span className="home-resume-pct num">{percent}%</span>
              </span>
              <span className="home-resume-title clamp-2">{item.title}</span>
              <span className="home-resume-bar" aria-hidden>
                <span style={{ width: `${percent}%` }} />
              </span>
            </button>
          )
        })}
      </div>
    </HomeSection>
  )
}
