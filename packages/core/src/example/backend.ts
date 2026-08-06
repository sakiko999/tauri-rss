/**
 * 共享运行时 —— core example 的初始化操作(参考 crawler example/backend.ts)。
 *
 * core 自身不依赖 Node 专属 API,example(Node 环境)注入:
 *   - setupBackends:            注入 Node 宿主(appHost)+ 构造 DataLayer
 *   - subscriptionsFromChannels:从 crawler 输出的 channel 批量建订阅
 *     (有 defaultInfo 直接用;无的手动补 manualInfo 示例参数)
 */
import { listChannels } from "@tauri-playground/crawler"
import { injectNodeHost } from "@tauri-playground/host"
import { createDataLayer, type DataLayer } from "../data-layer.ts"

/** 需手动构造 info 的 channel 的有效示例参数(与 crawler example 一致)。 */
function manualInfo(key: string): Record<string, string> {
  switch (key) {
    case "bili:user_video": return { uid: "511068914" } // 3Blue1Brown
    case "bili:live": return { roomId: "998" } // 一个公开直播房间
    case "youtube": return { channelId: "UCYO_jab_esuFRV4b17AJtAw" } // 3Blue1Brown
    case "live:huya": return { roomId: "116" } // 虎牙房间
    case "live:douyu": return { roomId: "9999" } // 斗鱼房间(yyfyyf,验证过 betard 可用)
    case "live:douyin": return { roomId: "1" } // 抖音房间
    default: return {}
  }
}

/**
 * 初始化:注入 Node 宿主(appHost,http 用 Node fetch)+ 构造 DataLayer。
 * 各 example 开头调用。
 */
export function setupBackends(): DataLayer {
  injectNodeHost()
  return createDataLayer()
}

/** 从 crawler 输出的 channel 构造订阅集(有 defaultInfo 直接用,无的手动补)。 */
export async function subscriptionsFromChannels(dl: DataLayer, now = Date.now()): Promise<void> {
  const all = listChannels()
  const subs = all.map((ch) => ({
    id: ch.key,
    channelKey: ch.key,
    title: ch.name,
    enabled: true,
    info: ch.defaultInfo ?? manualInfo(ch.key),
    createdAt: now,
    updatedAt: now,
  }))
  for (const s of subs) await dl.subscriptions.add(s)
}
