#!/usr/bin/env bun
/**
 * player-dryrun —— 媒体流播放稳定性探测（★ 只跑 HTTP 探针记录信息，不跑播放器）。
 *
 * 目的：把「播放卡不卡」拆成可记录的客观数据 —— 直链/清单/分片各自的状态码、
 * TTFB、读取吞吐、抖动（多轮 min/avg/max），不加载 hls/flv/dash 引擎、不建
 * <video>。用于：新平台渠道接入后的流活性验证、播放问题与「解析层 vs 传输层」
 * 的快速二分。
 *
 * 探测路径与真实播放一致：媒体分片在应用里由 WebView fetch 直连（Rust 只注入
 * Referer/UA），**不走 appHost.http 隧道**——所以媒体探针也用原生 fetch + 流自带
 * headers；只有 resolve 阶段走 CLI 同款 appHost 路径（登录档位）。
 *
 * 吞吐是「首 128KB 读取速率」，不是带宽基准（高 BDP 链路会低估）；稳定性看
 * TTFB 抖动与失败率，不看绝对速率。
 *
 * 用法：
 *   bun scripts/player-dryrun.ts <url>
 *   bun scripts/player-dryrun.ts <url> --via-service          # 解析走数据服务（同 cookie/配额）
 *   bun scripts/player-dryrun.ts <url> --rounds 3 --segments 4
 *   bun scripts/player-dryrun.ts <url> --json report.json     # 结构化落盘（趋势对比用）
 */

import { cookieFieldForPlatform } from "@amoeba/core"
import { setPlatformCookieLookup } from "@amoeba/resolve"
import type { Stream } from "@amoeba/xml"

import { resolveByUrl } from "../apps/cli/src/commands/item.ts"
import { probeResolve } from "../apps/cli/src/commands/probe.ts"
import { closeBrowser, setupHost } from "../apps/cli/src/host/node-host.ts"
import { loadSettings } from "../apps/cli/src/info.ts"

// —— 参数 ——————————————————————————————————————————————

const args = process.argv.slice(2)

