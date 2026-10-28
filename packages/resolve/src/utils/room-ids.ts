/**
 * room-ids —— 直播房间订阅参数解析(跨平台共用)。
 *
 * live channel 统一支持多房间订阅:`info.roomIds`(逗号分隔,可多个)。空则返回 []。
 * ⚠️ 2026-10-28 删除 `info.roomId`(单房间)兼容回退：CLI 示例参数已改 roomIds，
 * 旧订阅不再兜底（全新安装为前提，见 docs/audit/findings.md §五）。
 */

import type { SourceInfo } from "../index.ts"

/** 解析订阅信息里的房间列表:roomIds 逗号分隔,空则 []。 */
export function parseRoomIds(info: SourceInfo): string[] {
  return String(info.roomIds ?? "")
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
