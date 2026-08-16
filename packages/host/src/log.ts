import { createLogDomain } from "@tauri-playground/log"

/**
 * host:http 域 —— HTTP 隧道请求日志。
 *
 * 请求经 invoke → Rust reqwest 隧道发出,WebView 的 devtools Network 面板
 * 只能看到 http_get 这个 IPC 调用、看不到真实 URL。这里打日志补上:
 *   发起 → requestStart(debug,devtools Console 需勾选 Verbose 才显示)
 *   完成 → requestDone(info,非 2xx 用 requestError(warn) 显眼标出失败)
 * 打开 devtools Console → 过滤 [host:http] 即可看到完整 URL/状态/耗时。
 * 开关:localStorage["log:host:http"]="0" 只关本域 info/debug;旧 key
 * `host-log`="0" 仍兼容(legacyKey)。warn/error 永保留。
 */
export const httpLog = createLogDomain("host:http", {
  color: "#60a5fa", // blue-400
  ansi: 75,
  legacyKey: "host-log",
  events: {
    requestStart: {
      level: "debug",
      text: (ctx: { method: string; url: string }) => `→ ${ctx.method} ${ctx.url}`,
    },
    requestDone: {
      level: "info",
      text: (ctx: { method: string; url: string; status: number; elapsed: number }) =>
        `${ctx.method} ${ctx.url} → ${ctx.status} (${ctx.elapsed}ms)`,
    },
    requestError: {
      level: "warn",
      text: (ctx: { method: string; url: string; status: number; elapsed: number }) =>
        `${ctx.method} ${ctx.url} → ${ctx.status} (${ctx.elapsed}ms)`,
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
  },
})
