/**
 * Subscription types — the *config* layer("what you follow")。
 *
 * 一个订阅 = 一个 crawler channel(channelKey)+ 实例化参数(info)。
 * `channel.getSource(info).fetch()` 产出 RSS XML,由 core 解析成 MediaItem 存 store。
 * 无 kind 判别:按 channelKey 查 crawler 注册表,自由组合不同 source。
 */
/** 字段,形如 "rss:hn" / "bili:live" / "youtube" / "live:douyu"。 */
export interface Subscription {
  id: string
  /** 渠道 key(crawler 注册表),如 "rss:hn" / "bili:live" / "youtube"。 */
  channelKey: string
  title: string
  /** 分组树节点(单值;null/undefined = 顶层)。 */
  groupId?: string | null
  enabled: boolean
  /** 实例化 source 的参数,直接传给 channel.getSource(info)。 */
  info: Record<string, string>
  createdAt: number
  updatedAt: number
  /** 每订阅刷新间隔覆盖。 */
  refreshIntervalSec?: number
}

/** 一个用户自定义分组(follow 树节点)。 */
export interface SubscriptionGroup {
  id: string
  title: string
  icon?: string
  /** 嵌套;null/undefined = 顶层。 */
  parentId?: string | null
}
