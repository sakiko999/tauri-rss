/**
 * HotPane —— 微博热搜的词条栏(窄栏)。
 *
 * 热搜订阅本身是一次抓取:条目即「热搜词」。点词条 → URL 带 `?word=`,
 * 右栏变成该词下的微博内容流(store.loadHotWord → dl.resolveHotWord)。
 * 用词条 item 的 author.name 承载热度值(weibo:hot 渠道的既有约定)。
 */
import { useMemo } from "react"
import { useDesktop } from "../../store/index.ts"
import { baseFor } from "../../store/selectors.ts"
import { Icon } from "../../components/Icon.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { useViewNavigate } from "../../router.tsx"

export function HotPane() {
  const view = useDesktop((s) => s.view)
  const nodeId = useDesktop((s) => s.selectedNodeId)
  const hotWord = useDesktop((s) => s.hotWord)
  const go = useViewNavigate()

  // ⚠️ 用 baseFor 取该节点**未经过滤**的条目,不用 view.list —— 后者已套用全局
  // 搜索词(顶栏搜索框跨视图留存)。曾直接吃 view.list:在同一热搜视图里打个搜索词
  // (哪怕与热搜无关)就把左栏清空成「没有取到热搜」,误导排查方向。
  const words = useMemo(() => {
    const s = useDesktop.getState()
    return baseFor(s, nodeId, Date.now()).filter((i) => i.kind === "social")
  }, [nodeId, view])

  return (
    <section className="pane col-pane">
      <header className="pane-head">
        <div className="pane-head-main">
          <h2 className="pane-title">热搜榜</h2>
          <div className="pane-meta">
            <span className="num">{words.length} 条</span>
            <span>点词看该词下的微博</span>
          </div>
        </div>
      </header>

      {words.length === 0 ? (
        <StateBlock
          icon="radio"
          tight
          title="没有取到热搜"
          text="可能是网络问题，试着刷新一下。"
        />
      ) : (
        <div className="scroll-area" style={{ flex: 1 }}>
          {words.map((w, i) => {
            const heat = (w as { author?: { name?: string } }).author?.name
            const active = hotWord?.word === w.title
            return (
              <button
                key={w.id}
                className="hot-row"
                aria-current={active ? "true" : undefined}
                onClick={() => go(nodeId ?? "tab:social", w.title)}
              >
                <span className="hot-rank num" data-top={String(i < 3)}>
                  {i + 1}
                </span>
                <span className="hot-body">
                  <span className="hot-word od-truncate">{w.title}</span>
                  {heat ? <span className="hot-heat num">{heat}</span> : null}
                </span>
                {/* 点击是「在右栏看该词下的微博」,不是跳外链 —— 用 chevronRight 表意。 */}
                <Icon name="chevronRight" size={13} />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
