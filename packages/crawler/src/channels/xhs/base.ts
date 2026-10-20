/**
 * xhs 渠道公共基类。
 *
 * 单独成文件的原因:shared.ts 会 import `@amoeba/resolve`,而 resolve → host → core
 * → crawler 的包级依赖是环。若基类留在 shared.ts,直接 import shared 时 user.ts
 * 可能在 shared 求值完成前 `extends XhsChannelBase` → TDZ。基类不依赖 shared,
 * 拆出来后 user/explore 可以安全地先拿基类、再用 shared 的函数。
 */
import type { Loginable, LoginResult } from "../../index.ts"
import { xhsScanLogin } from "@amoeba/resolve"

export class XhsChannelBase implements Loginable {
  /** 两个 xhs 渠道都支持 L9(浏览器被动)。 */
  readonly supportsL9 = true

  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<LoginResult> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error("扫码登录需 Tauri 桌面环境(未注入 appHost.browser)")
    return xhsScanLogin(browser, emitQr, opts)
  }
}
