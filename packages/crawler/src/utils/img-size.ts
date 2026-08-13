/**
 * img-size — 图片宽高解析(瀑布流需要每张图的比例来 span 行高)。
 *
 * 思路(方案 A):对图片 URL 发 `Range: bytes=0-N` 请求取**文件头**,从二进制头
 * 解析宽高,而非完整下载。PNG 只需 64 字节;JPEG 的 SOF 段可能被 Exif/APP 段
 * 推到几百字节后 → 取 1024 字节足够。WebP/GIF 头也在前几十字节。
 *
 * 依赖 globalThis.appHost.http(跨环境:node fetch / Tauri 隧道)。与 md5.ts
 * 同范式:无第三方依赖。
 *
 * 优先用源返回的宽高(B站 API 的 pics width/height、小红书 SSR cover),缺省才
 * 预取——fetchImageSize 单张,fillImageSizes 批量(瀑布流 channel 共用)。
 */
import type { SocialImage } from "@tauri-playground/xml"

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

/** URL → 尺寸缓存(微博等图床 URL 稳定、宽高不变)。失败不缓存(可重试)。 */
const sizeCache = new Map<string, ImageSize>()

/**
 * 预取图片宽高:Range 请求文件头 + 解析。
 * 失败(非 206 / 无 body / 不可识别)返回 null——调用方据此退化到默认比例。
 * 已解析过的 URL 直接命中缓存(跨刷新复用,避免每次订阅刷新都重发 Range)。
 */
export async function fetchImageSize(url: string): Promise<ImageSize | null> {
  const hit = sizeCache.get(url)
  if (hit) return hit
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
    const size = parseImageSize(buf.subarray(0, HEADER_BYTES))
    if (size) sizeCache.set(url, size)
    return size
  } catch {
    return null
  }
}

/**
 * 批量补缺宽高的图(接受 `string | SocialImage`,string 旧协议形态跳过)。
 * 缺宽高才发请求,命中缓存直接复用。多个 social channel 共用,不在各 channel
 * 重复「filter 缺 → fetch → 回填」编排。
 */
export async function fillImageSizes(images: Array<SocialImage | string>): Promise<void> {
  await Promise.all(
    images
      .filter((img): img is SocialImage => typeof img !== "string")
      .filter((img) => !img.width || !img.height)
      .map(async (img) => {
        const size = await fetchImageSize(img.url)
        if (size) {
          img.width = size.width
          img.height = size.height
        }
      }),
  )
}
