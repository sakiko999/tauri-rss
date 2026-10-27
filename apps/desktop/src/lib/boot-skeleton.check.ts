/**
 * 骨架屏与真实侧栏的**宽度契约**自检。
 *
 * 跑:`bun apps/desktop/src/lib/boot-skeleton.check.ts`
 *
 * ⚠️ 为什么需要:骨架 CSS(`public/boot-skeleton.css`)在 Vite 产物加载**之前**就要
 * 生效,所以它**读不到** styles/ 里的 `--rail` 变量 —— 三个宽度值只能手抄一份。
 * 抄错/改了真实值忘了同步的表现是「启动时侧栏先宽后窄跳一下」,而且**只在冷启动
 * 第一帧可见**,平时开发根本看不到(用户为此报过三次)。
 *
 * 这条自检把「两份字面量必须相等」钉死:它读**真实源码文本**比对,不跑浏览器。
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8")

const skeleton = read("../../public/boot-skeleton.css")
const tokens = read("../styles/10-tokens.css")
const responsive = read("../styles/90-responsive.css")

/** 取 CSS 里某个声明块内的 `--rail` / `width` 值。 */
const railVar = (css: string): string | undefined => css.match(/--rail:\s*([^;]+);/)?.[1]?.trim()
const bsRailWidth = (css: string, at?: RegExp): string | undefined => {
  // 有 `at` 时只在匹配到的片段里找 .bs-rail 的 width(用来区分基础/折叠/窄窗三份)。
  const scope = at ? css.split(at)[1] ?? "" : css
  return scope.match(/\.bs-rail\s*\{\s*width:\s*([^;]+);/)?.[1]?.trim()
}

// ── 1. 展开态:骨架 268px vs 真实 --rail ─────────────────────────────────
const realRail = railVar(tokens)
assert.equal(realRail, "268px", `真实侧栏宽度变了(${realRail})——记得同步改 boot-skeleton.css 的 .bs-rail`)
assert.equal(
  bsRailWidth(skeleton),
  realRail,
  `骨架侧栏宽度(${bsRailWidth(skeleton)})与真实 --rail(${realRail})不一致 —— 启动会跳一下`,
)

// ── 2. 折叠态:骨架 64px vs 真实(窄窗那档 --rail:64px)──────────────────
// ⚠️ 不能 `split('html[data-prefs~="rail-collapsed"]')` —— 那一串在**上面的注释里**
// 也出现过,split 会切在注释处、取不到规则块。直接匹配「该选择器紧跟 .bs-rail{width}」。
const bsCollapsed = skeleton
  .match(/html\[data-prefs~="rail-collapsed"\]\s*\.bs-rail\s*\{\s*width:\s*([^;]+);/)?.[1]
  ?.trim()
assert.equal(bsCollapsed, "64px", `骨架折叠宽度应为 64px,实际 ${bsCollapsed}`)

// ── 3. 窄窗断点必须同为 1080px,且窄窗下的 --rail 也是 64px ──────────────
const narrowRail = (responsive.split("@media (max-width: 1080px)")[1] ?? "").match(/--rail:\s*([^;]+);/)?.[1]?.trim()
assert.equal(narrowRail, bsCollapsed, `窄窗 --rail(${narrowRail})与骨架折叠宽度(${bsCollapsed})不一致`)
const bsBreakpoint = skeleton.match(/@media \(max-width:\s*(\d+)px\)\s*\{\s*\.bs-rail/)?.[1]
assert.equal(bsBreakpoint, "1080", `骨架的窄窗断点(${bsBreakpoint})与真实断点(1080)不一致`)

// ── 4. 顶栏高度:骨架 .bs-topbar vs 真实 --header-h ───────────────────────
// 合流改版会把顶栏收进主列并把高度改到 64px。改 token 时若漏改骨架,首帧顶栏会跳。
const headerVar = tokens.match(/--header-h:\s*([^;]+);/)?.[1]?.trim()
const bsHeader = skeleton.match(/\.bs-topbar\s*\{[^}]*?height:\s*([^;]+);/)?.[1]?.trim()
assert.equal(headerVar, "52px", `真实顶栏高度变了(${headerVar})——记得同步改 boot-skeleton.css 的 .bs-topbar`)
assert.equal(bsHeader, headerVar, `骨架顶栏高度(${bsHeader})与真实 --header-h(${headerVar})不一致 —— 启动会跳一下`)

// ── 5. 调色板:骨架的 --bs-* 字面量必须与 10-tokens 的主题值相等 ──────────
// 骨架读不到主题令牌(见文件头),只能手抄;本轮换配色时曾漏抄一次,冷启动会看到
// 旧的暖灰渐变在换色后跳一下。映射:bs-surface←surface-1、bs-muted←surface-2、
// bs-line←surface-3、bs-bg←bg。
const oklchArg = (css: string, name: string): string | undefined =>
  css.match(new RegExp(`${name}:\\s*oklch\\(([^)]+)\\)`))?.[1]?.trim()
const skelDark = skeleton.split('[data-theme="light"]')[0] ?? ""
const skelLight = (skeleton.split('[data-theme="light"]')[1] ?? "").split("html:not([data-theme])")[0] ?? ""
const tokDark = tokens.split('[data-theme="light"]')[0] ?? ""
const tokLight = tokens.split('[data-theme="light"]')[1] ?? ""
const PAIRS: Array<[string, string]> = [
  ["--bs-surface", "--surface-1"],
  ["--bs-muted", "--surface-2"],
  ["--bs-line", "--surface-3"],
  ["--bs-bg", "--bg"],
]
for (const [bs, tok] of PAIRS) {
  assert.equal(
    oklchArg(skelDark, bs),
    oklchArg(tokDark, tok),
    `${bs}(深色)与 ${tok} 不一致 —— 启动骨架会与真实主题不同色`,
  )
  assert.equal(
    oklchArg(skelLight, bs),
    oklchArg(tokLight, tok),
    `${bs}(浅色)与 ${tok} 不一致 —— 启动骨架会与真实主题不同色`,
  )
}
// `html:not([data-theme])` 那条兜底:浅支 = 浅色值,深支 = 深色值。
// ⚠️ 按「选择器 + {」切,不能按裸选择器切 —— 那份选择器在注释里也出现过,
// split 会切在注释处,取到的是 light 块而不是兜底块。
const noTheme = skeleton.split(/html:not\(\[data-theme\]\)\s*\{/)[1] ?? ""
for (const [bs, tok] of PAIRS) {
  const pair = noTheme.match(new RegExp(`${bs}:\\s*light-dark\\(oklch\\(([^)]+)\\),\\s*oklch\\(([^)]+)\\)\\)`))
  assert.equal(pair?.[1]?.trim(), oklchArg(tokLight, tok), `${bs} 的 light-dark 浅支与浅色 ${tok} 不一致`)
  assert.equal(pair?.[2]?.trim(), oklchArg(tokDark, tok), `${bs} 的 light-dark 深支与深色 ${tok} 不一致`)
}

console.log("✔ 骨架/侧栏/顶栏契约自检通过(展开 268 / 折叠 64 / 断点 1080 / 顶栏 52 / 两套配色八值一致)")
