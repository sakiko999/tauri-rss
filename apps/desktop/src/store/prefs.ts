/**
 * prefs —— 表现型偏好的本地存储与「应用到 <html>」。
 *
 * 为什么与 core settings 分开:主题/密度/字号必须**同步**可读(首帧脚本在 index.html
 * 里就要定主题,而 core 的 settings 走异步 SQLite,物理上读不到)。功能型设置
 * (刷新间隔/cookie/自动播放等)仍在 core `dl.settings`。
 *
 * 存储 key 与首帧脚本(index.html)`ui-prefs` 共用,勿改。
 */
import { create } from "zustand"

export type ThemeMode = "light" | "dark" | "system"
export type Density = "relaxed" | "standard" | "compact"
export type Motion = "off" | "standard" | "rich"
export type Measure = "narrow" | "comfortable" | "wide"

export interface Prefs {
  theme: ThemeMode
  density: Density
  motion: Motion
  measure: Measure
  /** 正文字号 px(详情页 --article-fs)。 */
  fontSize: number
  /** 侧栏折叠。 */
  railCollapsed: boolean
  /** 首次引导是否完成。 */
  onboarded: boolean
}

const STORAGE_KEY = "ui-prefs"

export const DEFAULT_PREFS: Prefs = {
  theme: "dark",
  density: "standard",
  motion: "standard",
  measure: "comfortable",
  fontSize: 17,
  railCollapsed: false,
  onboarded: false,
}

function load(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFS
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    return DEFAULT_PREFS
  }
}

/** 解析 system 主题为实际值。 */
function resolveTheme(t: ThemeMode): "light" | "dark" {
  if (t !== "system") return t
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
  } catch {
    return "dark"
  }
}

/** 把偏好写到 <html> 的 data-* 与 --article-fs(首帧脚本同样逻辑)。 */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(p.theme)
  root.dataset.density = p.density
  root.dataset.motion = p.motion
  root.dataset.measure = p.measure
  root.style.setProperty("--article-fs", `${p.fontSize}px`)
}

interface PrefsState extends Prefs {
  set(patch: Partial<Prefs>): void
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...load(),
  set(patch) {
    const next = { ...get(), ...patch }
    set(patch)
    applyPrefs(next)
    try {
      // 只写 Prefs 字段(不把 set 函数写进去)。
      const { set: _drop, ...persisted } = next
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      /* 持久化失败不影响当前会话 */
    }
  },
}))

// 模块加载即应用一次(React 挂载前就位,避免首帧后又跳一下)。
applyPrefs(usePrefs.getState())

// 「跟随系统」时监听 OS 明暗切换:resolveTheme 只在 applyPrefs 里取一次快照,
// 不监听的话系统切了主题要重载应用才生效。
try {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    const s = usePrefs.getState()
    if (s.theme === "system") applyPrefs(s)
  })
} catch {
  /* 不支持 matchMedia 的环境忽略 */
}
