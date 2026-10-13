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
import { useNavigate } from "react-router"
import type { MediaItem } from "@tauri-playground/core"
import { unlockAudioPlayback } from "@tauri-playground/player"
import { nodeTypeOf, useDesktop } from "../../store/index.ts"
import { usePlayNavigate, viewPath } from "../../router.tsx"
import { openExternalSafely } from "../../lib/host.ts"
import type { CardActions } from "../../components/cards.tsx"

export function usePlayerNav(): CardActions {
  const navigateToPlay = usePlayNavigate()
  const navigate = useNavigate()
  const openSocialDetail = useDesktop((s) => s.openSocialDetail)
  const selectArticle = useDesktop((s) => s.selectArticle)
  const markRead = useDesktop((s) => s.markRead)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const toast = useDesktop((s) => s.toast)

  /**
   * 打开文章:标已读 + 选中 + 若**当前节点不是阅读视图**(如在「全部」混合网格、
   * 视频 tab、分组聚合里),跳到文章 tab 用三栏读——否则选中态会指向一个当前视图根本
   * 不渲染正文的条目,点一下像什么都没发生。(参考实现 `new_desktop/js/app.js`
   * 的 openArticle 同此逻辑。)
   *
   * ⚠️ 跳转后**把「选中」排到 loader 之后**:`/v` 的 loader 会调 `select()` 清掉
   * `selectedArticleId`,而 loader 是同步的(在微任务里跑完),故用 setTimeout(0)
   * 走在它后面。zustand 的 useSyncExternalStore 是同步提交,不受 /v 的低优先级
   * transition 影响,选中一定能落上。
   */
  const openArticle = useCallback(
    (item: MediaItem) => {
      // ⚠️ 与 ArticlePane/shortcuts 同款守卫:开「打开即标已读」才标 —— 旧实现无条件
      // 标读,用户关掉该设置后从混合 feed(卡片 onOpen)点文章仍被强制标读(且落库)。
      if (item.isUnread && (useDesktop.getState().settings?.markReadOnOpen ?? true)) markRead(item)
      if (nodeTypeOf(useDesktop.getState().selectedNodeId) !== "reader") {
        navigate(viewPath("tab:article"))
        setTimeout(() => selectArticle(item.id), 0)
        return
      }
      selectArticle(item.id)
    },
    [navigate, markRead, selectArticle],
  )

  const onPlay = useCallback(
    (item: MediaItem) => {
      // ⚠️ 收口防护:social / article 都没有可播流,解析必然失败。任何「播放」入口
      // (卡片、命令面板、未来新增的)碰到它们都改走各自的主操作,而不是送进破碎的
      // 播放页。
      if (item.kind === "social") {
        openSocialDetail(item)
        return
      }
      if (item.kind === "article") {
        openArticle(item)
        return
      }
      unlockAudioPlayback()
      navigateToPlay(item.id)
    },
    [navigateToPlay, openSocialDetail, openArticle],
  )

  const onOpen = useCallback(
    (item: MediaItem) => {
      if (item.kind === "social") openSocialDetail(item)
      else if (item.kind === "article") openArticle(item)
      else openExternalSafely(item.url)
    },
    [openSocialDetail, openArticle],
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
