/**
 * 共享运行时 —— 三个 example 公用的宿主注入 + 示例参数。
 *
 * 宿主实现(node fetch / new Function / 内存 storage)来自 @tauri-playground/host,
 * 这里只保留 crawler 特有的 exampleInfo(各 channel 示例参数)。
 */
import { injectNodeHost } from "@tauri-playground/host"

/** 各 channel 的示例 info(需要参数的 channel 给真实示例值)。 */
export function exampleInfo(key: string): Record<string, string> {
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

/** 注入 Node 宿主后端(共享入口,各 example 开头调用)。 */
export function setupBackends(): void {
  injectNodeHost()
}
