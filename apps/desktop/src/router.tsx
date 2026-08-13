/**
 * router — 视图位置路由(react-router 8,data 模式)。
 *
 * URL 是「视图位置」的唯一真相,store 是「数据」的真相,单向同步:
 *   - `/v/:nodeId?word=` → loader 在渲染前跑,同步 `store.select(nodeId)`
 *     (URL 变化 → store 更新 → App 读 store 渲染,无首帧闪烁);
 *   - nodeId 直接进 path segment(`tab:all` / `today` / `s-live-douyu` 等,
 *     冒号在 path 段合法,无需 encode);
 *   - word 是热搜词流(weibo:hot 订阅下点词条),navigate 带 `?word=`。
 *
 * data 模式:用 RouterProvider + route objects,拿 errorElement(路由级错误边界),
 * 但不用 loader/action 做数据加载(数据在 zustand DataLayer,路由只定「位置」)。
 */
import { createBrowserRouter, Navigate, useNavigate } from "react-router"
import App from "./App"
import { useDesktop } from "./store"

/** 默认视图:全部 tab。 */
export const DEFAULT_VIEW = "tab:all"

/** URL 形态:`/v/{nodeId}?word={hotWord}`。 */
export function viewPath(nodeId: string, word?: string): string {
  return word ? `/v/${nodeId}?word=${encodeURIComponent(word)}` : `/v/${nodeId}`
}

/** 导航到任意节点(侧栏 / 热搜词条共用)。URL 变化 → loader 同步 store。 */
export function useViewNavigate(): (nodeId: string, word?: string) => void {
  const navigate = useNavigate()
  return (nodeId, word) => navigate(viewPath(nodeId, word))
}

export const router = createBrowserRouter([
  {
    path: "/v/:nodeId",
    Component: App,
    loader: ({ params, request }) => {
      // 渲染前同步 store:select 重置 hotWord + 刷新当前视图;带 word 再加载热搜词流。
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
    // 未知路径(含首访 "/")→ 重定向默认视图。
    path: "*",
    element: <Navigate to={`/v/${DEFAULT_VIEW}`} replace />,
  },
])

/** 路由级错误边界(组件内抛错)。 */
function RouteError() {
  const navigate = useNavigate()
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background">
      <p className="text-sm font-medium">视图渲染出错了</p>
      <button
        onClick={() => navigate(`/v/${DEFAULT_VIEW}`)}
        className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        回到默认视图
      </button>
    </div>
  )
}
