/**
 * router —— 视图位置路由(react-router,data 模式)。
 *
 * URL 是「视图位置」的唯一真相,store 是「数据」的真相,单向同步:
 *   - `/v/:nodeId?word=` → loader 在渲染前跑,同步 `store.select(nodeId)`;
 *   - `/play/:itemId?from=` → 播放页;from 记住返回位置;
 *   - 其余路径 → 重定向默认视图。
 *
 * 数据不在 loader 里加载(数据在 zustand + DataLayer);路由只定「位置」。
 */
import { createBrowserRouter, Navigate, useNavigate, useParams, useSearchParams } from "react-router"
import App from "./App"
import { DEFAULT_VIEW } from "./store/nodes.ts"
import { useDesktop } from "./store/index.ts"

/** `/v/{nodeId}?word={hotWord}`。 */
export function viewPath(nodeId: string, word?: string): string {
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
    path: "/v/:nodeId",
    Component: App,
    loader: ({ params, request }) => {
      const nodeId = params.nodeId ?? DEFAULT_VIEW
      const word = new URL(request.url).searchParams.get("word")
      const st = useDesktop.getState()
      st.select(nodeId)
      if (word) void st.loadHotWord(word)
      return { nodeId, word }
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
  { path: "*", element: <Navigate to={`/v/${DEFAULT_VIEW}`} replace /> },
])

function RouteError() {
  const navigate = useNavigate()
  return (
    <div className="state-block">
      <p className="state-title">视图渲染出错了</p>
      <button className="btn btn-secondary" onClick={() => navigate(`/v/${DEFAULT_VIEW}`)}>
        回到默认视图
      </button>
    </div>
  )
}
