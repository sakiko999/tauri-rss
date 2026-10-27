/**
 * HomeView —— 「合流」首页看板（M3，业务件：读 store、吃 domain 类型）。
 *
 * 五个区块的数据**全部**由 store/selectors 的纯函数在客户端派生（零协议改动）：
 *   今日计数 → todayCounts · 正在直播 → selectLive · 继续观看 → resumeWithPct
 *   订阅更新 → groupedBySub · 为你精选 → picksMix
 *
 * ⚠️ 本视图自带滚动（.home-view.scroll-area），**不要**塞进 MasonryGrid 之类的
 *    内滚容器（会变成区块内二次滚动），也不要再包一层 overflow。
 * ⚠️ useMemo 依赖只认 allItems / subscriptions —— store 换引用即重算；
 *    不能把 Date.now() 直接写进依赖（每帧都变，memo 永远失效）。
 */
import { useMemo } from "react"
import type { MediaItem } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { groupedBySub, isToday, picksMix, resumeWithPct, selectLive, todayCounts } from "../../store/selectors.ts"
import { mediaUrl } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { useViewNavigate } from "../../router.tsx"
import { usePlayerNav } from "../player/usePlayerNav.ts"
import { HomeFeature } from "./HomeFeature.tsx"
import { HomeLivePanel } from "./HomeLivePanel.tsx"
import { HomeResumeRail } from "./HomeResumeRail.tsx"
import { HomeFeedRows } from "./HomeFeedRows.tsx"
import { HomePicks } from "./HomePicks.tsx"

function greetingOf(hour: number): string {
  if (hour < 12) return "早上好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

export function HomeView() {
  const allItems = useDesktop((s) => s.allItems)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const offline = useDesktop((s) => s.offline)
  const setOffline = useDesktop((s) => s.setOffline)
  const refreshAll = useDesktop((s) => s.refreshAll)
  const toggleStar = useDesktop((s) => s.toggleStar)
  const go = useViewNavigate()
  const actions = usePlayerNav()

  // 「现在」只在数据变化时刷新一次（见文件头：不能进依赖的每帧值）。
  const now = useMemo(() => Date.now(), [allItems, subscriptions])

  const counts = useMemo(() => todayCounts(allItems, now), [allItems, now])
  const feature = useMemo(() => {
    const today = allItems
      .filter((i) => i.kind === "article" && isToday(i.publishedAt, now))
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    // 优先「今日未读且有图」；没有就退到今日最新（有无图都行，无图走纯文字 hero）。
    return today.find((i) => i.isUnread && !!mediaUrl(i)) ?? today[0] ?? null
  }, [allItems, now])
  const live = useMemo(() => selectLive(allItems, 4), [allItems])
  const resume = useMemo(() => resumeWithPct(allItems).slice(0, 8), [allItems])
  const feeds = useMemo(() => groupedBySub(allItems, subscriptions, 2).slice(0, 6), [allItems, subscriptions])
  const picks = useMemo(() => picksMix(allItems, 12), [allItems])

  // 继续观看：文章续读走阅读视图，视频/音频进播放。播放入口一律经 usePlayerNav。
  const onResumeOpen = (item: MediaItem) => {
    if (item.kind === "article") actions.onOpen?.(item)
    else actions.onPlay(item)
  }

  // 精选只有动态与影音：动态开详情弹窗，视频进播放。
  const onPickOpen = (item: MediaItem) => {
    if (item.kind === "social") actions.onOpen?.(item)
    else actions.onPlay(item)
  }

  // 全空态：离线 / 没有订阅 / 有订阅但一条内容都没有。三件事的下一步动作不同，
  // 不能合成一句「暂无数据」。离线判断排在最前：此刻「刷新」按下去也不会发请求，
  // 把它当主操作是假动作。
  if (allItems.length === 0 && offline) {
    return (
      <div className="home-view home-empty scroll-area" {...overlayBlock("home", "home:empty")}>
        <StateBlock
          tone="warn"
          icon="offline"
          title="离线模式"
          text="已跳过网络抓取，当前镜像里没有内容。切回在线后刷新一次。"
          actions={
            <button className="btn btn-primary" onClick={() => setOffline(false)}>
              切回在线
            </button>
          }
        />
      </div>
    )
  }
  if (subscriptions.length === 0) {
    return (
      <div className="home-view home-empty scroll-area" {...overlayBlock("home", "home:empty")}>
        <StateBlock
          icon="compass"
          title="还没有订阅"
          text="去发现页挑一个源，或粘贴 RSS 地址添加订阅。订阅之后，今天的更新、直播和继续观看会汇到这里。"
          actions={
            <button className="btn btn-primary" onClick={() => go("page:discover")}>
              <Icon name="compass" size={14} /> 去发现页添加订阅
            </button>
          }
        />
      </div>
    )
  }
  if (allItems.length === 0) {
    return (
      <div className="home-view home-empty scroll-area" {...overlayBlock("home", "home:empty")}>
        <StateBlock
          icon="inbox"
          title="订阅还没有内容"
          text="可能是源暂时为空，或首轮抓取失败。刷新一次；若持续为空，检查该源是否已停用。"
          actions={
            <>
              <button className="btn btn-primary" onClick={() => void refreshAll(true)}>
                <Icon name="refresh" size={14} /> 刷新
              </button>
              <button className="btn btn-secondary" onClick={() => go("page:discover")}>
                去发现页添加订阅
              </button>
            </>
          }
        />
      </div>
    )
  }

  const dt = new Date(now)
  const dateText = `${dt.getMonth() + 1} 月 ${dt.getDate()} 日 · 周${"日一二三四五六"[dt.getDay()]}`
  // 概览只写**能算准**的两件事。「今日有更新」不写「今日 N 篇」：YouTube InnerTube /
  // bili:precious 等源刻意不设 publishedAt，精确计数会漏掉它们（§2.2 文案修正 ①）；
  // 计数为 0 时整句不出现 —— 「今日暂无更新」在全是无时间戳源的库里是假话。
  const summaryParts: string[] = []
  if (counts.total > 0) summaryParts.push(`今日有更新 ${counts.total} 条`)
  if (counts.liveNow > 0) summaryParts.push(`${counts.liveNow} 场直播进行中`)

  return (
    <div className="home-view scroll-area" {...overlayBlock("home", "home:view")}>
      <header className="home-head">
        <h1 className="home-greet">{greetingOf(dt.getHours())}</h1>
        <p className="home-date">{dateText}</p>
        {summaryParts.length > 0 ? <p className="home-summary">{summaryParts.join(" · ")}</p> : null}
      </header>

      {feature ? <HomeFeature item={feature} onRead={(item) => actions.onOpen?.(item)} onLater={toggleStar} /> : null}

      <HomeLivePanel items={live} onPlay={actions.onPlay} />

      <HomeResumeRail entries={resume} onOpen={onResumeOpen} />

      <HomeFeedRows feeds={feeds} onOpenSub={(sub) => go(sub.id)} />

      <HomePicks items={picks} onOpen={onPickOpen} />
    </div>
  )
}
