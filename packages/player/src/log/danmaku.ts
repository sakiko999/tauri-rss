import { createLogDomain } from "@tauri-playground/log"

/**
 * danmaku 域:Canvas 弹幕渲染层的订阅生命周期。
 * (2026-08-28 log 清退:danmakuBatch/danmakuEmit 已删——数据流与发射窗口 CLI `rss dm`
 * 可复现;保留 subscribed/unsubscribed——连接释放竞态(onOpen stopped 拦截)的
 * Webview UI 生命周期案发现场,见 CLAUDE.md 弹幕章节。)
 */
export const danmakuLog = createLogDomain("player:danmaku", {
  color: "#e879f9", // fuchsia-400
  ansi: 177,
  legacyKey: "player-log",
  events: {
    danmakuSubscribed: { level: "info", text: "订阅弹幕流" },
    danmakuUnsubscribed: { level: "info", text: "弹幕层卸载,退订流" },
  },
})
