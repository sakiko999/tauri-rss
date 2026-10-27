#!/usr/bin/env bun
/**
 * 统一检查入口 —— `bun run check [--layer <csv>] [--filter <substr>] [--list] [--verbose]`
 *
 * 分层（默认跑前三层 + typecheck；service 慢，显式 `--layer service|all`）：
 *   static     纯解析/算法/UI 工具（无 IO、无网络）
 *   contract   跨包契约：XML 边界、凭据三级语义、平台表、二维码、路由错误分类
 *   state      存储/并发/编排：DataLayer、缓存、退订、被动模式、浏览器 lane
 *   service    起真实数据服务（bun:sqlite + HTTP/WS），慢但验证协议与快照
 *   typecheck  12 个 tsconfig（packages/* + apps/*）
 *
 * 新增 `.check.ts` 后把它加进对应层；分层错了会在这里暴露（CI 与本地同一入口）。
 * 失败输出「首行错误 + 复跑命令」，不吞退出码。
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
type Layer = "static" | "contract" | "state" | "service" | "typecheck"
const ALL_LAYERS: Layer[] = ["static", "contract", "state", "service", "typecheck"]
const DEFAULT_LAYERS: Layer[] = ["static", "contract", "state", "typecheck"]

const FILES: Record<Exclude<Layer, "typecheck">, string[]> = {
  static: [
    "packages/log/src/example/log.check.ts",
    "packages/xml/src/example/opml.check.ts",
    "packages/platform/src/example/platform.check.ts",
    "packages/core/src/reading-position.check.ts",
    "packages/resolve/src/example/router.check.ts",
    "packages/resolve/src/example/danmaku-proto.check.ts",
    "packages/resolve/src/example/douyu-frame.check.ts",
    "packages/resolve/src/example/huya-tars.check.ts",
    "packages/resolve/src/example/twitch-playlist.check.ts",
    "packages/resolve/src/example/bili-buvid.check.ts",
    "packages/resolve/src/example/bili-space-sign.check.ts",
    "packages/resolve/src/example/youtube-clients.check.ts",
    "packages/resolve/src/example/xhs-time.check.ts",
    "packages/resolve/src/example/youtube-danmaku-poll.check.ts",
    "packages/resolve/src/example/login-events.check.ts",
    "packages/resolve/src/example/douyin-user.check.ts",
    "packages/crawler/src/example/extract.check.ts",
    "packages/crawler/src/example/bili-popular.check.ts",
    "packages/crawler/src/example/bili-channels.check.ts",
    "packages/crawler/src/example/twitch-live.check.ts",
    "packages/crawler/src/example/youtube-channels.check.ts",
    "packages/crawler/src/example/category-directory.check.ts",
    "packages/crawler/src/example/hot-channels.check.ts",
    "packages/player/src/hooks/useStreamSelection.check.ts",
    "packages/player/src/hooks/player-stats.check.ts",
    "apps/desktop/src/lib/opml.check.ts",
    "apps/desktop/src/lib/ime.check.ts",
    "apps/desktop/src/lib/rail-nav.check.ts",
    "apps/desktop/src/lib/boot-skeleton.check.ts",
    "apps/desktop/src/store/nodes.check.ts",
    "apps/desktop/src/store/selectors.check.ts",
    "apps/desktop/src/lib/live-filter.check.ts",
    "apps/desktop/src/lib/subscriptions.check.ts",
    "apps/desktop/src/lib/channel-catalog.check.ts",
    "apps/desktop/src/dev/ui-overlay/overlay.check.ts",
    "apps/mobile/src/html.check.ts",
  ],
  contract: [
    "packages/core/src/example/serialize-roundtrip.check.ts",
    "packages/core/src/example/serialize-contract.check.ts",
    "packages/core/src/example/error-kind.check.ts",
    "packages/resolve/src/example/credentials.check.ts",
    "packages/resolve/src/example/media-referrer-parity.check.ts",
    "packages/resolve/src/example/youtube-channel.check.ts",
    "packages/host/src/example/host-check.ts",
    "packages/host/src/example/governor.check.ts",
    "apps/cli/src/ui/qr-terminal.check.ts",
  ],
  state: [
    "packages/core/src/example/data-layer.check.ts",
    "packages/core/src/example/body-cache.check.ts",
    "packages/core/src/example/repo-concurrency.check.ts",
    "packages/core/src/example/media-store.check.ts",
    "packages/core/src/example/cookie-sync.check.ts",
    "packages/core/src/example/passive-mode.check.ts",
    "packages/resolve/src/example/scheduler.check.ts",
    "packages/resolve/src/example/live-photo.check.ts",
    "packages/crawler/src/example/passive-buffer.check.ts",
    "packages/crawler/src/example/passive-capture.check.ts",
    "packages/crawler/src/example/xhs-strategy.check.ts",
  ],
  service: [
    "scripts/service-skeleton-check.ts",
    "scripts/service-data-check.ts",
    "scripts/remote-data-layer-check.ts",
  ],
}

const TYPECHECK_PROJECTS = [
  "packages/xml",
  "packages/log",
  "packages/platform",
  "packages/resolve",
  "packages/crawler",
  "packages/core",
  "packages/host",
  "packages/player",
  "packages/ui",
  "apps/cli",
  "apps/desktop",
  "apps/mobile",
]

interface Result {
  name: string
  ok: boolean
  ms: number
  out: string
}

function parseArgs(argv: string[]): { layers: Layer[]; filter?: string; list: boolean; verbose: boolean } {
  let layers = DEFAULT_LAYERS
  let filter: string | undefined
  let list = false
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--list") list = true
    else if (a === "--verbose" || a === "-v") verbose = true
    else if (a === "--layer") {
      const raw = argv[++i] ?? ""
      if (raw === "all") layers = ALL_LAYERS
      else {
        const picked = raw.split(",").filter(Boolean) as Layer[]
        const bad = picked.filter((l) => !ALL_LAYERS.includes(l))
        if (bad.length) throw new Error(`未知层：${bad.join(",")}（可用：${ALL_LAYERS.join(",")},all）`)
        layers = picked
      }
    } else if (a === "--filter") filter = argv[++i]
    else throw new Error(`未知参数：${a}`)
  }
  return { layers, filter, list, verbose }
}

function run(cmd: string[], name: string): Result {
  const t0 = performance.now()
  const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: ROOT, encoding: "utf8", timeout: 180_000 })
  const ms = performance.now() - t0
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  return { name, ok: r.status === 0, ms, out }
}

/** 失败时只留最有信息量的行：断言/错误行优先，否则前 12 行。 */
function excerpt(out: string): string {
  const lines = out.split(/\r?\n/).filter((l) => l.trim())
  const key = lines.filter((l) => /✗|✘|FAIL|AssertionError|error TS|Error:|throw/i.test(l))
  const picked = (key.length ? key : lines).slice(0, 12)
  return picked.map((l) => `    ${l}`).join("\n")
}

