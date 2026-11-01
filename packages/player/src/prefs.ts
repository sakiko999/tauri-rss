/**
 * PlayerPrefs —— 播放偏好的全局持久化(P0a-3):音量 / 静音 / 倍速。
 *
 * 换条目、回播放页、视频⇄播客都不重置。**不进 core AppSettings schema**(播放器
 * 自有偏好,不污染数据层);存 localStorage(desktop/mobile WebView 都有)。
 *
 * 只记录**用户意图**:`ops.changeVolume/toggleMute/changeRate` 保存;元素事件
 * (自动起播被拦后的静音降级、引擎自设倍速)不保存 —— 否则一次 autoplay 降级
 * 会把「静音」写死进偏好。
 *
 * 读失败/损坏一律回落默认值(1 / 未静音 / 1×)。
 */

const KEY = "amoeba:player-prefs"

export interface PlayerPrefs {
  volume: number
  muted: boolean
  rate: number
}

const DEFAULTS: PlayerPrefs = { volume: 1, muted: false, rate: 1 }

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 无 localStorage 的宿主(隐私模式/受限环境)
  }
}

export function loadPlayerPrefs(): PlayerPrefs {
  const s = storage()
  if (!s) return { ...DEFAULTS }
  try {
    const raw = s.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const p = JSON.parse(raw) as Partial<PlayerPrefs>
    return {
      volume: typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULTS.volume,
      muted: typeof p.muted === "boolean" ? p.muted : DEFAULTS.muted,
      rate: typeof p.rate === "number" && p.rate >= 0.25 && p.rate <= 4 ? p.rate : DEFAULTS.rate,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify({ ...loadPlayerPrefs(), ...patch }))
  } catch {
    // 配额/隐私模式 — 偏好丢失可接受,不影响播放。
  }
}

/**
 * 把偏好应用到媒体元素(挂载时一次)。
 * 倍速只在**已确认点播**(有限时长)时应用;直播恒 1×。
 */
export function applyPlayerPrefs(el: HTMLMediaElement): void {
  const p = loadPlayerPrefs()
  try {
    el.volume = p.volume
    el.muted = p.muted
    if (Number.isFinite(el.duration) && el.duration > 0) el.playbackRate = p.rate
  } catch {
    // 个别元素状态(未就绪)会抛 — 忽略。
  }
}
