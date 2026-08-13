/**
 * deferred —— 「异步 setup → build 弹幕流」统一封装。
 *
 * 弹幕探测普遍异步(setup:ensureCookie/enter 拿长号/getDanmuInfo/页面解析),
 * 建连(createWsStream)前必须检查是否已退订——否则 setup 完成时玩家已关闭
 * 直播间,仍会建 WS → 连接泄漏。本 helper 把这层「stopped 守卫 + 退订即断开」
 * 样板收敛(douyin 双层 / bili live / huya / bili VOD 共用)。
 */
import type { DanmakuItem } from "./types.ts"
import type { DanmakuStream } from "../index.ts"

/**
 * 异步 setup + build 组合成 DanmakuStream。
 * [setup] 异步探测(返回 build 所需的参数);[build] setup 成功后建流,返回退订函数
 * (或 void);[onError] setup/build 失败回调(不传则静默吞掉)。
 * 退订在 setup 未完成时置 stopped,完成后不再建流——连接零泄漏。
 */
export function deferredStream<T>(
  setup: () => Promise<T>,
  build: (value: T, onItems: (items: DanmakuItem[]) => void) => (() => void) | void,
  onError?: (error: unknown) => void,
): DanmakuStream {
  return (onItems) => {
    let stopped = false
    let unsub: (() => void) | undefined
    void setup()
      .then((value) => {
        if (stopped) return
        const u = build(value, onItems)
        if (u) unsub = u
      })
      .catch((e) => {
        if (!stopped) onError?.(e)
      })
    return () => {
      stopped = true
      unsub?.()
    }
  }
}
