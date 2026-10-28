/**
 * router —— 视图位置路由(react-router,data 模式)。
 *
 * URL 是「视图位置」的唯一真相,store 是「数据」的真相,单向同步:
 *   - `/` → 首页看板,同步 `store.select(HOME_NODE)`;
 *   - `/v/:nodeId?word=` → loader 在渲染前跑,同步 `store.select(nodeId)`;
 *   - `/play/:itemId?from=` → 播放页;from 记住返回位置;
 *   - 其余路径 → 重定向首页。
 *
 * 数据不在 loader 里加载(数据在 zustand + DataLayer);路由只定「位置」。
 */

import { createBrowserRouter, Navigate, useNavigate, useParams, useSearchParams } from "react-router"

import App from "./App"
import { Button } from "./components/Button.tsx"
import { useDesktop } from "./store/index.ts"
import { DEFAULT_VIEW, HOME_NODE, LIBRARY_NODE } from "./store/nodes.ts"

/** `/v/{nodeId}?word={hotWord}`；首页是根路径 `/`（§3.1）。 */
export function viewPath(nodeId: string, word?: string): string {
  // 首页只有一个 URL 形态：生成 /v/home 会让同一个视图有两个地址（深链/分享/返回栈
  // 各记一份），且 `/v/home` 的 loader 还要再走一遍节点判定。
  if (nodeId === HOME_NODE) return "/"
  // 片库同样是「一个视图一个 URL」（§3.1），不让它退化出 /v/library 两种地址。
  if (nodeId === LIBRARY_NODE) return "/library"
  return word ? `/v/${encodeURIComponent(nodeId)}?word=${encodeURIComponent(word)}` : `/v/${encodeURIComponent(nodeId)}`
}

/**
 * `/v/{nodeId}?open={itemId}` —— 在订阅节点里打开一个**容器条目**的二级内容
 * （播客节目 → 单集 / 分区目录 → 房间）。`MediaMain` 据此把预览条目喂给
 * **与正常订阅同一套网格**（只换表头），关掉/返回时去掉 query 即回到容器列表。
 */
export function previewPath(nodeId: string, itemId: string): string {
  return `/v/${encodeURIComponent(nodeId)}?open=${encodeURIComponent(itemId)}`
}

/**
 * `/play/{itemId}?from={nodeId}&sub={subscriptionId}`。
 *
 * `from` 只负责「返回位置」，`sub` 才是条目的订阅身份：聚合节点（tab:all 等）下
 * `from` 是节点 id，不是 subscriptionId，不能拿它当身份用。
 */
export function playPath(itemId: string, from?: string | null, sub?: string | null): string {
  const q = new URLSearchParams()
  if (from) q.set("from", from)
  if (sub) q.set("sub", sub)
  const qs = q.toString()
  return `/play/${encodeURIComponent(itemId)}${qs ? `?${qs}` : ""}`
}

/** 导航到库节点(侧栏 / 热搜词条共用)。 */
export function useViewNavigate(): (nodeId: string, word?: string) => void {
  const navigate = useNavigate()
  return (nodeId, word) => navigate(viewPath(nodeId, word))
}

/** 打开设置页并定位到某个 tab(侧栏/命令面板的「管理分组」用它,否则会落在「外观」)。 */
export function useSettingsNavigate(): (tab: string) => void {
  const navigate = useNavigate()
  return (tab) => navigate(`${viewPath("page:settings")}?tab=${encodeURIComponent(tab)}`)
}

/**
 * 导航到播放页。收**条目**而非裸 id：播放页必须同时拿到 `subscriptionId`，
 * 否则跨订阅同 id 时会定位到另一订阅的条目。
 */
export function usePlayNavigate(): (item: { id: string; subscriptionId: string }, from?: string | null) => void {
  const navigate = useNavigate()
  const nodeId = useDesktop((s) => s.selectedNodeId)
  return (item, from) => navigate(playPath(item.id, from ?? nodeId, item.subscriptionId))
}

/** 当前播放页参数。 */
export function usePlayParams(): { itemId: string | null; from: string | null; sub: string | null } {
  const params = useParams()
  const [sp] = useSearchParams()
  return { itemId: params.itemId ?? null, from: sp.get("from"), sub: sp.get("sub") }
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: App,
    // ⚠️ 首页也**必须**走 select()：App 的布局读的是 store.selectedNodeId，
    // 不调它就会用上一个节点的数据渲染新布局（仓库已踩过同型故障，见 App.tsx 顶部注释）。
    loader: () => {
      useDesktop.getState().select(HOME_NODE)
      return { nodeId: HOME_NODE }
    },
    errorElement: <RouteError />,
  },
  {
    path: "/v/:nodeId",
    Component: App,
    loader: ({ params, request }) => {
      const nodeId = params.nodeId ?? DEFAULT_VIEW
      const sp = new URL(request.url).searchParams
      const word = sp.get("word")
      const st = useDesktop.getState()
      // ⚠️ **只在节点真的变了时才 select()**：loader 在同一条路由的任何 search 变化
      // （?filter= chips、?word=、?open=）上都会重跑，而 select() 会清掉
      // selectedArticleKey 与视图内搜索词 —— 无条件调用时，点一下「未读」chip
      // 右侧正在读的文章就没了、搜索框里的词也消失。
      // 离开热搜（?word= 消失）必须清 hotWord，否则词条栏停在上一词；select() 顺带清掉。
      if (st.selectedNodeId !== nodeId || (!word && st.hotWord)) st.select(nodeId)
      // 阅读筛选也走 URL（D10）：刷新/分享/Alt+← 能还原；没有参数 = 全部。
      // ⚠️ 放在节点同步之后：切节点时 filter 由本条 URL 决定，残留的上一节点 filter 不生效。
      const filter = sp.get("filter")
      st.setFilter(nodeId, { unreadOnly: filter === "unread", starredOnly: filter === "starred" })
      if (word) void st.loadHotWord(word)
      return { nodeId, word, filter }
    },
    errorElement: <RouteError />,
  },
  {
    // 片库 v1 未开放（P1）：深链留一个说明页，不让它被 `*` 静默吞回首页。
    path: "/library",
    Component: App,
    loader: () => {
      useDesktop.getState().select(LIBRARY_NODE)
      return { nodeId: LIBRARY_NODE }
    },
    errorElement: <RouteError />,
  },
  {
    path: "/play/:itemId",
    Component: App,
    // 播放页**不改选中节点**(返回位置由 ?from= 承载),也不碰 selectedArticleKey
    // (那是阅读栏的选择态,塞进播放条目会让返回后正文显示错内容)。
    // 条目 id 由 PlayerPage 自己从路由参数读。
    loader: () => null,
    errorElement: <RouteError />,
  },
  { path: "*", element: <Navigate to="/" replace /> },
])

function RouteError() {
  const navigate = useNavigate()
  return (
    <div className="state-block">
      <p className="state-title">视图渲染出错了</p>
      <Button variant="secondary" onClick={() => navigate("/")}>
        回到首页
      </Button>
    </div>
  )
}
