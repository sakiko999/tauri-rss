/**
 * RelativeTime — 相对/今日时间(原生 Date,零依赖)。
 * 今日 → HH:mm(桌面阅读器看「几点发的」);非今日 → M月D日。跨年 → 含年份。
 * 与 desktop ArticleList.fmtTime 语义一致(抽到 ui 包共享,mobile 也能用)。
 */
export function RelativeTime({ ts, className }: { ts?: number; className?: string }) {
  if (!ts || !Number.isFinite(ts)) return null
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const sameYear = d.getFullYear() === now.getFullYear()

  let text: string
  if (sameDay) {
    text = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
  } else if (sameYear) {
    text = `${d.getMonth() + 1}月${d.getDate()}日`
  } else {
    text = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }
  return <span className={className}>{text}</span>
}
