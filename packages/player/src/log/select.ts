import { createLogDomain } from "@tauri-playground/log"
import { streamSummary, type StreamLike } from "./helpers.ts"

/** select 域:选流 / 切档。 */
export const selectLog = createLogDomain("player:select", {
  color: "#c084fc", // purple-400
  ansi: 141,
  legacyKey: "player-log",
  events: {
    streamSelected: {
      level: "info",
      text: (ctx: { stream: StreamLike; headerKeys: string[] }) =>
        `选中流: ${streamSummary(ctx.stream)} | headers: ${ctx.headerKeys.join(",") || "-"}`,
    },
    qualitySwitched: {
      level: "info",
      text: (ctx: { stream: StreamLike }) => `切档 → ${streamSummary(ctx.stream)}`,
    },
  },
})
