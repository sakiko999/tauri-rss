/**
 * PresetSubscription — the producer's *built-in subscription sources*.
 *
 * A preset is a static, human-authored description of one subscribable source
 * (id/title/tag + kind-specific config). It is NOT a runtime `Subscription`
 * (no enabled/createdAt/updatedAt — those are injected at construction via
 * `buildPresetSubscription`).
 *
 * This is the "all subscription sources, collected in producer, served to any
 * consumer" seam. Consumers enumerate `PRESETS` to offer a source picker, and
 * call `buildPresetSubscription(preset, runtime)` to get a ready-to-persist
 * `Subscription`.
 *
 * Note: `youtube` is not part of `KnownKind` — it rides the open string fallback
 * (`string & {}`), matching `YoutubeSource.kind = "youtube" as const`.
 */

/** Human-readable sourcing hints — not part of the runtime subscription. */
export interface PresetMeta {
  /** Source region, e.g. "cn" | "us" | "kr" | "pl" | "tw". */
  region?: string
  /** Content language, e.g. "zh" | "en". */
  lang?: string
  /** Remark (provenance / measured availability). */
  note?: string
}

/** Fields every preset carries. */
interface PresetBase {
  id: string
  title: string
  /** Human-readable media/format label, e.g. "RSS · 纯文". */
  tag: string
  meta?: PresetMeta
}

/** A direct RSS/Atom feed URL. */
export interface RssPreset extends PresetBase {
  kind: "rss"
  url: string
}

/** Bilibili hot-search (zero-signature API). */
export interface BilibiliRankPreset extends PresetBase {
  kind: "bilibili-rank"
}

/** Bilibili multi-route API (maps to BilibiliSubscription). */
export interface BilibiliPreset extends PresetBase {
  kind: "bilibili"
  route: "popular" | "ranking" | "weekly" | "user-video"
  /** Ranking partition (e.g. "all"); UP 主 uid for user-video. */
  rid?: string
  uid?: string
}

/** YouTube channel via official RSS. */
export interface YoutubePreset extends PresetBase {
  kind: "youtube"
  channelId: string
}

export type PresetSubscription =
  | RssPreset
  | BilibiliRankPreset
  | BilibiliPreset
  | YoutubePreset
