/**
 * ChannelInfo — 可用渠道的描述(core 定义,不透出 crawler 的 RssChannel)。
 *
 * 是 crawler `RssChannel` 面向 apps 的投影:apps 添加订阅时只需
 * key/name/kind/sourceInfoTpl/defaultInfo,不感知 crawler 的 source 装配。
 */
import type { SourceInfoField } from "@tauri-playground/crawler"
import type { MediaKind } from "./media-item.ts"

export interface ChannelInfo {
  /** 渠道唯一 key(如 "bili:square"、"rss:hn")。 */
  key: string
  /** 人类可读名称。 */
  name: string
  /** 该 channel 产出的 item 默认 kind。 */
  kind: MediaKind
  /** 实例化 source 需要的参数字段(供 UI 生成表单)。无参 channel 不声明。 */
  sourceInfoTpl?: SourceInfoField[]
  /** 带默认参数的实例(存在 = 无需输入即可订阅一个合理实例)。 */
  defaultInfo?: Record<string, string>
  /** 该渠道是否支持扫码登录(channel 级能力 Loginable;UI 据此显登录入口)。 */
  loginable: boolean
}
