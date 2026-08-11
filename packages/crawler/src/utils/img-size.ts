/**
 * img-size — 图片宽高解析(瀑布流需要每张图的比例来 span 行高)。
 *
 * 思路(方案 A):对图片 URL 发 `Range: bytes=0-N` 请求取**文件头**,从二进制头
 * 解析宽高,而非完整下载。PNG 只需 64 字节;JPEG 的 SOF 段可能被 Exif/APP 段
 * 推到几百字节后 → 取 1024 字节足够。WebP/GIF 头也在前几十字节。
 *
 * 纯函数 + 依赖 globalThis.appHost.http(跨环境:node fetch / Tauri 隧道)。
 * 与 md5.ts 同范式:无第三方依赖。
 *
 * 优先用源返回的宽高(B站 API 的 pics width/height),缺省才预取——见
 * channels/bili/dynamic.ts 的用法。
 */

/** 图片二进制尺寸,宽高像素。 */
export interface ImageSize {
  width: number
  height: number
}

/**
 * 从图片二进制头解析宽高(仅需文件头 ~1024 字节)。
 * 支持 PNG / JPEG(含 SOF 扫描)/ WebP / GIF。无法识别返回 null。
 */
export function parseImageSize(buf: Uint8Array): ImageSize | null {
  if (!buf || buf.byteLength < 8) return null
  const ascii = (i: number, s: string): boolean => {
    for (let j = 0; j < s.length; j++) if (buf[i + j] !== s.charCodeAt(j)) return false
    return true
  }
  // PNG:签名 8 字节 + IHDR,width@16 / height@20(big-endian u32)。
  if (ascii(0, "\x89PNG") && ascii(12, "IHDR") && buf.byteLength >= 24) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    return { width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  // JPEG:0xFFD8,扫描 SOF0-15 段(排除 DHT/C4、JPG/C8、DAC/CC),
  // 高度@段+5、宽度@段+7。SOF 可能在 Exif APP1 之后(几百字节)。
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.byteLength) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      // 无长度段的标记(D0-D9 等)跳过。
      if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
        off += 2
        continue
      }
      const segLen = (buf[off + 2] << 8) | buf[off + 3]
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof && off + 9 <= buf.byteLength) {
        return { height: (buf[off + 5] << 8) | buf[off + 6], width: (buf[off + 7] << 8) | buf[off + 8] }
      }
      off += 2 + segLen
    }
    return null
  }
  // WebP:'RIFF'....'WEBP' + VP8/VP8L/VP8X 变体。
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
    if (ascii(12, "VP8 ") && buf.byteLength >= 30) {
      return { width: (buf[26] << 8) | buf[25], height: (buf[28] << 8) | buf[27] }
    }
    if (ascii(12, "VP8L") && buf.byteLength >= 25) {
      return { width: 1 + (((buf[21] & 0x3f) << 8) | buf[20]), height: 1 + (((buf[23] & 0x0f) << 8) | buf[22]) }
    }
    if (ascii(12, "VP8X") && buf.byteLength >= 30) {
      // VP8X:24 位小端无符号(little-endian 24bit),DataView 无 getUint24 手动拼。
      const u24le = (o: number) => buf[o]! | (buf[o + 1]! << 8) | (buf[o + 2]! << 16)
      return { width: 1 + u24le(24), height: 1 + u24le(27) }
    }
    return null
  }
  // GIF:'GIF8',width@6 / height@8(little-endian u16)。
  if (ascii(0, "GIF8") && buf.byteLength >= 10) {
    return { width: buf[6] | (buf[7] << 8), height: buf[8] | (buf[9] << 8) }
  }
  return null
}

/** 文件头请求大小:JPEG SOF 可能被 Exif 推到几百字节后,1024 稳妥。 */
const HEADER_BYTES = 1024

/**
 * 预取图片宽高:Range 请求文件头 + 解析。
 * 失败(非 206 / 无 body / 不可识别)返回 null——调用方据此退化到默认比例。
 */
export async function fetchImageSize(url: string): Promise<ImageSize | null> {
  try {
    const res = await globalThis.appHost.http.request({
      url,
      method: "GET",
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
      responseType: "arraybuffer",
    })
    // Range 未支持时可能返回 200 全量;取前 HEADER_BYTES 字节仍可解析。
    const buf = res.body as Uint8Array | undefined
    if (!buf || buf.byteLength === 0) return null
    return parseImageSize(buf.subarray(0, HEADER_BYTES))
  } catch {
    return null
  }
}
