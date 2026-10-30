/**
 * browser-reset — 清掉抓取浏览器 profile。
 *
 * 实例身份（identifier）决定 profile 目录，必须分开清：
 *   - `cli`（默认）：`amoeba-browser.exe` 的 `%LOCALAPPDATA%/app.amoeba.cli/browser-profile`
 *   - `desktop`：安装版的 `.../app.amoeba.desktop/webview-profile`（含休眠的 CDP 9334）
 *   - `dev`：**与 desktop 同一个目录**（临时共用抓取浏览器 profile，见 `DEV_PROFILE`）
 *   - `all`：三者都清
 *
 * ⚠️ CLI 的浏览器是显式 opt-in（`--browser`）；清 CLI profile 会掉 CLI 侧登录态。
 * ⚠️ 停 sidecar 按**命令行里的 profile 路径**过滤，不按镜像名 —— dev 与安装版可以
 *    并跑，`taskkill /IM amoeba-browser.exe` 分不清谁是谁，会把另一个实例正在用的
 *    抓取浏览器一起杀掉。desktop 额外杀 9334 监听者（休眠的进程内抓取浏览器）。
 *
 * 用法:`bun run rss browser-reset [--target cli|desktop|dev|all]`
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

import { defaultSidecarProfileDir } from "@amoeba/host/node"
import pc from "picocolors"

import { fail, ok, row } from "../ui/render.ts"

/** 与 apps/src-tauri/src/webview_browser.rs 的 `PORT` 对齐。 */
const DESKTOP_CDP_PORT = 9334
/** 与 tauri.conf.json / tauri.conf.dev.json 的 identifier + Rust
 *  `app_local_data_dir()/webview-profile` 对齐。
 *  ⚠️ `app_local_data_dir` 在 Windows 是 LOCALAPPDATA(不是 Roaming)。
 *  ⚠️ **改 identifier 必须同步这里** —— 不同步会去删一个不存在的目录(静默 no-op),
 *  用户以为清了 profile、其实脏数据还在。(2026-10-16 `com.zhh.tauri-app` → `app.amoeba.desktop`) */
const desktopProfileDir = (identifier: string) => join(process.env.LOCALAPPDATA ?? "", identifier, "webview-profile")
const DESKTOP_PROFILE = desktopProfileDir("app.amoeba.desktop")
/** ⚠️ 临时共用（2026-10-30，与 `service.rs:resolve_paths` 同一决定）：dev 调试实例的抓取
 *  浏览器 profile 指向**安装版**目录（登录态才换得到 dev 里）。所以 `--target dev` 与
 *  `--target desktop` 清的是同一个目录 —— 清 dev 会连带清掉安装版的登录态。 */
const DEV_PROFILE = DESKTOP_PROFILE
/** 与 sidecar 默认值同一实现（手抄路径会在规则变化时去删一个不存在的目录，静默 no-op）。 */
const CLI_PROFILE = defaultSidecarProfileDir()

/** 目录占用体积(MB);不存在返回 null。 */
function dirSizeMB(dir: string): number | null {
  if (!existsSync(dir)) return null
  let bytes = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      try {
        if (e.isDirectory()) walk(p)
        else bytes += statSync(p).size
      } catch {
        /* 权限/竞态:跳过 */
      }
    }
  }
  try {
    walk(dir)
    return bytes / 1024 / 1024
  } catch {
    return null
  }
}

/** 杀掉占用 `port` 的进程及其整棵子进程树(Windows `netstat -ano` + `taskkill /T`)。 */
function killOnPort(port: number): number {
  let out = ""
  try {
    out = Bun.spawnSync(["netstat", "-ano", "-p", "TCP"]).stdout.toString()
  } catch {
    return 0
  }
  const pids = new Set<string>()
  for (const line of out.split("\n")) {
    if (!line.includes("LISTENING") || !line.includes(`:${port} `)) continue
    const m = line.trim().match(/(\d+)\s*$/)
    if (m) pids.add(m[1]!)
  }
  for (const pid of pids) {
    try {
      Bun.spawnSync(["taskkill", "/F", "/T", "/PID", pid])
    } catch {
      /* 进程已退出 */
    }
  }
  return pids.size
}

