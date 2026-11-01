/**
 * MediaDanmakuButton —— 弹幕开关(播放器控件栏)。
 *
 * 视觉对齐 B 站直播播放器:「弹」字方框;开启时右下角叠**品牌粉对勾**,
 * 关闭时整枚图标降为白 45%。纯受控:enabled 来自宿主,点击调 onToggle。
 * 不做弹幕发送/输入(B 站把发送条放在视频下方页面里,本项目不提供写操作,
 * 放一个不可用的输入框只是假象 —— 已删除)。
 */

export interface DanmakuControl {
  enabled: boolean
  onToggle: () => void
}

export function MediaDanmakuButton({
  control,
  className = "relative flex h-[22px] w-10 shrink-0 items-center justify-center text-white/80 hover:text-white",
}: {
  control?: DanmakuControl
  className?: string
}) {
  if (!control) return null
  return (
    <button
      type="button"
      aria-label={control.enabled ? "关闭弹幕" : "开启弹幕"}
      aria-pressed={control.enabled}
      title={control.enabled ? "关闭弹幕" : "开启弹幕"}
      onClick={control.onToggle}
      className={className}
    >
      <span
        className={`rounded-[4px] border-[1.5px] border-current px-[3px] text-[12px] leading-[15px] font-medium ${
          control.enabled ? "" : "text-white/45"
        }`}
      >
        弹
      </span>
      {control.enabled && (
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="absolute right-1 bottom-0.5 h-3 w-3 text-[#fb7299]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 6.5 4.5 9.5 10.5 2.5" />
        </svg>
      )}
    </button>
  )
}
