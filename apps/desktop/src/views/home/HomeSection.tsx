/**
 * HomeSection —— 首页区块的标题行（纯 props 功能件）。
 *
 * 首页五个区块的标题排版完全同构（标题 + 可选副标），抄五遍只会各自漂移。
 * 只做「标题 + 说明」，不包滚动：每个区块自己决定是网格、横轨还是行列表。
 */
import type { ReactNode } from "react"

export function HomeSection({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="home-sec">
      <header className="home-sec-head">
        <h2 className="home-sec-title">{title}</h2>
        {sub ? <span className="home-sec-sub num">{sub}</span> : null}
      </header>
      {children}
    </section>
  )
}
