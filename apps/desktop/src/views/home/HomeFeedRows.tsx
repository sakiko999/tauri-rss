/**
 * HomeFeedRows —— 首页「订阅更新」行列表（纯 props）。
 *
 * 每行 = 源名 + 最近一条标题 + 未读数；点行进入该订阅节点。
 * groupedBySub 已经把所有订阅按「最新一条」排好，且跳过了没有条目的空源
 * （空源不该在首页占一块位置）。
 */
import type { Subscription } from "@amoeba/core"

import type { SubFeed } from "../../store/selectors.ts"
import { HomeSection } from "./HomeSection.tsx"

export function HomeFeedRows({ feeds, onOpenSub }: { feeds: SubFeed[]; onOpenSub: (sub: Subscription) => void }) {
  if (feeds.length === 0) return null
  return (
    <HomeSection title="订阅更新">
      <div className="home-feed-list">
        {feeds.map(({ sub, items, unread }) => (
          <button key={sub.id} className="home-feed-row" onClick={() => onOpenSub(sub)} title={sub.title}>
            <span className="home-feed-source od-truncate">{sub.title}</span>
            <span className="home-feed-latest od-truncate">{items[0]?.title ?? ""}</span>
            {unread > 0 ? (
              <span className="home-feed-unread num" title={`${unread} 条未读`}>
                {unread}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </HomeSection>
  )
}
