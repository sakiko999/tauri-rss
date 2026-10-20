/**
 * 二级订阅预览骨架(`MediaMain` 的 `?open=` 加载态)。
 *
 * ⚠️ **不复用 `GridSkeleton`**:那个组件自带一条 `.bs-sec` 标题占位条,而预览页已经
 * 有**真实表头**(`PreviewHead`:封面/标题/订阅按钮)—— 再画一根标题占位会重复,
 * 且高度与真实表头对不上,加载完成时内容整体跳一下。
 * 本组件只画内容区,形态与落地内容一致:播客单集 = 行列表,分区目录 = 网格。
 *
 * 类名复用 `.bs-*`(纯装饰样式,无结构契约);条数独立于启动骨架(index.html 契约)。
 */
import { useMemo } from "react"

const ROWS = 8
const CARDS = 9

export function PreviewSkeleton({ mode = "grid" }: { mode?: "grid" | "list" }) {
  const items = useMemo(
    () => Array.from({ length: mode === "list" ? ROWS : CARDS }, (_, i) => i),
    [mode],
  )
  return mode === "list" ? (
    <div className="bs-list">
      {items.map((i) => (
        <div key={i} className="bs-row">
          <span className="bs-bar bs-thumb" />
          <span className="bs-row-lines">
            <span className="bs-bar" style={{ width: "92%" }} />
            <span className="bs-bar" style={{ width: "64%", height: 12 }} />
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="bs-grid">
      {items.map((i) => (
        <div key={i} className="bs-card" />
      ))}
    </div>
  )
}
