/**
 * 网络策略投影:settings(整体档位 + 平台覆盖) → 宿主 governor。
 *
 * 从 data-layer.ts 拆出(2026-11-01)。无状态、无 IO —— 只做形状归一与一次
 * best-effort 调用;host 未注入 `net`(浏览器/CLI/旧宿主)时静默跳过,
 * 刷新时的等级闸门仍由 governor 默认策略兜底。
 */

import { platformOfChannelKey } from "@amoeba/platform"

import { getChannel } from "../source/index.ts"
import type { AppSettings, NetLevel } from "../types/settings.ts"

/**
 * 旧版 channelKey 覆盖 → 平台键(2026-10-21 设置页改为只按平台)。
 * 返回 null = 无需迁移(没有 channelKey 键)。
 * 规则与旧运行时投影一致:
 *   - **L0 优先**(显式调试直通,覆盖平台档);
 *   - 其余取**更严格**者(不因个别渠道收紧而误放);
 *   - 被动渠道的存量键**丢弃**(它不产生应用构造的请求,等级无意义)。
 */
export function foldChannelLevels(src: Record<string, NetLevel>): Record<string, NetLevel> | null {
  let changed = false
  const levels: Record<string, NetLevel> = { ...src }
  for (const [key, level] of Object.entries(src)) {
    const platform = platformOfChannelKey(key)
    if (!platform) continue
    delete levels[key]
    changed = true
    if (getChannel(key)?.passive) continue
    const prev = levels[platform]
    if (prev === undefined) levels[platform] = level
    else if (prev === 0 || level === 0) levels[platform] = 0
    else levels[platform] = prev >= level ? prev : level
  }
  return changed ? levels : null
}

/** 把网络策略同步给宿主 governor(best-effort)。 */
export function syncNetPolicy(s: AppSettings): void {
  // governor 按 URL host 只认**平台名**;旧版 channelKey 覆盖先折叠成平台键(正常
  // 启动时已迁移,这里兜底任何尚未迁移的写入)。
  const levels = foldChannelLevels(s.netLevels) ?? s.netLevels
  try {
    // levels 是**整表替换**语义(设置页的完整平台覆盖快照)。
    globalThis.appHost?.net?.configure({ level: s.netLevel, levels })
  } catch {
    /* net 未注入 / 旧宿主:沿用宿主默认策略 */
  }
}
