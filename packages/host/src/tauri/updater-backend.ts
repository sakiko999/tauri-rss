/**
 * TauriUpdaterBackend — UpdaterBackend 的桌面实现(tauri-plugin-updater)。
 *
 * ⚠️ check() 返回的 Update 在 Rust 侧持资源,必须 close() 或 install 才释放。
 * 这里缓存最近一次结果;重复 check 前先关旧的,避免每次点「检查更新」漏一个句柄。
 *
 * ⚠️ Windows 上 downloadAndInstall 拉起 NSIS 安装器后会**直接退出应用**
 * (restartAfterInstall 默认 true),所以安装成功后前端不应假设还能继续操作;
 * relaunch() 主要为 macOS/Linux 兜底,Windows 走安装器自带的重启。
 */

import { getVersion } from "@tauri-apps/api/app"
import { invoke } from "@tauri-apps/api/core"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater"

export class TauriUpdaterBackend implements UpdaterBackend {
  /** 最近一次 check() 的结果(已下载的 update 与之绑定)。 */
  private pending: Update | null = null

  async version(): Promise<string> {
    return getVersion()
  }

  async check(): Promise<UpdateInfo | null> {
    // ⚠️ 先联网、成功后再关闭旧 Update:检查失败时旧结果仍然有效,不能提前释放。
    // 无超时的请求会永久挂住,必须显式设上限。
    const update = await check({ timeout: 20_000 })
    const old = this.pending
    this.pending = update
    if (old) await old.close().catch(() => {})
    if (!update) return null
    return {
      version: update.version,
      currentVersion: update.currentVersion,
      ...(update.body ? { body: update.body } : {}),
      ...(update.date ? { date: update.date } : {}),
    }
  }

  async downloadAndInstall(onEvent: (e: UpdateEvent) => void): Promise<void> {
    const update = this.pending
    if (!update) throw new Error("没有待安装的更新,请先检查更新")
    // 先摘掉引用:安装流程一旦开始,重复点击不应再进第二次。
    this.pending = null

    let total: number | undefined
    let downloaded = 0
    const onProgress = (p: DownloadEvent): void => {
      if (p.event === "Started") {
        total = p.data.contentLength
        onEvent({ event: "started", ...(total !== undefined ? { contentLength: total } : {}) })
      } else if (p.event === "Progress") {
        downloaded += p.data.chunkLength
        onEvent({ event: "progress", downloaded, ...(total !== undefined ? { contentLength: total } : {}) })
      } else {
        onEvent({ event: "finished" })
      }
    }
    try {
      // 分两步(而不是 downloadAndInstall):Windows 上 install 走 `std::process::exit(0)`
      // (插件文档原话),不触发我们的 ExitRequested 钩子 —— 必须在 install 之前
      // 显式停数据服务(含 amoeba-browser),否则安装器会撞上仍在退出的 sidecar,
      // 表现为更新进度卡住 / 「browser 还未完全退出」。
      await update.download(onProgress, { timeout: 10 * 60_000 })
      await invoke("service_shutdown").catch(() => {
        /* 服务已停/未启动都不阻塞安装 */
      })
      await update.install()
    } catch (e) {
      // 失败(下载中断/签名不符)时释放 Rust 侧资源,允许用户重新检查。
      // ⚠️ 若失败发生在 service_shutdown 之后,数据服务已停,需要重启应用恢复。
      await update.close().catch(() => {})
      throw e
    }
  }

  async relaunch(): Promise<void> {
    await relaunch()
  }
}
