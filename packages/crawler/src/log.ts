/**
 * crawler 日志域 —— 集中管理 + 统一 `log` 对象导出(对齐 player/src/log)。
 * 各 channel 从本模块 import,不各自 createLogDomain。
 * 均为自由 warn(一次性降级/调试警告);域名即 channel 前缀。
 * ⚠️ 不能像 player 那样 spread 平铺——crawler 各域都是同名 `warn`,平铺会互相覆盖
 * (前缀全变成最后一个域)。故按 channel 分组命名空间:`log.bili.warn(...)`。
 */
import { createLogDomain } from "@tauri-playground/log"

/** [bili] 视频档位降级警告。 */
const biliLog = createLogDomain("bili", { color: "#fb7299", ansi: 211 })
/** [bili:live] 直播档位降级警告。 */
const biliLiveLog = createLogDomain("bili:live", { color: "#f43f5e", ansi: 203 })
/** [youtube] 直链降级/兜底警告。 */
const youtubeLog = createLogDomain("youtube", { color: "#ef4444", ansi: 196 })
/** [douyin] enter/reflow/HTML 降级警告。 */
const douyinLog = createLogDomain("douyin", { color: "#22d3ee", ansi: 45 })
/** [douyu] 档位/CDN 降级警告。 */
const douyuLog = createLogDomain("douyu", { color: "#ff6a00", ansi: 208 })
/** [huya] 档位/弹幕降级警告。 */
const huyaLog = createLogDomain("huya", { color: "#ffa52a", ansi: 214 })

export const log = {
  bili: biliLog,
  biliLive: biliLiveLog,
  youtube: youtubeLog,
  douyin: douyinLog,
  douyu: douyuLog,
  huya: huyaLog,
}
