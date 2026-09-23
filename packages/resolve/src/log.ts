/**
 * crawler 日志域 —— 集中管理 + 统一 `log` 对象导出(对齐 player/src/log)。
 * 各 channel 从本模块 import,不各自 createLogDomain。
 * 各平台域均为自由 warn(一次性降级/调试警告);`danmaku`/`crawler` 域仅存
 * 异常 warn(2026-08-28 log 清退:正常路径日志已删,数据路径观测走 CLI 探针,
 * 见 docs/cli-plan.md §7)。
 * ⚠️ 不能像 player 那样 spread 平铺——crawler 各域都是同名 `warn`,平铺会互相覆盖
 * (前缀全变成最后一个域)。故按 channel 分组命名空间:`log.bili.warn(...)`。
 */
import { createLogDomain } from "@tauri-playground/log"

/** [bili] 视频档位降级警告。 */
const biliLog = createLogDomain("bili", { color: "#fb7299", ansi: 211 })
/** [bili:live] 直播档位降级警告。 */
const biliLiveLog = createLogDomain("bili:live", { color: "#f43f5e", ansi: 203 })
const biliLoginLog = createLogDomain("bili:login", { color: "#fb7185", ansi: 204 })
/** [youtube] 直链降级/兜底警告。 */
const youtubeLog = createLogDomain("youtube", { color: "#ef4444", ansi: 196 })
/** [douyin] enter/reflow/HTML 降级警告。 */
const douyinLog = createLogDomain("douyin", { color: "#22d3ee", ansi: 45 })
/** [douyu] 档位/CDN 降级警告。 */
const douyuLog = createLogDomain("douyu", { color: "#ff6a00", ansi: 208 })
/** [huya] 档位/弹幕降级警告。 */
const huyaLog = createLogDomain("huya", { color: "#ffa52a", ansi: 214 })
/** [xhs] 扫码登录生命周期(导航/出码/等待/成功/超时)——重复性日志,模板事件。 */
const xhsLog = createLogDomain("xhs", {
  color: "#ff2e4d", // 小红书红
  ansi: 196,
  events: {
    loginNavigate: { level: "info", text: (ctx: { url: string }) => `扫码登录导航 ${fmtUrl(ctx.url)}` },
    qrReady: { level: "info", text: "二维码已捕获(可扫码)" },
    qrMissing: { level: "warn", text: "二维码未出现(登录弹窗可能未打开)" },
    loginOk: {
      level: "info",
      text: (ctx: { user_id?: string }) => `登录成功${ctx.user_id ? ` · user_id=${ctx.user_id}` : ""}`,
    },
    loginTimeout: { level: "warn", text: "扫码登录超时或二维码已失效" },
    // SSR user.notes 空结果诊断(区分「该用户无笔记」vs「匿名/未登录/页面结构变化」)。
    userEmpty: { level: "warn", text: (ctx: { body: string }) => `user.notes 空: ${ctx.body}` },
  },
})
/** URL 统一截断显示(防超长 query 刷屏;xhs 登录导航事件用)。 */
const fmtUrl = (url: string): string => url.slice(0, 100)

/**
 * [danmaku] 弹幕通用 WS 连接层(createWsStream)——异常生命周期模板事件。
 * (2026-08-28 log 清退:wsConnect/wsOpen/wsItems/wsClosedByUser 已删——连接生命周期
 * 与帧数是纯数据路径,CLI `rss dm` 配 RSS_LOG=1 可完整复现;保留三类异常 warn
 * (意外断线/重连/握手失败),正常开关直播间零日志。)
 */
const danmakuLog = createLogDomain("danmaku", {
  color: "#818cf8", // indigo-400
  ansi: 105,
  events: {
    wsClosed: {
      level: "warn",
      text: (ctx: { code: number; reason: string }) =>
        `连接关闭(code=${ctx.code}${ctx.reason ? ` reason=${ctx.reason}` : ""})`,
    },
    wsReconnect: {
      level: "warn",
      text: (ctx: { attempt: number; delayMs: number }) => `断线重连(第 ${ctx.attempt} 次, ${ctx.delayMs}ms 后)`,
    },
    wsHandshakeError: {
      level: "warn",
      text: (ctx: { message: string }) => `握手失败: ${ctx.message}`,
    },
  },
})

/**
 * [crawler] 抓取失败(factory.apiFetch 统一装配点)——仅 warn 永保留。
 * (2026-08-28 log 清退:fetchStart/fetchOk/fetchMore/fetchMoreOk 已删——耗时/条数
 * 是纯数据路径,CLI `rss fetch` 给出结构化答案,见 docs/cli-plan.md §7。)
 */
const crawlerLog = createLogDomain("crawler", {
  color: "#34d399", // emerald-400
  ansi: 78,
  events: {
    fetchError: {
      level: "warn",
      text: (ctx: { source: string; message: string }) => `抓取失败 ${ctx.source}: ${ctx.message}`,
    },
  },
})

export const log = {
  bili: biliLog,
  biliLive: biliLiveLog,
  biliLogin: biliLoginLog,
  youtube: youtubeLog,
  douyin: douyinLog,
  douyu: douyuLog,
  huya: huyaLog,
  xhs: xhsLog,
  danmaku: danmakuLog,
  crawler: crawlerLog,
}
