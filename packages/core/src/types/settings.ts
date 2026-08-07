/**
 * App settings — user preferences, persisted via a `SettingsRepository`.
 */
import { DEFAULT_BILIBILI_COOKIE } from "../bilibili-cookie.ts"

export type ViewMode = "reader" | "masonry" | "shortvideo"
export type ThemeMode = "light" | "dark" | "system"
export type Density = "comfortable" | "compact"

export interface AppSettings {
  viewMode: ViewMode
  theme: ThemeMode
  fontSize: number
  density: Density
  autoplayVideo: boolean
  /** 静音起播，用户交互后取消静音 */
  startMuted: boolean
  dataSaver: boolean
  refreshIntervalMin: number
  /**
   * bilibili 登录 cookie(浏览器复制的完整串,含 SESSDATA)。
   * 作 core 层默认:所有 bili 订阅(live/video)未显式配 cookie 时自动带上,
   * 解锁登录档位(非大会员 1080p/原画)。留空 = 零登录。
   */
  bilibiliCookie: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  viewMode: "reader",
  theme: "system",
  fontSize: 16,
  density: "comfortable",
  autoplayVideo: true,
  startMuted: true,
  dataSaver: false,
  refreshIntervalMin: 30,
  bilibiliCookie: DEFAULT_BILIBILI_COOKIE,
}
