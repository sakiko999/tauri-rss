/**
 * 全量数据导出（JSON）—— 换机/重装时的「不只是 URL 订阅」的备份。
 *
 * OPML 只能表达 URL 订阅；平台订阅（B站/微博/小红书…）、分组、已读/星标/播放进度/
 * 阅读进度都不在里面。这里从桌面镜像直接导出这些字段。
 *
 * ⚠️ **不含凭证**：settings 里所有 `*Cookie` 字段被剔除，订阅 `info` 里的 cookie 键
 * 也剔除（导出文件会落到下载目录，明文 cookie 不应跟着走）。重装后重新扫码登录即可。
 */

import type { AppSettings, MediaItem, Subscription, SubscriptionGroup } from "@amoeba/core"

export interface DataExport {
  app: "amoeba"
  version: 1
  exportedAt: string
  /** 明文平台凭证已剔除（见文件头）。 */
  credentialsOmitted: true
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  /** 阅读态：已读/星标/续播位置/阅读比例/最近阅读时间（只导出非默认值）。 */
  reading: Array<{
    subscriptionId: string
    itemId: string
    isUnread: boolean
    isStarred: boolean
    positionSec?: number
    scrollRatio?: number
    lastReadAt?: number
  }>
  settings: Omit<AppSettings, `${string}Cookie`>
}

function redactSettings(settings: AppSettings): Omit<AppSettings, `${string}Cookie`> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(settings)) {
    if (k.endsWith("Cookie")) continue
    out[k] = v
  }
  return out as Omit<AppSettings, `${string}Cookie`>
}

/**
 * 订阅 info 是任意字符串表，core 明确支持 `info.cookie` 作为订阅级凭证
 * （调用点显式值优先于 settings 快照）。导出时必须同 settings 一样剔除。
 */
function redactSubscriptions(subscriptions: Subscription[]): Subscription[] {
  return subscriptions.map((sub) => ({
    ...sub,
    info: Object.fromEntries(Object.entries(sub.info).filter(([k]) => !/cookie/i.test(k))),
  }))
}

export function buildDataExport(input: {
  subscriptions: Subscription[]
  groups: SubscriptionGroup[]
  items: MediaItem[]
  settings: AppSettings
  now?: number
}): string {
  const reading: DataExport["reading"] = []
  for (const it of input.items) {
    const touched =
      it.isUnread === false ||
      !!it.isStarred ||
      (it.positionSec ?? 0) > 0 ||
      (it.scrollRatio ?? 0) > 0 ||
      !!it.lastReadAt
    if (!touched) continue
    reading.push({
      subscriptionId: it.subscriptionId,
      itemId: it.id,
      isUnread: it.isUnread !== false,
      isStarred: !!it.isStarred,
      ...(it.positionSec ? { positionSec: it.positionSec } : {}),
      ...(it.scrollRatio ? { scrollRatio: it.scrollRatio } : {}),
      ...(it.lastReadAt ? { lastReadAt: it.lastReadAt } : {}),
    })
  }
  const data: DataExport = {
    app: "amoeba",
    version: 1,
    exportedAt: new Date(input.now ?? Date.now()).toISOString(),
    credentialsOmitted: true,
    subscriptions: redactSubscriptions(input.subscriptions),
    groups: input.groups,
    reading,
    settings: redactSettings(input.settings),
  }
  return JSON.stringify(data, null, 2)
}

/** `<a download>` + Blob（与 OPML 导出同款：WebView2 允许同源 blob 下载）。 */
export function downloadJson(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
