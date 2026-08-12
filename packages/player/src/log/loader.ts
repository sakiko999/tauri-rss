import { createLogDomain } from "@tauri-playground/log"

/** loader 域:隧道请求错误(hls/flv/dash 自定义 loader)。 */
export const loaderLog = createLogDomain("player:loader", {
  color: "#2dd4bf", // teal-400
  ansi: 79,
  legacyKey: "player-log",
  events: {
    loaderHttpError: {
      level: "warn",
      text: (ctx: { engine: string; status: number; url: string }) =>
        `${ctx.engine} 隧道 HTTP ${ctx.status} for ${ctx.url.slice(0, 80)}`,
    },
    loaderError: {
      level: "warn",
      text: (ctx: { engine: string; msg: string }) => `${ctx.engine} 隧道错误: ${ctx.msg}`,
    },
  },
})
