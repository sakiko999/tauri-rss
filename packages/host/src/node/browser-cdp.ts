/**
 * Electron 宿主的浏览器载具：连宿主进程内 CDP 代理（electron-tabs-demo 的
 * packages/rss-service/src/cdp-proxy.ts），与 sidecar 载具共用 CdpBrowserBackend
 * 的全部语义（lane/超时/资源拦截/cookie），差异只收敛在本 driver：
 *
 *   - ensureReady：直接返回宿主给的端口。浏览器生命周期（隐藏 BrowserWindow
 *     的创建/回收）归 Electron 主进程，本进程不拉起任何东西；
 *   - target：代理把 `Target.createTarget` 映射为「新建隐藏 BrowserWindow」；
 *   - close：让代理关掉全部托管窗口（host 空闲回收照常释放渲染进程内存），
 *     绝不退出 Electron；
 *   - resetProfile：让代理清 rss-crawler 分区存储；
 *   - setMode：空实现。Electron 隐藏窗口以 backgroundThrottling:false 全速渲染，
 *     不存在 WebView2「SW_HIDE 停渲染」模式；interactive 需要的 rAF/IO 语义天然满足。
 *
 * ⚠️ 指纹：代理把 UA 洗成 Chromium（去掉 Electron 标识），但 canvas/WebGL 等指纹
 *    仍与 WebView2 不同 —— 强反爬平台（小红书/抖音）需真机验证登录与抓取后才可依赖。
 */

import { type BrowserDriver, CdpBrowserBackend, type CdpTargetInfo } from "../browser/backend.ts"
import { nodeCdpConnector } from "./cdp-connector.ts"

const IDLE_CLOSE_MS = 3 * 60_000
const TAB_IDLE_CLOSE_MS = 5 * 60_000

export interface CdpPortBrowserOptions {
  /** 宿主 CDP 代理端口（127.0.0.1）。 */
  port: number
  /** 整树空闲回收毫秒（0 = 不回收）。默认 3 分钟，与 sidecar 载具同档。 */
  idleCloseMs?: number
  /** 单 lane tab 空闲回收毫秒（0 = 不回收）。默认 5 分钟。 */
  tabIdleCloseMs?: number
}

class ElectronCdpDriver implements BrowserDriver {
  readonly idleCloseMs: number
  readonly tabIdleCloseMs: number

  constructor(private readonly port: number, opts: CdpPortBrowserOptions) {
    this.idleCloseMs = opts.idleCloseMs ?? IDLE_CLOSE_MS
    this.tabIdleCloseMs = opts.tabIdleCloseMs ?? TAB_IDLE_CLOSE_MS
  }

  async ensureReady(): Promise<number> {
    return this.port
  }

  /** 代理的 /json/list 只包含宿主托管的抓取窗口，没有内置 UI 页需要过滤。 */
  isUsableTarget(t: CdpTargetInfo): boolean {
    return t.type === "page"
  }

  /** 代理忽略窗口参数（隐藏窗口由 Electron 侧创建）；保留契约形状。 */
  targetParams(): Record<string, unknown> {
    return { url: "about:blank", background: true }
  }

  async afterTargetChange(): Promise<void> {
    // 隐藏窗口无任务栏/焦点问题，无需整理
  }

  async setMode(): Promise<void> {
    // Electron 隐藏窗口保持全速渲染，没有可切换的窗口模式
  }

  /** 关掉宿主托管的全部抓取窗口（空闲回收用）；不退出 Electron。 */
  async close(): Promise<void> {
    await globalThis.appHost.http
      .request({
        url: `http://127.0.0.1:${this.port}/amoeba/close-targets`,
        method: "POST",
        responseType: "text",
        timeoutMs: 5_000,
      })
      .catch(() => undefined)
  }

  async resetProfile(): Promise<string> {
    const res = await globalThis.appHost.http.request({
      url: `http://127.0.0.1:${this.port}/amoeba/reset-profile`,
      method: "POST",
      responseType: "text",
      timeoutMs: 10_000,
    })
    const body = JSON.parse(String(res.body)) as { profile?: string }
    return body.profile ?? "electron:rss-crawler"
  }
}

export function createCdpPortBrowser(opts: CdpPortBrowserOptions): BrowserBackend {
  return new CdpBrowserBackend({
    driver: new ElectronCdpDriver(opts.port, opts),
    connector: nodeCdpConnector(),
  })
}
