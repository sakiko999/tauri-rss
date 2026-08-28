/**
 * info 组装 —— channel 实例化参数与登录 cookie 的统一入口(各探针共用)。
 *
 * cookie 策略与 desktop 对齐:core 层 settings 按平台前缀存默认 cookie
 * (DEFAULT_SETTINGS 内嵌占位,本地改 apps/cli/.data/storage.json 的
 * settings 键即可换真实值),订阅级 info.cookie 永远优先(计划 §六:
 * file-JSON 只做 settings 级小量)。
 */
import { DEFAULT_SETTINGS, type AppSettings } from "@tauri-playground/core"
import { getChannel, type SourceInfo } from "@tauri-playground/crawler"
import { sqliteStorage } from "./store/sqlite-storage.ts"

/** 各 channel 的示例参数(收编自 crawler example/backend.ts;无参 channel 空)。 */
export function exampleInfo(key: string): Record<string, string> {
  switch (key) {
    case "bili:user_video": return { uid: "511068914" } // 3Blue1Brown
    case "bili:dynamic": return { uid: "2267573" } // DIYgod(视频为主,需登录 cookie)
    case "bili:live": return { roomId: "998" } // 一个公开直播房间
    case "youtube": return { channelId: "UCYO_jab_esuFRV4b17AJtAw" } // 3Blue1Brown
    case "youtube:live": return { videoId: "tRsQsTMvPNg" } // Claude FM 常驻直播(desktop 测试源)
    case "live:huya": return { roomId: "116" } // 虎牙房间
    case "live:douyu": return { roomId: "9999" } // 斗鱼房间(yyfyyf,验证过 betard 可用)
    case "live:douyin": return { roomId: "1" } // 抖音房间
    case "rss:podcast": return { url: "https://feeds.megaphone.fm/hubermanlab" } // Huberman Lab(desktop 测试源)
    default: return {}
  }
}

/** 读 settings(与 core SettingsRepository 同构:DEFAULT_SETTINGS 兜底)。 */
export async function loadSettings(): Promise<AppSettings> {
  const raw = await sqliteStorage().get("settings")
  if (!raw) return { ...DEFAULT_SETTINGS }
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** channelKey 前缀 → settings cookie 字段(与 core data-layer.cookieFieldFor 同表)。 */
function cookieForChannel(channelKey: string, s: AppSettings): string | undefined {
  if (channelKey.startsWith("bili:")) return s.bilibiliCookie || undefined
  if (channelKey.startsWith("weibo:")) return s.weiboCookie || undefined
  if (channelKey.startsWith("xhs:")) return s.xhsCookie || undefined
  return undefined
}

/** item.url 域名 → 平台 cookie(item/dm 探针不经 channelKey,按 url 判平台)。 */
export function cookieForUrl(url: string, s: AppSettings): string | undefined {
  if (url.includes("bilibili.com")) return s.bilibiliCookie || undefined
  if (url.includes("weibo.")) return s.weiboCookie || undefined
  if (url.includes("xiaohongshu.com") || url.includes("xhslink.com")) return s.xhsCookie || undefined
  return undefined
}

/**
 * 组装 channel 实例化 info:defaultInfo < exampleInfo < 用户 kv。
 * cookie 单独注入(fetch/item/dm 直连 source/resolver,不经 DataLayer 的
 * sourceInfoFor);overrides.cookie 可显式覆盖。
 */
export async function buildInfo(channelKey: string, overrides: Record<string, string> = {}): Promise<SourceInfo> {
  const ch = getChannel(channelKey)
  if (!ch) throw new Error(`unknown channel: ${channelKey}`)
  const settings = await loadSettings()
  const base: Record<string, string> = { ...(ch.defaultInfo ?? {}), ...exampleInfo(channelKey), ...overrides }
  const cookie = overrides.cookie ?? cookieForChannel(channelKey, settings)
  return cookie ? { ...base, cookie } : base
}

/**
 * 解析命令行的 k=v 参数对(未知形态直接报错,防静默吞参)。
 * cac 对重复 option 的产出不稳定(单个 = string,重复 = string[]),入口统一归一;
 * 空值(`cookie=`)合法 = 显式清空该字段(如强制匿名探测)。
 */
export function parseKvPairs(pairs: string | string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const list = Array.isArray(pairs) ? pairs : pairs ? [pairs] : []
  for (const p of list) {
    const i = p.indexOf("=")
    if (i < 1) throw new Error(`参数应为 k=v 形式,得到: "${p}"`)
    out[p.slice(0, i)] = p.slice(i + 1)
  }
  return out
}
