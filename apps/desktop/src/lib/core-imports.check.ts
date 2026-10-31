/**
 * core 导入边界自检（desktop 首屏包体不变量）。
 *
 * 跑：`bun apps/desktop/src/lib/core-imports.check.ts`
 *
 * ⚠️ 为什么需要：core 根入口会求值 data-layer（静态拉进 crawler/resolve/xml，连带抖音
 * msdk 签名脚本）。desktop 是数据服务的远端客户端，用不到这些实现，但只要**一处值导入**
 * 根入口，打包器就把它们全塞进首屏包 —— 2026-11-01 实测 7 处值导入 + main.tsx 一条
 * 副作用导入让主包多了约 680KB（3.34MB 的 20%），tsc 与构建都不报错。
 *
 * 三层检查（只管静态 import/export；动态 `import()` 放行 —— data-source.ts 的浏览器 dev 分支要用）：
 *   A. desktop 源码：`@amoeba/core` 根入口只许类型导入；禁止 `@amoeba/core/source*` 静态导入；
 *   B. desktop 静态可达的 workspace 包（player/ui/service-client/service-protocol）：同 A；
 *   C. `packages/core/src/pure.ts` 的 re-export 闭包：只许零依赖相对模块 +
 *      `@amoeba/platform` + `@amoeba/resolve/errors`（pure 入口的纯度是本不变量的根）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("../", import.meta.url))
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".check.ts") && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/**
 * `import [type] <子句> from [注释] "<mod>"` / `export ... from ...`。
 * ⚠️ 不能要求 `from` 与模块串之间只有空白：`from /* 注释 *\/ "x"` 是合法 TS，bun fmt 也保留。
 */
const FROM =
  /^[ \t]*(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']([^"']+)["']/gm
/** 副作用导入 `import "<mod>"`。 */
const BARE = /^[ \t]*import\s*(?:\/\*[\s\S]*?\*\/\s*)*["']([^"']+)["']/gm

const isCore = (mod: string) => mod === "@amoeba/core" || mod.startsWith("@amoeba/core/")

/** `{ type A, type B }` 才算类型导入；`{}` 是**值导入**（空绑定仍会求值模块）。 */
function typeOnlyClause(clause: string): boolean {
  const c = clause.trim()
  if (!c.startsWith("{")) return false
  const specs = c
    .slice(1, -1)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return specs.length > 0 && specs.every((s) => s.startsWith("type "))
}

interface Violation {
  at: string
  what: string
}

function scanStaticImports(file: string): Array<{ mod: string; typeOnly: boolean; index: number }> {
  const src = readFileSync(file, "utf8")
  const out: Array<{ mod: string; typeOnly: boolean; index: number }> = []
  for (const m of src.matchAll(FROM)) {
    out.push({ mod: m[3] ?? "", typeOnly: !!m[1] || typeOnlyClause(m[2] ?? ""), index: m.index })
  }
  for (const m of src.matchAll(BARE)) out.push({ mod: m[1] ?? "", typeOnly: false, index: m.index })
  return out
}

function at(file: string, src?: string, index?: number): string {
  const base = relative(ROOT, file).replaceAll("\\", "/")
  if (src === undefined || index === undefined) return base
  return `${base}:${src.slice(0, index).split("\n").length}`
}

// ── A + B：值导入根入口 / 静态导入 source ───────────────────────────────────
const PACKAGES = ["packages/player", "packages/ui", "packages/service-client", "packages/service-protocol"]
const targets = [
  ...walk(SRC).filter((p) => !relative(ROOT, p).replaceAll("\\", "/").startsWith("apps/desktop/src/dev/")),
  ...PACKAGES.flatMap((p) => (existsSync(join(ROOT, p, "src")) ? walk(join(ROOT, p, "src")) : [])),
]
const bad: Violation[] = []
for (const file of targets) {
  const src = readFileSync(file, "utf8")
  for (const imp of scanStaticImports(file)) {
    if (!isCore(imp.mod) || imp.typeOnly) continue
    if (imp.mod === "@amoeba/core" || imp.mod.startsWith("@amoeba/core/source")) {
      bad.push({ at: at(file, src, imp.index), what: `值导入 ${imp.mod}` })
    }
  }
}

// ── C：pure.ts 的 re-export 闭包只许零依赖模块 ──────────────────────────────
const PURE = join(ROOT, "packages/core/src/pure.ts")
const PURE_ALLOWED = new Set(["@amoeba/platform", "@amoeba/resolve/errors"])
const seen = new Set<string>()
const queue = [PURE]
while (queue.length) {
  const file = queue.pop()!
  if (seen.has(file) || !existsSync(file)) continue
  seen.add(file)
  const src = readFileSync(file, "utf8")
  for (const imp of scanStaticImports(file)) {
    if (!imp.mod.startsWith(".")) {
      if (!PURE_ALLOWED.has(imp.mod)) bad.push({ at: at(file, src, imp.index), what: `pure 闭包引入了 ${imp.mod}` })
      continue
    }
    const next = resolve(dirname(file), imp.mod)
    if (next.endsWith(".ts")) queue.push(next)
    else if (existsSync(`${next}.ts`)) queue.push(`${next}.ts`)
    else if (existsSync(join(next, "index.ts"))) queue.push(join(next, "index.ts"))
  }
}
if (!seen.has(PURE)) bad.push({ at: PURE, what: "找不到 pure.ts（检查失效，先修这个）" })

if (bad.length) {
  for (const b of bad) console.error(`✘ ${b.at}  ${b.what}`)
  console.error("  修法：类型改 `import type`；纯函数/常量改从 `@amoeba/core/pure` 导入（缺的往 core/src/pure.ts 加，")
  console.error("  该文件及其相对闭包只许 re-export 零依赖模块 + @amoeba/platform + @amoeba/resolve/errors）；")
  console.error("  source 注册只放在跑进程内 DataLayer 的入口。")
  process.exit(1)
}
console.log(`✔ core 导入边界自检通过（${targets.length} 个源文件 + pure 闭包 ${seen.size} 个模块）`)
