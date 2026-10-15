/**
 * MediaMain —— 非文章节点的网格主区。按内容形态分发:
 *   social 独占 → MasonryGrid 瀑布流
 *   含直播     → 「正在直播」横滑轨 + 「其余内容」网格
 *   其余       → 单个网格
 *
 * 网格保留 VirtuosoGrid 虚拟化(比 new_desktop 的 page-cap 全量渲染更适合大库)。
 * 点击卡片 → 播放入口(手势内 unlockAudioPlayback,见 usePlayerNav)。
 */
import { useCallback, useMemo, useRef } from "react"
import { VirtuosoGrid } from "react-virtuoso"
import { itemKey } from "../../lib/media.ts"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { healthOf } from "../../store/selectors.ts"
import { MediaCard, SocialCard } from "../../components/app/Cards.tsx"
import { GridSkeleton } from "../../components/BootSkeleton.tsx"
import { MasonryGrid } from "../../components/app/MasonryGrid.tsx"
import { LoadMoreFooter } from "../../components/app/LoadMoreFooter.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { usePlayerNav } from "../player/usePlayerNav.ts"
import { useViewNavigate } from "../../router.tsx"

/**
 * Virtuoso 网格的列宽/间距全部走 CSS —— `listClassName="media-grid"`(grid 列模板)
 * + `itemClassName="media-card-item"`(铺满轨道并把卡片拉到等高)。
 *
 * ⚠️ 两个已踩的坑(改前的「卡片参差 + 虚拟化错位」根因):
 *   1. **别用 components.List/Item 覆盖** —— virtuoso 不给 Item 下发宽高,只给
 *      `className`;而 List 的 inline `style` 带 paddingTop/paddingBottom **虚拟化
 *      偏移**,自己拼 style 很容易把它盖掉 → 滚动定位整体错位。
 *   2. **Item 不能 display:flex 成收缩项** —— 卡片会缩到内容宽而非铺满网格轨道。
 */

