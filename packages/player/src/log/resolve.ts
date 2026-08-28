import { createLogDomain, formatError } from "@tauri-playground/log"

/**
 * resolve 域:懒解析失败(点击播放 → 拿流)。
 * (2026-08-28 log 清退:start/success 已删——解析与流清单是纯数据路径,CLI `rss item`
 * 给出结构化答案;仅留 error 级失败。)
 */
export const resolveLog = createLogDomain("player:resolve", {
  color: "#38bdf8", // sky-400
  ansi: 117,
  legacyKey: "player-log",
  events: {
    resolveFailed: { level: "error", text: (ctx: { err: unknown }) => `失败: ${formatError(ctx.err)}` },
  },
})
