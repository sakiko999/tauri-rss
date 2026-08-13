/**
 * 浏览器 Buffer polyfill —— 仅覆盖 xhshow-js 用到的 Buffer API。
 *
 * xhshow-js 直接引用 node 全局 Buffer(from/alloc/allocUnsafe + 实例
 * writeBigUInt64LE/toString),webview 无 Buffer → 运行时崩。本模块**模块加载即注入**
 * `globalThis.Buffer`(由 index.ts 首个 import);node/example 有原生 Buffer,跳过。
 *
 * 实现基于 Uint8Array + TextEncoder/TextDecoder/DataView,零依赖。
 */
const HEX = "0123456789abcdef"

function hexEncode(bytes: Uint8Array): string {
  let out = ""
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15]
  return out
}

function hexDecode(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 最小 Buffer:from(hex/utf8/数组/typedarray) + alloc/allocUnsafe + toString + writeBigUInt64LE。 */
export class PolyfillBuffer extends Uint8Array {
  // 静态方法签名与基类 Uint8Array.from/alloc 冲突,声明为 any 绕过(运行时行为正确)。
  static from: any = (data: any, enc?: string): PolyfillBuffer => {
    if (typeof data === "string") {
      if (enc === "hex") return new PolyfillBuffer(hexDecode(data))
      if (enc === "base64") {
        const bin = atob(data)
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return new PolyfillBuffer(out)
      }
      return new PolyfillBuffer(new TextEncoder().encode(data))
    }
    if (Array.isArray(data)) return new PolyfillBuffer(data)
    if (data instanceof Uint8Array) return new PolyfillBuffer(data)
    if (data instanceof ArrayBuffer) return new PolyfillBuffer(new Uint8Array(data))
    throw new Error("Buffer.from 不支持的类型")
  }
  static alloc: any = (n: number): PolyfillBuffer => new PolyfillBuffer(n)
  static allocUnsafe: any = (n: number): PolyfillBuffer => new PolyfillBuffer(n)
  /** 8 字节 little-endian 写 BigUInt(envFingerprintA/B 用)。 */
  writeBigUInt64LE(v: bigint): number {
    new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(0, v, true)
    return 8
  }
  /** 拷贝本 Buffer 的字节段到 target(与 node Buffer.copy 语义一致,返回拷贝长度)。 */
  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const len = Math.min(sourceEnd - sourceStart, target.length - targetStart)
    target.set(this.subarray(sourceStart, sourceStart + len), targetStart)
    return len
  }
  toString(enc?: string): string {
    if (enc === "hex") return hexEncode(this)
    if (enc === "base64") {
      let bin = ""
      for (let i = 0; i < this.length; i++) bin += String.fromCharCode(this[i])
      return btoa(bin)
    }
    return new TextDecoder().decode(this)
  }
}

if (!(globalThis as any).Buffer) (globalThis as any).Buffer = PolyfillBuffer
