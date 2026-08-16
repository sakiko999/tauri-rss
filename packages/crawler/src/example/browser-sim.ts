/**
 * 验证脚本:CDP 隧道 + 浏览器模拟抓取(weibo:user / xhs:user)。
 *
 * 生产路径:appHost.browser = Tauri spawn 系统 Edge + CDP(packages/host tauri/
 * browser-backend.ts)。本脚本在 **Node 环境**用 playwright-core 连系统 Chrome/Edge
 * 模拟同形状的 BrowserBackend,验证 crawler 侧 cdp.ts + channel 浏览器路径。
 *
 * 用法(需先装 playwright-core + 系统 Chrome/Edge):
 *   bun add -d playwright-core
 *   bun run packages/crawler/src/example/browser-sim.ts weibo:user
 *   bun run packages/crawler/src/example/browser-sim.ts xhs:user
 *
 * ⚠️ xhs:user 反复验证会触发账号风控——低频单次。
 */
import { chromium } from "playwright-core"
import { injectNodeHost, setHostCaps, nodeBackend, nodeJsBackend, memStorage } from "@tauri-playground/host"
import { exampleInfo, makePlaywrightBackend } from "./backend.ts"

async function main() {
  const key = process.argv[2]
  if (!key) {
    console.error("用法: bun run packages/crawler/src/example/browser-sim.ts weibo:user|xhs:user")
    process.exit(1)
  }
  injectNodeHost()

  // CDP 连本机已开 Chrome/Edge(channel 探测:edge 或 chrome;headless 有头更稳)。
  const browser = await chromium.launch({ channel: "msedge", headless: false })
  const page = await browser.newPage()
  // 门面是 getter 只读,setHostCaps 需完整 caps(shape 与 tauri host 一致 + browser)。
  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage: memStorage(),
    browser: makePlaywrightBackend(page, () => browser.close()),
  })

  const info = exampleInfo(key)
  const { listChannels } = await import("../index.ts")
  const channels = await listChannels()
  const channel = channels.find((c: any) => c.key === key)
  if (!channel) throw new Error(`未找到 channel: ${key}`)

  console.log(`[browser-sim] 抓取 ${key}`, info)
  const source = channel.getSource(info)
  // fetch() 直出 RSS 2.0 XML 字符串。打印前 400 字符看是否有条目。
  const xml = await source.fetch()
  console.log(`[browser-sim] RSS XML 长度: ${xml.length}`)
  console.log(xml.slice(0, 400))
  await (globalThis.appHost as any).browser.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[browser-sim] 失败:", e)
  process.exit(1)
})
