/** 模拟 webview:无 Buffer 全局 → 包注入 PolyfillBuffer 且签名可用。 */
export {}
;(globalThis as any).Buffer = undefined
const mod = await import("../index.ts")
const buf = (globalThis as any).Buffer
console.log("Buffer 注入:", typeof buf === "function", "类名:", buf?.name)
const client = new mod.Client()
const xs = client.signXS("GET", "/api/sns/web/v1/user_posted", "a1xxx", "xhs-pc-web", { num: "30" })
console.log("signXS:", xs.startsWith("XYS_"), xs.slice(0, 24) + "…")
console.log("signXSCommon:", typeof client.signXSCommon({ a1: "a1xxx" }) === "string")
