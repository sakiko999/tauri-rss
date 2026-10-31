/**
 * session-queue —— 音频/视频两个会话共用的「队列消费 + 互斥 + 播完自动下一条」。
 *
 * 两会话（audio-session / video-session）在此交汇（它 import 双方，双方不互相
 * import，避免循环）：
 * - `openVideoSession/openAudioSession`：互斥包装（开一路先暂停另一路，防双声）；
 * - `consumeEnded`：播完自动下一条的**唯一**实现 —— 在播放页（onStage）→ 导航下一条
 *   （URL 是位置权威）；浮层态（小窗/迷你条）→ 会话内换条目、**不导航**（用户此刻在
 *   浏览别处，跳页 = 抢走视图；回页时 playTo(会话条目) 天然对齐 URL）。只续**同族**
 *   （audio→audio；video/live→video/live），跨族衔接留给在页导航，避免浮层静默拉起
 *   一整套视频解析。
 */

import type { MediaItem, MediaStream } from "@amoeba/core"

import { itemKey } from "../../lib/media.ts"
import { playPath, router } from "../../router.tsx"
import { useDesktop } from "../../store/index.ts"
import {
  isAudioOnStage,
  setAudioPlayInterceptor,
  setAudioSessionEndedHandler,
  useAudioSession,
} from "./audio-session.ts"
import { isVideoOnStage, useVideoSession } from "./video-session.ts"

/** 全量条目表（allItems + 预览条目）—— PlayerPage 的 `known` 同一语义。 */
export function knownItems(): MediaItem[] {
  const s = useDesktop.getState()
  return s.previewDetail?.items.length ? [...s.allItems, ...s.previewDetail.items] : s.allItems
}

/**
 * 队列里的下一条。按 `subId:itemId` 复合键反查（`MediaItem.id` 只在订阅内唯一）。
 * 可传响应式值（PlayerPage 的 useMemo），缺省现读 store（会话/浮层路径）。
 */
export function nextInQueueOf(item: MediaItem, queue?: string[], known?: MediaItem[]): MediaItem | null {
  const q = queue ?? useDesktop.getState().queue
  const k = known ?? knownItems()
  const idx = q.indexOf(itemKey(item))
  if (idx < 0) return null
  const nextKey = q[idx + 1]
  if (!nextKey) return null
  return k.find((i) => itemKey(i) === nextKey) ?? null
}

/** 同族判定：播客一族，画面（视频/直播）一族。 */
function familyOf(item: MediaItem): "audio" | "video" {
  return item.kind === "audio" ? "audio" : "video"
}

/** 播完自动下一条（两会话的 ended 都汇到这里；onStage=当前条正显示在播放页）。 */
function consumeEnded(kind: "audio" | "video", item: MediaItem) {
  const st = useDesktop.getState()
  if (!(st.settings?.autoPlayNext ?? true)) return
  // ⚠️ 先取下一条再出队：nextInQueueOf 按「当前条在队列中的位置」定位下一条，
  // 出队后再算 indexOf 恒 -1（原页面实现靠渲染期 useMemo 先算好才没踩到）。
  const next = nextInQueueOf(item)
  // 播过的当前条出队（队列是待播列表，不是播放历史）。
  st.removeFromQueue(item)
  if (!next || familyOf(next) !== familyOf(item)) return

  if (kind === "audio") {
    const from = useAudioSession.getState().from
    const onStage = isAudioOnStage()
    const src = (next as { stream?: MediaStream }).stream?.url
    if (onStage) {
      router.navigate(playPath(next.id, from, next.subscriptionId))
    } else if (src) {
      openAudioSession(next, src, next.positionSec, from)
    }
    return
  }

  const vs = useVideoSession.getState()
  const mode = vs.mode === "listen" ? "listen" : undefined
  if (isVideoOnStage(itemKey(item))) {
    router.navigate(playPath(next.id, vs.from, next.subscriptionId, mode))
  } else {
    // 浮层态：会话内换条目（Stage 的 key 变化 → PlayableMedia 正常重挂重建引擎）。
    useVideoSession.getState().open(next, { from: vs.from, mode: vs.mode, startAtSec: next.positionSec })
  }
}

/** 开播客单集：先暂停视频会话（互斥的另一半；video→audio 的 pause 在 video-session.open 里）。 */
export function openAudioSession(item: MediaItem, src: string, startAtSec?: number, from?: string | null) {
  useVideoSession.getState().ctl?.pause()
  useAudioSession.getState().open(item, src, startAtSec, from)
}

// 音频会话的播完/互斥接线（模块级常驻，迷你条状态也生效 —— 补齐旧实现切走后连播失效的缺口）。
setAudioSessionEndedHandler((item) => consumeEnded("audio", item))
setAudioPlayInterceptor(() => useVideoSession.getState().ctl?.pause())

// 供 Stage 的 onEnded 调用（video-session 不能 import 本模块，经 VideoSessionStage 接线）。
export { consumeEnded }
