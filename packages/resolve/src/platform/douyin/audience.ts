/**
 * douyin 观众数解析 —— 区分「并发」与「累计」。
 *
 * ⚠️ 实测 2026-10:匿名热门/分区接口里 `room.user_count` **就是并发数**,
 * 且与 `room_view_stats.display_value` **实测相等**(8 房间全等:85=85、2150=2150)。
 * 即此前用 display_value 显示的其实是并发,**不是** capability-gaps 里记的「累计值」。
 * 累计观众在 `room.stats.total_user_str`(如 "7万+")。
 *
 * 但 display_value 的语义(display_* 是一族展示字段)未来可能被平台改成累计口径,
 * 故仍**显式优先取并发真字段** `user_count`,display_value 只作兜底 —— 与参照
 * pure_live `douyin_audience.dart` 的候选顺序同思路(它更进一步,把 display_value/
 * total_user 完全排除在「在线人数」之外)。
 *
 * 返回 undefined = 无任何可用字段(UI 显示「—」);0 是合法值(无人观看),照常返回。
 */
export function douyinOnline(room: Record<string, any> | undefined | null): number | undefined {
  if (!room) return undefined
  const vs = room.room_view_stats as Record<string, any> | undefined
  const candidates = [
    room.user_count, // 并发(实测与 display_value 相等,但语义更明确)
    room.online_user_count,
    room.online_user_for_anchor,
    vs?.user_count,
    vs?.online_user_count,
    vs?.online_user_for_anchor,
    vs?.display_value, // 兜底:实测同值;语义是「展示值」,口径可能变
  ]
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue
    const n = Number(c)
    if (Number.isFinite(n)) return n
  }
  return undefined
}
