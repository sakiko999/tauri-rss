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
    case "bili:dynamic": return { uid: "2267573" } // DIYgod(视频为主,需登录 cookie)
    case "bili:live": return { roomId: "998" } // 一个公开直播房间
    case "youtube": return { channelId: "UCYO_jab_esuFRV4b17AJtAw" } // 3Blue1Brown
    case "youtube:live": return { videoId: "tRsQsTMvPNg" } // Claude FM 常驻直播(desktop 测试源)
    case "live:huya": return { roomId: "116" } // 虎牙房间
    case "live:douyu": return { roomId: "9999" } // 斗鱼房间(yyfyyf,验证过 betard 可用)
    case "live:douyin": return { roomId: "1" } // 抖音房间
    case "weibo:user": return { uid: "1195230310" } // 微博·何炅(desktop 测试源)
    case "xhs:user": return { user_id: "593032945e87e77791e03696" } // 小红书·小宇菇菇(desktop 测试源)
    case "rss:podcast": return { url: "https://feeds.megaphone.fm/hubermanlab" } // Huberman Lab(desktop 测试源)
    default: return {}
  }
}

/** 注入 Node 宿主后端(共享入口,各 example 开头调用)。 */
export function setupBackends(): void {
  injectNodeHost()
}
