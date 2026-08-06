/**
 * App — 极简两栏验证界面。
 *
 * 左栏:订阅列表(标题 + channelKey + 刷新错误徽章),点击 select。
 * 右栏:选中订阅的 items,按 kind 分发 MediaItemView(ui 渲染器)。
 * 顶部:刷新全部按钮 + loading 指示。
 *
 * 阶段目标:验证不同 source 类型的订阅 + 渲染器,不做界面细节。
 */
import { useEffect, type CSSProperties } from "react"
import { MediaItemView } from "@tauri-playground/ui"
import { useDesktop } from "./store"

export default function App() {
  const {
    subscriptions,
    selectedId,
    items,
    loading,
    refreshErrors,
    init,
    select,
    refresh,
    refreshAll,
    markRead,
    toggleStar,
  } = useDesktop()

  useEffect(() => {
    init()
  }, [init])

  const selected = subscriptions.find((s) => s.id === selectedId)

  return (
    <div style={styles.layout}>
      {/* ── 左栏:订阅列表 ── */}
      <aside style={styles.sidebar}>
        <h2 style={styles.sidebarTitle}>订阅</h2>
        <button style={styles.refreshBtn} onClick={refreshAll} disabled={loading}>
          {loading ? "刷新中…" : "刷新全部"}
        </button>
        <ul style={styles.subList}>
          {subscriptions.map((sub) => {
            const err = refreshErrors[sub.id]
            return (
              <li
                key={sub.id}
                style={{
                  ...styles.subItem,
                  ...(sub.id === selectedId ? styles.subItemActive : {}),
                }}
                onClick={() => select(sub.id)}
              >
                <div>
                  <div style={styles.subTitle}>{sub.title}</div>
                  <div style={styles.subKey}>{sub.channelKey}</div>
                </div>
                {err && <span style={styles.errBadge} title={err}>!</span>}
              </li>
            )
          })}
        </ul>
      </aside>

      {/* ── 右栏:选中订阅的 items ── */}
      <main style={styles.content}>
        <div style={styles.contentHead}>
          <h1 style={styles.contentTitle}>{selected?.title ?? "选择订阅"}</h1>
          {selected && (
            <button style={styles.refreshBtn} onClick={() => refresh(selected.id)} disabled={loading}>
              刷新
            </button>
          )}
          {refreshErrors[selectedId ?? ""] && (
            <span style={styles.errText}>{refreshErrors[selectedId!]}</span>
          )}
        </div>
        <div>
          {items.length === 0 && !loading && <p style={styles.empty}>暂无内容</p>}
          {items.map((item) => (
            <MediaItemView
              key={item.id}
              item={item}
              onOpen={(url) => window.open(url, "_blank")}
              onToggleRead={markRead}
              onToggleStar={toggleStar}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  layout: { display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif" },
  sidebar: { width: 260, borderRight: "1px solid #ddd", padding: 16, overflowY: "auto" },
  sidebarTitle: { margin: "0 0 12px", fontSize: 18 },
  refreshBtn: {
    border: "1px solid #ccc", borderRadius: 6, padding: "6px 12px", background: "#f5f5f5",
    cursor: "pointer", fontSize: 13,
  },
  subList: { listStyle: "none", padding: 0, margin: "12px 0 0" },
  subItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 12px", borderRadius: 6, cursor: "pointer", border: "1px solid transparent",
  },
  subItemActive: { background: "#eef4ff", borderColor: "#bcd" },
  subTitle: { fontSize: 14, fontWeight: 600 },
  subKey: { fontSize: 12, color: "#888" },
  errBadge: {
    color: "#fff", background: "#e11", borderRadius: 10, width: 18, height: 18,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
  },
  content: { flex: 1, padding: 24, overflowY: "auto" },
  contentHead: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
  contentTitle: { margin: 0, fontSize: 22 },
  errText: { color: "#e11", fontSize: 13 },
  empty: { color: "#888" },
}
