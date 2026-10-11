/**
 * usePlayerNav —— 卡片/列表的「播放入口」回调收敛处。
 *
 * 三个动作:
 *   - onPlay  → 手势内先 unlockAudioPlayback(否则带声自动播会被 autoplay policy 拦),
 *               再导航到播放页;
 *   - onQueue → 加入播放队列(不跳转);
 *   - onOpen  → social 卡片开详情弹窗,其余打开原文(走宿主 openExternal)。
 *
 * ⚠️ unlockAudioPlayback 必须在**用户手势的同步调用栈**里调用,不能挪进 effect。
 * ⚠️ 打开外链必须走 `appHost.openExternal`(桌面是 Tauri opener 插件)——WebView
 * 会把裸 `window.open` 拦掉,表现为「点了没反应」。
 */
import { useCallback, useMemo } from "react"
import type { MediaItem } from "@tauri-playground/core"
import { unlockAudioPlayback } from "@tauri-playground/player"
import { useDesktop } from "../../store/index.ts"
import { usePlayNavigate } from "../../router.tsx"
import type { CardActions } from "../../components/cards.tsx"

export function usePlayerNav(): CardActions {
  const navigateToPlay = usePlayNavigate()
  const openSocialDetail = useDesktop((s) => s.openSocialDetail)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const toast = useDesktop((s) => s.toast)

  const onPlay = useCallback(
    (item: MediaItem) => {
      unlockAudioPlayback()
      navigateToPlay(item.id)
    },
    [navigateToPlay],
  )

  const onOpen = useCallback(
    (item: MediaItem) => {
      if (item.kind === "social") openSocialDetail(item)
      else if (item.url) void globalThis.appHost.openExternal(item.url)
    },
    [openSocialDetail],
  )

  const onQueue = useCallback(
    (item: MediaItem) => {
      addToQueue(item.id)
      toast("ok", "已加入播放队列", item.title)
    },
    [addToQueue, toast],
  )

  return useMemo(() => ({ onPlay, onOpen, onQueue }), [onPlay, onOpen, onQueue])
}
