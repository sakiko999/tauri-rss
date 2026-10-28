/**
 * CLI 的浏览器载具：spawn `amoeba-browser.exe`（独立 WebView2 进程）+ CDP。
 *
 * 与桌面共用 `browser/backend.ts` 的全部语义（lane/超时/资源拦截/cookie），
 * 这里只提供 BrowserDriver：
 *   - 拉起 sidecar、读 stdout 的 `READY <port>`、崩溃后重启；
 *   - target 参数（WebView2 每个 target = 独立顶层窗口，必须屏外 + background）；
 *   - tidy / mode 控制（sidecar 的 stdin 行命令）；
 *   - close（关 stdin 等退出，超时 taskkill /T）与清 profile。
 *
 * ⚠️ sidecar 只支持 Windows（WebView2）。非 Windows 返回 undefined，CLI 保持无 browser。
 * ⚠️ profile 与桌面严格分开（`%LOCALAPPDATA%/app.amoeba.cli/browser-profile`），
 *    同一个 profile 只能有一个 environment，否则 CDP 端口会互相覆盖。
 */

import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { type BrowserDriver, CdpBrowserBackend, type CdpTargetInfo } from "../browser/backend.ts"
import { nodeCdpConnector } from "./cdp-connector.ts"

/** sidecar 从拉起至 READY 的上限。冷启动实测 1–3s，给足余量。 */
const READY_TIMEOUT_MS = 20_000
/** 优雅关闭（stdin close → 等浏览器退出并 flush cookie）的上限。 */
const CLOSE_TIMEOUT_MS = 5_000

const SIDECAR_NAME = "amoeba-browser.exe"

export interface SidecarBrowserOptions {
  /** sidecar 可执行文件路径（`locateSidecarBinary` 的结果）。 */
  binary: string
  /** WebView2 user data dir。默认 `%LOCALAPPDATA%/app.amoeba.cli/browser-profile`。 */
  profileDir?: string
  /** 关闭图片加载（默认开：xhs 扫码二维码是图片）。 */
  images?: boolean
}

/** 与 sidecar 默认值一致；CLI 显式传参时以调用方为准。 */
export function defaultSidecarProfileDir(): string {
  const base =
    process.env.LOCALAPPDATA ?? join(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(), ".local", "share")
  return join(base, "app.amoeba.cli", "browser-profile")
}

/**
 * 找 sidecar 二进制。顺序：
 *   1. 显式参数 / `AMOEBA_BROWSER_SIDECAR`
 *   2. 当前可执行文件同目录（发布形态：`rss.exe` + `amoeba-browser.exe`）
 *   3. 从源码目录向上找仓库根（开发形态：`target/{release,debug}`）
 */
export function locateSidecarBinary(explicit?: string): string | undefined {
  if (process.platform !== "win32") return undefined
  const candidates: string[] = []
  const fromEnv = explicit ?? process.env.AMOEBA_BROWSER_SIDECAR
  if (fromEnv) candidates.push(resolve(fromEnv))
  candidates.push(join(dirname(process.execPath), SIDECAR_NAME))

  let dir = import.meta.dir
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, "target", "release", SIDECAR_NAME))
    candidates.push(join(dir, "target", "debug", SIDECAR_NAME))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return candidates.find((p) => existsSync(p))
}

/** Edge/Chromium 自带界面：默认页绝不挂上去。 */
const BROWSER_UI_URL = /^(edge|chrome|chrome-untrusted|devtools|chrome-extension):/i

interface RunningSidecar {
  child: ChildProcessWithoutNullStreams
  port: number
  stderrTail: string[]
}

class SidecarDriver implements BrowserDriver {
  private running: RunningSidecar | null = null
  private starting: Promise<number> | null = null
  private readonly profileDir: string

  constructor(private readonly opts: SidecarBrowserOptions) {
    this.profileDir = opts.profileDir ?? defaultSidecarProfileDir()
  }

