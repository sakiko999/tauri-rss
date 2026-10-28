/**
 * 终端二维码渲染自检 —— `bun apps/cli/src/ui/qr-terminal.check.ts`
 *
 * 覆盖:PNG 解码(8-bit 灰度 / 1-bit 灰度)→ jsqr 还原内容 → 矩阵尺寸 →
 * 半块渲染尺寸。二维码识别失败是「画出一张扫不动的图」这种静默错误,
 * 只能在 CPU 上守住。
 */
import { deflateSync } from "node:zlib"
import jsQR from "jsqr"
import QRCode from "qrcode"
import { contentFromDataUrl, decodePng, matrixFromEmit, matrixOf, renderHalfBlocks } from "./qr-terminal.ts"

let failed = 0
const ok = (cond: unknown, msg: string): void => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed += 1
    console.error(`  ✗ ${msg}`)
  }
}

/** CRC32（PNG chunk 用）。 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "ascii")
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, Buffer.from(data), crc])
}

/**
 * 1-bit 灰度 PNG（非隔行、filter 0）。1 = 白、0 = 黑。
 * 用来覆盖 xhs 这类「页面/服务端直出的位图」，与 qrcode 库的 8-bit 输出区分。
 */
function oneBitPng(m: { size: number; data: ArrayLike<number> }, scale = 8, marginModules = 4): Uint8Array {
  const total = (m.size + marginModules * 2) * scale
  const rowsPerLine = Math.ceil(total / 8)
  const raw = Buffer.alloc((rowsPerLine + 1) * total)
  for (let y = 0; y < total; y++) {
    const rowOff = y * (rowsPerLine + 1)
    raw[rowOff] = 0 // filter: none
    for (let x = 0; x < total; x++) {
      const mx = Math.floor(x / scale) - marginModules
      const my = Math.floor(y / scale) - marginModules
      const black = mx >= 0 && my >= 0 && mx < m.size && my < m.size && m.data[my * m.size + mx] === 1
      // 位序：高位在左；1 = 白。
      if (!black) raw[rowOff + 1 + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(total, 0)
  ihdr.writeUInt32BE(total, 4)
  ihdr[8] = 1 // bitDepth
  ihdr[9] = 0 // colorType: 灰度
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}

const content = "https://passport.bilibili.com/x/passport-login/web/qrcode?qrcode_key=abc123"

// 1) qrcode 库的 PNG（8-bit 灰度）→ 解码 → 识别
const dataUrl = await QRCode.toDataURL(content, { errorCorrectionLevel: "M", margin: 2, width: 240 })
const bmp = decodePng(Uint8Array.from(Buffer.from(dataUrl.split(",")[1]!, "base64")))
ok(bmp.width === 240 && bmp.height === 240, "8-bit PNG 尺寸")
ok(contentFromDataUrl(dataUrl) === content, "8-bit PNG 识别还原内容")

// 2) 1-bit 灰度 PNG → 解码 → 识别
const matrix = matrixOf(content)
const oneBit = oneBitPng(matrix)
const bmp1 = decodePng(oneBit)
ok(bmp1.width === bmp1.height && bmp1.width === (matrix.size + 8) * 8, "1-bit PNG 尺寸")
const decoded = jsQR(bmp1.rgba, bmp1.width, bmp1.height)?.data ?? ""
ok(decoded === content, "1-bit PNG 识别还原内容")

// 3) 矩阵与渲染尺寸
const total = matrix.size + 4
const lines = renderHalfBlocks(matrix).split("\n")
ok(lines.length === Math.ceil(total / 2), "半块行数 = ceil((size+4)/2)")
ok(
  lines.every((l) => l.length === total),
  "每行宽度 = size+4",
)
ok(matrixFromEmit(content).size === matrix.size, "内容类 emit 与 data URL 同矩阵")

// 4) 非 PNG data URL 明确报错（不静默画错图）
try {
  contentFromDataUrl("data:image/jpeg;base64,AAAA")
  ok(false, "非 PNG 应报错")
} catch (e) {
  ok(e instanceof Error && /PNG/.test(e.message), "非 PNG data URL 报错")
}

// 5) emitQr 的两种「确定无法渲染」载荷：明确报错，别把图片地址编码成一个假二维码
try {
  matrixFromEmit("https://v2.qr.weibo.cn/api/qrcode.png?size=180")
  ok(false, "图片扩展名 URL 应报错")
} catch (e) {
  ok(e instanceof Error && /远程图片/.test(e.message), "图片 URL 载荷报错（weibo 取码失败回退）")
}
try {
  matrixFromEmit("data:image/jpeg;base64,AAAA")
  ok(false, "非 PNG data URL 应报错")
} catch (e) {
  ok(e instanceof Error && /仅 PNG/.test(e.message), "非 PNG data URL 载荷报错")
}
// 内容本身就是链接（bili）必须照常编码 —— 不能把 http(s) 一律当图片。
ok(
  matrixFromEmit("https://passport.bilibili.com/x/passport-login/web/qrcode?qrcode_key=abc").size > 0,
  "链接型二维码内容照常编码",
)

console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
