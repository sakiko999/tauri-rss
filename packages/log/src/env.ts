/** env — 环境检测 + 开关解析。 */

/** 是否浏览器/WebView(用 %c CSS 着色);否则视为终端(用 ANSI)。bun/node 下 window 为 undefined。 */
export function isBrowser(): boolean {
  return typeof window !== "undefined"
}

/**
 * 开关解析:返回 "0"(关) | "1"(开) | undefined(未设置,视为开)。
 * 优先级:per-domain `log:<name>` > legacy `<legacyKey>` > 全局 `log`。
 * localStorage 不可用(终端)或抛异常(隐私模式)→ undefined。
 */
export function readSwitch(name: string, legacyKey?: string): "0" | "1" | undefined {
  try {
    const ls = globalThis.localStorage
    if (!ls) return undefined
    const per = ls.getItem(`log:${name}`)
    if (per === "0" || per === "1") return per
    if (legacyKey) {
      const legacy = ls.getItem(legacyKey)
      if (legacy === "0" || legacy === "1") return legacy
    }
    const g = ls.getItem("log")
    return g === "0" || g === "1" ? g : undefined
  } catch {
    return undefined
  }
}
