import { createLogDomain, formatError } from "@tauri-playground/log"
import { streamSummary, type StreamLike } from "./helpers.ts"

/** resolve 域:懒解析(点击播放 → 拿流)。 */
export const resolveLog = createLogDomain("player:resolve", {
  color: "#38bdf8", // sky-400
  ansi: 117,
  legacyKey: "player-log",
  events: {
    resolveStart: { level: "info", text: "开始(手势内解锁 autoplay)" },
    resolveSuccess: {
      level: "info",
      text: (ctx: { streams: StreamLike[] }) =>
        `成功: ${ctx.streams.length} 条流: ${ctx.streams.map((s) => streamSummary(s)).join(" | ")}`,
    },
    resolveFailed: { level: "error", text: (ctx: { err: unknown }) => `失败: ${formatError(ctx.err)}` },
  },
})
