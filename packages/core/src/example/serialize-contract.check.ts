/**
 * crawler→core 的 `tpl:` 契约完整性守卫 —— `bun packages/core/src/example/serialize-contract.check.ts`
 *
 * ⚠️ 守护的 bug 类(CLAUDE.md 已记,本会话实测又踩了 fetchedAt/authorAvatar 两次):
 * `serializeFeed` 必须写出 core `deserialize` 读的**每一个** tpl: 字段,否则该字段在
 * 边界静默退化成默认值/undefined(如 fetchedAt→ctx.now、liveStatus→"unknown")。
 *
 * 做法:静态扫两侧源码,对比「serialize 写的 tpl: 键」与「deserialize 读的 tpl: 键」。
 * 差异必须在 ALLOWLIST 里有解释,否则红 —— 新加字段忘透传时立刻发现。
 *
 * 扫描面（两种写法都要覆盖）:
 *   - `setTpl(tree, "key", …)` / `setTplN(tree, "key", …)` 单行调用；
 *   - XML 属性直写 `node["@_tpl:key"] = …`（如 social 图的 liveVideo）。
 * 旧实现只扫前者，`tpl:liveVideo` 因此被误报为「读不写」——守卫常红会让真正的
 * 漏写失去信号，所以属性形式必须纳入。
 */

import { readFileSync } from "node:fs"

const SER = "packages/xml/src/serialize.ts"
const DE = "packages/core/src/processing/deserialize.ts"

/**
 * 已知且**有意**的差异（每条都要在这里解释）。
 * 当前没有：旧的 image/images 是 media:content 路径的误报，已随属性扫描修正而移除。
 */
const READ_ONLY_OK = new Set<string>()

let fails = 0
const ok = (cond: unknown, label: string) => {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

const ser = readFileSync(SER, "utf8")
const de = readFileSync(DE, "utf8")

const wrote = new Set<string>()
for (const m of ser.matchAll(/setTplN?\([^,]+,\s*"([^"]+)"/g)) wrote.add(m[1]!)
for (const m of ser.matchAll(/\["@_tpl:([A-Za-z0-9_]+)"\]/g)) wrote.add(m[1]!)
const read = new Set<string>()
for (const m of de.matchAll(/tpl:([A-Za-z0-9_]+)/g)) read.add(m[1]!)

const onlyRead = [...read].filter((k) => !wrote.has(k) && k !== "kind" && k !== "total").sort()
const unexplained = onlyRead.filter((k) => !READ_ONLY_OK.has(k))

console.log("serialize 写的 tpl: 键:", [...wrote].sort().join(", "))
console.log("deserialize 读的 tpl: 键:", [...read].sort().join(", "))
console.log("\ndeserialize 读、serialize 从不写:")
for (const k of onlyRead) {
  const tag = READ_ONLY_OK.has(k) ? "✓ 已知(有意)" : "✗ 未解释"
  console.log(`  ${tag}  tpl:${k}`)
}
ok(unexplained.length === 0, `所有「读不写」差异都有解释(未解释: ${unexplained.join(", ") || "无"})`)

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
