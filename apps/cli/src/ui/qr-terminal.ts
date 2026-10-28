/**
 * 终端二维码渲染 —— 把 `scanLogin` 的 emitQr 载荷画成 Unicode 半块字符。
 *
 * emitQr 有两种语义（packages/crawler/src/index.ts 的 Loginable）：
 *   - `data:image/...`（xhs / weibo / douyin 的浏览器路径）→ 已是二维码图片；
 *   - 其余是二维码**内容**（bili 纯 HTTP 协议只给一段 URL）。
 *
 * 图片路径要先把 PNG 解成 RGBA，再交给 jsqr 识别出内容，最后统一用 qrcode
 * 重新编码成模块矩阵。多一步识别的价值：模块尺寸/旋转/纠错交给成熟库，
 * 失败还能明确报错，而不是画出一张扫不动的点阵。
 *
 * PNG 解码只覆盖二维码图的常见形态：非隔行、bitDepth 1/2/4/8、
 * colorType 0(灰度)/2(RGB)/3(调色板)/6(RGBA)。16-bit 与 Adam7 直接报错
 * —— 已知上限，二维码生成器不用这些形态。
 */

import { inflateSync } from "node:zlib"

import jsQR from "jsqr"
import pc from "picocolors"
import QRCode from "qrcode"

export interface Bitmap {
  width: number
  height: number
  /** RGBA，每像素 4 字节。 */
  rgba: Uint8ClampedArray
}

export interface QrMatrix {
  size: number
  /** size*size，1 = 黑。 */
  data: ArrayLike<number>
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function readU32(b: Uint8Array, off: number): number {
  return ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0
}

function ascii(b: Uint8Array, off: number, len: number): string {
  return String.fromCharCode(...b.subarray(off, off + len))
}

/** 取 PNG 行内第 x 个样本（bitDepth < 8 时按位展开）。 */
function sampleAt(row: Uint8Array, x: number, bitDepth: number): number {
  if (bitDepth === 8) return row[x]!
  const bitPos = x * bitDepth
  const byte = row[bitPos >> 3]!
  const shift = 8 - bitDepth - (bitPos & 7)
  return (byte >> shift) & ((1 << bitDepth) - 1)
}

/** Paeth 预测（PNG filter 4）。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** 最小 PNG 解码器（见文件头的能力边界）。 */
export function decodePng(bytes: Uint8Array): Bitmap {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("不是 PNG（签名不匹配）")
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: Uint8Array | null = null
  const idat: Uint8Array[] = []

  let off = 8
  while (off + 8 <= bytes.length) {
    const len = readU32(bytes, off)
    const type = ascii(bytes, off + 4, 4)
    const body = bytes.subarray(off + 8, off + 8 + len)
    if (type === "IHDR") {
      width = readU32(body, 0)
      height = readU32(body, 4)
      bitDepth = body[8]!
      colorType = body[9]!
      interlace = body[12]!
    } else if (type === "PLTE") {
      palette = body
    } else if (type === "IDAT") {
      idat.push(body)
    } else if (type === "IEND") {
      break
    }
    off += 12 + len
  }

  if (!width || !height) throw new Error("PNG 缺少 IHDR")
  if (interlace !== 0) throw new Error("不支持隔行（Adam7）PNG")
  if (bitDepth !== 1 && bitDepth !== 2 && bitDepth !== 4 && bitDepth !== 8) {
    throw new Error(`不支持 PNG bitDepth=${bitDepth}`)
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 6 ? 4 : 0
  if (!channels) throw new Error(`不支持 PNG colorType=${colorType}`)
  if (colorType === 3 && !palette) throw new Error("PNG 调色板缺失")

  const inflated = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))))
  const bitsPerPixel = channels * bitDepth
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8)
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const stride = rowBytes + 1
  if (inflated.length < stride * height) throw new Error("PNG IDAT 长度不足")

  const rgba = new Uint8ClampedArray(width * height * 4)
  let prev = new Uint8Array(rowBytes)
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * stride]!
    const src = inflated.subarray(y * stride + 1, (y + 1) * stride)
    const row = new Uint8Array(rowBytes)
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? row[x - bpp]! : 0
      const b = prev[x]!
      const c = x >= bpp ? prev[x - bpp]! : 0
      const raw = src[x]!
      switch (filter) {
        case 0:
          row[x] = raw
          break
        case 1:
          row[x] = (raw + a) & 0xff
          break
        case 2:
          row[x] = (raw + b) & 0xff
          break
        case 3:
          row[x] = (raw + ((a + b) >> 1)) & 0xff
          break
        case 4:
          row[x] = (raw + paeth(a, b, c)) & 0xff
          break
        default:
          throw new Error(`不支持 PNG filter=${filter}`)
      }
    }

    const maxSample = (1 << bitDepth) - 1
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      if (colorType === 0) {
        const v = Math.round((sampleAt(row, x, bitDepth) * 255) / maxSample)
        rgba[p] = v
        rgba[p + 1] = v
        rgba[p + 2] = v
        rgba[p + 3] = 255
      } else if (colorType === 3) {
        const i = sampleAt(row, x, bitDepth) * 3
        rgba[p] = palette![i]!
        rgba[p + 1] = palette![i + 1]!
        rgba[p + 2] = palette![i + 2]!
        rgba[p + 3] = 255
      } else if (colorType === 2) {
        const i = x * 3
        rgba[p] = row[i]!
        rgba[p + 1] = row[i + 1]!
        rgba[p + 2] = row[i + 2]!
        rgba[p + 3] = 255
      } else {
        const i = x * 4
        rgba[p] = row[i]!
        rgba[p + 1] = row[i + 1]!
        rgba[p + 2] = row[i + 2]!
        rgba[p + 3] = row[i + 3]!
      }
    }
    prev = row
  }

  return { width, height, rgba }
}

