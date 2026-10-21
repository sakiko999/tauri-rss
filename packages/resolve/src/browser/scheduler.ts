/**
 * browser/scheduler —— lane 化的调度原语(风控 §3.13.1)。
 *
 * 背景:`withBrowserLock` 把四件不同粒度的东西捆在一个全局锁里 —— 互斥、窗口模式、
 * 平台准入、登录豁免。lane 化后各归各位:
 *
 * | 关注点        | 原语              | 粒度                      |
 * |--------------|-------------------|---------------------------|
 * | 互斥(导航+fetch 原子) | `withLane`        | per-lane(同 lane 串行,跨 lane 并发) |
 * | 窗口模式      | `withRenderLease` | 全局引用计数(首个 interactive,最后释放 hidden) |
 * | 平台准入      | `browserGateFor`  | per-platform 自串行,且在 op lane 锁**外** |
 * | 进程级操作    | `withBrowserGlobal` | 全局(clearCookies/resetProfile,防与导航交错) |
 *
 * 为什么 gate 必须自己串行:governor 的 `browserGate` 是「读 last → sleep → 写 last」
 * 的非原子序列,过去安全只因它在全局锁里;拆锁后两条 lane 会同读同放行,最小间隔/抖动
 * 失效 —— 用 `gate:<platform>` lane 把整个 gate 调用串行化。gate 在 op lane 锁外执行,
 * 冷却/间隔等待不再队头阻塞其它平台已在排队的操作。
 *
 * 窗口模式为什么用引用计数:`setMode` 是窗口级(Rust 单槽 + 对整棵 Edge 进程树
 * ShowWindow),多 lane 下任一 hidden 操作收尾都把别人正在滚动的页面掐成 hidden
 * (滚动静默 0 条);且每次切换 Rust 都要 `restore_foreground` sleep 350ms,反复抖动很贵。
 * 代价:interactive 常驻期间所有 lane 共享真实渲染 —— 这是多 tab 的既定语义。
 *
 * abort:调度层不做信号量取消 —— 每个 lane tab 是独立 CDP 连接,`tab.abortPending`
 * (单 lane)与 `browser.abortTabs(reason, {keepLogin})`(除登录外全断)在连接层完成,
 * 粒度天然正确;登录 lane 被 keepLogin 豁免后,`scanLoginActive` 布尔与 45s 超时的
 * 平台前缀猜测一并退役。
 */

// ── withLane:同 lane 串行、跨 lane 并发(每 lane 一条 promise 链) ──────────────
const laneTails = new Map<string, Promise<void>>()

/**
 * 在 `lane` 上串行执行 fn:同一 lane 的操作严格按提交顺序执行(导航+fetch 原子),
 * 不同 lane 并发。前驱失败不传染(链只做排序,不传播 rejection);fn 自身异常原样抛出。
 *
 * lane 命名约定(保留前缀,调用方勿复用):
 *   - `op:<lane>`   业务操作(withBrowserOp 内部使用)
 *   - `gate:<platform>` 平台准入串行
 *   - `browser:global`  浏览器进程级操作
 */
export function withLane<T>(lane: string, fn: () => Promise<T>): Promise<T> {
  const prev = laneTails.get(lane) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((r) => (release = r))
  laneTails.set(lane, tail)
  // 尾巴 settle 后自清(防 map 无界增长);若已有新操作接力则保留其尾巴。
  void tail.then(() => {
    if (laneTails.get(lane) === tail) laneTails.delete(lane)
  })
  return prev.then(fn).finally(release)
}

// ── withRenderLease:interactive 的全局引用计数 ────────────────────────────────
let renderLeases = 0
/** 首个租约的 hidden→interactive 切换(后续租约必须等它落地才能开始)。 */
let renderReady: Promise<void> | null = null

/**
 * 持一个「真实渲染」租约执行 fn:租约数 0→1 时切 interactive,1→0 时切回 hidden。
 *
 * 两层保护(审查修正,2026-10-22):
 *   1. **租约计数在串行锁外**:重叠的租约不会把窗口反复 interactive/hidden 抖动
 *      (每次 Rust 切换 ~350ms);只有 0→1 / 1→0 才切。
 *   2. **fn 在 `browser:render` lane 上全局串行**:单窗口多 tab 下激活是排他的,
 *      两个滚动 op 并发各自 activate 会互抢(后 activate 的赢,前者的 scroll
 *      静默无效);且第二个租约若在首个 setMode 尚未落地时就跑 fn,窗口还是
 *      hidden —— 滚动静默 0 条。所以 >1 的租约先 await 同一条 ready promise。
 * 首个租约切不过去会抛错(滚动会静默 0 条,必须失败而不是装成功);释放路径尽力而为。
 */
