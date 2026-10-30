/**
 * douyin:user —— 抖音用户主页「作品」渠道(kind: social)。
 *
 * **被动采集**：导航 `www.douyin.com/user/<sec_uid>`，页面自己的 JS 会请求
 * `aweme/v1/web/aweme/post/`；我们用 `capturePage` 在 `Network.loadingFinished`
 * 后读那份响应体，**应用侧不构造任何接口请求、不做签名**。
 * 不声明 `passive` 是因为这条渠道依赖页面脚本渲染（passive 闸门只认导航文档本身），
 * 但数据来源仍是页面自己的请求，与 xhs:user 同档。
 *
 * ⚠️ 为什么不能「页面内 fetch」或自签直连（2026-10-30 实测，详见
 * `resolve/platform/douyin/user.ts` 文件头）：页面自己发 200 JSON，**原样重放同一条
 * URL**（同一份 cookie）返回的是 835KB HTML 骨架；补 `uifid` 头 / 页面 msToken /
 * 本仓现算 `a_bogus` 全部无效；纯 HTTP 自签走 ABogus + ttwid 直接 **403**（并触发平台
 * 5 分钟冷却）。→ 只能被动捕获。
 *
 * ⚠️ **已知上限：只拿首屏（实测 ~21 条）**。作品数更多的账号，翻页需要页面自己发下一次
 * `/aweme/post`（`max_cursor` 在页面手里），但 2026-10-30 实测这些手段都**没能**触发：
 * 程序化 `scrollTop`（含小步 scrollBy 到 1192/1192）、内层容器逐个滚、真实滚轮
 * （`Input.dispatchMouseEvent`）、`PageDown`、`Input.synthesizeScrollGesture`、
 * `Emulation.setFocusEmulationEnabled` + `Page.setWebLifecycleState(active)`、
 * 加宽/加高视口、以及已登录 profile。页面全程只发首屏那一次请求。
 * 因此本渠道**不提供 `fetchMore`**：界面不会出现「加载更多」，也不会假装到底。
 * 后续要打通翻页，得先解决「怎么让页面自己发下一页」这件事（候选：真屏内可见窗口 +
 * OS 级输入、或找到页面内部的加载触发点），届时再补 Pageable。
 */

import {
  awemeListToSocial,
  cdpNavigate,
  douyinUserUrl,
  now,
  parseDouyinSecUid,
  readAwemeList,
  withBrowserOp,
} from "@amoeba/resolve"
import type { Item, SerializeOptions } from "@amoeba/xml"

import type { RssChannel, RssSource, SourceInfo } from "../../index.ts"
import { passiveBuffer } from "../../passive/buffer.ts"
import { capturePage } from "../../passive/capture.ts"
import { apiFetchItems } from "../factory.ts"

/** 被动捕获的 lane（列表页专属 tab）。 */
const LANE = "list:douyin:user"
/** passiveBuffer 的接口键（与 platform 一起定位「本渠道」的响应）。 */
const ENDPOINT = "user_posts"
/** 页面自己的作品列表接口（只用于判定，不用于发请求）。 */
const POST_PATH = "/aweme/v1/web/aweme/post/"

const NEEDS_BROWSER =
  "抖音用户主页需要桌面抓取浏览器：作品列表只能由页面自己请求（接口重放会被降级成 HTML，自签直连 403）"

const NO_POSTS =
  "抖音用户主页没有触发作品列表请求：可能是页面被风控、链接无效，或作品为空（请在浏览器里确认主页能正常打开）"

export class DouyinUserChannel implements RssChannel {
  readonly key = "douyin:user"
  readonly name = "抖音用户主页"
  readonly kind = "social" as const
  readonly sourceInfoTpl = [
    {
      key: "sec_uid",
      label: "用户主页链接或 sec_uid",
      required: true,
      placeholder: "https://www.douyin.com/user/MS4wLj…",
    },
  ]

  getSource(info: SourceInfo): RssSource {
    const secUid = parseDouyinSecUid(String(info.sec_uid ?? ""))
    const browser = globalThis.appHost?.browser
    return {
      // 无浏览器（mobile / CLI 未加 --browser）没有被动采集通道：抖音的 HTTP 直连
      // 需要自签 a_bogus + 真实 msToken，已实测 403（且会触发平台冷却），不提供该路径。
      fetch: apiFetchItems(
        () => (browser ? this.fetchFirstPage(browser, secUid) : Promise.reject(new Error(NEEDS_BROWSER))),
        () => this.channelOptions(secUid),
      ),
    }
  }

  /**
   * 首屏：导航主页 → 捕获页面自己的 `/aweme/post/` → 映射。
   *
   * ⚠️ 必须 interactive：lane 的 tab 是**后台 target**，hidden 下渲染/水合被节流，
   * 页面连首屏那发 `/aweme/post/` 都不会发（2026-10-30 实测：默认页上会发，lane tab
   * 上不发，passiveBuffer 恒空、作品区 0 张卡）。xhs 的被动捕获能留在 hidden，是因为
   * 它读的是导航文档本身，不依赖页面脚本再发请求。
   */
  private async fetchFirstPage(browser: BrowserBackend, secUid: string): Promise<Item[]> {
    const awemes = await withBrowserOp(browser, { lane: LANE, mode: "interactive", platform: "douyin" }, async (b) => {
      // 页面那发请求偶尔没在捕获窗口内落地（实测重跑就正常）→ 重载再试一次。
      for (let attempt = 0; attempt < 2; attempt++) {
        await capturePage(b, {
          platform: "douyin",
          endpoint: ENDPOINT,
          match: (u) => u.pathname === POST_PATH,
          trigger: (x) => cdpNavigate(x, douyinUserUrl(secUid), true),
        })
        // ⚠️ 必须核对 URL 里的 sec_user_id：缓冲按 (platform, endpoint) 取最新，同一次运行里
        // 两个 douyin:user 订阅会共用这个键 —— 不核对就会把上一个号的作品当成这个号的。
        const entry = passiveBuffer.getLatest("douyin", ENDPOINT)
        if (!entry || !entry.url.includes(secUid)) continue
        const list = readAwemeList(entry.body)
        if (list.length) return list
      }
      throw new Error(NO_POSTS)
    })
    return awemeListToSocial(awemes, this.key, now())
  }

  private channelOptions(secUid: string): SerializeOptions {
    return {
      channelTitle: `抖音 · ${secUid.slice(-8)}`,
      channelLink: douyinUserUrl(secUid),
    }
  }
}
