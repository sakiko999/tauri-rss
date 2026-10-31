/**
 * desktop → `@amoeba/core` 导入边界自检。
 *
 * 跑：`bun apps/desktop/src/lib/core-imports.check.ts`
 *
 * ⚠️ 为什么需要：core 根入口会求值 data-layer（静态拉进 crawler/resolve/xml，连带抖音
 * msdk 签名脚本）。desktop 是数据服务的远端客户端，用不到这些实现，但只要**一处值导入**
 * 根入口，打包器就把它们全塞进首屏包 —— 2026-11-01 实测 7 处值导入 + main.tsx 一条
 * 副作用导入让主包多了约 680KB（3.34MB 的 20%），tsc 与构建都不报错。
 *
 * 规则（只管静态 import/export；动态 `import()` 放行 —— data-source.ts 的浏览器 dev 分支要用）：
 *   - `@amoeba/core` 根入口：只许 `import type`，或花括号里每个说明符都带 `type`；
 *   - `@amoeba/core/source*`：禁止静态导入（副作用注册只属于跑进程内 DataLayer 的入口）；
 *   - 值导入走 `@amoeba/core/pure`（以及 media-store / reading 等纯子路径）。
 */

import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
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

/** `import [type] <子句> from "<mod>"` / `export [type] <子句> from "<mod>"`（子句可跨行）。 */
const FROM =
  /^[ \t]*(?:import|export)\s+(type\s+)?(\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s*from\s*["']([^"']+)["']/gm
/** 副作用导入 `import "<mod>"`。 */
const BARE = /^[ \t]*import\s*["']([^"']+)["']/gm

const isCore = (mod: string) => mod === "@amoeba/core" || mod.startsWith("@amoeba/core/")
const typeOnlyBraces = (clause: string) =>
  clause.startsWith("{") &&
  clause
    .slice(1, -1)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .every((s) => s.startsWith("type "))

const bad: string[] = []
for (const file of walk(SRC)) {
  const src = readFileSync(file, "utf8")
  const at = (i: number) => `${relative(ROOT, file).replaceAll("\\", "/")}:${src.slice(0, i).split("\n").length}`
  for (const m of src.matchAll(FROM)) {
    const [, typeKw, clause = "", mod = ""] = m
    if (!isCore(mod) || typeKw) continue
    if (mod === "@amoeba/core" && typeOnlyBraces(clause)) continue
    if (mod === "@amoeba/core" || mod.startsWith("@amoeba/core/source")) bad.push(`${at(m.index)}  值导入 ${mod}`)
  }
  for (const m of src.matchAll(BARE)) {
    const mod = m[1] ?? ""
    if (mod === "@amoeba/core" || mod.startsWith("@amoeba/core/source")) bad.push(`${at(m.index)}  副作用导入 ${mod}`)
  }
}

if (bad.length) {
  for (const b of bad) console.error(`✘ ${b}`)
  console.error("  修法：类型改 `import type`；纯函数/常量改从 `@amoeba/core/pure` 导入（缺的往 core/src/pure.ts 加，")
  console.error("  只许 re-export 零依赖模块）；source 注册只放在跑进程内 DataLayer 的入口。")
  process.exit(1)
}
console.log("✔ desktop → core 导入边界自检通过（根入口仅类型，无 source 静态导入）")
