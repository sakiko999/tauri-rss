/** 存储与诊断 tab:概况计数 + 清缓存 / 清浏览器 profile / 完全重置 + 最近抓取错误。 */

import { ERROR_KIND_LABEL } from "@amoeba/core/pure"
import { useState } from "react"

import { Button } from "../../../components/Button.tsx"
import { Icon } from "../../../components/Icon.tsx"
import { SideCard, StateBlock } from "../../../components/StateBlock.tsx"
import { useDesktop } from "../../../store/index.ts"

export function Diagnostics() {
  const allItems = useDesktop((s) => s.allItems)
  const subscriptions = useDesktop((s) => s.subscriptions)
  const refreshErrors = useDesktop((s) => s.refreshErrors)
  const refreshErrorKinds = useDesktop((s) => s.refreshErrorKinds)
  const dl = useDesktop((s) => s.dl)
  const toast = useDesktop((s) => s.toast)
  const [cacheSize, setCacheSize] = useState<number | null>(null)

  async function measureCache() {
    if (!dl) return
    try {
      const stats = await dl.diagnostics.cacheStats()
      setCacheSize(stats.bytes)
    } catch (e) {
      toast("error", "统计失败", String(e))
    }
  }

  async function clearCache() {
    if (
      !window.confirm(
        "清空内容缓存？\n\n" +
          "会删除全部订阅的已抓取内容。已显示的条目保留在列表里," +
          "但下次刷新会真正走网络重新抓取。\n不影响:订阅列表、阅读状态、凭证。",
      )
    )
      return
    if (!dl) return
    try {
      const count = await dl.diagnostics.clearContentCache()
      setCacheSize(0)
      // ⚠️ 缓存没了但 store 里的条目还在(内存),只是下次刷新会真正走网络。
      // 提示里说清楚,免得用户以为「清空」= 列表清空。
      toast("ok", "内容缓存已清空", `${count} 条。已加载的条目保留在列表里,下次刷新会重新抓取。`)
    } catch (e) {
      toast("error", "清空失败", String(e))
    }
  }

  /** 清掉抓取用的内置浏览器数据(扩展/登录态越积越乱)。走后端命令,不自己删目录。 */
  async function clearBrowserProfile() {
    if (
      !window.confirm(
        "清理浏览器数据?\n\n" +
          "会删除抓取用的浏览器数据(缓存、登录态)。\n" +
          "影响:微博/小红书等需要重新登录;下次抓取会重建一份全新的。\n" +
          "不影响:订阅、已缓存内容、B站凭证。",
      )
    )
      return
    if (!dl) return
    try {
      // 服务端 diagnostics 内部用 withBrowserGlobal 与抓取 lane 互斥。
      const r = await dl.diagnostics.resetBrowserProfile()
      toast("ok", "浏览器数据已清理", r)
    } catch (e) {
      toast("error", "清理失败", String(e))
    }
  }

  /**
   * 完全重置:删空 SQLite KV(订阅/分组/阅读/设置/内容缓存)+ localStorage(界面偏好/
   * 播放队列),然后整页重载让 DataLayer 从空库重建。
   *
   * ⚠️ dev 构建下要落 `dev:seeded` 标记 —— 否则重载后空库会再次触发测试种子写入,
   * 用户以为「重置没生效」。生产构建没有种子逻辑,标记为无害冗余(这里仍只在 DEV 写)。
   * ⚠️ 不碰浏览器 profile(登录态);需要时用上面的「清理浏览器数据」单独处理。
   */
  async function resetAll() {
    if (
      !window.confirm(
        "完全重置本地数据？\n\n" +
          "会删除:订阅与分组、阅读/星标/播放进度、设置、内容缓存、界面偏好与播放队列。\n" +
          "不会删除:抓取用的浏览器登录态(用上面的「清理浏览器数据」单独处理)。\n\n" +
          "重置后应用会立即重新加载。此操作不可撤销。",
      )
    )
      return
    if (!dl) return
    try {
      await dl.diagnostics.clearAll()
      // 种子标记在 localStorage；清掉后空库启动会重新种（dev only）。
      localStorage.clear()
      window.location.reload()
    } catch (e) {
      toast("error", "重置失败", e instanceof Error ? e.message : String(e))
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
          <Button variant="secondary" onClick={() => void measureCache()}>
            <Icon name="database" size={14} /> 统计内容缓存
          </Button>
          <Button variant="danger" onClick={() => void clearCache()}>
            <Icon name="trash" size={14} /> 清空内容缓存
          </Button>
        </div>
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <Button variant="secondary" onClick={() => void clearBrowserProfile()}>
            <Icon name="offline" size={14} /> 清理浏览器数据
          </Button>
        </div>
        <p className="setting-help">订阅、阅读状态与内容缓存都存本地。清理浏览器数据后，微博/小红书需重新登录。</p>
      </SideCard>

      <SideCard title="完全重置" icon="alert">
        <p className="setting-help" style={{ padding: "var(--sp-2) 0" }}>
          删除本机全部应用数据（订阅、阅读记录、设置、内容缓存、界面偏好），应用会重新加载。
          抓取用的浏览器登录态不在此列。
        </p>
        <div className="inline-row" style={{ padding: "var(--sp-2) 0" }}>
          <Button variant="danger" onClick={() => void resetAll()}>
            <Icon name="trash" size={14} /> 完全重置数据
          </Button>
        </div>
      </SideCard>

      <SideCard title={`最近的抓取错误 ${errs.length}`} icon="alert" blockKey="settings:errors">
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
                  <td className="t-small t-muted">
                    <span className="tag" style={{ marginRight: 6 }}>
                      {ERROR_KIND_LABEL[refreshErrorKinds[id] ?? "unknown"]}
                    </span>
                    {msg}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SideCard>
    </>
  )
}