export function MediaMain() {
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const view = useDesktop((s) => s.view)
  const hotWord = useDesktop((s) => s.hotWord)
  const query = useDesktop((s) => s.query)
  const offline = useDesktop((s) => s.offline)
  const loading = useDesktop((s) => s.loading)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const busy = useDesktop((s) => s.busy)
  const loadHotWord = useDesktop((s) => s.loadHotWord)
  const meta = useNodeMeta(nodeId)
  const actions = usePlayerNav()
  const go = useViewNavigate()
  // ⚠️ 必须在**所有** early return 之前调用(hook 顺序)。
  const wheelRef = useMainRegionWheel()

  // 热搜词流优先(三栏右栏语义)。
  const items = hotWord ? hotWord.items : view.list
  const socialOnly = items.length > 0 && items.every((i) => i.kind === "social")
  const liveItems = useMemo(() => items.filter((i) => i.kind === "live"), [items])
  const restItems = useMemo(() => items.filter((i) => i.kind !== "live"), [items])
  const health = meta.sub ? healthOf(meta.sub, refreshErrors, busy) : "ok"
  const hasMix = liveItems.length > 0 && restItems.length > 0

  // ⚠️ 必须放在**所有 hook 之后**:早返回会让这一支少跑 useMemo,
  //    切换视图时 React 抛「Rendered fewer hooks than expected」整页崩掉。
  // 热搜视图(左栏是词榜)但还没选词:右栏原本会把 51 个热搜词当卡片列一遍 ——
  // 与左栏「热搜榜」完全重复,而且每张卡都显示「未知作者」。没选词时给引导,不复读。
  if (meta.type === "hot" && !hotWord) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <GridHead title={meta.title} />
        <StateBlock icon="speed" title="选一个热搜词" text="点左侧榜单里的任意词，这里会显示该词下的微博。" />
      </div>
    )
  }

  // 热搜词流:加载中 / 失败 / 空 三态必须分开 —— 失败若与加载中同态,右栏会永久
  // 停在「正在取…」且没有重试入口。
  if (hotWord && hotWord.items.length === 0) {
    const retry = () => void loadHotWord(hotWord.word)
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <GridHead title={viewTitleFor(meta, hotWord)} />
        {hotWord.loading ? (
          <StateBlock icon="loader" title={`正在取「${hotWord.word}」下的微博…`} text="热搜词流依赖登录 cookie;若失败会给出提示。" />
        ) : hotWord.error ? (
          <StateBlock
            tone="error"
            icon="alert"
            title={`热搜「${hotWord.word}」加载失败`}
            text={hotWord.error}
            actions={
              <button className="btn btn-secondary" onClick={retry}>
                <Icon name="refresh" size={14} /> 重试
              </button>
            }
          />
        ) : (
          <StateBlock
            icon="inbox"
            title={`「${hotWord.word}」暂无内容`}
            text="这个词下没有取到微博,换个词或稍后再试。"
            actions={
              <button className="btn btn-secondary" onClick={retry}>
                <Icon name="refresh" size={14} /> 重新获取
              </button>
            }
          />
        )}
      </div>
    )
  }

  if (items.length === 0) {
    // 冷启动首轮刷新还没回来 → 出骨架,别闪「这里还没有内容」。
    // 有搜索词时优先报「没有匹配」。⚠️ 启动过渡期由 App 兜(见 App.tsx 的 booting)——
    // 这里只需要管「库已读到、但这一轮刷新还没回来」。
    if (!query && loading) {
      return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <GridHead title={viewTitleFor(meta, hotWord)} />
          <GridSkeleton />
        </div>
      )
    }
    return <MediaEmpty nodeId={nodeId} query={query} offline={offline} hasSub={!!meta.sub} disabled={meta.sub ? !meta.sub.enabled : false} onGo={go} />
  }

  // ⚠️ 计数用 view.total(筛选后的**总数**),不是 items.length —— 后者是分页窗口
  // 内的条数(默认 60,滚动加载才增长)。用窗口长度会出现「侧栏说 900、表头说 240」
  // 的同一视图两个数字。热搜词流不是窗口(全量返回),仍用长度。
  const total = hotWord ? items.length : view.total
  const pageHead = <GridHead title={viewTitleFor(meta, hotWord)} sub={`${total} 条`} health={health} />

  if (socialOnly) {
    return (
      <div ref={wheelRef} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        {pageHead}
        {/* ⚠️ MasonryGrid 自带内层滚动容器(overflow-y-auto),外面不能再套
            scroll-area,否则出现双重滚动条。 */}
        <div style={{ flex: 1, minHeight: 0 }}>
        <MasonryGrid items={items} renderItem={(it) => <SocialCard item={it} actions={actions} />} />
      </div>
      </div>
    )
  }

  if (hasMix) {
    return (
      <div ref={wheelRef} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        {pageHead}
        <div className="rail-block">
          <div className="rail-head">
            <span className="grid-title" style={{ fontSize: "var(--fs-h3)" }}>
              正在直播
            </span>
            <span className="grid-sub">{liveItems.length} 个房间</span>
            <span className="spacer" />
            <button className="chip chip-sm" onClick={() => go("tab:live")}>
              <Icon name="radio" size={12} /> 只看直播
            </button>
          </div>
          <div className="rail-track">
            {liveItems.slice(0, 12).map((it) => (
              <MediaCard key={itemKey(it)} item={it} actions={actions} />
            ))}
          </div>
        </div>
        {/* ⚠️ 滚动器由 VirtuosoGrid 自己持有(className 给它),头/尾走 components,
            不要再包一层 overflow 容器。 */}
        <VirtuosoGrid
          className="scroll-area"
          style={{ flex: 1, minHeight: 0 }}
          data={restItems}
          listClassName="media-grid"
          itemClassName="media-card-item"
          components={{
            // 这只是「其余内容」子网格自身的窗口计数(与上面的总数口径不同,但自洽)。
            Header: () => <GridHead title="其余内容" sub={`${restItems.length} 条`} />,
            Footer: LoadMoreFooter,
          }}
          computeItemKey={(_, it) => itemKey(it)}
          itemContent={(_, it) => <MediaCard item={it} actions={actions} />}
        />
      </div>
    )
  }

  return (
    <div ref={wheelRef} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <VirtuosoGrid
        className="scroll-area"
        style={{ flex: 1, minHeight: 0 }}
        data={items}
        listClassName="media-grid"
        itemClassName="media-card-item"
        components={{ Header: () => pageHead, Footer: LoadMoreFooter }}
        computeItemKey={(_, it) => itemKey(it)}
        itemContent={(_, it) => <MediaCard item={it} actions={actions} />}
      />
    </div>
  )
}

function GridHead({ title, sub, health }: { title: string; sub?: string; health?: string }) {
  return (
    <div className="grid-head">
      <span className="grid-title">{title}</span>
      {sub ? <span className="grid-sub num">{sub}</span> : null}
      <span className="spacer" />
      {health && health !== "ok" ? <span className="status-dot" data-state={health} title="订阅状态" /> : null}
    </div>
  )
}

