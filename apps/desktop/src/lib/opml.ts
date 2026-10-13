/**
 * opml — SubscriptionGroup[] ↔ OpmlFeed[] 映射(OPML 编解码在 `@tauri-playground/xml`)。
 *
 * 导出:订阅按分组树拼 groupPath(顶层 = []);只导出有可分享 URL 的订阅
 *   (rss:* / rsshub:* 取 info.url)。
 * 导入:groupPath 逐级建/复用分组(标题为路径键,同名共享),每条 feed 落 `rss:url`;
 *   同 xmlUrl 已存在则跳过(不重复订阅)。
 */
import type { Subscription, SubscriptionGroup } from "@tauri-playground/core"
import { serializeOpml, type OpmlDoc, type OpmlFeed } from "@tauri-playground/xml"

/** 订阅 → 上游 feed URL(可分享的订阅才有)。 */
function feedUrlOf(sub: Subscription): string | undefined {
  if (sub.channelKey.startsWith("rss:") || sub.channelKey.startsWith("rsshub:")) {
    const url = sub.info?.url
    return url && url.trim() ? url.trim() : undefined
  }
  return undefined
}

/** 分组 id → 从顶层到自身的标题链(环保护:最多走到根)。 */
function groupPathOf(groupId: string | null | undefined, groups: SubscriptionGroup[]): string[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const path: string[] = []
  let cur = groupId ?? null
  for (let i = 0; cur && i <= groups.length; i++) {
    const g = byId.get(cur)
    if (!g) break
    path.unshift(g.title)
    cur = g.parentId ?? null
  }
  return path
}

/** 订阅清单 → OPML 字符串。 */
export function exportOpml(subscriptions: Subscription[], groups: SubscriptionGroup[], title = "Tauri RSS"): string {
  const feeds: OpmlFeed[] = subscriptions
    .filter((s) => !s.channelKey.startsWith("rsshub:")) // rsshub 走外挂实例,URL 不通用
    .map((s) => {
      const url = feedUrlOf(s)
      return url ? { title: s.title, xmlUrl: url, groupPath: groupPathOf(s.groupId, groups) } : null
    })
    .filter((f): f is OpmlFeed => f !== null)
  return serializeOpml({ title, feeds } satisfies OpmlDoc)
}

/** 导入结果:新 feed(xmlUrl 未订阅过)+ 被跳过的重复数。 */
export interface ImportResult {
  feeds: OpmlFeed[]
  skipped: number
}

/** 过滤出未订阅过的 feed(按 info.url 归一比对;同 xmlUrl 视为重复)。 */
export function pendingImports(doc: OpmlDoc, subscriptions: Subscription[]): ImportResult {
  const have = new Set<string>()
  for (const s of subscriptions) {
    const url = s.info?.url?.trim()
    if (url) have.add(url)
  }
  const feeds: OpmlFeed[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const f of doc.feeds) {
    const url = f.xmlUrl.trim()
    if (!url || have.has(url) || seen.has(url)) {
      skipped++
      continue
    }
    seen.add(url)
    feeds.push({ ...f, xmlUrl: url })
  }
  return { feeds, skipped }
}
