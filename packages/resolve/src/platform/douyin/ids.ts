/**
 * 抖音用户/直播间标识归一（纯函数，无网络/宿主依赖）。
 *
 * ⚠️ 抖音的 `web_rid` 不要求纯数字：用户抖音号（`unique_id`）、数字 `short_id`
 * 都能被 enter API 解析成当前直播间（2026-10-18 实测）。故订阅参数允许用户
 * 直接粘贴「抖音号」「直播间链接」或 `@抖音号`，这里统一收敛。
 *
 * 本模块只做**标识归一**（主页链接 → sec_uid），不调网络；sec_uid → `unique_id`
 * 需要匿名资料 API，见 `profile.ts` / 渠道 `live:douyin:user`。
 */

/** 是否抖音用户主页链接（含 `share/user` 旧路径）。 */
export function isDouyinProfileUrl(raw: string): boolean {
  const s = raw.trim()
  return (
    /^(?:https?:\/\/)?(?:www\.)?douyin\.com\/(?:share\/)?user\//i.test(s) ||
    /^(?:https?:\/\/)?(?:www\.)?iesdouyin\.com\/share\/user\//i.test(s)
  )
}

/**
 * 从主页链接 / `@抖音号` / 裸 sec_uid 中取 `sec_uid`。
 * 只接受主页链接或裸 sec_uid；直播间链接会抛错（那是 `live:douyin` 的参数）。
 */
export function parseDouyinSecUid(raw: string): string {
  const s = raw.trim().replace(/^@+/, "")
  if (!s) throw new Error("需要抖音用户主页链接或 sec_uid")
  if (/^抖音号\s*[:：]/u.test(s)) {
    throw new Error("这是抖音号，不是主页链接；抖音号请用 live:douyin 渠道，或提供用户主页链接")
  }

  if (/^https?:\/\//i.test(s) || /^(?:www\.)?(?:ies)?douyin\.com\//i.test(s)) {
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
    let url: URL
    try {
      url = new URL(withScheme)
    } catch {
      throw new Error(`不是有效的抖音主页链接: ${raw}`)
    }
    const m = url.pathname.match(/\/(?:share\/)?user\/([^/?#]+)/)
    if (!m?.[1]) throw new Error("链接不是抖音用户主页（应形如 www.douyin.com/user/<sec_uid>）")
    return decodeURIComponent(m[1])
  }

  return s
}

/**
 * 直播间输入归一：
 *   `@pvcyinse` / `抖音号：pvcyinse` → `pvcyinse`
 *   `https://live.douyin.com/6753235366?foo=1` → `6753235366`
 *   `live.douyin.com/6753235366` → `6753235366`
 * 其余原样返回（裸抖音号 / 短 ID / web_rid）。
 *
 * ⚠️ 主页链接会原样返回；调用方先用 `isDouyinProfileUrl` 拦住，再交给资料 API
 * 解析成 web_rid（`live:douyin` 与存量 `live:douyin:user` 共用）。
 */
export function normalizeDouyinRoomId(raw: string): string {
  let s = raw.trim()
  if (!s) return ""
  s = s.replace(/^@+/, "").replace(/^抖音号\s*[:：]\s*/u, "")

  if (/^(?:https?:\/\/)?(?:www\.|live\.)?douyin\.com\//i.test(s)) {
    const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`
    try {
      const url = new URL(withScheme)
      // 只认 live.douyin.com 的直播间路径；www.douyin.com/user/... 是主页，交给上层拦截。
      if (/^(?:live|www)\.douyin\.com$/i.test(url.hostname) || /^douyin\.com$/i.test(url.hostname)) {
        const segs = url.pathname.split("/").filter(Boolean)
        const last = segs[segs.length - 1]
        if (last) return decodeURIComponent(last)
      }
    } catch {
      // 解析失败：回退原文，让上游 API 给出清晰错误。
    }
  }

  return s
}
