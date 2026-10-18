/**
 * BoardList —— 可订阅榜单(无参渠道一键订阅)。
 *
 * 从 DiscoverPage 拆出。`boards` 的筛选口径由父页面决定(见那里的注释:不按 kind /
 * key 正则缩范围,只排除原生 RSS 直链)。
 */
import { useState } from "react"
import type { ChannelInfo } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { Icon } from "../../components/Icon.tsx"
import { StateBlock } from "../../components/StateBlock.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"

export function BoardList({ boards }: { boards: ChannelInfo[] }) {
  const subscriptions = useDesktop((s) => s.subscriptions)
  const addSubscription = useDesktop((s) => s.addSubscription)
  const toast = useDesktop((s) => s.toast)
  const [busy, setBusy] = useState<string | null>(null)

  if (boards.length === 0) {
    return <StateBlock icon="layers" tight title="没有可一键订阅的无参渠道" text="用上面的分区浏览找内容。" />
  }

  return (
    <div className="result-grid" {...overlayBlock("board-list", "discover:boards:list")}>
      {boards.map((b) => {
        const subscribed = subscriptions.some((s) => s.channelKey === b.key)
        return (
          <div className="platform-card" key={b.key} {...overlayBlock("board-card", `board:${b.key}`)}>
            <div className="platform-head">
              <span className="platform-mark">
                <Icon name={b.kind === "live" ? "radio" : "layers"} size={17} />
              </span>
              <span className="platform-title">
                <span className="platform-name" style={{ fontSize: "var(--fs-h3)" }}>
                  {b.name}
                </span>
                <span className="t-micro t-dim">{b.key}</span>
              </span>
            </div>
            <div className="chip-row">
              <button
                className={subscribed ? "btn btn-secondary btn-sm" : "btn btn-primary btn-sm"}
                disabled={subscribed || busy === b.key}
                onClick={async () => {
                  setBusy(b.key)
                  try {
                    await addSubscription(b.key, b.name, b.defaultInfo ?? {})
                  } catch (e) {
                    // 一键订阅失败要可见(旧代码无 catch → 只有 unhandled rejection)。
                    toast("error", `订阅「${b.name}」失败`, e instanceof Error ? e.message : String(e))
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {subscribed ? (
                  <>
                    <Icon name="check" size={13} /> 已订阅
                  </>
                ) : (
                  <>
                    <Icon name="plus" size={13} /> 一键订阅
                  </>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
