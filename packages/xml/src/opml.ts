/**
 * opml — OPML 2.0 订阅清单的编解码(与 RSS 编解码同居此包,共用 fast-xml-parser)。
 *
 * 标准 OPML:`<opml><head/><body><outline text title xmlUrl type htmlUrl>…</outline></body></opml>`
 * ——嵌套 outline = 分组层级。本模块只认 RSS/Atom(`type="rss"`,xmlUrl 非空),
 * 其余(xmlUrl 空 = 纯分组节点;非 rss 的 link/播放列表)跳过。
 *
 * 数据层无关:core.Subscription ↔ OpmlFeed 的映射在 apps/desktop(`lib/opml.ts`)。
 */
import { XMLBuilder, XMLParser } from "fast-xml-parser"

export interface OpmlFeed {
  title: string
  xmlUrl: string
  htmlUrl?: string
  /** 嵌套分组的上级标题链(导入时逐级建组)。顶层 = []。 */
  groupPath: string[]
}

export interface OpmlDoc {
  title: string
  feeds: OpmlFeed[]
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  suppressEmptyNode: true,
  processEntities: false,
  format: true,
})

/** feeds → OPML 2.0 字符串。游标类型按平台惯例声明(reader 靠 type="rss" 认)。 */
export function serializeOpml(doc: OpmlDoc): string {
  // groupPath 逐级建嵌套 outline;标题到字符串 key 取或建(同名前缀共享节点)。
  type Node = { children: Map<string, Node>; feed?: OpmlFeed }
  const root: Node = { children: new Map() }
  for (const f of doc.feeds) {
    let node = root
    for (const g of f.groupPath) {
      if (!g) continue
      let next = node.children.get(g)
      if (!next) {
        next = { children: new Map() }
        node.children.set(g, next)
      }
      node = next
    }
    node.children.set(`\u0000feed:${f.xmlUrl}`, { children: new Map(), feed: f })
  }

  const toOutline = (node: Node): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = []
    for (const [key, child] of node.children) {
      if (child.feed) {
        const f = child.feed
        out.push({
          "@_type": "rss",
          "@_text": f.title,
          "@_title": f.title,
          "@_xmlUrl": f.xmlUrl,
          ...(f.htmlUrl ? { "@_htmlUrl": f.htmlUrl } : {}),
        })
      } else {
        out.push({ "@_text": key, "@_title": key, outline: toOutline(child) })
      }
    }
    return out
  }

  return (
    builder.build({
      "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
      opml: {
        "@_version": "2.0",
        head: { title: doc.title, dateCreated: new Date().toUTCString() },
        body: { outline: toOutline(root) },
      },
    }) + "\n"
  )
}

/** 解析容错解析器:大写字(重复节点成数组)、`#text`(带属性的文本节点),两处归一。 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "outline",
  attributesGroupName: false,
})

function textOf(node: Record<string, unknown>): string {
  const t = node["@_text"] ?? node["@_title"] ?? node["#text"] ?? ""
  return typeof t === "string" ? t.trim() : String(t ?? "")
}

function attr(node: Record<string, unknown>, key: string): string {
  const v = node[`@_${key}`]
  return typeof v === "string" ? v.trim() : ""
}

function walk(nodes: unknown, parent: string[], out: OpmlFeed[]): void {
  for (const raw of Array.isArray(nodes) ? nodes : nodes ? [nodes] : []) {
    if (!raw || typeof raw !== "object") continue
    const node = raw as Record<string, unknown>
    const xmlUrl = attr(node, "xmlUrl")
    const type = attr(node, "type").toLowerCase()
    if (xmlUrl && (!type || type === "rss")) {
      out.push({
        title: textOf(node) || xmlUrl,
        xmlUrl,
        htmlUrl: attr(node, "htmlUrl") || undefined,
        groupPath: parent,
      })
    } else {
      // 纯分组节点(xmlUrl 空)或非 rss 节点:后者的子节点仍按当前层级继续走。
      const title = textOf(node)
      walk(node.outline, title ? [...parent, title] : parent, out)
    }
  }
}

/** OPML 字符串 → { title, feeds }。仅收 xmlUrl 非空的 RSS 轮廓。 */
export function parseOpml(xml: string): OpmlDoc {
  const tree = parser.parse(xml) as Record<string, any>
  const opml = tree?.opml ?? {}
  const head = opml.head ?? {}
  const title = typeof head.title === "string" ? head.title : "Subscriptions"
  const feeds: OpmlFeed[] = []
  walk(opml.body?.outline, [], feeds)
  return { title, feeds }
}
