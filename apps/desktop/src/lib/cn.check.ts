/**
 * cn（tailwind-merge 扩展配置）自检。
 *
 * 跑：`bun apps/desktop/src/lib/cn.check.ts`
 *
 * ⚠️ 为什么需要：tailwind-merge 只认默认主题，`@theme` 自定义令牌不登记时它按前缀猜
 * 分组 —— `text-ui` 被当成颜色，与 `text-foreground` 互相覆盖。tsc 与构建都不报错，
 * 只表现为按钮字号/文字色悄悄不对（2026-11-01：首页「阅读」按钮白字压橙底）。
 * 这里按 10-tokens.css 的真实令牌反查，新增令牌忘了登记 `TW_THEME_EXTEND` 直接失败。
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { Button, IconButton } from "../components/Button.tsx"
import { cn } from "./cn.ts"

// ── 1. 每个自定义令牌：与同组默认类互相覆盖；与同前缀的异组类共存 ──────────────
const tokens = readFileSync(new URL("../styles/10-tokens.css", import.meta.url), "utf8")

/** 命名空间 → 工具类前缀 + 同组默认类（应被覆盖）+ 同前缀异组类（应共存）。 */
const GROUPS: Record<string, { prefix: string; same: string; other?: string }> = {
  text: { prefix: "text-", same: "text-sm", other: "text-foreground" },
  spacing: { prefix: "h-", same: "h-4" },
  "font-weight": { prefix: "font-", same: "font-bold", other: "font-mono" },
  shadow: { prefix: "shadow-", same: "shadow-sm", other: "shadow-black" },
  ease: { prefix: "ease-", same: "ease-linear" },
  animate: { prefix: "animate-", same: "animate-spin" },
  radius: { prefix: "rounded-", same: "rounded-none" },
}

const found = new Set<string>()
for (const m of tokens.matchAll(
  /^\s*--(text|spacing|font-weight|shadow|ease|animate|radius)-([a-z0-9][a-z0-9-]*)\s*:/gm,
)) {
  const [, ns, name] = m
  if (!ns || !name || name.includes("--")) continue // `--text-ui--line-height` 这类子属性不是独立令牌
  found.add(`${ns}:${name}`)
}
assert.ok(
  found.has("text:ui") && found.has("spacing:control"),
  "没从 10-tokens.css 解析到 text-ui / spacing-control —— 解析失效",
)

for (const key of found) {
  const [ns, name] = key.split(":") as [string, string]
  const g = GROUPS[ns]!
  const util = `${g.prefix}${name}`
  const hint = `（--${ns}-${name}：去 lib/cn.ts 的 TW_THEME_EXTEND.${ns} 登记 "${name}"）`
  assert.equal(cn(g.same, util), util, `${util} 应覆盖同组的 ${g.same}${hint}`)
  assert.equal(cn(util, g.same), g.same, `${g.same} 应覆盖同组的 ${util}${hint}`)
  if (g.other) assert.equal(cn(util, g.other), `${util} ${g.other}`, `${util} 与 ${g.other} 不同组，应共存${hint}`)
}

// ── 2. 真实组件输出：字号/高度/文字色三者都在（原 bug 的直接回归）───────────────
const classes = (el: unknown): string[] => (el as { props: { className: string } }).props.className.split(/\s+/)
const TEXT_COLOR = {
  primary: "text-primary-foreground",
  secondary: "text-foreground",
  quiet: "text-muted-foreground",
  danger: "text-destructive",
} as const
for (const variant of Object.keys(TEXT_COLOR) as Array<keyof typeof TEXT_COLOR>) {
  for (const size of ["md", "sm"] as const) {
    const c = classes(Button({ variant, size }))
    const label = `Button ${variant}/${size}`
    const [fs, h, hOther] =
      size === "sm" ? ["text-ui-sm", "h-control-sm", "h-control"] : ["text-ui", "h-control", "h-control-sm"]
    assert.ok(c.includes(fs), `${label} 丢了字号 ${fs}：${c.join(" ")}`)
    assert.ok(c.includes(h) && !c.includes(hOther), `${label} 高度类不对：${c.join(" ")}`)
    assert.ok(c.includes(TEXT_COLOR[variant]), `${label} 丢了文字色 ${TEXT_COLOR[variant]}：${c.join(" ")}`)
    assert.ok(c.includes("font-ui"), `${label} 丢了字重 font-ui：${c.join(" ")}`)
  }
}
const overridden = classes(Button({ className: "h-8 text-sm" }))
assert.ok(overridden.includes("h-8") && !overridden.includes("h-control"), "调用方 h-8 应覆盖 h-control")
assert.ok(overridden.includes("text-sm") && !overridden.includes("text-ui"), "调用方 text-sm 应覆盖 text-ui")
const iconSm = classes(IconButton({ size: "sm" }))
assert.ok(
  iconSm.includes("size-control-sm") && !iconSm.includes("size-control"),
  `IconButton sm 尺寸类不对：${iconSm.join(" ")}`,
)

console.log(`✔ cn 自检通过（${found.size} 个自定义令牌按组合并 + Button 4 变体 × 2 尺寸 + IconButton）`)