const tscBin = join(ROOT, "node_modules/typescript/bin/tsc")

function main(): number {
  const { layers, filter, list, verbose } = parseArgs(process.argv.slice(2))

  if (list) {
    for (const layer of ALL_LAYERS) {
      const items = layer === "typecheck" ? TYPECHECK_PROJECTS.map((p) => `${p} (tsc)`) : FILES[layer]
      console.log(`\n${layer} (${items.length})`)
      for (const item of items) console.log(`  ${item}`)
    }
    console.log(`\n默认层：${DEFAULT_LAYERS.join(" + ")}；service 用 --layer service|all 显式跑。`)
    return 0
  }

  if (!existsSync(tscBin)) throw new Error(`找不到 ${tscBin}（先 bun install）`)

  const results: Result[] = []
  const t0 = performance.now()

  for (const layer of layers) {
    const isTsc = layer === "typecheck"
    const items = (isTsc ? TYPECHECK_PROJECTS : FILES[layer]).filter((x) => !filter || x.includes(filter))
    if (!items.length) continue
    console.log(`\n${layer}`)
    for (const item of items) {
      const cmd = isTsc ? [process.execPath, tscBin, "-p", item] : [process.execPath, item]
      const name = isTsc ? `${item} (tsc)` : item
      const r = run(cmd, name)
      results.push(r)
      const mark = r.ok ? "✓" : "✘"
      console.log(`  ${mark} ${name} ${Math.round(r.ms)}ms`)
      if (verbose && r.ok) {
        for (const line of r.out.split(/\r?\n/).filter(Boolean).slice(0, 20)) console.log(`    ${line}`)
      }
      if (!r.ok) {
        console.log(excerpt(r.out))
        console.log(
          layer === "typecheck"
            ? `    复跑: ./node_modules/.bin/tsc -p ${item}`
            : `    复跑: bun ${item}`,
        )
      }
    }
  }

  const failed = results.filter((r) => !r.ok)
  const ms = Math.round(performance.now() - t0)
  console.log(
    `\n${failed.length ? `✘ ${failed.length} 项失败` : "全部通过"} · ${results.length - failed.length}/${results.length} · ${ms}ms`,
  )
  if (failed.length) {
    console.log(`失败项：${failed.map((r) => r.name).join(", ")}`)
  }
  return failed.length ? 1 : 0
}

process.exit(main())
