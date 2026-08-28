import { createLogDomain, formatError } from "@tauri-playground/log"

/**
 * engine 域:流媒体引擎(hls/flv/dash)生命周期。
 * (2026-08-28 log 清退:engineSelected 已删——选型是纯逻辑,streams 的 format 字段
 * `rss item` 已给;保留 hlsLevelLoaded/dashManifestReady(锁档与装配是 Webview 隧道
 * 特有行为的案发现场)与 engineError(error)。)
 */
export const engineLog = createLogDomain("player:engine", {
  color: "#fbbf24", // amber-400
  ansi: 221,
  legacyKey: "player-log",
  events: {
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
