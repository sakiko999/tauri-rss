/**
 * 「TS/TSX 里用到的语义类必须在 CSS 里有定义」自检。
 *
 * 跑：`bun apps/desktop/src/lib/css-classes.check.ts`
 *
 * ⚠️ 为什么需要：类名写错、或 CSS 删了而 TSX 没跟着改，tsc 与构建都不报错，元素只是
 * 悄悄没样式 —— 2026-11-01 一次查出 5 处：`.btn` 迁到 CVA 后 BoardList / LibraryPage 的
 * 按钮渲染成纯文字，`.sk-line` 无定义让骨架零高，`.err-text` 让「抓取失败」不着色。
 *
 * 判定（只抓「看起来是语义类」的 token，宁漏不误报）：
 *   - 取 `*className=` 的字面量 / 表达式里的字符串、`cn()` / `clsx()` 的字符串参数；
 *     模板字符串里紧贴 `${}` 的半截 token 跳过，`=== "x"` 这类比较值跳过；
 *   - 带 `: [ / ! @ .` 等的是变体/任意值工具类，跳过；
 *   - tailwind-merge（与 cn 同一份扩展配置）认得的是工具类，跳过；
 *   - 剩下的必须在 CSS（desktop styles/ 与 public/、index.html 的 <style>、
 *     packages/player|ui 的 tailwind.css）里以 `.类名` 出现，或由 `@utility` 定义。
 * 已知上限：颜色类前缀（text-/bg-/border-…）在 tailwind-merge 里是「任意值」，撞这些
 * 前缀的语义类会被当工具类放过；运行时拼出来的类名（变量、函数返回值）扫不到。
 * apps/desktop/src/dev/ 自带注入样式（ui-overlay），不扫。
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { cn } from "./cn.ts"

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))
const rel = (p: string): string => relative(ROOT, p).replaceAll("\\", "/")

/** 有意不在 CSS 定义的类（如纯 JS 钩子）。每条写原因；过期条目会报错。 */
const ALLOW: Record<string, string> = {}

function walk(dir: string, accept: (p: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, accept, out)
    } else if (accept(p)) out.push(p)
  }
  return out
}

// ── 1. CSS 里定义过的类 ────────────────────────────────────────────────────
const isCss = (p: string) => p.endsWith(".css")
const cssTexts = [
  ...walk(join(ROOT, "apps/desktop/src"), isCss),
  ...walk(join(ROOT, "apps/desktop/public"), isCss),
  ...walk(join(ROOT, "packages/player/src"), isCss),
  ...walk(join(ROOT, "packages/ui/src"), isCss),
].map((f) => readFileSync(f, "utf8"))
const html = readFileSync(join(ROOT, "apps/desktop/index.html"), "utf8")
for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) cssTexts.push(m[1] ?? "")

const defined = new Set<string>()
for (const raw of cssTexts) {
  const css = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replace(/url\([^)]*\)/g, "")
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]!)
  for (const m of css.matchAll(/@utility\s+([\w-]+)/g)) defined.add(m[1]!)
}

// ── 2. TS/TSX 里的类名 token ───────────────────────────────────────────────
type OnString = (s: string, start: number, end: number) => void
const HOLE = "\u0000" // 模板字符串里 `${…}` 的占位：紧贴它的 token 是半截类名

/** 读 src[i] 处的字符串/模板字面量，回调内容，返回结束位置（含收尾引号之后）。 */
function readString(src: string, i: number, onString: OnString): number {
  const q = src[i]!
  let j = i + 1
  let s = ""
  while (j < src.length && src[j] !== q) {
    if (src[j] === "\\") {
      s += src[j + 1] ?? ""
      j += 2
    } else if (q === "`" && src[j] === "$" && src[j + 1] === "{") {
      s += HOLE
      j = scan(src, j + 2, "}", onString) + 1
    } else {
      s += src[j]
      j += 1
    }
  }
  onString(s, i, j + 1)
  return j + 1
}

/** 从 i 扫到同层的 close（返回其下标），途中收集所有字符串字面量。 */
function scan(src: string, i: number, close: string, onString: OnString): number {
  let depth = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === '"' || c === "'" || c === "`") {
      i = readString(src, i, onString)
      continue
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i)
      i = nl < 0 ? src.length : nl
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if ("([{".includes(c)) depth += 1
    else if (")]}".includes(c)) {
      if (depth === 0 && c === close) return i
      depth -= 1
    }
    i += 1
  }
  return i
}

