/**
 * 启动骨架 —— 应用入口到「有内容可显示」之间那段窗口的占位。
 *
 * 两处用同一个组件、同一套 `.bs-*` 类,叠在完全相同的位置,所以换手看不出来:
 *   1. **静态骨架**(index.html 的 `#boot-skeleton`)—— 从 HTML 首帧就在画。
 *      Vite 的 dev 脚本要 ~1.1s 才执行(main.tsx 实测),任何 JS 方案都补不上这段。
 *   2. **App 兜底**(App.tsx 的 `booting` → `.boot-overlay`)—— 静态骨架盖的是
 *      「还在加载」,这一层盖的是「库还没读到,视图画的是假信息」。
 *
 * 真正的侧栏栏体在 index.html 里就有(静态骨架自带),这里只需要主区。
 *
 * ⚠️ 类名与结构是跟 index.html 那份**一份契约**,改一处要改两处。
 * ⚠️ 布局字面量(52px 顶栏 / 268px 侧栏 / 自动填充网格)与 App 同源,改了 App 也要
 * 改 index.html。
 */
import { useMemo } from "react"

/**
 * 骨架条数。⚠️ 与 `apps/desktop/index.html` 里静态骨架的 `.bs-card` 数量**必须相等** ——
 * 两侧交接时条数一变就是一次跳变(曾 8 vs 12,肉眼可见)。
 */
const SKELETON_COUNT = 12

/**
 * 主区骨架。`mode` 与视图的内容形态对齐。
 *
 * ⚠️ 结构必须与 index.html 里 `.bs-main` 那份**一致**(先标题条、再网格),
 * 否则两者交接时卡片会整体上下跳一段(实测差 ~44px)。两处的类名与顺序是一份契约。
 */
export function GridSkeleton({ mode = "grid" }: { mode?: "grid" | "list" }) {
  // ⚠️ 一律 keyed:Virtuoso 家族靠它做测量缓存,重复 key 会让它算错高度。
  const cards = useMemo(() => Array.from({ length: SKELETON_COUNT }, (_, i) => i), [])
  return (
    <>
      <div className="bs-sec" style={{ paddingBottom: 8 }}>
        <span className="bs-bar bs-title" />
      </div>
      {mode === "list" ? (
        <div className="bs-list">
          {cards.map((i) => (
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
          {cards.map((i) => (
            <div key={i} className="bs-card" />
          ))}
        </div>
      )}
    </>
  )
}
