/**
 * 更新检查与安装状态。
 *
 * ⚠️ 状态放在模块里,**不能**放 About 组件内:下载中切到别的设置 tab 会把
 * About 卸载,组件 state 丢失后重进会显示「可更新」，而后端 pending 已被消费
 * —— 点安装只会报错,实际那次安装在后台继续跑。模块状态还能让启动检查的结果
 * 在用户点 toast「查看」进设置页时直接可见。
 *
 * ⚠️ 启动检查必须**完全静默**:首个版本、离线、GitHub 404 都不该弹错误——
 * 用户没主动要求检查,打断使用比漏报更糟。
 */

import { useDesktop } from "../store/index.ts"

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; downloaded: number; total?: number }
  | { kind: "installed"; info: UpdateInfo }
  | { kind: "error"; message: string }

let startupStarted = false
/** 在途检查:启动静默检查与用户手动检查可能撞车,复用同一个请求。 */
let inflight: Promise<UpdateInfo | null> | null = null
let phase: UpdatePhase = { kind: "idle" }
const listeners = new Set<() => void>()

function setPhase(p: UpdatePhase): void {
  phase = p
  for (const l of listeners) l()
}

/** 供 useSyncExternalStore 读取。 */
export function getUpdatePhase(): UpdatePhase {
  return phase
}

/** 供 useSyncExternalStore 订阅。 */
export function subscribeUpdatePhase(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 查一次并更新缓存。宿主没注入 updater(浏览器/CLI/移动端)时返回 null。 */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  if (inflight) return inflight
  const updater = globalThis.appHost.updater
  if (!updater) return Promise.resolve(null)
  inflight = updater.check().finally(() => {
    inflight = null
  })
  return inflight
}

/** 设置页手动检查:驱动 phase(idle → checking → current/available/error)。 */
export async function manualCheck(): Promise<void> {
  if (!globalThis.appHost.updater) return
  setPhase({ kind: "checking" })
  try {
    const info = await checkForUpdate()
    setPhase(info ? { kind: "available", info } : { kind: "current" })
  } catch (e) {
    setPhase({ kind: "error", message: errText(e) })
  }
}

/** 下载并安装;进度写回模块状态,切 tab/重进页面都不丢。 */
export async function installUpdate(info: UpdateInfo): Promise<void> {
  const updater = globalThis.appHost.updater
  if (!updater) return
  setPhase({ kind: "downloading", info, downloaded: 0 })
  try {
    await updater.downloadAndInstall((e) => {
      if (e.event === "started") {
        setPhase({ kind: "downloading", info, downloaded: 0, total: e.contentLength })
      } else if (e.event === "progress") {
        if (phase.kind === "downloading") {
          setPhase({ ...phase, downloaded: e.downloaded, total: e.contentLength ?? phase.total })
        }
      }
      // finished 不单独落状态:下载完到安装完成之间仍显示进度条最后位置。
    })
    setPhase({ kind: "installed", info })
  } catch (e) {
    setPhase({ kind: "error", message: errText(e) })
  }
}

/** 安装完成后重启(macOS/Linux;Windows 通常由安装器接管)。 */
export function relaunchApp(): void {
  void globalThis.appHost.updater?.relaunch()
}

/** 启动后静默查一次;只弹一次「有新版本」,失败静默。 */
export function scheduleStartupCheck(onFound: (info: UpdateInfo) => void): void {
  if (startupStarted) return
  startupStarted = true
  // 等首屏与刷新队列先跑完,别和启动抓取抢带宽。
  setTimeout(() => {
    if (useDesktop.getState().offline) return
    void checkForUpdate()
      .then((info) => {
        if (!info) return
        // 用户可能已经在设置页手动检查过;别覆盖更具体的状态。
        if (phase.kind === "idle") setPhase({ kind: "available", info })
        onFound(info)
      })
      .catch(() => {
        // 静默:首个版本尚无 latest.json / 网络不可达都走这里。
      })
  }, 4000)
}
