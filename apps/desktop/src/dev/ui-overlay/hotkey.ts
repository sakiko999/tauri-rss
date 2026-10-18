/**
 * 快捷键解析/匹配 —— 纯函数，供自检与安装逻辑共用。
 *
 * 默认 Ctrl+Shift+U。用 `code`（KeyU）而不是 `key` 匹配，避免 CapsLock/输入法
 * 影响大小写；同时兼容没有 code 的合成事件（回退到 key）。
 */

export const DEFAULT_HOTKEY = "Ctrl+Shift+U"

export interface HotkeySpec {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  /** KeyboardEvent.code 形态（KeyU / Digit1 / F1…）。 */
  code: string
  /** 回退匹配用（小写）。 */
  key: string
}

function keyTokenToCode(token: string): { code: string; key: string } {
  if (/^Key[A-Z]$/i.test(token)) {
    const k = token.slice(3).toUpperCase()
    return { code: `Key${k}`, key: k.toLowerCase() }
  }
  if (/^Digit[0-9]$/i.test(token)) {
    return { code: `Digit${token.slice(5)}`, key: token.slice(5) }
  }
  if (/^F([1-9]|1[0-2])$/i.test(token)) {
    return { code: token.toUpperCase(), key: token.toLowerCase() }
  }
  if (token.length === 1) {
    const k = token.toUpperCase()
    if (/[A-Z]/.test(k)) return { code: `Key${k}`, key: k.toLowerCase() }
    if (/[0-9]/.test(k)) return { code: `Digit${k}`, key: k }
  }
  return { code: token, key: token.toLowerCase() }
}

/** "Ctrl+Shift+U" / "Mod+Alt+KeyU" → 规格。至少需要一个非修饰键。 */
export function parseHotkey(input: string): HotkeySpec {
  const parts = input
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean)
  const spec: HotkeySpec = { ctrl: false, shift: false, alt: false, meta: false, code: "", key: "" }
  for (const p of parts) {
    const t = p.toLowerCase()
    if (t === "ctrl" || t === "control" || t === "mod") spec.ctrl = true
    else if (t === "shift") spec.shift = true
    else if (t === "alt" || t === "option") spec.alt = true
    else if (t === "meta" || t === "cmd" || t === "command" || t === "win") spec.meta = true
    else {
      const mapped = keyTokenToCode(p)
      spec.code = mapped.code
      spec.key = mapped.key
    }
  }
  if (!spec.code) return parseHotkey(DEFAULT_HOTKEY)
  return spec
}

/** 规格 → 展示文本（Ctrl/Shift/Alt/Meta + 主键）。 */
export function formatHotkey(spec: HotkeySpec): string {
  const parts: string[] = []
  if (spec.ctrl) parts.push("Ctrl")
  if (spec.shift) parts.push("Shift")
  if (spec.alt) parts.push("Alt")
  if (spec.meta) parts.push("Meta")
  if (spec.code.startsWith("Key")) parts.push(spec.code.slice(3))
  else if (spec.code.startsWith("Digit")) parts.push(spec.code.slice(5))
  else parts.push(spec.code)
  return parts.join("+")
}

/** 事件是否命中规格。修饰键要求**精确相等**，避免 Ctrl+Shift+U 被 Ctrl+U 抢。 */
export function matchHotkey(
  e: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "code" | "key">,
  spec: HotkeySpec,
): boolean {
  if (e.ctrlKey !== spec.ctrl || e.shiftKey !== spec.shift || e.altKey !== spec.alt || e.metaKey !== spec.meta) {
    return false
  }
  if (e.code) return e.code === spec.code
  return e.key.toLowerCase() === spec.key
}
