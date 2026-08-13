/**
 * 内联 JSON 提取 —— 从 HTML 的 JS 变量里取 JSON 对象。
 *
 * 各平台 SSR/全局变量把 JSON 内嵌进 script(`window.__INITIAL_STATE__ = {...}`、
 * `window.HNF_GLOBAL_INIT = {...}` 等)。**平衡括号截取**(页面嵌套深时非贪婪正则会
 * 截断;字符串内可能含 `{}` 需跳过)。RSSHub 同样自写 extractInitialState,无标准库。
 *
 * 清洗(clean)处理 JS 表达式:JSON.parse 前把 `undefined`/`new Map([])`/`function(){...}`
 * 等非 JSON 片段归一(RSSHub 只 replaceAll("undefined","null") 救不了 new Map)。
 */

/** 平衡括号:从 start 的 `{` 计数到归零,跳过字符串内括号与转义。找不到返回 -1。 */
function balancedJsonEnd(s: string, start: number): number {
  let depth = 0
  let inString = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 从 html 提取 marker 后的顶层 JSON 对象。
 * @param marker 定位标记(如 "window.__INITIAL_STATE__=" / "HNF_GLOBAL_INIT")
 * @param clean  可选清洗:parse 前处理非 JSON 片段
 * @param label  错误信息前缀(平台名)
 */
export function extractInlineJson(
  html: string,
  marker: string,
  clean?: (raw: string) => string,
  label = "inline JSON",
): Record<string, any> {
  const eq = html.indexOf(marker)
  if (eq < 0) throw new Error(`${label}: 未找到 ${marker}`)
  const start = html.indexOf("{", eq)
  if (start < 0) throw new Error(`${label}: ${marker} 块未找到`)
  const end = balancedJsonEnd(html, start)
  if (end < 0) throw new Error(`${label}: 括号不平衡`)
  let raw = html.slice(start, end + 1)
  if (clean) raw = clean(raw)
  try {
    return JSON.parse(raw) as Record<string, any>
  } catch {
    throw new Error(`${label}: JSON 解析失败`)
  }
}

/** 安全 parse:失败返回 null(不做平衡括号,只对已提取的片段)。 */
export function parseJsonSafe<T = Record<string, any>>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
