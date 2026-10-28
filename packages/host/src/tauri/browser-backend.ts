/**
 * TauriBrowserBackend — 桌面载具：CDP 附加 Tauri 自己的 WebView2。
 *
 * 微博/小红书反爬强,需真实浏览器提供登录态 + JS 签名(_webmsxyw)+ 设备指纹。
 * Rust `webview_browser_open` 建一个隐藏 webview(独立 data_directory + CDP 9334),
 * 不 spawn 系统 Edge。CDP 语义（lane/超时/资源拦截/空闲回收）在
 * `browser/backend.ts` 的 `CdpBrowserBackend`，这里只提供两样桌面专属的东西：
 *   - connector：文本帧走 Rust ws 隧道（invoke ws_connect/ws_send/ws_close）；
 *   - driver：窗口/target 的桌面语义（屏外坐标 + tidy、Edge 自带界面、3 分钟空闲回收）。
 *
 * ⚠️ WebView2 没有 tab：`Target.createTarget` 每个 target 都是独立顶层窗口，
 * 必须给屏外坐标 + `background`，创建后立刻 `webview_browser_tidy` 去任务栏。
 * ⚠️ 默认通道不能取「第一个 page」：实测 Edge 155 的 /json/list 首项是
 * `edge://nurturing/`，不是启动参数里的 about:blank。
 */
import { Channel, invoke } from "@tauri-apps/api/core"

import { type BrowserDriver, CdpBrowserBackend, type CdpTargetInfo } from "../browser/backend.ts"
import type { CdpConnector, CdpTransport, CdpTransportHandlers } from "../browser/transport.ts"

/** 与 ws.rs WsEvent(tag/content)对齐;CDP 走 Text 帧。 */
interface CdpEventMsg {
  event: "Text" | "Close" | "Error" | "Open" | "Binary"
  data?: unknown
}

/** btoa 只支持 Latin1;CDP 消息可能含中文(URL/签名/页面文本),先 UTF-8 编码再 base64。 */
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(b64: string): string {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Edge 自带界面的 scheme。默认通道绝不挂上去，启动后也顺手关掉这些 target。
 * ⚠️ `about:` 不在此列 —— 那是我们自己的空白页。
 */
const EDGE_UI_URL = /^(edge|chrome|chrome-untrusted|devtools|chrome-extension):/i

/** Copilot 侧栏 iframe：实测独占一个 renderer、121MB private，抓取完全用不到。 */
const EDGE_UI_HOST = /^https?:\/\/copilot\.microsoft\.com\//i

function isEdgeUiTarget(t: CdpTargetInfo): boolean {
  const url = t.url ?? ""
  return EDGE_UI_URL.test(url) || EDGE_UI_HOST.test(url)
}

/**
 * Rust ws 隧道作为 CDP 文本帧传输。
 * ⚠️ ws.rs 的 ws_send 已支持 text=true(CDP 用),弹幕二进制调用不受影响。
 */
export const tauriBrowserConnector: CdpConnector = {
  async connect(wsUrl: string, handlers: CdpTransportHandlers): Promise<CdpTransport> {
    const onEvent = new Channel<CdpEventMsg>()
    onEvent.onmessage = (ev) => {
      if (ev.event === "Text") handlers.onText(fromBase64(ev.data as string))
      else if (ev.event === "Close" || ev.event === "Error") handlers.onClose(`CDP 连接已断开(${ev.event})`)
    }
    const c = await invoke<{ connectionId: string }>("ws_connect", {
      req: { url: wsUrl, headers: {}, timeoutMs: 10_000 },
      onEvent,
    })
    const connectionId = c.connectionId
    return {
      async send(text: string): Promise<void> {
        await invoke("ws_send", { connectionId, payload: toBase64(text), text: true })
      },
      async close(): Promise<void> {
        await invoke("ws_close", { connectionId }).catch(() => {})
      },
    }
  },
}

/**
 * 空闲关闭:抓取实例活跃时约 0.9–1.0GB private(实测 2026-10-22),而抓取是间歇性的。
 * 零在途操作满 3 分钟就关掉(profile/登录态留在磁盘上),下次用自动重启(~1.5s)。
 * ⚠️ 10 分钟太长:一轮刷新结束后通常就没事了,而常驻的 1GB 对用户是实打实的。
 */
const IDLE_CLOSE_MS = 3 * 60_000

/** 桌面载具：WebView2 隐藏窗口 + 固定端口 9334。 */
export function tauriBrowserDriver(): BrowserDriver {
  return {
    ensureReady: () => invoke<number>("webview_browser_open"),
    // 只跳过 Edge 自带界面；`browser_ui` 可能是窗口自身的 UI target，关掉有连带风险。
    isUsableTarget: (t) => !(t.type !== "browser_ui" && isEdgeUiTarget(t)),
    targetParams: () => ({
      url: "about:blank",
      newWindow: true,
      left: -32000,
      top: -32000,
      width: 1280,
      height: 800,
      background: true,
    }),
    afterTargetChange: () => invoke<void>("webview_browser_tidy"),
    setMode: async (mode) => {
      await invoke("webview_browser_set_mode", { mode })
    },
    close: async () => {
      await invoke("webview_browser_close")
    },
    resetProfile: () => invoke<string>("webview_browser_reset"),
    idleCloseMs: IDLE_CLOSE_MS,
  }
}

export class TauriBrowserBackend extends CdpBrowserBackend {
  constructor() {
    super({ driver: tauriBrowserDriver(), connector: tauriBrowserConnector })
  }
}
