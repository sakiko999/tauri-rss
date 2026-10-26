/**
 * login — 扫码登录平台账号（经数据服务）。
 *
 * 架构前提（2026-10-26 定）：数据服务是唯一生产者，profile/cookie 只存在于服务上，
 * desktop 与 CLI 都是消费者。所以登录**只有一条路径**：连服务的 `scanLogin` RPC，
 * cookie 由服务写入自己的 settings。CLI 不写本地库，也不维护第二份 profile —— 那
 * 会让桌面与 CLI 各有一份登录态，且谁也看不到对方。
 *
 * 服务的生命周期不与 desktop 绑定：桌面运行时顺带管理它，但登录命令只要求「有服务
 * 在跑」。服务未运行时给出两条启动路径，并提示手动起服务必须复用同一份 db/profile。
 *
 * 二维码：emitQr 两种载荷（data URL / 内容）统一由 ui/qr-terminal 画成半块字符；
 * 识别失败时把原图落盘，不让终端卡在一张画不出来的码上。
 */
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import pc from "picocolors"
import { LOGIN_PLATFORMS, cookieFieldOf, platformOfChannelKey } from "@amoeba/platform"
import { isLoginable, listChannels, type Loginable, type RssChannel } from "@amoeba/crawler"
import { createRemoteDataLayer } from "@amoeba/service-client"
import { matrixFromEmit, pngBytesFromDataUrl, printQr } from "../ui/qr-terminal.ts"
import { fmtMs, ok, printJson, startTimer } from "../ui/render.ts"
import { resolveEndpoint } from "./attach.ts"

export interface LoginOptions {
  endpoint?: string
  /** 等待扫码的秒数（缺省由平台实现决定，通常 3~5 分钟）。 */
  timeout?: number
  json?: boolean
}

function findLoginable(platform: string): RssChannel & Loginable {
  if (!cookieFieldOf(platform)) {
    throw new Error(`平台 ${platform} 不支持扫码登录。可用：${LOGIN_PLATFORMS.join(" / ")}`)
  }
  // 同平台多渠道共享登录态（xhs:explore / xhs:user），取第一个可登录渠道即可。
  const channel = listChannels().find((c) => isLoginable(c) && platformOfChannelKey(c.key) === platform)
  if (!channel) throw new Error(`没有找到 ${platform} 的可登录渠道`)
  return channel as RssChannel & Loginable
}

function loadEndpoint(explicit?: string) {
  try {
    return resolveEndpoint(explicit)
  } catch (e) {
    // 只取首行（resolveEndpoint 的后半句提示由下面的统一文案覆盖）。
    const reason = (e instanceof Error ? e.message : String(e)).split("\n")[0]!
    throw new Error(
      `没有运行中的数据服务。\n${pc.dim(reason)}\n` +
        `启动桌面（会一并拉起服务），或手动起服务：\n` +
        `  rss --service --data-dir <dir> --db <桌面库> --profile-dir <桌面 profile>\n` +
        pc.yellow("⚠️ 手动起服务必须指向同一份 db/profile，否则登录态不会共享。"),
    )
  }
}

export async function runLogin(platform: string, opts: LoginOptions): Promise<void> {
  const channel = findLoginable(platform)
  const endpoint = loadEndpoint(opts.endpoint)
  const elapsed = startTimer()

  let layer: Awaited<ReturnType<typeof createRemoteDataLayer>>
  try {
    layer = await createRemoteDataLayer(endpoint)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`连不上数据服务 127.0.0.1:${endpoint.port}：${reason}\n${pc.dim("服务可能刚退出，重新启动后再试。")}`)
  }

  const controller = new AbortController()
  // Ctrl+C：abort 会经 service-client 转成 client.cancel(jobId)。只 abort 本地 fetch
  // 不会停服务端 job —— 登录会占住 login:<platform> lane 直到超时。
  const onSigint = () => {
    controller.abort()
    setTimeout(() => process.exit(130), 300)
  }
  process.once("SIGINT", onSigint)

  let lastPayload = ""
  const emit = (qr: string | null): void => {
    // emitQr 在 WS 事件回调里执行，抛错会影响后续事件处理 —— 这里全部吞掉并提示。
    try {
      if (qr === null) {
        console.log(pc.dim("二维码已关闭"))
        return
      }
      if (qr === lastPayload) return
      lastPayload = qr
      printQr(matrixFromEmit(qr))
      console.log(pc.dim("用手机扫码登录（Ctrl+C 取消）"))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        const file = join(tmpdir(), `amoeba-login-${platform}-${Date.now()}.png`)
        writeFileSync(file, pngBytesFromDataUrl(qr!))
        console.error(pc.yellow(`⚠️ 终端渲染失败（${msg}），二维码已保存：${file}`))
      } catch {
        console.error(pc.red(`✘ 二维码无法显示：${msg}`))
      }
    }
  }

  try {
    const result = await layer.scanLogin(channel.key, emit, {
      ...(opts.timeout ? { timeoutMs: Math.round(opts.timeout * 1000) } : {}),
      signal: controller.signal,
    })
    const ms = elapsed()

    if (opts.json) {
      printJson({
        platform,
        channelKey: channel.key,
        userId: result.user_id ?? null,
        alreadyLoggedIn: result.alreadyLoggedIn === true,
      })
      return
    }

    const who = result.user_id ? pc.dim(` · user_id ${result.user_id}`) : ""
    console.log(
      result.alreadyLoggedIn
        ? `${ok("已登录")} ${platform}${who}`
        : `${ok("登录成功")} ${platform}${who} ${fmtMs(ms)}`,
    )
    console.log(pc.dim("cookie 已写入数据服务设置；桌面刷新与 --via-service 探针会直接使用。"))
  } finally {
    process.off("SIGINT", onSigint)
    layer.close()
  }
}
