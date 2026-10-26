/**
 * browser-reset — 清掉抓取浏览器 profile。
 *
 * 现在有两套浏览器，profile 必须分开清：
 *   - `cli`（默认）：`amoeba-browser.exe` 的 `%LOCALAPPDATA%/app.amoeba.cli/browser-profile`
 *   - `desktop`：Tauri WebView2 的 `.../app.amoeba.desktop/webview-profile`（CDP 9334）
 *   - `all`：两者都清
 *
 * ⚠️ CLI 的浏览器是显式 opt-in（`--browser`）；清 CLI profile 会掉 CLI 侧登录态。
 * ⚠️ 桌面 profile 的清理仍是「杀 9334 进程树 + 删目录」；CLI profile 用镜像名
 *    `amoeba-browser.exe`（我们自己的进程，安全）先停 sidecar，再删目录。
 *
 * 用法:`bun run rss browser-reset [--target cli|desktop|all]`
 */
import pc from "picocolors"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { defaultSidecarProfileDir } from "@amoeba/host/node"
import { fail, ok, row } from "../ui/render.ts"

/** 与 apps/src-tauri/src/webview_browser.rs 的 `PORT` 对齐。 */
const DESKTOP_CDP_PORT = 9334
/** 与 tauri.conf.json 的 identifier + Rust `app_local_data_dir()/webview-profile` 对齐。
 *  ⚠️ `app_local_data_dir` 在 Windows 是 LOCALAPPDATA(不是 Roaming)。
 *  ⚠️ **改 identifier 必须同步这里** —— 不同步会去删一个不存在的目录(静默 no-op),
 *  用户以为清了 profile、其实脏数据还在。(2026-10-16 `com.zhh.tauri-app` → `app.amoeba.desktop`) */
const DESKTOP_PROFILE = join(process.env.LOCALAPPDATA ?? "", "app.amoeba.desktop", "webview-profile")
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

/** 停掉所有 amoeba-browser sidecar（我们自己的进程名，不误伤用户浏览器）。 */
function killCliSidecars(): number {
  try {
    const r = Bun.spawnSync(["taskkill", "/F", "/T", "/IM", "amoeba-browser.exe"], {
      stderr: "ignore",
    })
    return r.exitCode === 0 ? 1 : 0
  } catch {
    return 0
  }
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

async function resetOne(
  label: string,
  dir: string,
  stop: () => number,
): Promise<boolean> {
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
  target?: "cli" | "desktop" | "all"
}

export async function runBrowserReset(opts: BrowserResetOptions = {}): Promise<void> {
  const target = opts.target ?? "cli"
  console.log(pc.bold(`清理抓取浏览器 profile（${target}）`))

  let okAll = true
  if (target === "cli" || target === "all") {
    console.log(pc.dim(`  ${CLI_PROFILE}`))
    okAll = (await resetOne("CLI", CLI_PROFILE, killCliSidecars)) && okAll
  }
  if (target === "desktop" || target === "all") {
    console.log(pc.dim(`  ${DESKTOP_PROFILE}`))
    // 桌面端可能正在运行：杀占用 9334 的进程树（只认端口，不按镜像名）。
    okAll = (await resetOne("桌面", DESKTOP_PROFILE, () => killOnPort(DESKTOP_CDP_PORT))) && okAll
  }

  if (!okAll) process.exit(1)
  console.log(pc.dim("\n下次使用会重建全新 profile；登录态需要重新建立。"))
}