function optValue(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function optInt(name: string, fallback: number): number {
  const v = optValue(name)
  if (v === undefined) return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} 需要正整数，得到: ${v}`)
  return Math.floor(n)
}

// 带值选项（解析 positional 时跳过其值，防 `--rounds 3` 的 3 被当成 URL）。
const VALUE_OPTS = new Set(["--endpoint", "--profile", "--json", "--rounds", "--segments"])
const positionals: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (VALUE_OPTS.has(args[i])) i++
    continue
  }
  positionals.push(args[i])
}
const url = positionals[0]
if (!url) {
  console.error(
    "用法: bun scripts/player-dryrun.ts <url> [--via-service] [--endpoint <p>] [--profile <p>] [--rounds N] [--segments N] [--json <path>]",
  )
  process.exit(1)
}

const OPTS = {
  viaService: args.includes("--via-service"),
  endpoint: optValue("endpoint"),
  profile: optValue("profile"),
  rounds: optInt("rounds", 2),
  segments: optInt("segments", 3),
  json: optValue("json"),
}

/** 每次探针最多读取的字节（吞吐样本；不是带宽基准）。 */
const READ_CAP = 128 * 1024

// —— 宿主注入（与 CLI 同路径：登录档位 / 浏览器显式 opt-in）—————————————————

setupHost()
{
  // credentials provider：与 core DataLayer / CLI 入口同一 settings 源。
  const settings = await loadSettings()
  setPlatformCookieLookup((platform) => {
    const field = cookieFieldForPlatform(platform)
    const v = field ? settings[field] : undefined
    return typeof v === "string" && v ? v : undefined
  })
}

// —— HTTP 探针 —————————————————————————————————————————————

interface ProbeRecord {
  label: string
  url: string
  status?: number
  contentType?: string
  /** 服务器是否按 Range 返回 206（direct 流的 Range 支持性）。 */
  rangeOk?: boolean
  /** content-range/content-length 头里的总大小（可解析时）。 */
  totalBytes?: number
  bytes: number
  ttfbMs?: number
  readMs?: number
  error?: string
}

/**
 * 单次探测：GET（可选 Range）→ 记 TTFB（headers 到达）→ 读最多 READ_CAP 字节
 * → cancel。200 全量流（直播 flv/不支持 Range 的源）也安全：读完上限即断。
 */
async function httpProbe(
  label: string,
  url: string,
  headers: Record<string, string> | undefined,
  opts: { range?: string; timeoutMs?: number; readCap?: number } = {},
): Promise<ProbeRecord> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000)
  const t0 = performance.now()
  try {
    const res = await fetch(url, {
      headers: { ...(opts.range ? { Range: opts.range } : {}), ...headers },
      redirect: "follow",
      signal: ctrl.signal,
    })
    const ttfb = Math.round(performance.now() - t0)
    let bytes = 0
    const cap = opts.readCap ?? READ_CAP
    if (res.body) {
      const reader = res.body.getReader()
      while (bytes < cap) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
      }
      await reader.cancel().catch(() => {})
    }
    const totalBytes = parseTotalBytes(res.headers.get("content-range") ?? res.headers.get("content-length"))
    return {
      label,
      url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      rangeOk: opts.range ? res.status === 206 : undefined,
      totalBytes,
      bytes,
      ttfbMs: ttfb,
      readMs: Math.round(performance.now() - t0),
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { label, url, bytes: 0, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/** `bytes 0-131071/52428800` / `52428800` → 52428800。 */
function parseTotalBytes(header: string | null): number | undefined {
  if (!header) return undefined
  const m = /\/(\d+)$/.exec(header.trim())
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return n
  }
  const n = Number(header)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 清单类小文本专用：全量读完（清单通常 <100KB），同时记 TTFB。 */
async function fetchTextProbe(
  label: string,
  url: string,
  headers: Record<string, string> | undefined,
): Promise<{ record: ProbeRecord; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  const t0 = performance.now()
  try {
    const res = await fetch(url, { headers: { ...headers }, redirect: "follow", signal: ctrl.signal })
    const ttfb = Math.round(performance.now() - t0)
    const buf = new Uint8Array(await res.arrayBuffer())
    const totalMs = Math.round(performance.now() - t0)
    return {
      record: {
        label,
        url,
        status: res.status,
        contentType: res.headers.get("content-type") ?? undefined,
        bytes: buf.byteLength,
        ttfbMs: ttfb,
        readMs: totalMs,
      },
      text: new TextDecoder().decode(buf),
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return { record: { label, url, bytes: 0, error: msg }, text: "" }
  } finally {
    clearTimeout(timer)
  }
}

// —— 清单解析（正则级：只做结构统计，不做完整解析器）—————————————————

interface M3u8Info {
  isMaster: boolean
  /** master 的子清单（bandwidth 降序排好后取首个 = 最高画质）。 */
  variants: { bandwidth: number; resolution?: string; codecs?: string; url: string }[]
  segments: string[]
  targetDurationSec?: number
  /** 无 EXT-X-ENDLIST = 直播清单（持续追加）。 */
  live: boolean
}

function parseM3u8(text: string, baseUrl: string): M3u8Info {
  const lines = text.split(/\r?\n/)
  const variants: M3u8Info["variants"] = []
  const segments: string[] = []
  let targetDurationSec: number | undefined
  let pendingVariant: M3u8Info["variants"][number] | null = null
  let pendingSegment = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pendingVariant = {
          bandwidth: Number(attr(line, "BANDWIDTH") ?? 0),
          resolution: attr(line, "RESOLUTION"),
          codecs: attr(line, "CODECS"),
          url: "",
        }
      } else if (line.startsWith("#EXTINF:")) {
        pendingSegment = true
      } else if (line.startsWith("#EXT-X-TARGET-DURATION:")) {
        targetDurationSec = Number(line.split(":")[1])
      }
      continue
    }
    const abs = new URL(line, baseUrl).href
    if (pendingVariant) {
      pendingVariant.url = abs
      variants.push(pendingVariant)
      pendingVariant = null
    } else if (pendingSegment) {
      segments.push(abs)
      pendingSegment = false
    }
  }
  variants.sort((a, b) => b.bandwidth - a.bandwidth)
  return { isMaster: variants.length > 0, variants, segments, targetDurationSec, live: !text.includes("EXT-X-ENDLIST") }
}

function attr(line: string, name: string): string | undefined {
  // 前置空白/引号锚定属性名起点：`bandwidth` 包含 `width`，不锚定会串档。
  const m = new RegExp(`(?:^|[\\s"])${name}=("[^"]*"|[^,\\s]+)`).exec(line)
  if (!m) return undefined
  return m[1].startsWith('"') ? m[1].slice(1, -1) : m[1]
}

interface MpdRep {
  id: string
  mimeType: string
  codecs: string
  bandwidth: number
  width?: number
  height?: number
  baseUrl: string
  initRange?: string
}

/** 提取自装配 MPD（resolve/utils/mpd.ts 的形状：每 rep 一段 BaseURL + SegmentBase）。 */
function parseMpd(text: string): MpdRep[] {
  const reps: MpdRep[] = []
  const repRe = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g
  let m: RegExpExecArray | null
  while ((m = repRe.exec(text))) {
    const attrs = m[1]
    const body = m[2]
    const base = /<BaseURL>([\s\S]*?)<\/BaseURL>/.exec(body)?.[1]
    if (!base) continue // YouTube 等模板型 MPD 没有逐 rep BaseURL，只统计不探测
    const init = /<Initialization range="([^"]+)"/.exec(body)?.[1]
    reps.push({
      id: attr(attrs, "id") ?? "?",
      mimeType: attr(attrs, "mimeType") ?? "?",
      codecs: attr(attrs, "codecs") ?? "?",
      bandwidth: Number(attr(attrs, "bandwidth") ?? 0),
      width: Number(attr(attrs, "width") ?? NaN) || undefined,
      height: Number(attr(attrs, "height") ?? NaN) || undefined,
      baseUrl: base
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim(),
      initRange: init,
    })
  }
  return reps
}

// —— 单条流的探测编排 ——————————————————————————————————————

interface StreamReport {
  index: number
  kind: "dash-mpd" | "hls" | "direct"
  format?: string
  quality?: string
  host?: string
  dash?: { reps: MpdRep[] }
  hls?: { isMaster: boolean; live: boolean; targetDurationSec?: number; segmentCount?: number; variantCount?: number }
  probes: ProbeRecord[]
}

async function probeStream(s: Stream, index: number): Promise<StreamReport> {
  const headers = s.headers
  const host = streamHostOf(s.url)
  const report: StreamReport = { index, kind: "direct", format: s.format, quality: s.quality, host, probes: [] }

  if (s.dashManifest) {
    report.kind = "dash-mpd"
    const reps = parseMpd(s.dashManifest)
    report.dash = { reps }
    // video + audio 各取最高带宽 rep，Range 读 init 段（真实播放的第一击）。
    const video = reps.filter((r) => r.mimeType.startsWith("video")).sort((a, b) => b.bandwidth - a.bandwidth)[0]
    const audio = reps.filter((r) => r.mimeType.startsWith("audio")).sort((a, b) => b.bandwidth - a.bandwidth)[0]
    for (const rep of [video, audio]) {
      if (!rep) continue
      for (let r = 0; r < OPTS.rounds; r++) {
        report.probes.push(
          await httpProbe(
            `${rep.mimeType.startsWith("video") ? "video" : "audio"} ${rep.codecs} init#${r}`,
            rep.baseUrl,
            headers,
            {
              range: rep.initRange ? `bytes=${rep.initRange}` : "bytes=0-65535",
              readCap: 64 * 1024,
            },
          ),
        )
      }
    }
    return report
  }

  if (!s.url) {
    report.probes.push({ label: "resolve", url: "", bytes: 0, error: "stream 无 url 且无 dashManifest" })
    return report
  }

  const looksHls = /\.m3u8(\?|$)/i.test(s.url) || (s.format ? /hls/i.test(s.format) : false)
  if (looksHls) {
    report.kind = "hls"
    // ① 首拉清单：master → 取最高画质变体再拉 media（一次性）。
    const first = await fetchTextProbe("manifest", s.url, headers)
    report.probes.push(first.record)
    if (first.record.error || first.record.status === undefined || first.record.status >= 400) return report
    let info = parseM3u8(first.text, s.url)
    let mediaUrl = s.url
    if (info.isMaster) {
      if (!info.variants[0]) {
        report.hls = { isMaster: true, live: info.live, variantCount: 0 }
        return report
      }
      mediaUrl = info.variants[0].url
      const variant = await fetchTextProbe("variant-manifest", mediaUrl, headers)
      report.probes.push(variant.record)
      if (variant.record.error || variant.record.status === undefined || variant.record.status >= 400) return report
      info = parseM3u8(variant.text, mediaUrl)
    }
    report.hls = {
      isMaster: info.isMaster,
      live: info.live,
      targetDurationSec: info.targetDurationSec,
      segmentCount: info.segments.length,
      variantCount: info.isMaster ? undefined : info.variants.length || undefined,
    }
    // ② media 清单按 rounds 重拉（同 URL 抖动）。
    for (let r = 1; r < OPTS.rounds; r++) {
      report.probes.push((await fetchTextProbe(`manifest#${r}`, mediaUrl, headers)).record)
    }
    // ③ 首段分片各探一次（Range 截断，不整段拉）。
    for (let i = 0; i < Math.min(OPTS.segments, info.segments.length); i++) {
      report.probes.push(
        await httpProbe(`segment[${i}]`, info.segments[i], headers, { range: `bytes=0-${READ_CAP - 1}` }),
      )
    }
    return report
  }

  // direct（mp4/flv/其它）：Range 读首段，重复 rounds 记抖动。
  for (let r = 0; r < OPTS.rounds; r++) {
    report.probes.push(await httpProbe(`direct#${r}`, s.url, headers, { range: `bytes=0-${READ_CAP - 1}` }))
  }
  return report
}

function streamHostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : undefined
  } catch {
    return undefined
  }
}

// —— 执行 ——————————————————————————————————————————————

const t0 = performance.now()
console.log(`▶ player-dryrun  ${url}`)
console.log(
  `  mode: ${OPTS.viaService ? "via-service（解析走数据服务）" : "local（CLI 直连 resolve）"} · rounds=${OPTS.rounds} segments=${OPTS.segments}`,
)

let resolved: Awaited<ReturnType<typeof resolveByUrl>>
if (OPTS.viaService) {
  resolved = await probeResolve(url, OPTS.endpoint, OPTS.profile)
} else {
  resolved = await resolveByUrl(url)
}
console.log(
  `  route: ${resolved.route.platform} ${resolved.route.kind} ${resolved.route.id} · resolve ${Math.round(resolved.tookMs)}ms · streams ${resolved.streams.length}`,
)

const reports: StreamReport[] = []
for (const [i, s] of resolved.streams.entries()) {
  console.log(
    `\nstream[${i}] ${[s.quality, s.format, s.rate !== undefined ? `rate=${s.rate}` : null].filter(Boolean).join(" ") || "(未标)"}`,
  )
  const rep = await probeStream(s, i)
  reports.push(rep)
  printReport(rep)
}

// —— 汇总与落盘 ——————————————————————————————————————————————

