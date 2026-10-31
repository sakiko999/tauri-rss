#!/usr/bin/env bun
/**
 * Radix 边界自检（契约层）—— `bun scripts/radix-boundary.check.ts`
 *
 * 规则：
 *   1. 禁止 import 聚合包**根入口** `radix-ui`（按需子路径 `radix-ui/dialog`，子路径只是
 *      re-export，运行时图与独立包一致；根入口依赖 DCE 质量）。
 *   2. 禁止再引独立包 `@radix-ui/react-*`（desktop/player 已统一到 `radix-ui@1.8.1`；
 *      两处分版本会出现两份 popper/菜单实例、行为漂移）。
 *   3. `radix-ui/<primitive>` 只许出现在封装层：`apps/desktop/src/components/ui/**`、
 *      `packages/player/src/ui/**`，外加迁移完成前的临时白名单（下面 WHITELIST）。
 *      业务组件只能 import 本仓封装 —— 否则半年后又散落成一套手写浮层。
 *
 * 白名单是**精确文件**；迁移完成后删对应条目（条目指向不存在的文件会报错，防止长草）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..")
const UI_DIRS = ["apps/desktop/src/components/ui/", "packages/player/src/ui/"]
/** 迁移完成前允许直接碰 Radix 的文件（见 docs/ui/design-system-plan.md 的 F1/F2）。 */
const WHITELIST = new Set<string>()

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "target") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".check.ts")) out.push(p)
  }
  return out
}

const IMPORT =
  /(?:\bfrom\s*(?:\/\*[\s\S]*?\*\/\s*)*|\bimport\s*\()\s*["'](@radix-ui\/[^"']+|radix-ui(?:\/[^"']+)?)["']/g

const files = ["apps", "packages"].flatMap((r) => walk(join(ROOT, r)))
const violations: string[] = []

for (const file of files) {
  const rel = relative(ROOT, file).replaceAll("\\", "/")
  const src = readFileSync(file, "utf8")
  for (const m of src.matchAll(IMPORT)) {
    const mod = m[1]!
    const line = src.slice(0, m.index).split("\n").length
    const at = `${rel}:${line}`
    if (mod.startsWith("@radix-ui/")) {
      violations.push(`${at}  独立包 ${mod} —— 改用 radix-ui/<primitive>（在封装层内）`)
      continue
    }
    const wrapped = UI_DIRS.some((d) => rel.startsWith(d))
    const allowed = wrapped || WHITELIST.has(rel)
    if (mod === "radix-ui") violations.push(`${at}  聚合包根入口 —— 改用 radix-ui/<primitive>`)
    else if (!allowed) violations.push(`${at}  只有封装层可以 import ${mod}（见 docs/ui/design-system-plan.md）`)
  }
}
for (const w of WHITELIST) if (!existsSync(join(ROOT, w))) violations.push(`白名单条目 ${w} 已不存在，删掉它`)

if (violations.length) {
  for (const v of violations) console.error(`✘ ${v}`)
  process.exit(1)
}
console.log(`✔ Radix 边界自检通过（${files.length} 个源文件；封装层 2 个目录 + ${WHITELIST.size} 个临时白名单）`)
