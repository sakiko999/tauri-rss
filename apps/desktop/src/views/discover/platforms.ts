/**
 * 发现页共用的平台/能力常量(DiscoverPage 与 PlatformBrowser 都要用)。
 *
 * 2026-11-01:「搜索房间」能力随关键词搜索渠道删除（`*:search` / `youtube:live-search`
 * 只适合一次性检索），保留「分区浏览」与「搜主播」。
 */
export type Cap = "category" | "anchor"

/** 展示用的平台清单(能力从渠道注册表推导,不在数据里写死)。品牌图标按 id 取。 */
export const PLATFORMS: Array<{ id: string; label: string }> = [
  { id: "bili", label: "B站" },
  { id: "douyu", label: "斗鱼" },
  { id: "huya", label: "虎牙" },
  { id: "douyin", label: "抖音" },
  { id: "youtube", label: "YouTube" },
  { id: "twitch", label: "Twitch" },
  { id: "weibo", label: "微博" },
  { id: "xhs", label: "小红书" },
]

export const CAPS: Cap[] = ["category", "anchor"]
export const CAP_LABEL: Record<Cap, string> = { category: "分区浏览", anchor: "搜主播" }

/** PlatformBrowser 子视图(与 Cap 同键)的中文名。 */
export const VIEW_LABEL: Record<Cap, string> = { category: "分区", anchor: "主播" }
