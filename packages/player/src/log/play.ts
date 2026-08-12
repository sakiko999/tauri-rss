import { createLogDomain, formatError } from "@tauri-playground/log"

/** play 域:起播 + 媒体元素事件。 */
export const playLog = createLogDomain("player:play", {
  color: "#f472b6", // pink-400
  ansi: 212,
  legacyKey: "player-log",
  events: {
    // 媒体事件(原 MEDIA_EVENT_TEXT 表,key 即事件名 → playLog.play() 等)。
    play: { level: "debug", text: "play 事件" },
    pause: { level: "debug", text: "pause 事件" },
    ended: { level: "debug", text: "ended 事件" },
    waiting: { level: "debug", text: "waiting 事件(缓冲)" },
    playing: { level: "info", text: "playing 事件(起播/恢复成功)" },

    playSettled: { level: "debug", text: "起播调用结束" },
    playMutedFallback: {
      level: "warn",
      text: (ctx: { reason: string }) => `被 autoplay policy 拦(${ctx.reason}),降级静音重试`,
    },
    playFailed: { level: "error", text: (ctx: { err: unknown }) => `起播失败: ${formatError(ctx.err)}` },
    mediaError: {
      level: "error",
      text: (ctx: { code: number | undefined; msg: string }) => `media error(code=${ctx.code ?? "?"}) ${ctx.msg}`,
    },
    userRetry: { level: "info", text: "用户重试 → 重建播放实例" },
  },
})
