/**
 * platform 类型 —— 平台请求客户端统一接口。
 *
 * 各平台抓取层收敛成无状态 `PlatformClient`(cookie/referer 每次传参),
 * 统一暴露带平台签名/UA/cookie 的请求 + 弹幕流能力。归一/流解析等平台特有
 * 能力保留各平台导出,不塞进统一接口(避免 all-optional 垃圾接口)。
 */

import type { DanmakuOptions, DanmakuStream } from "../danmaku"

export interface PlatformRequestOptions {
  /** 登录 cookie(平台 API 需要登录态/风控放行)。 */
  cookie?: string
  /** 动态 Referer(部分平台按请求页校验)。 */
  referer?: string
  /** 额外 headers(合并到平台默认 UA/签名头之后)。 */
  headers?: Record<string, string>
}

/**
 * 浏览器 profile 的登录 cookie 快照(应用启动时对齐 settings 用)。
 * `null` = 浏览器里没有登录标记(不能当成「确定已登出」,见 core syncBrowserCookies)。
 */
export interface LoginCookieSnapshot {
  /** `k=v; k2=v2`(含 HttpOnly;按 key 排序,便于比较)。 */
  cookie: string
  /**
   * 平台侧可得的最佳身份线索,仅用于日志(weibo=SUBP,不是 uid;xhs=user_id,可能缺失)。
   */
  user_id?: string
}

/** 平台请求客户端统一接口 —— 带平台签名/UA/cookie 的请求 + 弹幕流能力。 */
export interface PlatformClient {
  /** JSON 请求(有 JSON API 的平台实现;纯页面/专用协议平台如 huya/youtube 可省)。 */
  getJson?<T = any>(url: string, opts?: PlatformRequestOptions): Promise<T>
  /** 页面型平台(huya/xhs)的 HTML 抓取(带平台 UA/cookie)。 */
  getHtml?(url: string, opts?: PlatformRequestOptions): Promise<string>
  /** 弹幕流能力(直播/video 平台;订阅即开始,退订断开)。 */
  getDanmaku?(id: string, opts?: DanmakuOptions): DanmakuStream
}
