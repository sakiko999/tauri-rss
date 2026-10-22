/**
 * browser-reset — 清掉抓取浏览器(Tauri WebView2)的 profile。
 *
 * 抓取浏览器是应用内一个隐藏 WebView2 窗口（独立 user-data-dir + CDP 9334），
 * 登录态/缓存都落在该目录。profile 养脏或需要强制重新扫码时清一次即可。
 *
 * ⚠️ CLI 独立实现(**不能**转发 `invoke("webview_browser_reset")`):CLI 跑在 Bun 下,
 * 没有 `window.__TAURI_INTERNALS__`,`@tauri-apps/api` 的 invoke 必然抛
 * 「Cannot read properties of undefined (reading 'invoke')」——那样的入口等于永远失败。
 * 与 desktop 的 Rust 命令各自实现同一件事:杀掉占用 CDP 端口的进程树 → 删 profile 目录。
 *
 * 用法:`bun run rss browser-reset`
 */
import pc from "picocolors"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { fail, ok, row } from "../ui/render.ts"

/** 与 apps/src-tauri/src/webview_browser.rs 的 `PORT` 对齐。 */
const CDP_PORT = 9334
/** 与 tauri.conf.json 的 identifier + Rust `app_local_data_dir()/webview-profile` 对齐。
 *  ⚠️ `app_local_data_dir` 在 Windows 是 LOCALAPPDATA(不是 Roaming)。
 *  ⚠️ **改 identifier 必须同步这里** —— 不同步会去删一个不存在的目录(静默 no-op),
 *  用户以为清了 profile、其实脏数据还在。(2026-10-16 `com.zhh.tauri-app` → `app.amoeba.desktop`) */
const PROFILE_DIR = join(process.env.LOCALAPPDATA ?? "", "app.amoeba.desktop", "webview-profile")

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

export async function runBrowserReset(): Promise<void> {
  console.log(pc.bold("清理抓取浏览器 profile(WebView2)"))
  console.log(row("目录", pc.dim(PROFILE_DIR)))

  const before = dirSizeMB(PROFILE_DIR)
  if (before === null) {
    console.log(row("结果", pc.dim("profile 不存在,无需清理(下次使用会是全新实例)")))
    return
  }
  console.log(row("清理前", `${before.toFixed(1)} MB`))

  const killed = killOnPort(CDP_PORT)
  if (killed) console.log(row("进程", `结束 ${killed} 个占用 :${CDP_PORT} 的实例`))

  // 杀进程后 WebView2 子进程释放文件句柄有延迟,重试几次。
  let lastErr: unknown = null
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(PROFILE_DIR, { recursive: true, force: true })
      console.log(row("结果", ok(`已清理 ${before.toFixed(1)} MB`)))
      console.log(pc.dim("\n下次打开浏览器路径渠道时会重建全新 profile;微博/小红书需重新登录。"))
      return
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  console.log(row("结果", fail(String(lastErr))))
  console.log(pc.dim("\n可能有抓取浏览器进程仍占用该目录,请先退出应用后重试。"))
  process.exit(1)
}
