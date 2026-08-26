/**
 * room-ids —— 直播房间订阅参数解析(跨平台共用)。
 *
 * live channel 统一支持多房间订阅:`info.roomIds`(逗号分隔,可多个)优先,
 * 兼容旧订阅的 `info.roomId`(单房间)。空则返回 []。
 */
import type { SourceInfo } from "../index.ts"

/** 解析订阅信息里的房间列表:优先 roomIds(逗号分隔),兼容旧 roomId 单房间。 */
export function parseRoomIds(info: SourceInfo): string[] {
  const fromList = String(info.roomIds ?? "")
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromList.length) return fromList
  const single = String(info.roomId ?? "").trim()
  return single ? [single] : []
}
