/**
 * store 的零依赖工具:队列持久化 / 参数比较 / 超时 / 运行时设置镜像 / 导航桥。
 *
 * 与动作文件分开:这些函数不碰 store 状态,可独立阅读与复用。
 */

import type { AppSettings } from "@amoeba/core"

/** 播放队列的 localStorage key(与 prefs 分开存:队列是功能性状态)。 */
const QUEUE_KEY = "ui-queue"

export function loadQueue(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // 只收字符串数组(坏值当空,不让它污染 state 形状)。
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is string => typeof k === "string")
  } catch {
    return []
  }
}

export function saveQueue(keys: string[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(keys))
  } catch {
    /* 持久化失败不影响当前会话(如隐私模式/配额满) */
  }
}

export const now = (): number => Date.now()

/** 订阅参数是否等价(键序无关;空值/缺省视为同义)。 */
export function sameInfo(a: Record<string, string>, b: Record<string, string>): boolean {
  const norm = (o: Record<string, string>) =>
    Object.entries(o ?? {})
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
      .map(([k, v]) => `${k}=${String(v).trim()}`)
      .sort()
      .join("&")
  return norm(a) === norm(b)
}

/**
 * refreshAll 里单条订阅的硬超时。
 *
 * 大多数抓取路径已有自己的超时(Rust http_get 默认 20s;xhs 的 waitUntil 15s),
 * 但 browser 通道的 `invoke`(webview_browser_open / ws_connect / ws_send)**没有超时**
 * —— 一次不回话就永久占住 withBrowserLock,后面所有浏览器操作排队到天荒地老,
 * 整轮 refreshAll 也就永不完成。这里兜最后一层。
 */
export const REFRESH_TIMEOUT_MS = 45_000

/** 给单个 promise 套超时;超时以 reject 形式抛出,交给调用方按条记错。 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 只 reject 外层 promise 是不够的:被挂住的底层 invoke 仍持有浏览器锁。
      // 通知调用方做实际的中止(见 refreshAll 的 onTimeout)。
      try {
        onTimeout?.()
      } catch {
        /* 中止失败不吞掉本次超时 */
      }
      reject(new Error(`刷新超时(${Math.round(ms / 1000)}s):${label}`))
    }, ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

/**
 * 把「渲染管线要直读的设置」同步到宿主门面。
 *
 * 为什么走门面而不是 props:`MediaImage` 在 `packages/ui`,是任意深度的树节点,
 * 为一两个开关层层传参会污染所有中间组件的 props。这类「全局渲染开关」走
 * appHost 更短。目前只有 dataSaver。
 */
export function applyRuntimeSettings(s: AppSettings): void {
  const host = globalThis.appHost as { dataSaver?: boolean }
  host.dataSaver = s.dataSaver
}

/**
 * 导航桥 —— store 不能 import router(会成环),但删除当前节点后必须同步 URL
 * (「URL 是位置权威」)。App 挂载时注入 router.navigate;未注入则退化为只改 store。
 */
let navBridge: ((path: string, opts?: { replace?: boolean }) => void) | null = null

export function setNavBridge(fn: (path: string, opts?: { replace?: boolean }) => void): void {
  navBridge = fn
}

/** 经导航桥跳转(未注入时 no-op)。动作里不要直接碰 router。 */
export function navTo(path: string, opts?: { replace?: boolean }): void {
  navBridge?.(path, opts)
}
