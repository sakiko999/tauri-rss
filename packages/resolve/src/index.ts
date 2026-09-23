/**
 * @tauri-playground/resolve —— 平台解析层(独立包,持有平台全部能力)。
 *
 * 定位(2026-08-26 架构重构):platform 与 crawler 解耦,平台能力(请求签名/取数/
 * 播放解析/弹幕)全集中在此。crawler 只输出订阅数据(依赖 resolve 的平台 client
 * 抓数据产 XML);core 依赖 crawler(渠道)+ resolve(播放)。
 *
 * 对外契约:按 item.url 的懒解析(播放/弹幕)+ 平台 client(供 crawler channel 抓数据)。
 *
 * 类型边界:以下类型 resolve 自持(结构兼容),不依赖 crawler——resolve 是独立包,
 * 只能被 crawler 依赖,不能反向依赖 crawler。SourceInfo/LoginResult 在此镜像声明。
 */
/** 平台解析 / 抓取参数与 crawler 结构一致(channel info / resolver info)。 */
export type SourceInfo = Record<string, string>

/** 扫码登录结果(与 crawler LoginResult 结构一致)。 */
export interface LoginResult {
  cookie: string
  user_id?: string
  alreadyLoggedIn?: boolean
  /** 续期凭证(bili 扫码返回;bili 可自动保活,见 docs/platform-login-research.md)。 */
  refreshToken?: string
}

export type { DanmakuItem, DanmakuOptions, DanmakuStream } from "./danmaku/index.ts"

export * from "./danmaku/index.ts"
export * from "./resolver/index.ts"

// ── 平台能力(供 crawler channel 抓数据 + resolver 播放) ──
export * from "./platform/bili/index.ts"
export * from "./platform/douyin/index.ts"
export * from "./platform/douyu/index.ts"
export * from "./platform/huya/index.ts"
export * from "./platform/weibo/index.ts"
export * from "./platform/xhs/index.ts"
export * from "./platform/youtube/index.ts"
export type * from "./platform/types.ts"

// ── 公共工具(crawler channel 也用:httpText/now/log/utils) ──
export * from "./host.ts"
export * from "./log.ts"
export * from "./utils/index.ts"

// ── 浏览器模拟(weibo/xhs channel 抓取用,CDP 附加真实 Edge) ──
export * from "./browser/cdp.ts"
