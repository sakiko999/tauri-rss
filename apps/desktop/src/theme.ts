/**
 * useTheme — 明暗主题切换(无第三方依赖)。
 *
 * styles.css 的 `@custom-variant dark (&:where(.dark, .dark *))` 跟随 <html>.dark class。
 * 持久化到 localStorage("theme" key);默认 light。Tauri/浏览器通用。
 */
import { useCallback, useEffect, useState } from "react"

type Theme = "light" | "dark"

const STORAGE_KEY = "tauri-rss:theme"

function readInitial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark") return saved
  } catch {
    /* localStorage 不可用时默认 light */
  }
  return "light"
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readInitial)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* 忽略持久化失败 */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), [])

  return { theme, toggle }
}
