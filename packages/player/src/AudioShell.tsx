/**
 * AudioShell —— 原生音频外壳(mp3/aac/ogg)。
 *
 * 与 VideoShell 对偶:audio 无画面,保留浏览器原生 `<audio controls>` 控件,
 * 不套自定义外壳(控件层 + 自动隐藏只对视频有意义)。壳负责:
 *   - 原生 <audio> + autoPlay(已解锁时带声起播);
 *   - 多档位切换条(直播多清晰度,douyu 等);
 *   - referer 头提示(带 headers 的原生直链可能 403,浏览器无法带自定义 header)。
 */
export function AudioShell({
  src,
  autoPlay,
  qualityOptions,
  activeQuality,
  onQuality,
  className,
}: {
  src: string
  autoPlay?: boolean
  /** 多档位列表;length < 2 不显示。 */
  qualityOptions: { rate: number; quality: string }[]
  activeQuality?: number
  onQuality: (rate: number) => void
  className?: string
}) {
  return (
    <div className="space-y-1">
      {qualityOptions.length >= 2 && (
        <div className="flex flex-wrap gap-1">
          {qualityOptions.map(({ rate, quality }) => {
            const active = activeQuality === rate
            return (
              <button
                key={rate}
                type="button"
                onClick={() => onQuality(rate)}
                className={[
                  "rounded px-2 py-0.5 text-xs",
                  active
                    ? "bg-blue-600 text-white"
                    : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100",
                ].join(" ")}
              >
                {quality}
              </button>
            )
          })}
        </div>
      )}
      <audio
        src={src}
        controls
        autoPlay={autoPlay}
        muted={autoPlay}
        preload="none"
        // audio 无画面:不要黑底(mediaClass 含 bg-black 是给 video 的)。
        className={["w-full", className].filter(Boolean).join(" ")}
      />
    </div>
  )
}
