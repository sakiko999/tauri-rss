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
      {/* 视觉与播放器菜单同源(B 站实测):rgba(20,20,20,.9) / 2px 圆角 / 36px 条目。 */}
      <div
        className="fixed z-50 min-w-36 rounded-[2px] bg-[#141414]/90 py-0 text-[14px] text-white"
        style={{
          // 贴边时向内收,避免菜单出视口(YouTube 同款行为)。
          left: Math.min(x, window.innerWidth - 152),
          top: Math.min(y, window.innerHeight - 44),
        }}
      >
        <button
          type="button"
          className="flex h-9 w-full items-center px-3 whitespace-nowrap hover:bg-white/10"
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
