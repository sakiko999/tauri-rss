/**
 * App —— 应用外壳。布局形态由**节点意图**驱动(nodeMeta.type):
 *
 *   reader → [rail | 列表栏(--col) | 正文主区]
 *   media  → [rail | 主区]
 *   page   → [rail | 主区(整页)]
 *   player → [rail | 主区(播放页)]
 *
 * URL 是「视图位置」权威(nodeId 来自 path,router loader 同步 store);
 * 本组件只读 store 渲染。侧栏在播放页也保留(与 new_desktop 一致)。
 */
import { useEffect } from "react"
import { useNavigate, useParams } from "react-router"
import { setNavBridge, useDesktop, useNodeMeta } from "./store/index.ts"
import type { NodeType } from "./store/nodes.ts"
import { TitleBar } from "./components/TitleBar.tsx"
import { Rail } from "./components/Rail.tsx"
import { Toaster } from "./components/Toaster.tsx"
import { ArticlePane } from "./views/library/ArticlePane.tsx"
import { ReaderMain } from "./views/library/ReaderMain.tsx"
import { MediaMain } from "./views/library/MediaMain.tsx"
import { HotPane } from "./views/library/HotPane.tsx"
import { DiscoverPage } from "./views/discover/DiscoverPage.tsx"
import { SettingsPage } from "./views/manage/SettingsPage.tsx"
import { AccountPage } from "./views/manage/AccountPage.tsx"
import { OnboardingModal } from "./views/manage/OnboardingModal.tsx"
import { PlayerPage } from "./views/player/PlayerPage.tsx"
import { CommandPalette } from "./views/palette/CommandPalette.tsx"
import { SocialDetailModal } from "./components/SocialDetailModal.tsx"
import { usePrefs } from "./store/prefs.ts"
import { useGlobalShortcuts } from "./lib/shortcuts.ts"

export default function App() {
  const params = useParams()
  const navigate = useNavigate()
  // ⚠️ `/play/:itemId` 路由下**没有 nodeId**——播放页是独立视图,不该由节点元信息决定,
  // 这里显式分流(params 只用来判播放页)。
  const isPlay = !!params.itemId
  // ⚠️ 布局节点必须**从 store 读**,不能用 `params.nodeId`:
  //   /v 导航走 react-router v7 的 startTransition(低优先级),`params.nodeId` 要等过渡
  //   提交才更新;而 store 的 `view` 经 zustand useSyncExternalStore **同步**提交
  //   (HotPane/MediaMain 直订 store,useSyncExternalStore 不能被 time-slice 推迟)。
  //   两者差一帧 → 中间帧「旧布局渲染新数据」:从热搜切到其它视图时,词栏里被塞进
  //   60 条微博当词条(HotPane 直接渲染 view.list),中栏 scrollTop 从 120 跳到 895
  //   → 视觉抖动。改读 store 的 selectedNodeId(router loader 已同步 select())后,
  //   布局与数据在同一次提交里切换,中间帧消失。
  const storeNodeId = useDesktop((s) => s.selectedNodeId)
  const nodeId = isPlay ? null : storeNodeId
  const init = useDesktop((s) => s.init)
  const initError = useDesktop((s) => s.initError)
  const selectedArticleId = useDesktop((s) => s.selectedArticleId)
  const meta = useNodeMeta(nodeId)
  const railCollapsed = usePrefs((s) => s.railCollapsed)
  useGlobalShortcuts()

  useEffect(() => {
    void init()
  }, [init])

  // 把 router 的 navigate 注入 store(store 不能 import router)——删除当前节点后
  // store 借它同步 URL(「URL 是位置权威」)。
  useEffect(() => {
    setNavBridge((path, opts) => void navigate(path, opts))
    return () => setNavBridge(() => {})
  }, [navigate])

  // 播放页:独立视图,不走节点分发。
  const viewType: NodeType = isPlay ? "player" : meta.type

  // 数据层没起来(宿主未注入 / 库损坏)→ 整页错误,不要白屏。
  if (initError) {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="state-block">
          <p className="state-title">应用数据初始化失败</p>
          <p className="state-text">{initError}</p>
          <div className="state-actions">
            <button className="btn btn-primary" onClick={() => void init()}>
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  // data-sel 供窄屏在「列表 ⇄ 正文」间切换(见 styles.css 的 900px 断点)。
  const sel = viewType === "reader" ? !!selectedArticleId : false

  return (
    <div className="app-shell">
      <TitleBar />
      <div
        className="app-body"
        data-view={viewType}
        data-rail={railCollapsed ? "collapsed" : "expanded"}
        data-sel={String(sel)}
      >
        <Rail />
        {viewType === "reader" ? <ArticlePane /> : viewType === "hot" ? <HotPane /> : null}
        {/* ⚠️ key=nodeId:换节点时重挂主区。不这么做的话 Virtuoso/VirtuosoGrid 会保留
            上一个 feed 的 scrollTop(切换订阅后停在原位置,列表看着像空的)。
            key 只在节点变化时变 —— 热搜词切换(同一节点换 ?word=)不重挂,不会闪。 */}
        <main id="main-region" key={nodeId ?? "home"} className="main-region" tabIndex={-1}>
          {isPlay ? (
            <PlayerPage />
          ) : meta.type === "reader" ? (
            <ReaderMain />
          ) : meta.type === "page" ? (
            meta.node === "page:discover" ? (
              <DiscoverPage />
            ) : meta.node === "page:account" ? (
              <AccountPage />
            ) : (
              <SettingsPage />
            )
          ) : (
            <MediaMain />
          )}
        </main>
      </div>
      <CommandPalette />
      <SocialDetailModal />
      <OnboardingModal />
      <Toaster />
    </div>
  )
}
