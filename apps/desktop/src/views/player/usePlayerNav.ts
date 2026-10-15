/**
 * usePlayerNav —— 卡片/列表的「播放入口」回调收敛处。
 *
 * 三个动作:
 *   - onPlay  → 手势内先 unlockAudioPlayback(否则带声自动播会被 autoplay policy 拦),
 *               再导航到播放页;
 *   - onQueue → 加入播放队列(不跳转);
 *   - onOpen  → social 卡片开详情弹窗,其余打开原文(走宿主 openExternal);
 *   - onSubscribeFeed → 播客 feed 条目(Apple 榜单)订成 `rss:podcast`(它没有流)。
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
import { openSocialDetailWithTransition } from "../../lib/viewTransition.ts"
import { isFeedItem, type CardActions } from "../../components/app/Cards.tsx"

export function usePlayerNav(): CardActions {
  const navigateToPlay = usePlayNavigate()
  const navigate = useNavigate()
  const openSocialDetail = useDesktop((s) => s.openSocialDetail)
  const selectArticle = useDesktop((s) => s.selectArticle)
  const markRead = useDesktop((s) => s.markRead)
  const addToQueue = useDesktop((s) => s.addToQueue)
  const addSubscription = useDesktop((s) => s.addSubscription)
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

  /**
   * 播客 feed 条目(Apple 榜单/搜索)的主操作:**把它订成 `rss:podcast`**。
   *
   * 这类条目 `kind:"audio"` 但没有流 —— `url` 是节目的 RSS feed,不是一集音频。
   * 点「播放」必然掉进「该条目不指向可解析的视频链接」,用户只看到「打不开」。
   * 它携带的 feed 恰恰就是订阅所需的参数,所以主操作理应是订阅。
   *
   * 订阅后落到 `rss:podcast`,真正的**单集**会带着 enclosure 直链进来,那些是可播的。
   *
   * ⚠️ 必须声明在 `onPlay` **之前** —— 它进了 onPlay 的依赖数组,是 `const` 绑定,
   * 放后面会 TDZ 报错。
   */
  const onSubscribeFeed = useCallback(
    (item: MediaItem) => {
      const feedUrl = item.url ?? ""
      if (!feedUrl) {
        toast("error", "这条没有 feed 地址", "Apple 目录偶有缺 feedUrl 的条目,已在上游过滤。")
        return
      }
      void addSubscription("rss:podcast", item.title, { url: feedUrl })
        .catch((e: unknown) => toast("error", "订阅失败", e instanceof Error ? e.message : String(e)))
    },
    [addSubscription, toast],
  )

  const onPlay = useCallback(
    (item: MediaItem) => {
      // ⚠️ 收口防护:social / article 都没有可播流,解析必然失败。任何「播放」入口
      // (卡片、命令面板、未来新增的)碰到它们都改走各自的主操作,而不是送进破碎的
      // 播放页。
      if (item.kind === "social") {
        // 同样走形变入口(此处没有源图,helper 会退化为瞬时打开)。
        openSocialDetailWithTransition(() => openSocialDetail(item))
        return
      }
      if (item.kind === "article") {
        openArticle(item)
        return
      }
      // 播客 feed 条目同理:没有流,送进播放页必然破碎 —— 改走「订阅这个播客」。
      if (isFeedItem(item)) {
        onSubscribeFeed(item)
        return
      }
      unlockAudioPlayback()
      navigateToPlay(item.id)
    },
    [navigateToPlay, openSocialDetail, openArticle, onSubscribeFeed],
  )

  const onOpen = useCallback(
    (item: MediaItem) => {
      if (item.kind === "social") openSocialDetailWithTransition(() => openSocialDetail(item))
      else if (item.kind === "article") openArticle(item)
      else openExternalSafely(item.url)
    },
    [openSocialDetail, openArticle],
  )

  const onQueue = useCallback(
    (item: MediaItem) => {
      addToQueue(item)
      toast("ok", "已加入播放队列", item.title)
    },
    [addToQueue, toast],
  )

  return useMemo(
    () => ({ onPlay, onOpen, onQueue, onSubscribeFeed }),
    [onPlay, onOpen, onQueue, onSubscribeFeed],
  )
}
