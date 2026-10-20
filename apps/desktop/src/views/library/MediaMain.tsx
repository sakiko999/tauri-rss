/**
 * MediaMain —— 非文章节点的网格主区。按内容形态分发:
 *   social 独占 → MasonryGrid 瀑布流
 *   含直播     → 「正在直播」横滑轨 + 「其余内容」网格
 *   其余       → 单个网格
 *
 * 网格保留 VirtuosoGrid 虚拟化(比 new_desktop 的 page-cap 全量渲染更适合大库)。
 * 点击卡片 → 播放入口(手势内 unlockAudioPlayback,见 usePlayerNav)。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate, useSearchParams } from "react-router"
import { VirtuosoGrid } from "react-virtuoso"
import type { CategoryItem, MediaItem } from "@amoeba/core"
import { itemKey } from "../../lib/media.ts"
import { useDesktop, useNodeMeta } from "../../store/index.ts"
import { viewTitleFor } from "../../store/nodes.ts"
import { healthOf, matchesQuery } from "../../store/selectors.ts"
import { sameInfo } from "../../store/lib.ts"
import { isCategoryItem, isFeedItem, MediaCard, SocialCard } from "../../components/app/Cards.tsx"
import { GridSkeleton } from "../../components/BootSkeleton.tsx"
import { PreviewSkeleton } from "../../components/PreviewSkeleton.tsx"
import { MasonryGrid } from "../../components/app/MasonryGrid.tsx"
import { LoadMoreFooter } from "../../components/app/LoadMoreFooter.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { usePlayerNav } from "../player/usePlayerNav.ts"
import { useViewNavigate, viewPath } from "../../router.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

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
  const allItems = useDesktop((s) => s.allItems)
  const [searchParams] = useSearchParams()
  const preview = useDesktop((s) => s.previewDetail)
  const openPreview = useDesktop((s) => s.openPreviewDetail)

  // 二级订阅：`?open=<itemId>` 打开当前订阅里的「容器条目」(播客节目 / 分区目录)。
  // ⚠️ 从 allItems 查而不是 view.list —— 目录订阅可能有几百条，view.list 只是窗口。
  const openId = searchParams.get("open")
  const openItem = useMemo(
    () => (openId ? allItems.find((i) => i.subscriptionId === nodeId && i.id === openId) ?? null : null),
    [allItems, nodeId, openId],
  )
  // 容器条目 → 拉它的二级内容。结果只存 store 的 previewDetail（不落库/不建订阅）。
  const container = openItem && (isFeedItem(openItem) || isCategoryItem(openItem)) ? openItem : null
  const previewKey = container ? `${container.subscriptionId}:${container.id}` : null
  const previewCurrent = previewKey && preview?.key === previewKey ? preview : null
  useEffect(() => {
    if (container) void openPreview(container)
  }, [container, openPreview])

  // 热搜词流优先(三栏右栏语义)；二级订阅时是预览条目 —— 与正常订阅共用下面的网格。
  // ⚠️ 预览也过一遍搜索:`previewDetail.items` 不走 `queryView`,不过滤的话顶栏搜索
  // 在预览里会**静默失效**(输入后列表不变,用户以为搜索坏了)。
  const items = container
    ? (previewCurrent?.items ?? []).filter((i) => matchesQuery(i, query))
    : hotWord
      ? hotWord.items
      : view.list
  const socialOnly = items.length > 0 && items.every((i) => i.kind === "social")
  const liveItems = useMemo(() => items.filter((i) => i.kind === "live"), [items])
  const restItems = useMemo(() => items.filter((i) => i.kind !== "live"), [items])
  const health = meta.sub ? healthOf(meta.sub, refreshErrors, busy) : "ok"
  const hasMix = liveItems.length > 0 && restItems.length > 0

  // 二级订阅：只换表头与数据源，正文继续用与正常订阅**同一套网格/卡片**。
  // 加载 / 失败 / 空 三态分开 —— 失败若与加载中同态，会永久停在骨架且没有重试入口。
  if (container) {
    const head = <PreviewHead item={container} count={items.length} />
    const shell = (body: ReactNode) => (
      <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:preview")}>
        {head}
        {body}
      </div>
    )
    // 骨架与落地形态对齐:播客节目 → 单集行列表;分区目录 → 房间网格。
    // ⚠️ 用 PreviewSkeleton 而不是全局 GridSkeleton:后者的标题占位条会和
    // PreviewHead(真实表头)重复,加载完成时内容整体跳一下。
    const previewSkeleton = container.kind === "audio" ? "list" : "grid"
    if (!previewCurrent || previewCurrent.loading) {
      return shell(<PreviewSkeleton mode={previewSkeleton} />)
    }
    if (previewCurrent.error) {
      return shell(
        <StateBlock
          tone="error"
          icon="alert"
          title={container.kind === "category" ? "读不到该分区的内容" : "读不到该节目的单集"}
          text={previewCurrent.error}
          actions={
            <button className="btn btn-secondary" onClick={() => void openPreview(container, { force: true })}>
              <Icon name="refresh" size={14} /> 重试
            </button>
          }
        />,
      )
    }
    if (items.length === 0) {
      return shell(
        <StateBlock
          icon="inbox"
          title={container.kind === "category" ? "该分区当前没有内容" : "这个节目暂时没有单集"}
          text="可能暂时没有内容；稍后重试或换一个条目。"
          actions={
            <button className="btn btn-secondary" onClick={() => void openPreview(container, { force: true })}>
              <Icon name="refresh" size={14} /> 重新获取
            </button>
          }
        />,
      )
    }
  }

  // `?open=` 指向的容器条目已被刷新替换掉(目录订阅换了一批):静默退回目录网格、
  // 地址栏却还留着 `?open=`,用户看到的是「点了没反应」。明确报出来并给返回入口。
  if (openId && !openItem) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:preview-missing")}>
        <StateBlock
          icon="inbox"
          title="这条内容已被刷新替换"
          text="目录订阅刷新后原来的条目可能不在了，返回列表重新选择。"
          actions={
            <button className="btn btn-secondary" onClick={() => go(nodeId ?? "tab:all")}>
              <Icon name="back" size={14} /> 返回列表
            </button>
          }
        />
      </div>
    )
  }

  // ⚠️ 必须放在**所有 hook 之后**:早返回会让这一支少跑 useMemo,
  //    切换视图时 React 抛「Rendered fewer hooks than expected」整页崩掉。
  // 热搜视图(左栏是词榜)但还没选词:右栏原本会把 51 个热搜词当卡片列一遍 ——
  // 与左栏「热搜榜」完全重复,而且每张卡都显示「未知作者」。没选词时给引导,不复读。
  if (meta.type === "hot" && !hotWord) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:main")}>
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
      <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:main")}>
        <GridHead title={viewTitleFor(meta, hotWord)} />
        {hotWord.loading ? (
          <StateBlock icon="loader" title={`正在取「${hotWord.word}」下的微博…`} text="热搜词流需要登录；若失败会给出提示。" />
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
        <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:main")}>
          <GridHead title={viewTitleFor(meta, hotWord)} />
          <GridSkeleton />
        </div>
      )
    }
    return <MediaEmpty nodeId={nodeId} query={query} offline={offline} hasSub={!!meta.sub} disabled={meta.sub ? !meta.sub.enabled : false} onGo={go} />
  }

  // ⚠️ 计数用 view.total(筛选后的**总数**),不是 items.length —— 后者是分页窗口
  // 内的条数(默认 60,滚动加载才增长)。用窗口长度会出现「侧栏说 900、表头说 240」
  // 的同一视图两个数字。热搜词流 / 二级预览不是窗口(全量返回),仍用长度。
  const total = container || hotWord ? items.length : view.total
  const pageHead = container ? (
    <PreviewHead item={container} count={total} />
  ) : (
    <GridHead title={viewTitleFor(meta, hotWord)} sub={`${total} 条`} health={health} />
  )

  if (socialOnly) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:main")}>
        {/* ⚠️ MasonryGrid 自带内层滚动容器(overflow-y-auto),外面不能再套
            scroll-area,否则出现双重滚动条。头部**传进去**(而不是放外面):
            在外面就是滚动死区,而且头不会跟着滚走 —— 用户要的是整体一起滚。 */}
        <div className="flex-1 min-h-0" {...overlayBlock("social-grid", "media:social-grid")}>
          <MasonryGrid
            items={items}
            renderItem={(it) => <SocialCard item={it} actions={actions} />}
            header={pageHead}
          />
        </div>
      </div>
    )
  }

  if (hasMix) {
    // ⚠️ **头 + 直播轨必须在滚动器内部**(走 VirtuosoGrid 的 `Header`),整块一起滚。
    // 曾放在滚动器**外面**作 flex 兄弟:那样它们既**不跟着滚走**(与用户预期不符:
    // 「上下作为整体滚动」),又是**滚动死区** —— 鼠标停上去找不到可滚祖先,而 body 是
    // `overflow:hidden`,滚轮完全无反应(实测这两块合计占视口 59%)。
    const mixHeader = (
      <>
        {pageHead}
        <div className="live-block" {...overlayBlock("live-block", "media:live")}>
          <div className="live-block-head">
            <span className="grid-title" style={{ fontSize: "var(--fs-h3)" }}>
              正在直播
            </span>
            <span className="grid-sub">{liveItems.length} 个房间</span>
            <span className="spacer" />
            <button className="chip chip-sm" onClick={() => go("tab:live")}>
              <Icon name="radio" size={12} /> 只看直播
            </button>
          </div>
          <div className="live-track" {...overlayBlock("live-track", "media:live-track")}>
            {liveItems.slice(0, 12).map((it) => (
              <MediaCard key={itemKey(it)} item={it} actions={actions} />
            ))}
          </div>
        </div>
        <GridHead title="其余内容" sub={`${restItems.length} 条`} />
      </>
    )
    return (
      <div className="flex min-h-0 flex-1 flex-col" {...overlayBlock("media-main", "media:main")}>
        {/* ⚠️ 滚动器由 VirtuosoGrid 自己持有(className 给它),头/尾走 components,
            不要再包一层 overflow 容器。 */}
        <VirtuosoGrid
          className="scroll-area flex-1 min-h-0"
          data={restItems}
          listClassName="media-grid"
          itemClassName="media-card-item"
          components={{
            Header: () => mixHeader,
            Footer: LoadMoreFooter,
          }}
          computeItemKey={(_, it) => itemKey(it)}
          itemContent={(_, it) => <MediaCard item={it} actions={actions} />}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <VirtuosoGrid
        className="scroll-area flex-1 min-h-0"
        data={items}
        listClassName="media-grid"
        itemClassName="media-card-item"
        // ⚠️ 预览不挂 LoadMoreFooter:它读的是**目录订阅节点**的 canLoadMore / growPage,
        // 与预览数据无关 —— 会出现「点加载更多，预览一条不变，却把目录窗口撑大」。
        components={{ Header: () => pageHead, ...(container ? {} : { Footer: LoadMoreFooter }) }}
        computeItemKey={(_, it) => itemKey(it)}
        itemContent={(_, it) => <MediaCard item={it} actions={actions} />}
      />
    </div>
  )
}

