/**
 * audio-stage —— 音频版式「播放面」的组装（原型 podplay）。
 *
 * PlayerPage（播客单集的 AudioShell）与 VideoSessionStage（听视频的 PlayableMedia
 * audioStage prop）共用同一份 —— 封面/标题/元信息/次要动作只写一遍，两个宿主只是
 * 数据来源不同（页面上下文 vs 会话 store）。
 */

import type { MediaItem, PlaybackChapter } from "@amoeba/core"

import { Button } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { openExternalSafely } from "../../lib/host.ts"
import { fmtAgo, fmtTime, itemKey, mediaUrl, PLATFORM_LABEL, platformOf } from "../../lib/media.ts"
import type { PlayMode } from "../../router.tsx"

export interface AudioStageArgs {
  item: MediaItem
  /** 听视频（true）还是播客单集（false）—— 只影响 kicker 文案与「看视频」按钮。 */
  listening: boolean
  /** 点播视频才有听⇄看（live 无独立音轨）。 */
  canFlipToVideo: boolean
  chapterList: PlaybackChapter[]
  nextInQueue: MediaItem | null
  from: string | null
  playTo: (item: { id: string; subscriptionId: string }, from?: string | null, mode?: PlayMode) => void
}

export function buildAudioStage({
  item,
  listening,
  canFlipToVideo,
  chapterList,
  nextInQueue,
  from,
  playTo,
}: AudioStageArgs) {
  const platform = platformOf(item)
  const durationSec =
    (item as { durationSec?: number; duration?: number }).durationSec ?? (item as { duration?: number }).duration
  return {
    seed: itemKey(item),
    artwork: mediaUrl(item) || undefined,
    kicker: listening ? "正在播放 · 仅音频" : "正在播放 · 播客单集",
    title: item.title,
    subtitle: item.author?.name,
    chapters: chapterList,
    meta: (
      <>
        <span>{fmtAgo(item.publishedAt)}</span>
        {durationSec ? (
          <>
            <span className="opacity-60">·</span>
            <span>{fmtTime(durationSec)}</span>
          </>
        ) : null}
        {platform ? (
          <>
            <span className="opacity-60">·</span>
            <span>{PLATFORM_LABEL[platform] ?? platform}</span>
          </>
        ) : null}
      </>
    ),
    actions: (
      <>
        {canFlipToVideo ? (
          listening ? (
            <Button variant="quiet" size="sm" onClick={() => playTo(item, from)}>
              <Icon name="monitor" size={14} /> 看视频
            </Button>
          ) : (
            <Button variant="quiet" size="sm" onClick={() => playTo(item, from, "listen")}>
              <Icon name="music" size={14} /> 只听声音
            </Button>
          )
        ) : null}
        {nextInQueue ? (
          <Button variant="quiet" size="sm" onClick={() => playTo(nextInQueue, from, listening ? "listen" : undefined)}>
            <Icon name="skipForward" size={14} /> 下一条
          </Button>
        ) : null}
        {item.url ? (
          <Button variant="quiet" size="sm" onClick={() => openExternalSafely(item.url)}>
            <Icon name="external" size={14} /> 打开原文
          </Button>
        ) : null}
      </>
    ),
  }
}