/** `x === "grid"` / `"grid" !== x` 里的字符串是比较值，不是类名。 */
function isComparison(src: string, start: number, end: number): boolean {
  const before = src.slice(Math.max(0, start - 5), start).trimEnd()
  const after = src.slice(end, end + 5).trimStart()
  return /[=!]=$/.test(before) || /^[=!]=/.test(after)
}

interface Use {
  token: string
  at: string
}
const uses: Use[] = []
const isSource = (p: string) => /\.tsx?$/.test(p) && !p.endsWith(".check.ts") && !p.endsWith(".d.ts")
const tsFiles = [
  ...walk(join(ROOT, "apps/desktop/src"), (p) => isSource(p) && !rel(p).startsWith("apps/desktop/src/dev/")),
  ...walk(join(ROOT, "packages/player/src"), isSource),
  ...walk(join(ROOT, "packages/ui/src"), isSource),
]
for (const file of tsFiles) {
  const src = readFileSync(file, "utf8")
  const onString: OnString = (s, start, end) => {
    if (isComparison(src, start, end)) return
    const line = src.slice(0, start).split("\n").length
    for (const token of s.split(/\s+/)) {
      if (token && !token.includes(HOLE)) uses.push({ token, at: `${rel(file)}:${line}` })
    }
  }
  for (const m of src.matchAll(/\b\w*[cC]lassName\s*=\s*(?=["'`{])/g)) {
    const i = m.index + m[0].length
    if (src[i] === "{") scan(src, i + 1, "}", onString)
    else readString(src, i, onString)
  }
  for (const m of src.matchAll(/\b(?:cn|clsx)\(/g)) scan(src, m.index + m[0].length, ")", onString)
  // cva(...) 的 base/variants 都是类名字符串（Button/IconButton 的唯一样式源）。
  // 单标识符（"primary"/"md" 这类变体名，以及 defaultVariants 的值）不是类名，跳过；
  // 已知上限：cva 里单独一个不带连字符的工具类（"flex"）也在此被跳过。
  for (const m of src.matchAll(/\bcva\(/g)) {
    scan(src, m.index + m[0].length, ")", (s, start, end) => {
      if (!/[\s-]/.test(s.trim())) return
      onString(s, start, end)
    })
  }
}

// ── 3. 判定 ────────────────────────────────────────────────────────────────
const CLASS_LIKE = /^-?[a-zA-Z_][\w-]*$/ // 带 : [ / ! @ . 等的变体/任意值工具类、中文文案都不匹配
/** Tailwind 的标记类：本身不出 CSS，只给 `group-hover:` / `peer-checked:` 这类变体当锚点。 */
const TW_MARKERS = new Set(["group", "peer"])
const isUtility = (t: string): boolean => TW_MARKERS.has(t) || cn(t, t) === t // tailwind-merge 只对认得的类去重

const missing = new Map<string, Set<string>>()
const seen = new Set<string>()
for (const { token, at } of uses) {
  if (!CLASS_LIKE.test(token)) continue
  seen.add(token)
  if (defined.has(token) || token in ALLOW || isUtility(token)) continue
  if (!missing.has(token)) missing.set(token, new Set())
  missing.get(token)!.add(at)
}

const stale = Object.keys(ALLOW).filter((t) => defined.has(t) || !seen.has(t))

if (missing.size || stale.length) {
  for (const [token, ats] of missing) console.error(`✘ .${token} 没有 CSS 定义：${[...ats].join(", ")}`)
  for (const t of stale) console.error(`✘ 白名单 ALLOW["${t}"] 已过期（已有定义或不再使用），删掉它`)
  console.error("  修法：补 CSS 定义 / 改用已有类或工具类 / 删掉死类；确属 JS 钩子再进 ALLOW 并写原因。")
  process.exit(1)
}
console.log(`✔ 类名定义自检通过（${tsFiles.length} 个源文件、${seen.size} 个类名 token，CSS 定义 ${defined.size} 个）`)