  async ensureReady(): Promise<number> {
    if (this.running && this.running.child.exitCode === null) return this.running.port
    if (this.starting) return this.starting
    this.starting = this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<number> {
    const args = ["--user-data-dir", this.profileDir, "--parent-pid", String(process.pid)]
    if (this.opts.images === false) args.push("--no-images")

    // ⚠️ 清掉可能来自 release 调试的全局 WebView2 参数（CLAUDE.md 的 9222 做法），
    // 否则浏览器会用另一个调试端口，sidecar 的 READY 端口连不上自己的实例。
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    delete env.WEBVIEW2_USER_DATA_FOLDER

    const child = spawn(this.opts.binary, args, {
      stdio: "pipe",
      windowsHide: true,
      env,
    })
    const stderrTail: string[] = []
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderrTail.push(chunk)
      while (stderrTail.length > 40) stderrTail.shift()
    })
    // stdout 只用于 READY；READY 之后继续 drain，防管道写满。
    child.stdout.setEncoding("utf8")
    const port = await readReady(child, stderrTail)
    child.stdout.resume()

    const handle: RunningSidecar = { child, port, stderrTail }
    this.running = handle
    child.once("exit", () => {
      if (this.running === handle) this.running = null
    })
    return port
  }

  isUsableTarget(t: CdpTargetInfo): boolean {
    const url = t.url ?? ""
    return !BROWSER_UI_URL.test(url)
  }

  targetParams(): Record<string, unknown> {
    // WebView2 没有 tab：每个 target 都是独立顶层窗口，必须屏外创建 + background，
    // 创建后由 afterTargetChange 的 tidy 去任务栏。
    return {
      url: "about:blank",
      newWindow: true,
      left: -32000,
      top: -32000,
      width: 1280,
      height: 800,
      background: true,
    }
  }

  async afterTargetChange(): Promise<void> {
    this.write("tidy\n")
  }

  async setMode(mode: BrowserWindowMode): Promise<void> {
    this.write(`mode ${mode}\n`)
  }

  async close(): Promise<void> {
    const handle = this.running
    this.running = null
    if (!handle) return
    try {
      handle.child.stdin.write("close\n")
      handle.child.stdin.end()
    } catch {
      /* 已退出 */
    }
    const exited = await waitExit(handle.child, CLOSE_TIMEOUT_MS)
    if (!exited) killTree(handle.child.pid)
  }

  async resetProfile(): Promise<string> {
    await this.close()
    // WebView2 释放文件句柄有延迟，重试几次；profile 在仓库外，删失败时如实抛出。
    let last: unknown
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(this.profileDir, { recursive: true, force: true })
        return this.profileDir
      } catch (e) {
        last = e
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  }

  private write(text: string): void {
    const child = this.running?.child
    if (!child || child.exitCode !== null) return
    try {
      child.stdin.write(text)
    } catch {
      /* 管道已关：下一次 ensureReady 会重启 */
    }
  }
}

/** 读 stdout 的第一行 `READY <port>`；失败时带上 stderr 尾部。 */
function readReady(child: ChildProcessWithoutNullStreams, stderrTail: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const stderr = () => stderrTail.join("").trim().slice(-2000)

    const onData = (chunk: string) => {
      buffer += chunk
      const m = buffer.match(/(?:^|\n)READY (\d+)\s*(?:\n|$)/)
      if (!m) return
      cleanup()
      resolve(Number(m[1]))
    }
    const onExit = (code: number | null) => {
      cleanup()
      reject(new Error(`sidecar 启动即退出 (code ${code})${stderr() ? `:\n${stderr()}` : "（无 stderr）"}`))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(`sidecar ${READY_TIMEOUT_MS / 1000}s 内未 READY${stderr() ? `:\n${stderr()}` : "（无 stderr）"}`),
      )
    }, READY_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout.off("data", onData)
      child.off("exit", onExit)
    }
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", onData)
    child.once("exit", onExit)
  })
}

function waitExit(child: ChildProcessWithoutNullStreams, ms: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, ms)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
  })
}

/** 强杀整棵进程树（WebView2 子进程不会跟随 sidecar 单独退出）。 */
function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    })
  } catch {
    /* 进程已退出 */
  }
}

export function createSidecarBrowser(opts: SidecarBrowserOptions): BrowserBackend {
  return new CdpBrowserBackend({
    driver: new SidecarDriver(opts),
    connector: nodeCdpConnector(),
  })
}
