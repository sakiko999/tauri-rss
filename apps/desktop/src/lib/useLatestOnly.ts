/**
 * useLatestOnly —— 请求世代守卫。
 *
 * 场景:一个面板反复发同类请求(切平台 / 改关键词 / 重开弹窗),先发的可能**后回**,
 * 把后发的正确结果覆盖掉。经典表现是「切到 B 平台,面板却显示 A 平台的数据」。
 *
 * 用法:
 * ```ts
 * const latest = useLatestOnly()
 * const run = async () => {
 *   const gen = latest.start()          // 作废在途请求;回来时拿它判是不是最新的
 *   try {
 *     const r = await fetchSomething()
 *     if (latest.stale(gen)) return     // 已被取代 → 丢弃结果
 *     setItems(r)
 *   } finally {
 *     if (!latest.stale(gen)) setBusy(false)   // 在途请求的 finally 不该清新的 busy
 *   }
 * }
 * ```
 *
 * ⚠️ `invalidate()` 与 `start()` 的区别:前者只作废、不认领新一代(用于依赖变化时清场),
 * 后者作废并返回新世代号。
 *
 * 为什么不是 `AbortController`:本仓库的取数走 `appHost.http` 隧道(宿主进程转发),
 * 没有可传递的 abort 信号 —— 只能"丢弃结果",不能"取消请求"。世代号是这个约束下的
 * 最短路径(2 处重复实现收敛于此,见 docs/smoke-check.md)。
 */
import { useMemo, useRef } from "react"

export interface LatestOnly {
  /** 作废一切在途请求(不认领新世代)。用于「依赖变了,顺手清干净」。 */
  invalidate: () => void
  /** 作废在途请求并认领一个新世代号,回来时用它判断是否仍是最新。 */
  start: () => number
  /** `gen` 是否已被更新的请求取代。 */
  stale: (gen: number) => boolean
}

/**
 * ⚠️ 返回值**引用稳定**(useMemo 包住):调用方普遍会把它写进 `useEffect` 依赖数组
 * (`[platform, view, latest]`),每次渲染都返回新对象会让那个 effect 每轮重跑。
 */
export function useLatestOnly(): LatestOnly {
  const ref = useRef(0)
  return useMemo(
    () => ({
      invalidate: () => {
        ++ref.current
      },
      start: () => ++ref.current,
      stale: (gen: number) => gen !== ref.current,
    }),
    [],
  )
}
