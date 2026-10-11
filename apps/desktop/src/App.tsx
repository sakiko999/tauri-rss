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
import { useParams } from "react-router"
import { useDesktop, useNodeMeta } from "./store/index.ts"
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
  // ⚠️ `/play/:itemId` 路由下**没有 nodeId**——直接读 params.nodeId 会拿到 undefined,
  // useNodeMeta 就退回默认 tab:all(media),播放页永远渲染不出来。播放页是独立视图,
  // 不该由节点元信息决定,这里显式分流。
  const isPlay = !!params.itemId
  const nodeId = isPlay ? null : (params.nodeId ?? null)
  const init = useDesktop((s) => s.init)
  const selectedArticleId = useDesktop((s) => s.selectedArticleId)
  const meta = useNodeMeta(nodeId)
  const railCollapsed = usePrefs((s) => s.railCollapsed)
  useGlobalShortcuts()

  useEffect(() => {
    void init()
  }, [init])

  // 播放页:独立视图,不走节点分发。
  const viewType: NodeType = isPlay ? "player" : meta.type
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
        <main id="main-region" className="main-region" tabIndex={-1}>
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
