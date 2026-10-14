/** 存储与诊断 tab:概况计数 + 清缓存 / 清浏览器 profile + 最近抓取错误。 */
import { useState } from "react"
import { useDesktop } from "../../../store/index.ts"
import { SideCard, StateBlock } from "../../../components/StateBlock.tsx"
import { Icon } from "../../../components/Icon.tsx"

export function Diagnostics() {
  const allItems = useDesktop((s) => s.allItems)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const toast = useDesktop((s) => s.toast)
  const [cacheSize, setCacheSize] = useState<number | null>(null)

  async function measureCache() {
    try {
      const keys = await globalThis.appHost.storage.keys("content:")
      let bytes = 0
      for (const k of keys) {
        const v = await globalThis.appHost.storage.get(k)
        bytes += (v?.length ?? 0) * 2 // UTF-16 近似
      }
      setCacheSize(bytes)
    } catch (e) {
      toast("error", "统计失败", String(e))
    }
  }

  async function clearCache() {
    if (
      !window.confirm(
        "清空内容缓存？\n\n" +
          "会删除全部订阅的已抓取内容(TTL 缓存)。已显示的条目保留在列表里," +
          "但下次刷新会真正走网络重新抓取。\n不影响:订阅列表、阅读状态、凭证。",
      )
    )
      return
    try {
      const keys = await globalThis.appHost.storage.keys("content:")
      for (const k of keys) await globalThis.appHost.storage.delete(k)
      setCacheSize(0)
      // ⚠️ 缓存没了但 store 里的条目还在(内存),只是下次刷新会真正走网络。
      // 提示里说清楚,免得用户以为「清空」= 列表清空。
      toast("ok", "内容缓存已清空", `${keys.length} 条。已加载的条目保留在列表里,下次刷新会重新抓取。`)
    } catch (e) {
      toast("error", "清空失败", String(e))
    }
  }

  /** 清掉 CDP 用的 Edge profile(扩展/账户态越养越脏)。走后端命令,不自己删目录。 */
  async function clearBrowserProfile() {
    if (
      !window.confirm(
        "清理浏览器数据?\n\n" +
          "会结束 CDP 用的 Edge 并删除它的 profile(扩展、缓存、登录态)。\n" +
          "影响:微博/小红书等需要重新登录;下次抓取会重建全新 profile。\n" +
          "不影响:订阅、已缓存内容、bilibili 凭证。",
      )
    )
      return
    try {
      const browser = globalThis.appHost.browser
      if (!browser?.resetProfile) throw new Error("当前环境不支持(仅桌面端可用)")
      const r = await browser.resetProfile()
      toast("ok", "浏览器数据已清理", r)
    } catch (e) {
      toast("error", "清理失败", String(e))
    }
  }

  const errs = Object.entries(refreshErrors)

  return (
    <>
      <SideCard title="概况" icon="database">
        <div className="stat-strip" style={{ padding: "var(--sp-3) 0" }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">条目</span>
            <span className="t-h2 num">{allItems.length}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">订阅</span>
            <span className="t-h2 num">{subscriptions.length}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">未读</span>
            <span className="t-h2 num">{allItems.filter((i) => i.isUnread).length}</span>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <span className="t-micro t-dim">缓存</span>
            <span className="t-h2 num">{cacheSize === null ? "—" : `${Math.round(cacheSize / 1024)} KB`}</span>
          </div>
        </div>
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <button className="btn btn-secondary" onClick={() => void measureCache()}>
            <Icon name="database" size={14} /> 统计内容缓存
          </button>
          <button className="btn btn-danger" onClick={() => void clearCache()}>
            <Icon name="trash" size={14} /> 清空内容缓存
          </button>
        </div>
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <button className="btn btn-secondary" onClick={() => void clearBrowserProfile()}>
            <Icon name="offline" size={14} /> 清理浏览器数据
          </button>
        </div>
        <p className="setting-help">
          清单与阅读状态存在 SQLite（appData/rss.db）；内容缓存是同一 KV 表里的 content:* 记录。
          浏览器数据 = CDP 用的 Edge profile（扩展/账户态会越养越脏），清理后下次抓取重建全新实例，
          微博/小红书需重新登录。
        </p>
      </SideCard>

      <SideCard title={`最近的抓取错误 ${errs.length}`} icon="alert">
        {errs.length === 0 ? (
          <StateBlock icon="checkCircle" tone="ok" tight title="没有错误" text="最近一次刷新全部成功。" />
        ) : (
          <table className="table">
            <tbody>
              {errs.map(([id, msg]) => (
                <tr key={id}>
                  <td style={{ width: 200 }} className="od-truncate">
                    {subscriptions.find((s) => s.id === id)?.title ?? id}
                  </td>
                  <td className="t-small t-muted">{msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SideCard>
    </>
  )
}