/**
 * 二级订阅的表头：返回 / 标题 / 条数 / 订阅。**只换头，正文仍是下面的正常网格**。
 * 订阅目标：播客 feed → `rss:podcast` + `{url}`；分区目录 → 条目自带的渠道 + 完整参数。
 */
function PreviewHead({ item, count }: { item: MediaItem; count: number }) {
  const navigate = useNavigate()
  const subscriptions = useDesktop((s) => s.subscriptions)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const toast = useDesktop((s) => s.toast)
  const [subscribing, setSubscribing] = useState(false)

  const kind: "feed" | "category" = item.kind === "category" ? "category" : "feed"
  const target =
    item.kind === "category"
      ? {
          channelKey: (item as CategoryItem).categoryChannel,
          info: (item as CategoryItem).categoryInfo ?? {},
        }
      : { channelKey: "rss:podcast", info: { url: item.url ?? "" } }
  // ⚠️ 判重必须与 `addSubscription` 用同一套判据(`sameInfo`:键序无关、空值同义)。
  // 自己写 `===` 会在参数被归一化过(如 Twitch 分类填目录链接)时判成「未订阅」→
  // 点一下建出第二条同内容订阅;空 info 时 `every()` 又恒真 → 永远显示「已订阅」。
  const alreadySubscribed = subscriptions.some((s) => s.channelKey === target.channelKey && sameInfo(s.info ?? {}, target.info))

  async function subscribe() {
    if (!target.channelKey || alreadySubscribed) return
    setSubscribing(true)
    try {
      await addSubscription(target.channelKey, item.title, target.info)
    } catch (e) {
      toast("error", kind === "feed" ? "订阅失败" : "订阅该分区失败", e instanceof Error ? e.message : String(e))
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <div
      className="grid-head"
      {...overlayBlock("preview-head", `preview:${item.subscriptionId}:${item.id}`)}
    >
      <button className="btn btn-quiet btn-sm" onClick={() => navigate(viewPath(item.subscriptionId))}>
        <Icon name="back" size={13} /> 返回
      </button>
      <span className="grid-title od-truncate">{item.title}</span>
      <span className="grid-sub">
        {kind === "feed" ? "单集" : "分区内容"} · {count} 条（预览，不写入订阅）
      </span>
      <span className="spacer" />
      <button className="btn btn-secondary btn-sm" disabled={subscribing || alreadySubscribed} onClick={() => void subscribe()}>
        {subscribing ? (
          <Icon name="loader" size={13} className="animate-spin" />
        ) : alreadySubscribed ? (
          <Icon name="check" size={13} />
        ) : (
          <Icon name="plus" size={13} />
        )}
        {alreadySubscribed ? "已订阅" : kind === "feed" ? "订阅该节目" : "订阅该分区"}
      </button>
    </div>
  )
}

function GridHead({ title, sub, health }: { title: string; sub?: string; health?: string }) {
  return (
    <div className="grid-head" {...overlayBlock("media-head", `media:head:${title}`)}>
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
