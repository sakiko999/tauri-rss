import { createLogDomain } from "@amoeba/log"

/**
 * host:http 域 —— HTTP 隧道请求日志。
 *
 * 请求经 invoke → Rust reqwest 隧道发出,WebView 的 devtools Network 面板
 * 只能看到 http_get 这个 IPC 调用、看不到真实 URL。这里打日志补上:
 *   发起 → requestStart(debug,devtools Console 需勾选 Verbose 才显示)
 *   完成 → requestDone(info,非 2xx 用 requestError(warn) 显眼标出失败)
 * 打开 devtools Console → 过滤 [host:http] 即可看到完整 URL/状态/耗时。
 * 开关:localStorage["log:host:http"]="0" 只关本域 info/debug。warn/error 永保留。
 */
/**
 * 日志里的 URL 先脱敏再打印。
 *
 * ⚠️ 平台接口的 query 里带着凭据:抖音 `msToken`、小红书 `xsec_token`、
 * bilibili 的 `w_rid`/`access_key`、各家 `sign`/`token`。这些 URL 原样进 devtools
 * console 后,用户一旦截图报障就把登录态贴出去了。保 `?x=…&y=…` 的键名便于定位,
 * 值统一打码(长度也一并抹掉,免得被当作特征)。
 */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const keys = [...u.searchParams.keys()]
    if (!keys.length) return raw
    for (const k of keys) u.searchParams.set(k, "***")
    return u.toString()
  } catch {
    return raw
  }
}

export const httpLog = createLogDomain("host:http", {
  color: "#60a5fa", // blue-400
  ansi: 75,
  events: {
    requestStart: {
      level: "debug",
      text: (ctx: { method: string; url: string }) => `→ ${ctx.method} ${redactUrl(ctx.url)}`,
    },
    requestDone: {
      level: "info",
      text: (ctx: { method: string; url: string; status: number; elapsed: number }) =>
        `${ctx.method} ${redactUrl(ctx.url)} → ${ctx.status} (${ctx.elapsed}ms)`,
    },
    requestError: {
      level: "warn",
      text: (ctx: { method: string; url: string; status: number; elapsed: number }) =>
        `${ctx.method} ${redactUrl(ctx.url)} → ${ctx.status} (${ctx.elapsed}ms)`,
    },
  },
})

/**
 * host:browser 域 —— CDP 浏览器模拟异常日志。
 * evaluate 失败(表达式语法错/导航跳转中断旧 context)记 evalError(warn)。表达式可能含
 * 中文/长签名,完整打印便于定位;error 级别永保留。开关 localStorage["log:host:browser"]="0"。
 */
export const browserLog = createLogDomain("host:browser", {
  color: "#34d399", // emerald-400
  ansi: 78,
  events: {
    evalError: {
      level: "warn",
      text: (ctx: { expression: string; detail: string }) =>
        `CDP evaluate 异常\n  expression: ${ctx.expression}\n  detail: ${ctx.detail}`,
    },
    armFailed: {
      level: "warn",
      text: (ctx: { detail: string }) => `资源拦截未挂上(只是少了优化,不影响抓取): ${ctx.detail}`,
    },
    idleClose: {
      level: "info",
      text: (ctx: { minutes: number }) => `浏览器空闲 ${ctx.minutes} 分钟,已关闭(下次使用自动重启)`,
    },
    uiSweep: {
      level: "info",
      text: (ctx: { count: number }) => `已关闭 ${ctx.count} 个 Edge 自带界面 target(省 ~200MB private)`,
    },
  },
})
