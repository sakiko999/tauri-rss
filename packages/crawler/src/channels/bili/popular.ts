/**
 * bili:popular —— bilibili 综合热门(video channel)。
 *
 * `/x/web-interface/popular` 全站热门。implements VideoPlayable + DanmakuPlayable,
 * getDanmaku 走 bili VOD 弹幕(kind:"vod")。
 *
 * 另 implements **Loginable**:平台账号登录(不依赖 info 实例化)。bili 扫码是
 * 纯 HTTP 协议(`passport.bilibili.com/x/passport-login/web/qrcode/*`),不需要
 * appHost.browser —— 扫一次所有 bili channel 共享(登录态按 channelKey 前缀注入)。
 */
import type { Item } from "@amoeba/xml"
import { type SerializeOptions } from "@amoeba/xml"
import type { LoginResult, Loginable, RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { apiFetch } from "../factory.ts"
import { now } from "@amoeba/resolve"
import { biliClient, biliScanLogin, biliQrGenerate } from "@amoeba/resolve"
import { API, ugc } from "./video-common.ts"

export class BiliPopularChannel implements RssChannel, Loginable {
  readonly key = "bili:popular"
  readonly name = "B站综合热门"
  readonly kind = "video" as const

  /**
   * 扫码登录(平台级;纯 HTTP,不依赖 appHost.browser)。
   * emitQr 推的是**二维码内容 URL**(不是 data URL)—— 编码在 UI 侧。
   *
   * ⚠️ 必须把生成的 qr **传回** biliScanLogin:否则它会自己再 load 一个码,
   * 而用户扫的是我们推给他的那个 —— 永远登录不上。
   */
  async scanLogin(
    emitQr: (qr: string | null) => void,
    opts?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const qr = await biliQrGenerate()
    emitQr(qr.url)
    const result = await biliScanLogin({ timeoutMs: opts?.timeoutMs, qr })
    emitQr(null)
    return result
  }

  // 视频源:implements VideoPlayable,resolvePlay 闭包捕获 info(core 层注入 cookie)。
  getSource(info: SourceInfo): RssSource {
    return {
      fetch: apiFetch(() => this.fetchItems(info), () => this.channelOptions(info)),
    }
  }
  private async fetchItems(_info: SourceInfo): Promise<Item[]> {
    const data = await biliClient.getJson<{ data?: { list?: Array<Record<string, unknown>> } }>(
      `${API}/x/web-interface/popular`,
    )
    const list = data?.data?.list ?? []
    const t = now()
    return list.map((raw) =>
      ugc("bili:popular", t, {
        title: raw.title,
        pic: raw.pic,
        desc: raw.desc,
        pubdate: raw.pubdate,
        aid: raw.aid,
        bvid: raw.bvid,
        duration: raw.duration,
        owner: (raw.owner as { name?: string }) ?? undefined,
      }),
    )
  }
  private channelOptions(_info: SourceInfo): SerializeOptions {
    return { channelTitle: "B站综合热门", channelLink: "https://www.bilibili.com/" }
  }
}
