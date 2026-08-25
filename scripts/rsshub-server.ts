/**
 * RSSHub sidecar —— 独立 Node 进程跑 RSSHub npm 包,自起 HTTP 端口供 desktop 消费。
 *
 * 为什么存在:
 *   - `rsshub@1.0.0-master.0a5fb34` 是**进程内 API**(`init()+request(path)`),没有
 *     自带 HTTP server 端口。desktop 侧 `source/rsshub.ts` 用 `httpText(baseUrl+route)`
 *     直传——需要本进程把 request() 返回的 RSS 对象序列化成标准 RSS 2.0 XML
 *     (与 crawler serializeFeed 对齐),挂到 HTTP 上。
 *   - 附带一条**泛 URL 代理** `/url?u=<feedUrl>`:RSSHub 原生不支持「任意 feed URL →
 *     RSS」(36 条内置直链如 hnrss/npr 不在其路由表)。本进程自己抓上游 XML 归一输出,
 *     这样 desktop 订阅完全不需要 crawler 的 rss:* 渠道。
 *
 * 路由:
 *   GET /healthz            → 200 ok(desktop sidecar 探活)
 *   GET /url?u=<feedUrl>    → 抓上游任意 feed XML,原样输出(归一)
 *   GET /<rsshub-route>     → RSSHub request() 原生路由 → 序列化成 RSS 2.0 XML
 *
 * 使用:
 *   bun run scripts/rsshub-server.ts              # 默认 1200
 *   PORT=1200 bun run scripts/rsshub-server.ts
 *
 * ⚠️ 数据路径:desktop 的 `source/rsshub.ts` 用 httpText(baseUrl+route) 直传标准
 * XML;本进程保证全部输出都是标准 RSS 2.0(与 crawler serializeFeed 子集对齐),
 * 加工层 deserialize 增强(enclosure/media:thumbnail/dc:creator)统一吃到。
 */
import { init, request } from "rsshub"
import http from "node:http"
import { fetch as undiciFetch } from "undici"

const PORT = Number(process.env.PORT || 1200)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

/** 极简 XML 转义(CDATA 场景外层已有;这里转文本节点)。 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/**
 * 把 RSSHub `request()` 返回的 RSS 2.0 对象序列化成标准 RSS 2.0 XML。
 * 与 crawler serializeFeed 对齐:title/link/description(CDATA)/guid/pubDate/
 * author/enclosure/media:thumbnail。
 */
export function serializeRssObject(feed: {
  title?: string
  link?: string
  description?: string
  item?: Array<Record<string, unknown>>
}): string {
  const itemXml = (feed.item ?? [])
    .map((it) => {
      const title = String(it.title ?? "(untitled)")
      const link = String(it.link ?? "")
      const desc = it.description !== undefined ? String(it.description) : ""
      const guid = String(it.guid ?? it.link ?? title)
      const pubDate = it.pubDate !== undefined ? String(it.pubDate) : ""
      const author = it.author !== undefined ? String(it.author) : ""
      const enclosureUrl = it.enclosure_url !== undefined ? String(it.enclosure_url) : ""
      const enclosureType = it.enclosure_type !== undefined ? String(it.enclosure_type) : ""
      const mediaThumbRaw = it.media?.thumbnail ?? it.image
      const mediaThumb = typeof mediaThumbRaw === "string" ? mediaThumbRaw : mediaThumbRaw?.url
      // RSSHub attachments:youtube 视频嵌 frame 链接等 → media:content(加工层可作附件/缩略图)。
      const attachments = Array.isArray(it.attachments) ? it.attachments : []

      const parts = [`    <title>${xmlEscape(title)}</title>`]
      if (link) parts.push(`    <link>${xmlEscape(link)}</link>`)
      if (desc) parts.push(`    <description><![CDATA[${desc.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></description>`)
      parts.push(`    <guid isPermaLink="false">${xmlEscape(guid)}</guid>`)
      if (pubDate) parts.push(`    <pubDate>${xmlEscape(pubDate)}</pubDate>`)
      if (author) parts.push(`    <author>${xmlEscape(author)}</author>`)
      if (enclosureUrl) {
        parts.push(`    <enclosure url="${xmlEscape(enclosureUrl)}" type="${xmlEscape(enclosureType || "application/octet-stream")}" />`)
      }
      if (mediaThumb) parts.push(`    <media:thumbnail url="${xmlEscape(String(mediaThumb))}" />`)
      // attachments → media:content(video 嵌 frame → 可播源,加工层 resolvePlay 按 url 路由)
      for (const a of attachments) {
        const u = a.url, mime = a.mime_type, dur = a.duration_in_seconds
        if (u) {
          const attrs = [`url="${xmlEscape(String(u))}"`]
          if (mime) attrs.push(`type="${xmlEscape(String(mime))}"`)
          if (mime && String(mime).startsWith("video")) attrs.push(`medium="video"`)
          if (dur) attrs.push(`duration="${xmlEscape(String(dur))}"`)
          parts.push(`    <media:content ${attrs.join(" ")} />`)
        }
      }
      return `  <item>\n${parts.join("\n")}\n  </item>`
    })
    .join("\n")

  const ch = [
    `    <title>${xmlEscape(feed.title ?? "RSSHub")}</title>`,
    `    <link>${xmlEscape(feed.link ?? "https://rsshub.app")}</link>`,
    `    <description>${xmlEscape(feed.description ?? "")}</description>`,
  ].join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
${ch}
${itemXml}
  </channel>
</rss>`
}

async function main() {
  await init({})

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("ok")
      return
    }

    try {
      // 泛 URL 代理:抓上游 feed 原始 XML 原样吐(标准 RSS/Atom,加工层可解析)。
      if (url.pathname === "/url") {
        const feedUrl = url.searchParams.get("u")
        if (!feedUrl) {
          res.writeHead(400, { "content-type": "text/plain" })
          res.end("missing ?u=<feedURL>")
          return
        }
        const up = await undiciFetch(feedUrl, {
          headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8" },
          redirect: "follow",
        })
        if (!up.ok) {
          res.writeHead(502, { "content-type": "text/plain" })
          res.end(`upstream ${up.status} ${up.statusText}`)
          return
        }
        const upstreamXml = await up.text()
        res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" })
        res.end(upstreamXml)
        return
      }

      // RSSHub 原生路由:request(path) 拿对象 → 序列化。
      const path = url.pathname + url.search
      const data = await request(path)
      const xml = serializeRssObject(data as { title?: string; link?: string; description?: string; item?: Array<Record<string, unknown>> })
      res.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" })
      res.end(xml)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      res.end(`rsshub sidecar error: ${msg}\n`)
    }
  })

  server.listen(PORT, () => {
    console.log(`[rsshub-sidecar] listening on http://localhost:${PORT}`)
  })
}

main().catch((e) => {
  console.error("[rsshub-sidecar] fatal:", e)
  process.exit(1)
})