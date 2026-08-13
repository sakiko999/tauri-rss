/**
 * douyin 弹幕 —— 签名(WebMSSDK get_sign) → wss + signature → PushFrame hb → gzip → protobuf。
 *
 * ⚠️ 2026 douyin 风控升级:老签名脚本(dart_simple_live 2023 提取,getMSSDKSignature)
 * 已失效——实测把 dart 的参数/编码/域名/UA 全部复刻仍 415 DEVICE_BLOCKED。改用
 * jwwsjlm/douyinLive(2026 仍维护)的 webmssdk.js(get_sign,X-Bogus)+ 完整浏览器环境,
 * webcast100 域名 + 真实 pushID,probe 实测握手 101 成功。
 *
 * 签名复刻 douyinLive jsScript:
 *   msStub = md5("live_id=1,aid=6383,...,identity=audience")(k=v 逗号串,XMSStub);
 *   signature = get_sign(msStub) —— kWebMsSDK(webmssdk.js 2024 修改版)经 appHost.js
 *   执行。⚠️ 脚本裸引用 window/document/navigator 全局,必须前置 WEBMSSDK_ENV 完整
 *   环境注入(极简环境产出服务端拒的指纹,见 probe 验证)。含 `-`/`=` 的签名重试。
 * userId = 主播真实 user id_str(enter API data.user.id_str;dart 的随机 12 位已失效)。
 * roomId 需长号(enter API 的 id_str;失败兜底用订阅 web_rid)。
 */
import type { DanmakuStream } from "../../index.ts"
import { createWsStream } from "../../danmaku/ws.ts"
import { deferredStream } from "../../danmaku/deferred.ts"
import { decodeDouyinPushFrame, douyinHeartbeatFrame } from "../../danmaku/douyin-proto.ts"
import { md5Hex } from "../../utils/md5.ts"
import { httpJson } from "../../host.ts"
import { log } from "../../log.ts"
import { DEFAULT_TTWID, UA_ENTER, enterRoomParams, signDouyinUrl } from "./abogus.ts"
import { kWebMsSDK } from "./msdk-sign.ts"

const LIVE = "https://live.douyin.com"
/** WS 弹幕连接 UA(对齐 douyinLive 现代 Chrome;webmssdk 签名环境也用这套)。 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
/** 2026 WS 域名(douyinLive 兜底;webcast3/5 已废弃)。 */
const WS_BASE = "wss://webcast100-ws-web-lf.douyin.com/webcast/im/push/v2/"
/** douyinLive webcast_sdk_version(签名 msStub 字段;dart 的 1.3.0 已失效)。 */
const SDK_VER = "1.0.15"
/** 心跳间隔,ms(10s)。 */
const HEARTBEAT_MS = 10000

/**
 * 浏览器环境注入:webmssdk.js 裸引用 window/document/navigator/screen/localStorage/
 * crypto 全局。⚠️ 两个硬约束(probe 逐项验证):
 *   1. **遮蔽 node 特有全局**(process/Buffer/global 等)——webmssdk 检测到它们会走
 *      node 分支,产出服务端拒的指纹;new Function 在 node 全局作用域跑,必须显式遮蔽。
 *      (tauri webview 的 FunctionJsBackend 无这些全局,遮蔽无害。)
 *   2. **window 必须是完整挂载对象**(含 navigator/screen/document 等)——webmssdk
 *      经 window.navigator 取环境,空对象 window 拿不到 UA 指纹。
 * 另外 webmssdk 以 if (!window.byted_acrawler) 守卫初始化——首次执行设 byted_acrawler
 * 并污染全局,第二次执行被短路跳过 crawler 定义(报错),每次清除。
 * 对齐 douyinLive jsScript.go 的 browserEnvironmentScript 最小子集。
 */
