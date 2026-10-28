/**
 * crawler 日志域 —— 集中管理 + 统一 `log` 对象导出(对齐 player/src/log)。
 * 各 channel 从本模块 import,不各自 createLogDomain。
 *
 * 两种写法,按「是否需要被机器读」选:
 *   - 模板事件(`events`):登录生命周期、弹幕初始化失败等**同形事件** —— 文案/级别/开关
 *     一处可改,新平台直接 spread `LOGIN_EVENTS` / `DANMAKU_EVENTS`;
 *   - 自由 warn/debug:一次性降级(某档位/CDN 失败)与只此一处的诊断,不值得建模板。
 * 异常参数统一用 `formatError(e)`(`@amoeba/log`)—— `(e as Error)?.message` 在非 Error
 * reject 时输出空串,且对 hls/dash 的错误对象退化成 undefined。
 *
 * ⚠️ 不能像 player 那样 spread 平铺——crawler 各域都是同名 `warn`,平铺会互相覆盖
 * (前缀全变成最后一个域)。故按 channel 分组命名空间:`log.bili.warn(...)`。
 */

import { createLogDomain, type LogEvent } from "@amoeba/log"

/** URL 统一截断显示(防超长 query 刷屏;登录导航事件用)。 */
const fmtUrl = (url: string): string => url.slice(0, 100)

/**
 * 扫码登录生命周期 —— 各平台同形。
 * 新平台登录直接 `...LOGIN_EVENTS`,不要再手写 `log.xxx.info("…(HTTP 路径)")`:
 * 措辞/级别/开关必须一处可改,否则 grep 一次登录又得试三种说法。
 * 实现路径(纯 HTTP 还是浏览器/CDP)不进文案,降级用 `loginFallback` 表达。
 */
const LOGIN_EVENTS = {
  loginNavigate: { level: "info", text: (ctx: { url: string }) => `扫码登录导航 ${fmtUrl(ctx.url)}` },
  qrReady: { level: "info", text: "二维码已就绪(可扫码)" },
  qrMissing: { level: "warn", text: "二维码未出现(登录弹窗可能未打开)" },
  loginOk: {
    level: "info",
    text: (ctx: { user_id?: string }) => `登录成功${ctx.user_id ? ` · user_id=${ctx.user_id}` : ""}`,
  },
  loginReused: { level: "info", text: "已登录(复用 profile)" },
  loginTimeout: { level: "warn", text: "扫码登录超时或二维码已失效" },
  loginFallback: {
    level: "warn",
    text: (ctx: { reason: string }) => `HTTP 路径失败,回退浏览器: ${ctx.reason}`,
  },
} as const satisfies Record<string, LogEvent<any>>

/** 弹幕流创建失败 —— 各平台同形(初始化/握手前的准备阶段)。 */
const DANMAKU_EVENTS = {
  danmakuInitFailed: {
    level: "warn",
    text: (ctx: { error: string }) => `弹幕初始化失败(未开播?): ${ctx.error}`,
  },
} as const satisfies Record<string, LogEvent<any>>

/** [bili] 视频档位降级警告。 */
const biliLog = createLogDomain("bili", { color: "#fb7299", ansi: 211 })
/** [bili:live] 直播档位降级 + 弹幕初始化。 */
const biliLiveLog = createLogDomain("bili:live", {
  color: "#f43f5e",
  ansi: 203,
  events: { ...DANMAKU_EVENTS },
})
/** [bili:login] 扫码登录(纯 HTTP,无导航/出码步骤)。 */
const biliLoginLog = createLogDomain("bili:login", {
  color: "#fb7185",
  ansi: 204,
  events: { ...LOGIN_EVENTS },
})
/** [youtube] 直链降级/兜底 + live chat 轮询生命周期。 */
const youtubeLog = createLogDomain("youtube", {
  color: "#ef4444",
  ansi: 196,
  events: {
    ...DANMAKU_EVENTS,
    pollFailed: { level: "warn", text: (ctx: { error: string }) => `live chat 轮询失败: ${ctx.error}` },
    pollRecovered: {
      level: "info",
      text: (ctx: { failures: number }) => `live chat 轮询恢复(此前连续失败 ${ctx.failures} 次)`,
    },
  },
})
/** [douyin] enter/reflow/HTML 降级 + 扫码登录 + 弹幕。 */
const douyinLog = createLogDomain("douyin", {
  color: "#22d3ee",
  ansi: 45,
  events: { ...LOGIN_EVENTS, ...DANMAKU_EVENTS },
})
/** [douyu] 档位/CDN 降级警告。 */
const douyuLog = createLogDomain("douyu", { color: "#ff6a00", ansi: 208 })
/** [huya] 档位/弹幕降级警告。 */
const huyaLog = createLogDomain("huya", { color: "#ffa52a", ansi: 214, events: { ...DANMAKU_EVENTS } })
/** [twitch] GraphQL 降级/档位告警(自由 warn;正常路径零日志)。 */
const twitchLog = createLogDomain("twitch", { color: "#9146ff", ansi: 99 })
/** [xhs] 扫码登录生命周期 + SSR user.notes 空诊断。 */
const xhsLog = createLogDomain("xhs", {
  color: "#ff2e4d", // 小红书红
  ansi: 196,
  events: {
    ...LOGIN_EVENTS,
    // SSR user.notes 空结果诊断(区分「该用户无笔记」vs「匿名/未登录/页面结构变化」)。
    userEmpty: { level: "warn", text: (ctx: { body: string }) => `user.notes 空: ${ctx.body}` },
  },
})
/** [weibo] 扫码登录生命周期,与 xhs 同形。 */
const weiboLog = createLogDomain("weibo", { color: "#e6162d", ansi: 196, events: { ...LOGIN_EVENTS } })

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
    wsReconnectGaveUp: {
      level: "warn",
      text: (ctx: { attempts: number }) => `重连 ${ctx.attempts} 次仍失败,放弃(房间可能已下播)`,
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
 * 是纯数据路径,CLI `rss fetch` 给出结构化答案,见 docs/ops/commands.md。)
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
  twitch: twitchLog,
  xhs: xhsLog,
  weibo: weiboLog,
  danmaku: danmakuLog,
  crawler: crawlerLog,
}
