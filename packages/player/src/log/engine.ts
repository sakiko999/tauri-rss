import { createLogDomain, formatError } from "@tauri-playground/log"

/** engine 域:流媒体引擎(hls/flv/dash)生命周期 + 引擎选择。 */
export const engineLog = createLogDomain("player:engine", {
  color: "#fbbf24", // amber-400
  ansi: 221,
  legacyKey: "player-log",
  events: {
    engineSelected: {
      level: "debug",
      text: (ctx: { mode: "stream" | "video" | "audio" | "fallback"; format?: string }) => {
        const { mode, format } = ctx
        const text =
          mode === "stream"
            ? `流媒体引擎(${format ?? "?"})接管`
            : mode === "video"
              ? "原生 <video> 播放"
              : mode === "audio"
                ? "原生 <audio> 播放"
                : `未知格式 ${format ?? "?"} 兜底`
        return text
      },
    },
    hlsLevelLoaded: {
      level: "debug",
      text: (ctx: { live: boolean; level: number; height?: number; bitrate?: number }) => {
        // height 为 0/缺失(如 B站 LL-HLS 未声明分辨率)→ 显示档位 index,避免误导性 0p/0kbps。
        const desc =
          ctx.height != null && ctx.height > 0
            ? `${ctx.height}p/${Math.round((ctx.bitrate ?? 0) / 1000)}kbps`
            : `#${ctx.level}`
        return `hls 播放档位 ${ctx.live ? "live" : "vod"} ${desc}`
      },
    },
    dashManifestReady: {
      level: "info",
      text: (ctx: { len: number; autoPlay: boolean }) =>
        `dash: dashManifest 到达 ${ctx.len} 字符, autoPlay: ${ctx.autoPlay}`,
    },
    engineError: {
      level: "error",
      text: (ctx: { engine: string; err: unknown; fatal?: boolean }) =>
        `${ctx.engine} 错误: ${formatError(ctx.err)}${ctx.fatal ? " (fatal)" : ""}`,
    },
  },
})