export const WEBMSSDK_ENV = `
var window = {}
window.window = window
window.self = window
window.top = window
window.parent = window
window.byted_acrawler = undefined
window.crawler = undefined
window.navigator = { userAgent: ${JSON.stringify(UA)}, platform: "Win32", language: "zh-CN" }
window.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1032, colorDepth: 24, pixelDepth: 24 }
window.location = { href: "https://live.douyin.com/", origin: "https://live.douyin.com", protocol: "https:", host: "live.douyin.com", pathname: "/" }
window.document = { cookie: "", referrer: "https://www.douyin.com/", createElement: function () { return { getContext: function () { return null }, style: {} } }, documentElement: {}, addEventListener: function () {} }
window.localStorage = { getItem: function () { return null }, setItem: function () {}, removeItem: function () {} }
window.sessionStorage = { getItem: function () { return null }, setItem: function () {}, removeItem: function () {} }
window.crypto = window.crypto || {}
window.crypto.getRandomValues = window.crypto.getRandomValues || function (a) { for (var i = 0; i < a.length; i++) a[i] = (i * 17 + 29) & 255; return a }
var self = window
var top = window
var parent = window
var navigator = window.navigator
var screen = window.screen
var location = window.location
var document = window.document
var localStorage = window.localStorage
var sessionStorage = window.sessionStorage
var crypto = window.crypto
// 遮蔽 node 特有全局:webmssdk 检测到 process 存在走 node 分支,指纹被拒
var process = undefined
var Buffer = undefined
var global = undefined
var queueMicrotask = undefined
var setImmediate = undefined
`

/**
 * require polyfill:host 的 nodeJsBackend 用 `new Function` 执行(全局作用域,无
 * 模块私有 require),而 kWebMsSDK 的 buffer 转换函数(`_0x4d7e2d`)依赖 `require('buffer')`
 * (dart 的 QuickJS 封装自带 CommonJS shim,故能跑)。此处 prepend 一个最小 shim。
 */
export const JS_REQUIRE_SHIM = `
var require = (function () {
  var mod = {
    Buffer: Uint8Array,
    isBuffer: function (b) { return b instanceof Uint8Array || b instanceof ArrayBuffer },
    from: function (x) {
      if (typeof x === "string") { return new TextEncoder().encode(x) }
      return new Uint8Array(x)
    }
  }
  return function (name) { return mod }
})()
`

/** msStub = md5("live_id=1,aid=6383,...")(douyinLive XMSStub:k=v 逗号连接)。 */
function getMsStub(roomId: string, userId: string): string {
  const params: Array<[string, string]> = [
    ["live_id", "1"],
    ["aid", "6383"],
    ["version_code", "180800"],
    ["webcast_sdk_version", SDK_VER],
    ["room_id", roomId],
    ["sub_room_id", ""],
    ["sub_channel_id", ""],
    ["did_rule", "3"],
    ["user_unique_id", userId],
    ["device_platform", "web"],
    ["device_type", ""],
    ["ac", ""],
    ["identity", "audience"],
  ]
  return md5Hex(params.map(([k, v]) => `${k}=${v}`).join(","))
}

/**
 * signature = get_sign(msStub)。⚠️ 脚本前必须拼 WEBMSSDK_ENV(完整浏览器环境)+
 * JS_REQUIRE_SHIM(buffer shim)——webmssdk.js 裸引用 window/document/navigator/require。
 * 含 `-`/`=` 重新生成(douyinLive 循环)。
 */
function douyinSignature(roomId: string, userId: string): string {
  const msStub = getMsStub(roomId, userId)
  const code = `${WEBMSSDK_ENV}\n${JS_REQUIRE_SHIM}\n${kWebMsSDK}`
  let sign = ""
  do {
    sign = String(globalThis.appHost.js.call(code, "get_sign", [msStub]) ?? "")
  } while (sign.includes("-") || sign.includes("="))
  return sign
}

