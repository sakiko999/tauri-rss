/**
 * play — 解析直链 + 可选丢系统播放器实测活性(收编 crawler example/resolve.ts)。
 * 不做播放:hls.js/flv.js/dashjs 不进 CLI;DASH(dashManifest)系统播放器吃不了,
 * --open 自动跳到首个非 dash 档(docs/cli-plan.md §一)。
 */
import pc from "picocolors"
import { printResolved, resolveByUrl } from "./item.ts"

export interface PlayOptions {
  open?: boolean
}

export async function runPlay(url: string, opts: PlayOptions): Promise<void> {
  const r = await resolveByUrl(url)
  printResolved(r)

  if (!opts.open) return
  const target = r.streams.find((s) => s.format !== "dash") ?? r.streams[0]
  if (!target?.url) throw new Error("无可用直链可打开")
  if (target.format === "dash") {
    console.log(pc.yellow("⚠ 全部档位均为 DASH(dashManifest),系统播放器无法直接消费——不打开。mpv 落盘 .mpd 方案见 docs/mpv-playback-research.md"))
    return
  }
  console.log(`open:    ${target.quality ?? ""} ${target.format ?? ""} → 系统播放器`)
  openExternal(target.url)
}

/** 系统默认应用打开 URL(win: cmd start / mac: open / linux: xdg-open)。 */
function openExternal(u: string): void {
  const cmd =
    process.platform === "win32" ? ["cmd", "/c", "start", "", u]
    : process.platform === "darwin" ? ["open", u]
    : ["xdg-open", u]
  Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}
