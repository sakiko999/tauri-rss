/**
 * crawler 日志域 —— 集中管理 + 统一 `log` 对象导出(对齐 player/src/log)。
 * 各 channel 从本模块 import,不各自 createLogDomain。
 * 平台域均为自由 warn(一次性降级/调试警告);`danmaku` 域例外——通用 WS 连接层
 * 是重复性生命周期日志(建连/关闭/重连/帧数),用模板事件(见下)。
 * ⚠️ 不能像 player 那样 spread 平铺——crawler 各域都是同名 `warn`,平铺会互相覆盖
 * (前缀全变成最后一个域)。故按 channel 分组命名空间:`log.bili.warn(...)`。
 */
import { createLogDomain } from "@tauri-playground/log"

/** [bili] 视频档位降级警告。 */
const biliLog = createLogDomain("bili", { color: "#fb7299", ansi: 211 })
/** [bili:live] 直播档位降级警告。 */
const biliLiveLog = createLogDomain("bili:live", { color: "#f43f5e", ansi: 203 })
/** [youtube] 直链降级/兜底警告。 */
const youtubeLog = createLogDomain("youtube", { color: "#ef4444", ansi: 196 })
/** [douyin] enter/reflow/HTML 降级警告。 */
const douyinLog = createLogDomain("douyin", { color: "#22d3ee", ansi: 45 })
/** [douyu] 档位/CDN 降级警告。 */
const douyuLog = createLogDomain("douyu", { color: "#ff6a00", ansi: 208 })
/** [huya] 档位/弹幕降级警告。 */
const huyaLog = createLogDomain("huya", { color: "#ffa52a", ansi: 214 })
/**
 * [danmaku] 弹幕通用 WS 连接层(createWsStream)——连接生命周期模板事件
 * (建连/建立/关闭/重连/收到帧数),区别于上方各平台一次性自由 warn。
 * debug 级(wsConnect/wsItems)量大,默认显示,可 `log:danmaku="0"` 按域关。
 */
/** URL 统一截断显示(防超长 query 刷屏)。 */
const fmtUrl = (url: string): string => url.slice(0, 100)

const danmakuLog = createLogDomain("danmaku", {
  color: "#818cf8", // indigo-400
  ansi: 105,
  events: {
    wsConnect: { level: "debug", text: (ctx: { url: string }) => `建连 ${fmtUrl(ctx.url)}` },
    wsOpen: { level: "info", text: (ctx: { url: string }) => `连接建立(握手成功) ${fmtUrl(ctx.url)}` },
    wsClosed: {
      level: "warn",
      text: (ctx: { code: number; reason: string }) =>
        `连接关闭(code=${ctx.code}${ctx.reason ? ` reason=${ctx.reason}` : ""})`,
    },
    // 主动退订(关闭直播间):服务器可能不回 Close 帧(huya/douyin 直接断 → code 1006),
    // 属正常关闭表现,非意外断线,不打 warn。用 info 提示已释放。
    wsClosedByUser: { level: "info", text: "连接已关闭(主动退订)" },
    wsReconnect: {
      level: "warn",
      text: (ctx: { attempt: number; delayMs: number }) => `断线重连(第 ${ctx.attempt} 次, ${ctx.delayMs}ms 后)`,
    },
    wsItems: { level: "debug", text: (ctx: { count: number }) => `收到 ${ctx.count} 条弹幕` },
    wsHandshakeError: {
      level: "warn",
      text: (ctx: { message: string }) => `握手失败: ${ctx.message}`,
    },
  },
})

/**
 * [crawler] 抓取生命周期(factory.apiFetch 统一装配点)——重复性日志,模板事件。
 * 每次 fetch 完整打:开始(debug)/ 成功条数(info)/ 失败原因(warn,永保留)。
 * fetchStart/fetchOk 量大,可 `log:crawler="0"` 按域关。channelTitle 作 source 标识。
 */
const crawlerLog = createLogDomain("crawler", {
  color: "#34d399", // emerald-400
  ansi: 78,
  events: {
    fetchStart: { level: "debug", text: (ctx: { source: string }) => `抓取 ${ctx.source}` },
    fetchOk: {
      level: "info",
      text: (ctx: { source: string; count: number }) => `抓到 ${ctx.count} 条 · ${ctx.source}`,
    },
    fetchError: {
      level: "warn",
      text: (ctx: { source: string; message: string }) => `抓取失败 ${ctx.source}: ${ctx.message}`,
    },
    fetchMore: {
      level: "debug",
      text: (ctx: { source: string; cursor?: string }) => `翻页 ${ctx.source}${ctx.cursor ? ` cursor=${ctx.cursor}` : ""}`,
    },
    fetchMoreOk: {
      level: "info",
      text: (ctx: { source: string; count: number }) => `翻页到 ${ctx.count} 条 · ${ctx.source}`,
    },
  },
})

export const log = {
  bili: biliLog,
  biliLive: biliLiveLog,
  youtube: youtubeLog,
  douyin: douyinLog,
  douyu: douyuLog,
  huya: huyaLog,
  danmaku: danmakuLog,
  crawler: crawlerLog,
}
