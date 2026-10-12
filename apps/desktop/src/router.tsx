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

/** `/play/{itemId}?from={nodeId}`。 */
export function playPath(itemId: string, from?: string | null): string {
  const q = from ? `?from=${encodeURIComponent(from)}` : ""
  return `/play/${encodeURIComponent(itemId)}${q}`
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

/** 导航到播放页。 */
export function usePlayNavigate(): (itemId: string, from?: string | null) => void {
  const navigate = useNavigate()
  const nodeId = useDesktop((s) => s.selectedNodeId)
  return (itemId, from) => navigate(playPath(itemId, from ?? nodeId))
}

/** 当前播放页参数。 */
export function usePlayParams(): { itemId: string | null; from: string | null } {
  const params = useParams()
  const [sp] = useSearchParams()
  return { itemId: params.itemId ?? null, from: sp.get("from") }
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
    // 播放页**不改选中节点**(返回位置由 ?from= 承载),也不碰 selectedArticleId
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