const failed = reports.flatMap((r) => r.probes).filter((p) => p.error || (p.status !== undefined && p.status >= 400))
console.log(
  `\n▶ 汇总: ${reports.length} 条流 / ${reports.flatMap((r) => r.probes).length} 次探测 / 失败 ${failed.length}`,
)
for (const f of failed) console.log(`  ✘ ${f.label} → ${f.error ?? `HTTP ${f.status}`}`)
console.log(`  总耗时 ${Math.round(performance.now() - t0)}ms`)

if (OPTS.json) {
  const payload = {
    startedAt: new Date().toISOString(),
    url,
    mode: OPTS.viaService ? "via-service" : "local",
    route: resolved.route,
    resolveMs: Math.round(resolved.tookMs),
    readCapBytes: READ_CAP,
    streams: reports,
  }
  await Bun.write(OPTS.json, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`  json → ${OPTS.json}`)
}

await closeBrowser()
process.exit(failed.length ? 1 : 0)

// —— 渲染 ——————————————————————————————————————————————

function printReport(rep: StreamReport): void {
  if (rep.kind === "dash-mpd" && rep.dash) {
    const video = rep.dash.reps.filter((r) => r.mimeType.startsWith("video"))
    const audio = rep.dash.reps.filter((r) => r.mimeType.startsWith("audio"))
    console.log(
      `  MPD: ${video.length} video rep + ${audio.length} audio rep${rep.dash.reps.length === 0 ? "（无逐 rep BaseURL，未探测）" : ""}`,
    )
    for (const r of rep.dash.reps) {
      console.log(
        `    ${r.mimeType.startsWith("video") ? "video" : "audio"} ${r.codecs} ${r.width && r.height ? `${r.width}x${r.height} ` : ""}${fmtBps(r.bandwidth)}`,
      )
    }
  }
  if (rep.kind === "hls" && rep.hls) {
    const bits = [rep.hls.isMaster ? `master(${rep.hls.variantCount} 变体)` : `media(${rep.hls.segmentCount} 分片)`]
    if (rep.hls.targetDurationSec) bits.push(`目标分片 ${rep.hls.targetDurationSec}s`)
    bits.push(rep.hls.live ? "直播（无 ENDLIST）" : "点播（ENDLIST）")
    console.log(`  HLS: ${bits.join(" · ")}`)
  }
  for (const p of rep.probes) {
    if (p.error) {
      console.log(`    ✘ ${p.label}  ${p.error}`)
      continue
    }
    const speed =
      p.readMs && p.bytes >= 16 * 1024
        ? ` ${fmtBytes(p.bytes)}/${(p.readMs / 1000).toFixed(2)}s(${fmtBps((p.bytes * 8 * 1000) / p.readMs)})`
        : ""
    console.log(
      `    ${p.error || p.status === undefined || p.status >= 400 ? "✘" : "·"} ${p.label}  HTTP ${p.status}${p.contentType ? ` ${p.contentType}` : ""}` +
        `  ttfb ${p.ttfbMs}ms${p.totalBytes ? ` 总长 ${fmtBytes(p.totalBytes)}` : ""}${p.rangeOk === false ? "（Range 未生效，200 全量）" : ""}${speed}`,
    )
  }
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

function fmtBps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return "—"
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)}Mbps`
  return `${Math.round(bps / 1000)}kbps`
}
