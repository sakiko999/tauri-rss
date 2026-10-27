/**
 * NavRow / RailSection —— 侧栏导航的**功能件**(纯 props,不碰 store)。
 *
 * 抽出来的理由:Rail 里同一段「图标 + 单行标题 + 可选徽标」的 `<button className="nav-row">`
 * 重复了四遍(内容类型 / 智能订阅 / 模式 / 底部页面),只有数据源不同。
 *
 * ⚠️ 类名(`nav-row` / `nav-label` / `nav-count`)必须原样保留:它们是 styles.css 与
 * 折叠态规则(`.rail-collapsed` 与 `@media (max-width:1080px)` 两份清单)的选择器锚点。
 */
import { Icon } from "./Icon.tsx"
import { overlayBlock } from "../lib/uiOverlay.ts"

export function NavRow({
  icon,
  label,
  count,
  unread,
  dot,
  active,
  onClick,
}: {
  icon: string
  label: string
  /** 徽标数字;0 / undefined = 不显示(与旧实现 `n > 0 ? ... : null` 一致)。 */
  count?: number
  /** 徽标走「未读」强调色(`data-unread`)。 */
  unread?: boolean
  /**
   * 状态小圆点(「影音」有直播在播时用)。**独立槽位**,不塞进 count：
   * 数字徽标读作「有多少条」，圆点读作「此刻有动静」，两种语义混用会互相误导
   * （例如把 3 场直播显示成「3」→ 用户以为有 3 条未看视频）。
   */
  dot?: boolean
  active?: boolean
  onClick: () => void
}) {
  return (
    <button className="nav-row" aria-current={active ? "page" : undefined} onClick={onClick} title={label}>
      <Icon name={icon} />
      <span className="nav-label">{label}</span>
      {dot ? <span className="nav-dot" aria-hidden /> : null}
      {count && count > 0 ? (
        <span className="nav-count num" data-unread={unread ? "true" : undefined}>
          {count}
        </span>
      ) : null}
    </button>
  )
}

/** 侧栏分节(标题 + 若干行)。标题里可塞一个操作按钮(如「订阅」旁的管理分组)。 */
export function RailSection({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  const key = typeof title === "string" ? `rail-section:${title}` : undefined
  return (
    <section className="rail-section" {...overlayBlock("rail-section", key)}>
      <div className="rail-section-title">
        {title}
        {action}
      </div>
      {children}
    </section>
  )
}
