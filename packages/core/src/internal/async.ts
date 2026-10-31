/**
 * 编排用的小工具(从 data-layer.ts 拆出,2026-11-01)。
 */

/**
 * 抓取与取消竞速：signal 触发即抛（在途请求的响应被丢弃，不占后续流程）。
 *
 * ⚠️ 不做 socket 级 abort：`appHost.http` 契约里没有 signal，且 governor 的
 * 去重可能把同一请求共享给别的订阅——这里只停「本次刷新的编排」，网络层
 * 自行跑完（结果无人消费）。
 */
export function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  if (signal.aborted) return Promise.reject(new Error("刷新已取消"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("刷新已取消"))
    signal.addEventListener("abort", onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener("abort", onAbort)
        reject(e)
      },
    )
  })
}

/** 按 key 串行化(同 key 的 refresh/loadMore 共用一条链;不同 key 仍可并发)。 */
export function createSerialized(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>()
  return function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }
}
