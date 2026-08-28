/**
 * env — appHost 各门面自检。--probe 实测(轻请求 / JS 求值 / KV roundtrip),
 * 缺省只报告注入状态与配置位置。ws 不实际建连(四平台弹幕归 rss dm),
 * browser 明示排除(CLI 不做 Edge+CDP,docs/cli-plan.md §一)。
 */
import pc from "picocolors"
import { existsSync } from "node:fs"
import { nodeBackend, nodeJsBackend } from "@tauri-playground/host"
import { sqliteFilePath } from "../store/sqlite-storage.ts"
import { fail, fmtMs, ok, row, startTimer } from "../ui/render.ts"

export interface EnvOptions {
  probe?: boolean
}

export async function runEnv(opts: EnvOptions): Promise<void> {
  const dbPath = sqliteFilePath()
  const dbExists = existsSync(dbPath)
  console.log("appHost 门面状态:")
  console.log(row("http", `${ok("已注入")} (node fetch)`))
  console.log(row("js", `${ok("已注入")} (new Function)`))
  console.log(row("storage", `${ok("已注入")} (bun:sqlite: ${dbPath}${dbExists ? "" : pc.dim(", 尚未创建")})`))
  console.log(row("ws", `${ok("已注入")} (ws 包,支持自定义握手 header)`))
  console.log(row("browser", pc.dim("—(CLI 排除浏览器模拟渠道;desktop 走 Edge+CDP)")))
  console.log(row("log", `info/debug = ${process.env.RSS_LOG === "1" ? "开 (RSS_LOG=1)" : "关(默认;RSS_LOG=1 放开)"},warn/error 永保留`))

  if (!opts.probe) return

  console.log("\nprobe:")
  const http = nodeBackend()
  const tHttp = startTimer()
  const res = await http.request({ url: "https://www.bilibili.com", responseType: "text", timeoutMs: 10_000 })
  console.log(row("http", `${res.status === 200 ? ok("GET bilibili.com") : fail(`status ${res.status}`)} ${res.status}, ${fmtMs(tHttp())}`))

  const js = nodeJsBackend()
  const r = js.call("function ping() { return 40 + 2 }", "ping", [])
  console.log(row("js", r === 42 ? ok("call(ping) → 42") : fail(`call(ping) → ${String(r)}`)))

  const storage = globalThis.appHost.storage
  await storage.set("__cli_env_probe", "1")
  const back = await storage.get("__cli_env_probe")
  await storage.delete("__cli_env_probe")
  const roundtrip = back === "1" && (await storage.get("__cli_env_probe")) === null
  console.log(row("storage", roundtrip ? ok("set/get/delete roundtrip") : fail("KV roundtrip 失败")))
}
