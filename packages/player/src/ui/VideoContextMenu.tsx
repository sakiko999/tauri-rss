/**
 * VideoContextMenu —— 播放器右键菜单(目前只有「统计信息」一项)。
 *
 * 不自造完整菜单体系(右键菜单体系属 P1 裁剪项);统计信息是「stats for nerds」
 * 的入口,保留。菜单挂在播放器容器内(全屏时天然可见),坐标按视口钳制防出界。
 *
 * 由 VideoShell 控制开关:菜单打开渲染透明遮罩(点外关闭),菜单项点完即关。
 */

export function VideoContextMenu({
  x,
  y,
  statsShown,
  onToggleStats,
  onClose,
}: {
  /** 右键位置(视口坐标)。 */
  x: number
  y: number
  /** 统计面板当前是否显示(决定菜单文案)。 */
  statsShown: boolean
  onToggleStats: () => void
  onClose: () => void
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={(e) => {
          // 菜单在播放容器内:不拦冒泡会触发容器的单击播放/暂停。
          e.stopPropagation()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      />
      <div
        className="fixed z-50 min-w-36 rounded-md border border-white/15 bg-black/95 py-1 text-xs text-white shadow-xl"
        style={{
          // 贴边时向内收,避免菜单出视口(YouTube 同款行为)。
          left: Math.min(x, window.innerWidth - 152),
          top: Math.min(y, window.innerHeight - 44),
        }}
      >
        <button
          type="button"
          className="block w-full px-3 py-1.5 text-left hover:bg-white/15"
          onClick={(e) => {
            e.stopPropagation()
            onToggleStats()
            onClose()
          }}
        >
          {statsShown ? "隐藏统计信息" : "统计信息"}
        </button>
      </div>
    </>
  )
}
