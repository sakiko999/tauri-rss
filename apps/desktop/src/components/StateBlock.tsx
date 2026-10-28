/**
 * StateBlock —— 空态 / 错误态的统一样式块。
 * 文案按**真实失败模式**给方向(未订阅 / 抓取失败 / 需登录 / 无搜索结果 / 离线),
 * 不只是「暂无数据」。
 */
import type { ReactNode } from "react"
import { Icon } from "./Icon.tsx"
import { overlayBlock } from "../lib/uiOverlay.ts"

export function StateBlock({
  icon = "layers",
  tone = "neutral",
  title,
  text,
  actions,
  tight,
}: {
  icon?: string
  tone?: "neutral" | "error" | "warn" | "ok"
  title: string
  text?: string
  actions?: ReactNode
  tight?: boolean
}) {
  return (
    <div
      className={`state-block${tight ? " state-block-tight" : ""}`}
      {...overlayBlock("state-block", `state:${title}`)}
    >
      <span
        className={`state-glyph${tone === "ok" ? " state-glyph-ok" : ""}`}
        data-tone={tone === "ok" ? undefined : tone}
      >
        <Icon name={icon} size={22} />
      </span>
      <p className="state-title">{title}</p>
      {text ? <p className="state-text">{text}</p> : null}
      {actions ? <div className="state-actions">{actions}</div> : null}
    </div>
  )
}

/** 键值信息行(账号页 / 诊断页)。 */
export function InfoRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-key">{k}</span>
      <span className="info-val">{children}</span>
    </div>
  )
}

/** 内联提示条。 */
export function Banner({
  tone = "info",
  title,
  children,
  icon = "info",
}: {
  tone?: "info" | "warn" | "error" | "ok"
  title?: string
  children?: ReactNode
  icon?: string
}) {
  return (
    <div className="banner" data-tone={tone === "info" ? undefined : tone}>
      <Icon name={icon} size={15} />
      <div className="banner-body">
        {title ? <span className="banner-title">{title}</span> : null}
        {children}
      </div>
    </div>
  )
}

/** 卡片壳(设置页 / 账号页的分组容器)。 */
export function SideCard({
  title,
  icon,
  children,
  pad,
  blockKey,
}: {
  title?: string
  icon?: string
  children: ReactNode
  pad?: boolean
  /** 标题含动态计数时传一个稳定键，避免 overlay 编号跟着计数跳。 */
  blockKey?: string
}) {
  const key = blockKey ?? (title ? `side-card:${title}` : undefined)
  return (
    <section className="side-card" {...overlayBlock("side-card", key)}>
      {title ? (
        <header className="side-card-head">
          {icon ? <Icon name={icon} size={15} /> : null}
          <span className="side-card-title">{title}</span>
        </header>
      ) : null}
      <div className={`side-card-body${pad ? " pad" : ""}`}>{children}</div>
    </section>
  )
}
