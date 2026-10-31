/**
 * 由设置派生的纯策略函数（零运行时依赖，`@amoeba/platform` 是零依赖叶子）。
 *
 * 从 data-layer.ts 拆出（2026-11-01）：desktop 要在首屏用它们，而 data-layer 会静态
 * 拉进 crawler/resolve。对外经 `@amoeba/core/pure` 与根入口两处导出。
 */

import { cookieFieldForChannelKey, cookieFieldOf } from "@amoeba/platform"

import type { AppSettings } from "./types/settings.ts"
import type { Subscription } from "./types/subscription.ts"

/**
 * 内容缓存 TTL（ms）：订阅级 `refreshIntervalSec` 优先，否则全局 `refreshIntervalMin`。
 * 消费方：doRefresh 的 TTL 短路、desktop 选中订阅时的自动补刷判据。
 */
export function contentTtlMs(
  sub: Pick<Subscription, "refreshIntervalSec">,
  s: Pick<AppSettings, "refreshIntervalMin">,
): number {
  return sub.refreshIntervalSec ? sub.refreshIntervalSec * 1000 : s.refreshIntervalMin * 60 * 1000
}

/**
 * channelKey 前缀 → settings 里存的 cookie 字段。
 * **单一权威 = `@amoeba/platform` 的 PLATFORMS 表**（R9）：sourceInfoFor 注入 /
 * scanLogin 写回 / CLI 探针 / desktop 账号页全部经此，禁止再手抄前缀表。
 */
export function cookieFieldFor(channelKey: string): keyof AppSettings | undefined {
  return cookieFieldForChannelKey(channelKey) as keyof AppSettings | undefined
}

/** 平台名（governor 分类语义）→ settings cookie 字段（同一张 `@amoeba/platform` 表）。 */
export function cookieFieldForPlatform(platform: string): keyof AppSettings | undefined {
  return cookieFieldOf(platform) as keyof AppSettings | undefined
}
