/**
 * play — 解析直链 + 可选丢系统播放器实测活性(收编 crawler example/resolve.ts)。
 * 不做播放:hls.js/flv.js/dashjs 不进 CLI;DASH(dashManifest)系统播放器吃不了,
 * --open 自动跳到首个非 dash 档(docs/cli-plan.md §一)。
 */
import pc from "picocolors"
import { printResolved, resolveByUrl } from "./item.ts"
import { probeResolve } from "./probe.ts"

export interface PlayOptions {
  open?: boolean
  viaService?: boolean
  endpoint?: string
}

export async function runPlay(url: string, opts: PlayOptions): Promise<void> {
  const r = opts.viaService
    ? await probeResolve(url, opts.endpoint)
    : await resolveByUrl(url)
  printResolved(r)

  if (!opts.open) return
  const target = r.streams.find((s) => s.format !== "dash") ?? r.streams[0]
  if (!target?.url) throw new Error("无可用直链可打开")
  if (target.format === "dash") {
    console.log(pc.yellow("⚠ 全部档位均为 DASH(dashManifest),系统播放器无法直接消费——不打开。mpv 落盘 .mpd 方案见 docs/playback/mpv.md"))
    return
  }
  console.log(`open:    ${target.quality ?? ""} ${target.format ?? ""} → 系统播放器`)
  openExternal(target.url)
}

/** 系统默认应用打开 URL(win / mac / linux)。
 *  ⚠️ Windows **必须**用 rundll32 而非 `cmd /c start ""`——cmd 会在 query 的 `&` 处
 *  截断分命令(签名直链 `?wsSecret=…&wsTime=…` 会被切成半条 URL,后半触发
 *  `'wsTime' is not recognized`,而 stderr 被 ignore 用户看不到)。Bun 的引号转义
 *  (`\"`)cmd 也不认。rundll32 不经 cmd 解析,URL 原样传递。 */
function openExternal(u: string): void {
  const cmd =
    process.platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", u]
    : process.platform === "darwin" ? ["open", u]
    : ["xdg-open", u]
  Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}