/** 停掉 `--user-data-dir` 指向 `profileDir` 的 amoeba-browser sidecar（含整棵子树）。
 *
 * 按**命令行里的 profile 路径**过滤而不是按镜像名：dev 与安装版并跑时各有一个
 * sidecar，`taskkill /IM amoeba-browser.exe` 会把另一个实例正在用的抓取浏览器
 * 一起杀掉。host 侧 spawn 固定带 `--user-data-dir <profileDir>`（见
 * packages/host/src/node/browser-sidecar.ts），命令行就是归属判据。 */
function killSidecarsOnProfile(profileDir: string): number {
  let out = ""
  try {
    out = Bun.spawnSync([
      "powershell",
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='amoeba-browser.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${profileDir.replaceAll("'", "''")}*' } | ` +
        `ForEach-Object { $_.ProcessId }`,
    ]).stdout.toString()
  } catch {
    return 0
  }
  const pids = out.split(/\s+/).filter((v) => /^\d+$/.test(v))
  for (const pid of pids) {
    try {
      Bun.spawnSync(["taskkill", "/F", "/T", "/PID", pid])
    } catch {
      /* 进程已退出 */
    }
  }
  return pids.length
}

/** 删目录,句柄释放有延迟,重试几次。返回 null 表示成功，否则错误文本。 */
async function removeProfile(dir: string): Promise<string | null> {
  let last: unknown = null
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return null
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return last instanceof Error ? last.message : String(last)
}

async function resetOne(label: string, dir: string, stop: () => number): Promise<boolean> {
  const before = dirSizeMB(dir)
  if (before === null) {
    console.log(row(label, pc.dim(`${dir} 不存在，无需清理`)))
    return true
  }
  const killed = stop()
  if (killed) console.log(row(`${label} 进程`, `已停止`))
  const err = await removeProfile(dir)
  if (err) {
    console.log(row(label, `${fail(err)}（${dir}）`))
    console.log(pc.dim("可能有环境仍占用该目录；关闭相关实例后重试。"))
    return false
  }
  console.log(row(label, ok(`已清理 ${before.toFixed(1)} MB`)))
  return true
}

export interface BrowserResetOptions {
  target?: "cli" | "desktop" | "dev" | "all"
}

export async function runBrowserReset(opts: BrowserResetOptions = {}): Promise<void> {
  const target = opts.target ?? "cli"
  console.log(pc.bold(`清理抓取浏览器 profile（${target}）`))

  let okAll = true
  if (target === "cli" || target === "all") {
    console.log(pc.dim(`  ${CLI_PROFILE}`))
    okAll = (await resetOne("CLI", CLI_PROFILE, () => killSidecarsOnProfile(CLI_PROFILE))) && okAll
  }
  if (target === "desktop" || target === "all") {
    console.log(pc.dim(`  ${DESKTOP_PROFILE}`))
    // 安装版可能正在运行：先杀休眠进程内浏览器可能占着的 9334，再停本 profile 的 sidecar。
    okAll =
      (await resetOne("桌面(安装版)", DESKTOP_PROFILE, () => {
        const byPort = killOnPort(DESKTOP_CDP_PORT)
        return byPort + killSidecarsOnProfile(DESKTOP_PROFILE)
      })) && okAll
  }
  if (target === "dev" || target === "all") {
    console.log(pc.dim(`  ${DEV_PROFILE}`))
    okAll = (await resetOne("桌面(dev)", DEV_PROFILE, () => killSidecarsOnProfile(DEV_PROFILE))) && okAll
  }

  if (!okAll) process.exit(1)
  console.log(pc.dim("\n下次使用会重建全新 profile；登录态需要重新建立。"))
}