/** 拼 WS URL(参数复刻 douyinLive websocket_params.go QueryString + signature)。 */
function buildWsUrl(roomId: string, userId: string, ua: string): string {
  const nowMs = Date.now()
  const internalExt =
    `internal_src:dim|wss_push_room_id:${roomId}|wss_push_did:${userId}|first_req_ms:${nowMs}|fetch_time:${nowMs}|seq:1|wss_info:0-${nowMs}-0-0|wrds_v:7382620942951772256`
  const cursor = `d-1_u-1_fh-7383731312643626035_t-${nowMs}_r-1`
  const params: Array<[string, string]> = [
    ["app_name", "douyin_web"],
    ["version_code", "180800"],
    ["webcast_sdk_version", SDK_VER],
    ["update_version_code", SDK_VER],
    ["compress", "gzip"],
    ["device_platform", "web"],
    ["cookie_enabled", "true"],
    ["screen_width", "1920"],
    ["screen_height", "1080"],
    ["browser_language", "zh-CN"],
    ["browser_platform", "Win32"],
    ["browser_name", "Mozilla"],
    ["browser_version", ua.replace("Mozilla/", "")],
    ["browser_online", "true"],
    ["tz_name", "Asia/Shanghai"],
    ["cursor", cursor],
    ["internal_ext", internalExt],
    ["host", "https://live.douyin.com"],
    ["aid", "6383"],
    ["live_id", "1"],
    ["did_rule", "3"],
    ["endpoint", "live_pc"],
    ["support_wrds", "1"],
    ["user_unique_id", userId],
    ["im_path", "/webcast/im/fetch/"],
    ["identity", "audience"],
    ["need_persist_msg_count", "15"],
    ["insert_task_id", ""],
    ["live_reason", ""],
    ["room_id", roomId],
    ["heartbeatDuration", "0"],
  ]
  const q = params.map(([k, v]) => `${k}=${v.replace(/ /g, "%20")}`).join("&")
  const sign = douyinSignature(roomId, userId)
  return `${WS_BASE}?${q}&signature=${sign}`
}

/**
 * enter API 拿房间长号(id_str) + 主播 user id_str(user_unique_id)。
 * ⚠️ 两者都必需:dart 随机 12 位 userId 已失效,真实 pushID 参与签名。
 * 失败返回空(兜底:长号用 web_rid,userId 用 web_rid 尾部——尽力而为)。
 */
async function resolveRoomIds(webRid: string, ua: string, cookie?: string): Promise<{ roomId: string; pushId: string }> {
  try {
    const base = `${LIVE}/webcast/room/web/enter/`
    const json = await httpJson<{
      data?: {
        data?: Array<{ id_str?: string; owner_user_id_str?: string; owner?: { id_str?: string } }>
        user?: { id_str?: string }
        room?: { owner?: { id_str?: string } }
      }
    }>(
      signDouyinUrl(`${base}?${enterRoomParams(webRid)}`, ua),
      {
        "user-agent": ua,
        referer: `${LIVE}/${webRid}`,
        authority: "live.douyin.com",
        cookie: cookie || DEFAULT_TTWID,
      },
    )
    const roomId = String(json?.data?.data?.[0]?.id_str ?? "")
    const pushId = String(
      json?.data?.user?.id_str ?? json?.data?.data?.[0]?.owner_user_id_str ?? json?.data?.room?.owner?.id_str ?? "",
    )
    return { roomId, pushId }
  } catch {
    return { roomId: "", pushId: "" }
  }
}

/**
 * douyin 弹幕流:enter 拿长号+pushID → 签名 → 建 WS(进房=hb 心跳),退订断开。
 * [cookie] warmup 抓的新鲜 ttwid 等 —— 握手需带(缺则 415 DEVICE_BLOCKED),
 * 由 channel 的 ensureCookie 提供(example 无则用默认 ttwid)。
 */
export function douyinDanmakuStream(roomId: string, cookie?: string): DanmakuStream {
  return deferredStream(
    () => resolveRoomIds(roomId, UA_ENTER, cookie),
    ({ roomId: longId, pushId }, onItems) => {
      const room = longId || roomId
      const userId = pushId || roomId
      return createWsStream({
        url: buildWsUrl(room, userId, UA),
        // 对齐 douyinLive websocketDialContext 的握手 headers(UA/Cookie/Origin/Referer)。
        headers: {
          "user-agent": UA,
          cookie: cookie || DEFAULT_TTWID,
          origin: "https://live.douyin.com",
          referer: `${LIVE}/${roomId}`,
        },
        onOpen: (ws) => {
          ws.send(douyinHeartbeatFrame() as unknown as ArrayBufferView<ArrayBuffer>)
        },
        heartbeat: () => douyinHeartbeatFrame(),
        heartbeatMs: HEARTBEAT_MS,
        onClose: (code, reason) => log.douyin.warn(`弹幕 WS 关闭(code=${code} reason=${reason}, room=${room})`),
        onMessage: (data, ws) =>
          decodeDouyinPushFrame(new Uint8Array(data), (ack) =>
            ws.send(ack as unknown as ArrayBufferView<ArrayBuffer>),
          ),
      })(onItems)
    },
    (e) => log.douyin.warn("弹幕初始化失败:", (e as Error)?.message),
  )
}
