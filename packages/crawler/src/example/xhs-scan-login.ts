/**
 * 验证脚本:CDP 隧道 + xhs 扫码登录(xhsScanLogin 全链路)。
 *
 * 用 playwright-core 连系统 Edge 模拟 BrowserBackend,调 xhsScanLogin:
 * 导航小红书 → 点登录 → 读二维码 data URL → 存 tmp/xhs-qr.png(用户打开扫码)
 * → 轮询登录态 → 打印 cookie 前缀(含 web_session)。
 *
 * 用法(bun 有 driver 兼容坑,必须 tsx/node 跑):
 *   ./node_modules/.bin/tsx packages/crawler/src/example/xhs-scan-login.ts
 *
 * ⚠️ 低频单次——反复登录/登出触发账号风控(300011/-100)。
 */
import { chromium } from "playwright-core"
import { writeFileSync } from "node:fs"
import { xhsScanLogin } from "../platform/xhs/login.ts"
import { makePlaywrightBackend } from "./backend.ts"

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: false })
  const page = await browser.newPage()
  const bb = makePlaywrightBackend(page, () => browser.close())

  console.log("[xhs-scan-login] 开始扫码登录(Edge 窗口会打开小红书登录页)…")
  const result = await xhsScanLogin(bb, (dataUrl) => {
    if (!dataUrl) return
    const b64 = dataUrl.split(",")[1]
    if (!b64) return
    writeFileSync("tmp/xhs-qr.png", Buffer.from(b64, "base64"))
    console.log("[xhs-scan-login] 二维码已存 tmp/xhs-qr.png —— 打开图片用手机小红书扫,并在手机上确认登录")
  })

  console.log("[xhs-scan-login] 登录成功!cookie 前缀:", result.cookie.slice(0, 120))
  console.log("[xhs-scan-login] user_id:", result.user_id ?? "(未取到)")
  await bb.close()
  process.exit(0)
}

main().catch((e) => {
  console.error("[xhs-scan-login] 失败:", e)
  process.exit(1)
})
