/**
 * 续播位置落库决策 —— 播放器进度回调(4Hz)到「是否写库写什么」的纯函数。
 *
 * 两条规则合在一处(desktop / mobile 两个 app 层共用,别各写一份魔数):
 *   1. **近片尾清除**:最后 15s 或 >98% 时不写位置,而要清除历史位置 —— 否则「看完」
 *      的条目下次进来自动跳到结尾。
 *   2. **节流**:与上次位置相差不足 5s 不写 —— 4Hz 回调直接落库会把 SQLite 打爆
 *      (写放大也会让持久层串行队列积压)。
 *
 * 抽成纯函数是因为这两条都是容易写反、且写完看不出错的判据(阈值是「或」不是「且」,
 * 比较方向也易反),放一处 + 一条自检胜过在两处各写一遍。
 */

/** 近片尾阈值:剩余不足此秒数即视为看完。 */
const END_GAP_SEC = 15
/** 近片尾阈值:进度超过此比例即视为看完。 */
const END_RATIO = 0.98
/** 节流:与上次位置相差不足此秒数不落库。 */
const MIN_DELTA_SEC = 5

export type PositionDecision =
  | { kind: "clear" } // 近片尾 → 清除记录
  | { kind: "wait" } // 变化太小 → 本次不写
  | { kind: "save"; next: number } // 写入位置 next

/**
 * @param prev        上次已记录的秒数(0 = 无记录)
 * @param sec         本次回调位置(秒)
 * @param durationSec 总时长(秒;直播为 0 → 交给调用方跳过,不走此函数)
 */
export function positionDecision(prev: number, sec: number, durationSec: number): PositionDecision {
  if (durationSec > 0 && (durationSec - sec < END_GAP_SEC || sec / durationSec > END_RATIO)) return { kind: "clear" }
  if (Math.abs(sec - prev) < MIN_DELTA_SEC) return { kind: "wait" }
  return { kind: "save", next: sec }
}
