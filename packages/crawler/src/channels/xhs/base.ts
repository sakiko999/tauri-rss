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
  // ⚠️ `passive` 不下放在基类：xhs:user 的匿名路径必须走页面内 fetch（匿名 profile
  // SSR 抹空 noteId），标成被动会让桌面匿名订阅永远只剩缓存。只有 xhs:explore 是
  // 登录/匿名都读页面 SSR，由它自己声明。

  scanLogin(
    emitQr: (qrDataUrl: string | null) => void,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<LoginResult> {
    const browser = globalThis.appHost?.browser
    if (!browser) throw new Error("扫码登录需 Tauri 桌面环境(未注入 appHost.browser)")
    return xhsScanLogin(browser, emitQr, opts)
  }
}
