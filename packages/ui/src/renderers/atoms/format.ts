/**
 * format — 卡片共用格式化(时长 / 互动数)。
 * 从各 renderer 抽出,统一语义。时长:video 用 h 前缀,audio 用 mm:ss(调用侧选择)。
 */

/** 视频时长 `1:02:03` / `02:03`(小时存在才加)。 */
export function fmtDuration(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return ""
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 音频时长 `m:ss`(播客短时长,不显示小时)。 */
export function fmtAudioDuration(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return ""
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

/** 互动数缩写:1.2w / 3.4k / 890。 */
export function fmtCount(n?: number): string {
  if (n === undefined) return ""
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
