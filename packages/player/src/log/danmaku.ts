import { createLogDomain } from "@tauri-playground/log"

/**
 * danmaku 域:Canvas 弹幕渲染层生命周期(订阅/收发/VOD 时间窗口发射)。
 * ⚠️ 订阅时 live/vod 未定(video duration 未加载,state.live 初值 false),故
 * danmakuSubscribed 不带 live 分类;类型由 danmakuBatch 的 vod/live 计数体现
 * (vod>0=视频弹幕、live>0=直播聊天)。
 */
export const danmakuLog = createLogDomain("player:danmaku", {
  color: "#e879f9", // fuchsia-400
  ansi: 177,
  legacyKey: "player-log",
  events: {
    danmakuSubscribed: { level: "info", text: "订阅弹幕流" },
    danmakuUnsubscribed: { level: "info", text: "弹幕层卸载,退订流" },
    danmakuBatch: {
      level: "debug",
      text: (ctx: { vod: number; live: number }) => `收到弹幕 vod=${ctx.vod} live=${ctx.live}`,
    },
    danmakuEmit: {
      level: "debug",
      text: (ctx: { count: number; windowMs: number }) => `VOD 时间窗口发射 ${ctx.count} 条(${ctx.windowMs}ms)`,
    },
  },
})