export function withRenderLease<T>(browser: BrowserBackend, fn: () => Promise<T>): Promise<T> {
  renderLeases++
  return (async () => {
    try {
      if (renderLeases === 1) {
        // 包成 async IIFE:setMode 同步抛错也变成 rejected promise(计数在下方
        // finally 归还,不会泄漏)。
        renderReady = (async () => {
          await browser.setMode?.("interactive")
        })()
      }
      if (renderReady) await renderReady
      // 串行执行:滚动/懒加载同一时刻只允许一个(激活互斥 + 渲染开销)。
      return await withLane("browser:render", fn)
    } finally {
      renderLeases--
      if (renderLeases === 0) {
        try {
          await browser.setMode?.("hidden")
        } catch {
          // 释放路径静默:切不回 hidden 只是多渲染开销,不能掩盖业务结果。
        }
        renderReady = null
      }
    }
  })()
}

// ── browserGateFor:平台准入(governor.browserGate)按平台串行 ──────────────────

/**
 * 平台准入闸门(governor 的冷却 + 最小间隔 + 抖动)。`platform` 不传 = 跳过
 * (登录流程刻意不传:冷却期正是用户需要重新扫码自救的时候)。
 * ⚠️ 必须在 op lane 锁**外** await:gate 的间隔等待可能长达数秒,占用 op lane 会
 * 队头阻塞该 lane 已排队的其它操作。
 */
export async function browserGateFor(platform: string | undefined): Promise<void> {
  if (!platform) return
  await withLane(`gate:${platform}`, () => Promise.resolve(globalThis.appHost?.net?.browserGate?.(platform)))
}

// ── 浏览器进程级互斥(读写锁):op 共享,global 独占 ──────────────────────────
// ⚠️ 不能只给 global 一条 lane 键:不同 lane 键是**独立** promise 链,
// `browser:global` 与 `op:*` 完全并发 —— 注释承诺的「与所有 lane 互斥」不成立
// (审查发现:clearCookies 仍可与导航交错、resetProfile 仍可杀掉在抓的 Edge)。
// 语义:op 是共享读者(彼此并发),global 是独占写者(等在途 op 全部退出,且阻塞新 op)。
let activeOps = 0
let globalBusy = false
/** 写者等待数(写者优先:global 在排队时新 op 不得插队,否则独占可能被饿死)。 */
let writerWaiting = 0
let drainWaiters: Array<() => void> = []
let globalWaiters: Array<() => void> = []

async function acquireShared(): Promise<void> {
  while (globalBusy || writerWaiting > 0) await new Promise<void>((r) => globalWaiters.push(r))
  activeOps++
}

function releaseShared(): void {
  activeOps--
  if (activeOps === 0) {
    const ws = drainWaiters
    drainWaiters = []
    for (const r of ws) r()
  }
}

async function acquireExclusive(): Promise<void> {
  writerWaiting++
  try {
    while (globalBusy || activeOps > 0) {
      await new Promise<void>((r) => (activeOps > 0 ? drainWaiters : globalWaiters).push(r))
    }
    globalBusy = true
  } finally {
    writerWaiting--
  }
}

function releaseExclusive(): void {
  globalBusy = false
  const ws = globalWaiters
  globalWaiters = []
  for (const r of ws) r()
}

/**
 * 浏览器进程级操作(clearCookies / resetProfile)的**独占**锁:等待所有在途 op
 * (所有 lane)退出,并阻塞其后新发起的 op —— 前者与导航交错会产生半删状态,
 * 后者直接杀掉正在抓取的 Edge。lane 化前这些调用完全绕过浏览器锁(裸 invoke)。
 */
export async function withBrowserGlobal<T>(fn: () => Promise<T>): Promise<T> {
  await acquireExclusive()
  try {
    return await fn()
  } finally {
    releaseExclusive()
  }
}

/**
 * op 的共享通道(withBrowserOp 内部使用):等待任何在途 global 操作结束,
 * 期间与其它 op 并发;释放时若有 global 在等,最后一个 op 退出会唤醒它。
 */
export async function withBrowserOpSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireShared()
  try {
    return await fn()
  } finally {
    releaseShared()
  }
}
