/**
 * @amoeba/log 自检 —— `bun packages/log/src/example/log.check.ts`
 *
 * 守住日志系统最容易静默坏的四件事：
 *   1. 域注册幂等（同名返回同一引用，HMR 新增事件即时生效）；
 *   2. 开关语义（全局 log=0 / 按域 log:<name>=0，warn/error 永保留）；
 *   3. sink 接管（服务进程靠它把全部级别写 stderr —— stdout 只留 READY）；
 *   4. 错误文本（Error 取 message，不落成 [object Object]）。
 */
import { createLogDomain, formatError, getLogDomain, resetLogDomains, setLogSink } from "../index.ts"

let failed = 0
const ok = (cond: unknown, msg: string): void => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed += 1
    console.error(`  ✗ ${msg}`)
  }
}

// localStorage shim（readSwitch 的数据源；Bun 自带实现不可控，直接覆盖）
const store = new Map<string, string>()
const shim = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  get length() {
    return store.size
  },
}
Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true, writable: true })
const setLs = (entries: Record<string, string>): void => {
  store.clear()
  for (const [k, v] of Object.entries(entries)) store.set(k, v)
}

const lines: Array<{ level: string; text: string }> = []
setLogSink((level, text) => lines.push({ level, text }))
resetLogDomains()

const a = createLogDomain("t:core", {
  color: "#fff",
  ansi: 1,
  events: {
    failed: { level: "error", text: (c: { id: string }) => `失败 ${c.id}` },
    synced: { level: "info", text: (c: { n: number }) => `同步 ${c.n}` },
  },
})
const a2 = createLogDomain("t:core", { color: "#000", ansi: 2 })
ok(a === a2, "同名注册返回同一引用")
ok(getLogDomain("t:core") === a, "getLogDomain 返回同一实例")

a.failed({ id: "s1" })
ok(lines.at(-1)?.level === "error", "事件级别")
ok(lines.at(-1)?.text === "[t:core] 失败 s1", "事件文案 + 域前缀")

a.synced({ n: 2 })
ok(lines.at(-1)?.text === "[t:core] 同步 2", "info 事件")

// 全局开关
setLs({ log: "0" })
a.synced({ n: 3 })
ok(!lines.some((l) => l.text.includes("同步 3")), "全局 log=0 关闭 info")
a.failed({ id: "s2" })
ok(lines.at(-1)?.text.includes("失败 s2"), "warn/error 不开关（永保留）")
a.debug("dbg")
ok(!lines.some((l) => l.text.includes("dbg")), "全局 log=0 关闭 debug")

// 按域开关：只关本域
setLs({ "log:t:core": "0" })
const other = createLogDomain("t:other", { color: "#000", ansi: 3 })
a.info("core-hidden")
other.info("other-visible")
ok(!lines.some((l) => l.text.includes("core-hidden")), "按域开关关闭本域 info")
ok(lines.some((l) => l.text.includes("[t:other] other-visible")), "其它域不受影响")

// sink：Error 走 formatError，不落成 {}
setLs({})
a.warn("失败", new Error("boom"))
ok(lines.at(-1)?.level === "warn", "自由方法级别")
ok(lines.at(-1)?.text.includes("boom"), "sink 保留 Error message")
ok(!lines.at(-1)?.text.includes("[object Object]"), "不落成 [object Object]")

// HMR：重复注册新增事件，旧引用立即可用
createLogDomain("t:core", {
  color: "#fff",
  ansi: 1,
  events: { extra: { level: "info", text: "新增事件" } },
})
;(a as unknown as { extra: () => void }).extra()
ok(lines.at(-1)?.text === "[t:core] 新增事件", "幂等注册合并新事件（HMR）")

ok(formatError(new Error("x")) === "x", "formatError(Error) 取 message")
ok(formatError({ message: "m", details: "d" }) === "m d", "formatError({message,details})")
ok(formatError("plain") === "plain", "formatError(字符串)")

setLogSink(null)
console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
