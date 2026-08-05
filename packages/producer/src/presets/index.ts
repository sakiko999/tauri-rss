/**
 * Producer built-in subscription sources — the "all sources collected here,
 * served to any consumer" seam.
 *
 * Consumers enumerate `PRESETS` to offer a source picker, then call
 * `buildPresetSubscription(preset, runtime)` to get a ready-to-persist
 * `Subscription`. The builder is a pure switch over the known preset kinds
 * (compile-time exhaustive via `never`) — intentionally decoupled from the
 * adapter registry so subscriptions can be built before registration.
 */
import type { Subscription } from "../types/subscription.ts"
import type { PresetSubscription } from "./types.ts"
import { RSS_PRESETS } from "./rss-feeds.ts"
import { PLATFORM_PRESETS } from "./platform-feeds.ts"

export type { PresetSubscription, PresetMeta, RssPreset, BilibiliRankPreset, BilibiliPreset, YoutubePreset } from "./types.ts"

/** Runtime fields a subscription needs that a preset doesn't carry. */
export interface PresetRuntime {
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** All built-in subscription sources (rss direct feeds + platform feeds). */
export const PRESETS: readonly PresetSubscription[] = Object.freeze([
  ...RSS_PRESETS,
  ...PLATFORM_PRESETS,
])

export function getPreset(id: string): PresetSubscription | undefined {
  return PRESETS.find((p) => p.id === id)
}

/** Build a full runtime `Subscription` from a preset description. */
export function buildPresetSubscription(
  preset: PresetSubscription,
  runtime: PresetRuntime,
): Subscription {
  const base = {
    id: preset.id,
    title: preset.title,
    enabled: runtime.enabled,
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
  }
  switch (preset.kind) {
    case "rss":
      return { ...base, kind: "rss", url: preset.url }
    case "bilibili-rank":
      return { ...base, kind: "bilibili-rank" }
    case "bilibili":
      return {
        ...base,
        kind: "bilibili",
        route: preset.route,
        ...(preset.rid ? { rid: preset.rid } : {}),
        ...(preset.uid ? { uid: preset.uid } : {}),
      }
    case "youtube":
      return { ...base, kind: "youtube", channelId: preset.channelId }
    default:
      // Exhaustive: adding a preset kind must produce a case above.
      const neverKind: never = preset
      throw new Error(`Unknown preset kind: ${neverKind}`)
  }
}

/** Convenience: look up by id and build. Throws on unknown id. */
export function buildPreset(id: string, runtime: PresetRuntime): Subscription {
  const preset = getPreset(id)
  if (!preset) throw new Error(`Unknown preset id: ${id}`)
  return buildPresetSubscription(preset, runtime)
}