/** data URL → PNG 字节（非 PNG data URL 抛错）。 */
export function pngBytesFromDataUrl(dataUrl: string): Uint8Array {
  const m = /^data:image\/png;base64,([\s\S]+)$/i.exec(dataUrl)
  if (!m) throw new Error("二维码不是 PNG data URL")
  return Uint8Array.from(Buffer.from(m[1]!, "base64"))
}

/** data URL → 二维码内容（PNG 解码 + jsqr 识别）。 */
export function contentFromDataUrl(dataUrl: string): string {
  const bmp = decodePng(pngBytesFromDataUrl(dataUrl))
  const result = jsQR(bmp.rgba, bmp.width, bmp.height)
  if (!result) throw new Error("二维码识别失败（图片可能不完整）")
  return result.data
}

/** 内容 → 模块矩阵（纠错 M：允许平台 logo 遮挡一部分）。 */
export function matrixOf(content: string): QrMatrix {
  const qr = QRCode.create(content, { errorCorrectionLevel: "M" })
  return { size: qr.modules.size, data: qr.modules.data }
}

/** 图片站回退载荷（服务端拉图失败时 weibo login 会把原图 URL 交给 emitQr）。 */
const IMAGE_URL_RE = /^https?:\/\/.*\.(png|jpe?g|gif|webp|bmp)([?#]|$)/i

/**
 * emitQr 载荷 → 模块矩阵。
 *
 * 两种正常载荷：`data:image/png;base64,…`（图片）与二维码**内容**（bili 给 URL）。
 * ⚠️ 不能把「http(s) 开头」一律当图片 —— bili 的二维码内容本身就是链接。
 * 只在两种确定无法渲染的情况下报错，避免把图片地址当成内容编码出一个假二维码：
 *   - 图片扩展名的 URL（weibo 取码失败的回退）；
 *   - 非 PNG 的 data URL（微博图床可能是 jpeg）。
 */
export function matrixFromEmit(payload: string): QrMatrix {
  if (IMAGE_URL_RE.test(payload)) {
    throw new Error(`二维码是远程图片而非二维码内容，终端无法渲染；请用桌面端扫码或手动打开：${payload}`)
  }
  if (/^data:image\//i.test(payload) && !/^data:image\/png[;,]/i.test(payload)) {
    throw new Error(`二维码图片格式不支持（仅 PNG）：${payload.slice(0, 24)}…`)
  }
  return matrixOf(payload.startsWith("data:image/") ? contentFromDataUrl(payload) : payload)
}

/**
 * 半块字符渲染：每字符代表上下两个模块，模块近似正方形。
 * 留白 2 模块（扫码器需要静区）。
 */
export function renderHalfBlocks(m: QrMatrix, margin = 2): string {
  const total = m.size + margin * 2
  const lines: string[] = []
  const at = (x: number, y: number): boolean => {
    const mx = x - margin
    const my = y - margin
    if (mx < 0 || my < 0 || mx >= m.size || my >= m.size) return false
    return m.data[my * m.size + mx] === 1
  }
  for (let y = 0; y < total; y += 2) {
    let line = ""
    for (let x = 0; x < total; x++) {
      const top = at(x, y)
      const bottom = at(x, y + 1)
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " "
    }
    lines.push(line)
  }
  return lines.join("\n")
}

/**
 * 打印二维码。显式浅底深块：深色终端里默认前景反转会把码画反，
 * 多数扫码器能扫反色，但不值得赌。
 */
export function printQr(m: QrMatrix): void {
  console.log(pc.bgWhite(pc.black(renderHalfBlocks(m))))
}
