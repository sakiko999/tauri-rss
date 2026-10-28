/**
 * LibraryPage —— `/library` 深链的落地页：片库 v1 未开放（合流计划 P1/D6）。
 *
 * 为什么留这个页面而不是让 `*` 重定向回首页：用户手上可能已有 `/library` 链接
 * （原型/书签），静默跳首页会让人以为链接坏了。这里明确说「没做」以及**为什么**，
 * 并给出此刻能做的事。
 *
 * ⚠️ v1 **不渲染导航位**：没有任何渠道产出 movie/series/anime（MediaKind 六值里没有），
 * 硬造一个入口就是假功能。真做时见 docs/ui/heliu-redesign-plan.md §7-D14。
 */
import { StateBlock } from "../../components/StateBlock.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useViewNavigate } from "../../router.tsx"
import { HOME_NODE } from "../../store/nodes.ts"

export function LibraryPage() {
  const go = useViewNavigate()
  return (
    <div className="page" {...overlayBlock("library-page", "page:library")}>
      <div className="scroll-area page-scroll" {...overlayBlock("library-scroll", "page:library:scroll")}>
        <div className="page-wrap" {...overlayBlock("library-wrap", "page:library:wrap")}>
          <StateBlock
            icon="layers"
            title="片库还没开放"
            text="片库需要电影/剧集的元数据源，目前没有任何渠道产出这些信息。现在的内容都在订阅里：首页看今日更新与继续观看，发现页可以添加更多源。"
            actions={
              <button className="btn btn-primary" onClick={() => go(HOME_NODE)}>
                回到首页
              </button>
            }
          />
        </div>
      </div>
    </div>
  )
}
