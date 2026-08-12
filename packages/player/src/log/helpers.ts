/** 语义函数需要的流最小结构(兼容 MediaStream)。 */
export interface StreamLike {
  url: string
  format?: string
  rate?: number
  quality?: string
}

/** 流摘要:域名 + format + 档位 + 截断 url,日志里复用。 */
export function streamSummary(stream: StreamLike): string {
  const q = stream.rate != null ? `${stream.quality ?? stream.rate}` : ""
  // dash 流 url 为空(url:"" + format:"dash" + dashManifest,真实分片在自拼 MPD 里)
  // → 直接以 format + 档位摘要,不解析域名。
  if (!stream.url) return `${stream.format ?? "?"}${q ? ` ${q}` : ""}`
  let host = ""
  try {
    // crawler 产出的流 url 都是绝对地址,无需 base 补全(补全只在相对路径时生效,
    // 且空串会在上面提前返回;base 只会带来 x.invalid 之类误导)。
    host = new URL(stream.url).hostname
  } catch {
    host = stream.url.slice(0, 60)
  }
  const path = stream.url.length > 100 ? `…${stream.url.slice(-60)}` : stream.url
  return `${host} ${stream.format ?? "?"}${q ? ` ${q}` : ""} ${path}`
}
