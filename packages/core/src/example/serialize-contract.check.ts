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
 * 局限:正则只认 `setTpl(tree, "key", …)` / `setTplN(tree, "key", …)` 单行调用
 * (当前 serialize.ts 全为单行,足够);前提是仓库布局不变。
 */
import { readFileSync } from "node:fs"

const SER = "packages/xml/src/serialize.ts"
const DE = "packages/core/src/processing/deserialize.ts"

/** 已知且**有意**的差异(两侧都要有解释)。 */
const READ_ONLY_OK = new Set([
  "image", // 社交图:serialize 走 media:content,deserialize 从它重建(parseImagesFromMedia)
  "images",
])

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