function MediaEmpty({
  nodeId,
  query,
  offline,
  hasSub,
  disabled,
  onGo,
}: {
  nodeId: string | null
  query: string
  offline: boolean
  hasSub: boolean
  disabled: boolean
  onGo: (id: string) => void
}) {
  if (query) return <StateBlock icon="search" title="没有匹配的内容" text={`当前列表里没有包含「${query}」的条目。`} />
  if (offline) return <StateBlock icon="offline" title="离线模式" text="已跳过网络抓取。切回在线后再刷新。" />
  if (disabled) return <StateBlock icon="lock" title="订阅已停用" text="在「设置 → 订阅」里重新启用它。" />
  if (hasSub)
    return (
      <StateBlock
        icon="inbox"
        title="这个源还没有内容"
        text="点侧栏的刷新按钮抓一次;若持续为空,可能是该房间未开播或需要登录。"
      />
    )
  if (nodeId === "starred") return <StateBlock icon="star" title="还没有星标条目" text="在列表或卡片上点星标图标收藏。" />
  if (nodeId === "unread") return <StateBlock icon="checkCircle" tone="ok" title="全部已读" text="没有未读条目了。" />
  return (
    <StateBlock
      icon="layers"
      title="这里还没有内容"
      text="从「发现」浏览平台分区,或点侧栏的 + 添加一个源。"
      actions={
        <button className="btn btn-primary" onClick={() => onGo("page:discover")}>
          <Icon name="compass" size={14} /> 去发现
        </button>
      }
    />
  )
}

/**
 * 让**整块主区**都能滚 —— 鼠标停在哪都能滚,而不是只有网格那一块。
 *
 * ⚠️ 为什么需要这个:主区里凡是**不在滚动器内部**的元素(表头 `.grid-head`、直播横轨
 * `.rail-block`)都是**滚动死区** —— 鼠标停上去找不到可滚祖先,而 `body` 是
 * `overflow:hidden`(见 `15-base.css`),滚轮完全无反应。实测「全部」页里
 * `.grid-head` + `.rail-block` 合计占掉 **59% 的视口**,用户的主观描述就是
 * 「页面无法上下滑动」。
 *
 * 做法:在**捕获阶段**截获落在主区内的 wheel,手动转给主滚动器。捕获阶段能先于所有
 * 子元素拿到事件,所以不受子元素拦截影响;同时 `preventDefault` 挡住 body 的白滚。
 *
 * ⚠️ 命中判定用**滚轮自身的滚动意图**:`deltaY < 0` 向上滚(只有已经不在顶部时才接,
 * 否则交给祖先,保留「到顶继续滚 → 触发外层行为」的直觉);向下滚则只在**还没到底时**接。
 * ⚠️ 必须排除弹窗/浮层:它们虽在 `#root` 内,但有自己的滚动语义,不该被转走。
 *
 * ⚠️ **用 callback ref,不用 `useRef` + `useEffect(…, [])`** —— 后者只在挂载时跑一次。
 * 而各分支不是立刻渲染的:`items` 初值为空时走「空态」分支,数据到位后才渲染出带 ref 的
 * wrapper —— **元素是同一个组件里新出现的 DOM 节点**,effect 的 `[]` 不会重跑,监听器
 * 就仍挂在旧元素上(或压根没挂)。实测:社交分组表头滚不动,而「全部」可以(后者首屏
 * 就命中该分支,元素没换过)。
 */
function useMainRegionWheel(): (el: HTMLDivElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)
  return useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented) return
      // 浮层(模态/菜单/下拉)有自己的滚动语义。
      if ((e.target as Element | null)?.closest?.("[role=dialog],[role=menu],[role=listbox],.menu,.select-pop,.scrim")) return
      const scroller = el.querySelector<HTMLElement>(".scroll-area:not(.rail-scroll), .h-full.overflow-y-auto")
      if (!scroller) return
      const max = scroller.scrollHeight - scroller.clientHeight
      if (max <= 0) return
      const canGo = e.deltaY < 0 ? scroller.scrollTop > 0 : scroller.scrollTop < max
      if (!canGo) return
      scroller.scrollTop += e.deltaY
      e.preventDefault()
    }
    el.addEventListener("wheel", onWheel, { capture: true, passive: false })
    cleanupRef.current = () => el.removeEventListener("wheel", onWheel, { capture: true })
  }, [])
}
