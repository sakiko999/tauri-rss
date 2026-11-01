/**
 * 秒 → `mm:ss` / `h:mm:ss`(补零,对齐 B 站 `01:00 / 02:10`、直播 `407:26:23`)。
 * 非有限值/负数 → `00:00`。
 */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00"
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
