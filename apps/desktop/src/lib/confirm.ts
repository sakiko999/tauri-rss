/**
 * 异步确认框（替代 `window.confirm`）。
 *
 * 原生 confirm 是 WebView 系统弹窗：样式不可控、同步阻塞主线程，且和播放器/全屏
 * 叠在一起时观感断裂。这里改成「请求 Promise + 一个常驻 Host 渲染 Radix AlertDialog」，
 * 调用方 `if (!(await confirmAction(...))) return` 即可。
 *
 * 并发：同一时刻只展示一个，后来的排队（不丢请求、不覆盖前一个的 resolve）。
 * 关闭/取消一律解析为 false —— 调用方不需要 try/catch。
 */

export interface ConfirmOptions {
  title: string
  /** 次要说明：写「会怎样」，不重复标题。 */
  desc?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 危险操作（删除/重置）——按钮用 danger 样式。 */
  danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (accepted: boolean) => void
}

let current: ConfirmRequest | null = null
const queue: ConfirmRequest[] = []
let seq = 0
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const fn of listeners) fn()
}

export function subscribeConfirm(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getConfirmRequest(): ConfirmRequest | null {
  return current
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req: ConfirmRequest = { ...opts, id: ++seq, resolve }
    if (current) queue.push(req)
    else {
      current = req
      emit()
    }
  })
}

/** 结束当前请求（true = 确认）；队列里有下一个就顶上。 */
export function settleConfirm(accepted: boolean): void {
  const req = current
  if (!req) return
  req.resolve(accepted)
  current = queue.shift() ?? null
  emit()
}

/**
 * 只结束指定 id 的请求。Radix 的 `Dialog.Close` 会在按钮 onClick 之后再上报一次
 * `onOpenChange(false)`（Action/Cancel 都是 Close 子类）—— 用 id 守卫后，第二次
 * 调用落到「已经顶上来」的下一条上会被忽略，不会把排队中的请求误判成取消。
 */
export function settleConfirmFor(id: number, accepted: boolean): void {
  if (current?.id !== id) return
  settleConfirm(accepted)
}
