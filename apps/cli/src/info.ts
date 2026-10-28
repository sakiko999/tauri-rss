/**
 * info 组装 —— channel 实例化参数与登录 cookie 的统一入口(各探针共用)。
 *
 * cookie 策略(2026-10-21 credentials 收口后):
 *   - settings 登录态由 resolve 的 credentials provider 兜底(main.ts 入口注册一次),
 *     本文件不再手抄 channelKey→cookie 前缀表(旧表缺 douyin,已漂移);
 *   - 订阅级 `--kv cookie=` 覆盖:键存在即尊重,**空串 = 强制匿名探针**
 *     (渠道把 info.cookie 显式传给 client,client 侧空串不回落 provider)。
 */
import { createSettingsRepository, type AppSettings } from "@amoeba/core"
import { getChannel, type SourceInfo } from "@amoeba/crawler"

/** 各 channel 的示例参数(收编自 crawler example/backend.ts;无参 channel 空)。 */
export function exampleInfo(key: string): Record<string, string> {
  switch (key) {
    case "bili:user_video":
      return { uid: "511068914" } // 3Blue1Brown
    case "bili:dynamic":
      return { uid: "2267573" } // DIYgod(视频为主,需登录 cookie)
    case "bili:live":
      return { roomId: "998" } // 一个公开直播房间
    case "youtube":
      return { channelId: "UCYO_jab_esuFRV4b17AJtAw" } // 3Blue1Brown
    case "youtube:playlist":
      return { playlistId: "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI" } // 探针实测 15 条
    case "youtube:live-category":
      return { category: "gaming" } // Live Now - Gaming
    case "youtube:live":
      return { videoId: "tRsQsTMvPNg" } // Claude FM 常驻直播(desktop 测试源)
    case "bili:season":
      return { seasonId: "2974525" } // 探针实测 61 条
    case "bili:series":
      return { seriesId: "358495" } // 探针实测 54 条
    case "bili:favlist":
      return { mediaId: "1052622027" } // 公开收藏夹,探针实测 28 条
    case "live:huya":
      return { roomId: "116" } // 虎牙房间
    case "live:douyu":
      return { roomId: "9999" } // 斗鱼房间(yyfyyf,验证过 betard 可用)
    case "live:douyin":
      return { roomId: "1" } // 抖音房间
    case "twitch:live":
      return { roomIds: "shroud" } // Twitch 频道登录名
    case "twitch:category":
      return { category: "just-chatting" } // 分区 slug(或目录页链接)
    case "rss:podcast":
      return { url: "https://feeds.megaphone.fm/hubermanlab" } // Huberman Lab(desktop 测试源)
    default:
      return {}
  }
}

/** 进程内单例仓库(读改写串行化 + 归一化 + 损坏留证都在 core,R15)。 */
let settingsRepo: ReturnType<typeof createSettingsRepository> | null = null

/** 读 settings —— 走 core 的 SettingsRepository(与桌面/服务同一套归一化)。 */
export async function loadSettings(): Promise<AppSettings> {
  settingsRepo ??= createSettingsRepository(globalThis.appHost.storage)
  return settingsRepo.get()
}

/**
 * 组装 channel 实例化 info:defaultInfo < exampleInfo < 用户 kv。
 * cookie 不在此注入(settings 登录态走 credentials provider);kv 的 cookie 键
 * 存在即尊重(空串 = 强制匿名,渠道显式传给 client 后不回落 provider)。
 */
export async function buildInfo(channelKey: string, overrides: Record<string, string> = {}): Promise<SourceInfo> {
  const ch = getChannel(channelKey)
  if (!ch) throw new Error(`unknown channel: ${channelKey}(rss channels 查看全部)`)
  const base: Record<string, string> = { ...(ch.defaultInfo ?? {}), ...exampleInfo(channelKey), ...overrides }
  if (overrides.cookie !== undefined) base.cookie = overrides.cookie
  return base
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
