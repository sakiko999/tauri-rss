/**
 * App settings — user preferences, persisted via a `SettingsRepository`.
 */
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
}
