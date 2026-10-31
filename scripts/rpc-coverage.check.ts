/**
 * RPC 覆盖自检 —— `bun scripts/rpc-coverage.check.ts`
 *
 * 协议里新增一个方法、服务端忘了加 `case` → 线上只在调用时返回 404「未知方法」，
 * tsc 与其它检查都不报。这里对两份源码做集合比对：
 *   - `packages/service-protocol/src/index.ts` 的 `RpcMethodMap` 键；
 *   - `apps/cli/src/service/server.ts` 的 `case "…":`。
 * 两边必须完全一致（双向：协议多的报「未实现」，服务端多的报「协议里没有」）。
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const PROTOCOL = join(ROOT, "packages/service-protocol/src/index.ts")
const SERVER = join(ROOT, "apps/cli/src/service/server.ts")

/** 协议表两种写法都见过：`"channels.list": {` 与 `addSubscription: {`。 */
function keysOf(block: string): string[] {
  return [...block.matchAll(/^\s{2}(?:"([^"]+)"|(\w+)):\s*\{/gm)].map((m) => (m[1] ?? m[2])!)
}

const protoSrc = readFileSync(PROTOCOL, "utf8")
const start = protoSrc.indexOf("export interface RpcMethodMap")
const end = protoSrc.indexOf("\n}", start)
if (start < 0 || end < 0) throw new Error("解析 RpcMethodMap 失败（接口改名了？）")
const protocol = new Set(keysOf(protoSrc.slice(start, end)))

const serverSrc = readFileSync(SERVER, "utf8")
// 只看 dispatch 的 switch：同文件里还有命令行参数解析的 case（"--db" 等）。
const dispatchStart = serverSrc.indexOf("async function dispatch(")
const dispatchEnd = serverSrc.indexOf("default:", dispatchStart)
if (dispatchStart < 0 || dispatchEnd < 0) throw new Error("解析 dispatch switch 失败（函数改名了？）")
const implemented = new Set(
  [...serverSrc.slice(dispatchStart, dispatchEnd).matchAll(/case "([^"]+)":/g)].map((m) => m[1]!),
)

const missing = [...protocol].filter((m) => !implemented.has(m))
const extra = [...implemented].filter((m) => !protocol.has(m))
if (missing.length || extra.length) {
  if (missing.length) console.error(`✘ 协议有、服务端没实现：${missing.join(", ")}`)
  if (extra.length) console.error(`✘ 服务端有、协议里没有：${extra.join(", ")}`)
  process.exit(1)
}
console.log(`✔ RPC 覆盖自检通过（${protocol.size} 个方法双向一致）`)
