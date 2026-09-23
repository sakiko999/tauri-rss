/**
 * bili 扫码登录 —— **纯 HTTP**(无需 CDP/浏览器),两条接口:
 *   1. `passport.bilibili.com/x/passport-login/web/qrcode/generate` → qrcode_key + url
 *   2. `.../qrcode/poll?qrcode_key=` → 轮询状态,**成功时 cookie 在 Set-Cookie**
 *
 * 轮询状态码(`data.code`):
 *   86101 未扫码 / 86090 已扫待确认 / 0 成功 / 86038 二维码过期
 *
 * ⚠️ 与 xhs 路径(`platform/xhs/login.ts` 走 CDP 读页面 DOM)不同——bili 的扫码
 * 是纯 HTTP 协议,不依赖 appHost.browser(移动端同样可用)。
 *
 * 二维码本身由调用方渲染:generate 返回的 `url` 就是二维码内容(非图片),
 * 用任意 QR 库编码即可;本模块只负责协议。
 */
import { httpJson } from "../../host.ts"
import { log } from "../../log.ts"
import type { LoginResult } from "../../index.ts"

const PASSPORT = "https://passport.bilibili.com/x/passport-login/web/qrcode"
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const HEADERS = { "user-agent": UA, referer: "https://www.bilibili.com/" }

/** 轮询状态码。 */
export const BILI_QR_STATUS = {
  SUCCESS: 0,
  EXPIRED: 86038,
  SCANNED: 86090,
  PENDING: 86101,
} as const

export interface BiliQrCode {
  /** 轮询用 key。 */
  key: string
  /** 二维码内容(前端用 QR 库编码渲染)。 */
  url: string
}

/** 申请二维码。 */
export async function biliQrGenerate(): Promise<BiliQrCode> {
  const res = await httpJson<{ code?: number; message?: string; data?: { qrcode_key?: string; url?: string } }>(
    `${PASSPORT}/generate`,
    HEADERS,
  )
  const key = res?.data?.qrcode_key
  const url = res?.data?.url
  if (Number(res?.code) !== 0 || !key || !url) {
    throw new Error(`bili 扫码: generate 失败(${res?.message ?? "无响应"})`)
  }
  return { key, url }
}

/** 一次轮询结果。 */
export interface BiliQrPoll {
  /** 协议状态码(见 BILI_QR_STATUS)。 */
  status: number
  /** 成功时的 cookie 串(SESSDATA/bili_jct/DedeUserID 等)。 */
  cookie?: string
  /** 成功时的 refresh_token(可续期,见 docs/platform-login-research.md)。 */
  refreshToken?: string
}

/** 从 Set-Cookie 头数组提取 "k=v; k2=v2"。 */
function parseSetCookie(headers: Record<string, unknown>): string {
  const raw = headers["set-cookie"]
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split("\n") : []
  return list
    .map((c: unknown) => String(c).split(";")[0]!.trim())
    .filter((c: string) => c.includes("="))
    .join("; ")
}

/**
 * 轮询一次。成功时返回 cookie + refresh_token。
 * ⚠️ 需拿到响应头,故不能走 httpJson(它只给 body)——用 appHost.http.request 直接取。
 */
export async function biliQrPoll(key: string): Promise<BiliQrPoll> {
  const res = await globalThis.appHost.http.request({
    url: `${PASSPORT}/poll?qrcode_key=${encodeURIComponent(key)}`,
    method: "GET",
    headers: HEADERS,
  })
  let body: any = null
  try {
    body = JSON.parse(String(res.body ?? ""))
  } catch {
    /* 空 body / 非 JSON → 视为待扫 */
  }
  const status = Number(body?.data?.code ?? -1)
  if (status !== BILI_QR_STATUS.SUCCESS) return { status }
  const cookie = parseSetCookie(res.headers ?? {})
  // refresh_token 从跳转 url 的 query 里取(续期闭环用)。
  const refreshToken = String(body?.data?.refresh_token ?? "") || undefined
  return { status, cookie, refreshToken }
}

/** 轮询间隔(协议建议 ~2s;未扫到就继续)。 */
const POLL_INTERVAL_MS = 2000

export interface BiliScanLoginOptions {
  /** 总超时,默认 3 分钟(二维码约 3 分钟内有效)。 */
  timeoutMs?: number
  /** 轮询到「已扫待确认」时回调一次(供 UI 提示「请在手机上确认」)。 */
  onScanned?: () => void
}

/**
 * 完整扫码登录:generate → 循环 poll 直到成功/过期/超时。
 * 返回 LoginResult(cookie 由 core 落 settings)。
 */
export async function biliScanLogin(opts: BiliScanLoginOptions = {}): Promise<LoginResult> {
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000)
  const qr = await biliQrGenerate()
  let scannedNotified = false
  for (;;) {
    if (Date.now() > deadline) throw new Error("bili 扫码: 超时未完成")
    const r = await biliQrPoll(qr.key)
    if (r.status === BILI_QR_STATUS.SUCCESS) {
      if (!r.cookie) throw new Error("bili 扫码: 成功但未取到 cookie")
      log.biliLogin.info("扫码登录成功")
      return { cookie: r.cookie, refreshToken: r.refreshToken }
    }
    if (r.status === BILI_QR_STATUS.EXPIRED) throw new Error("bili 扫码: 二维码已过期")
    if (r.status === BILI_QR_STATUS.SCANNED && !scannedNotified) {
      scannedNotified = true
      opts.onScanned?.()
    }
    await new Promise((r2) => setTimeout(r2, POLL_INTERVAL_MS))
  }
}
