/**
 * node:crypto 的最小浏览器 shim(仅覆盖 xhshow-js 用到的 createHash/randomBytes)。
 *
 * xhshow-js 顶层 `import { createHash, randomBytes } from "crypto"`——桌面 webview 无
 * node crypto。desktop vite 配 `resolve.alias` 把 `crypto` 解析到本文件(webview 构建/
 * dev 生效);node / example 环境不用 vite,仍走真 node crypto,不碰本文件。
 *
 * 覆盖接口(见 xhshow-js dist):
 *   - createHash("md5").update(bytes | str, enc?).digest("hex")   → crypto-js.MD5 hex
 *   - randomBytes(32)                                             → getRandomValues
 */
import CryptoJS from "crypto-js"

/** Uint8Array → crypto-js WordArray(逐 4 字节拼 32bit 字,忽略末尾不足位)。 */
function toWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = []
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0),
    )
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length)
}

/** createHash("md5")——只实现 update 链 + digest("hex"),对应 xhshow-js 的全部调用。 */
export function createHash(_alg: string): {
  update(d: string | Uint8Array, enc?: string): unknown
  digest(enc?: string): string
} {
  let data: string | Uint8Array = ""
  return {
    update(d) {
      data = d
      return this
    },
    digest() {
      const wa = typeof data === "string" ? CryptoJS.enc.Utf8.parse(data) : toWordArray(data)
      return CryptoJS.MD5(wa).toString(CryptoJS.enc.Hex)
    },
  }
}

/** randomBytes(n)——Web Crypto 真随机;获取失败降级 Math.random。 */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b)
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256)
  return b
}
