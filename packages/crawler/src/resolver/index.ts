/**
 * crawler/resolver —— 按 item.url 统一解析流/弹幕的独立模块。
 *
 * 能力抽离:crawler/rsshub 的输出都只是基础信息(item.url 指向平台详情页)。
 * 本模块对任何来源的条目按 url 路由到平台解析函数,「统一生效」。channel 不再
 * 绑定 resolvePlay/getDanmaku,只输出基本信息。
 */
export * from "./router.ts"
export * from "./play.ts"
export * from "./danmaku.ts"