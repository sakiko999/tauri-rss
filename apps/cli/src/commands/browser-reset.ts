/**
 * browser-reset — 清掉 Edge 浏览器 profile(CDP 模拟用的那个)。
 *
 * 用途:Edge 会把 profile 越养越脏——累积扩展 + 微软账户层 cookie(edge-cdp skill
 * 的「坑 2」记录:换 `--user-data-dir` 也挡不住)。dev 下这些脏数据会混进 CDP 目标
 * 列表、污染抓取环境,清一次即可回到「全新实例」。
 *
 * ⚠️ CLI 独立实现(**不能**转发 `invoke("browser_reset_profile")`):CLI 跑在 Bun 下,
 * 没有 `window.__TAURI_INTERNALS__`,`@tauri-apps/api` 的 invoke 必然抛
 * 「Cannot read properties of undefined (reading 'invoke')」——那样的入口等于永远失败。
 * 与 desktop 的 Rust 命令各自实现同一件事:杀占用 CDP 端口的进程树 → 删 profile 目录。
 *
 * 用法:`bun run rss browser-reset`
 */
import pc from "picocolors"
import { existsSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { fail, ok, row } from "../ui/render.ts"

/** 与 apps/src-tauri/src/commands/browser.rs 的 CDP_PORT 对齐。 */
const CDP_PORT = 9223
/** 与 tauri.conf.json 的 identifier + Rust `app_data_dir()/edge-profile` 对齐。 */
const PROFILE_DIR = join(process.env.APPDATA ?? "", "com.zhh.tauri-app", "edge-profile")

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
function killEdgeOnPort(port: number): number {
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
  console.log(pc.bold("清理浏览器 profile(Edge CDP)"))
  console.log(row("目录", pc.dim(PROFILE_DIR)))

  const before = dirSizeMB(PROFILE_DIR)
  if (before === null) {
    console.log(row("结果", pc.dim("profile 不存在,无需清理(下次启动会是全新实例)")))
    return
  }
  console.log(row("清理前", `${before.toFixed(1)} MB`))

  const killed = killEdgeOnPort(CDP_PORT)
  if (killed) console.log(row("进程", `结束 ${killed} 个占用 :${CDP_PORT} 的实例`))

  // 杀进程后子进程释放文件句柄有延迟,重试几次。
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
  console.log(pc.dim("\n可能有 Edge 仍占用该目录,请手动关闭后重试。"))
  process.exit(1)
}
