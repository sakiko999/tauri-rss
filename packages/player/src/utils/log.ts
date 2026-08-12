/**
 * 播放器日志 —— 播放流程关键信息的统一出口。
 *
 * 语义化模板函数:每个事件一个专属函数,调用处只传事件数据、不拼文案;
 * 文案/级别/`[player:<阶段>]` 前缀全部集中在本文件。全包禁止裸 console.*。
 *
 * 阶段:resolve 懒解析 / select 选流切档 / engine 流媒体引擎 / play 起播与媒体
 * 事件 / loader 隧道请求。级别 error > warn > info > debug;默认全开,
 * `localStorage["player-log"]="0"` 关 info/debug(warn/error 永保留)。
 */

/** 语义函数需要的流最小结构(兼容 MediaStream)。 */
interface StreamLike {
  url: string
  format?: string
  rate?: number
  quality?: string
}

const enabled = typeof localStorage === "undefined" ? true : localStorage.getItem("player-log") !== "0"

function emit(level: "debug" | "info" | "warn" | "error", phase: string, ...args: unknown[]): void {
  if (!enabled && level !== "warn" && level !== "error") return
  const prefix = `[player:${phase}]`
  switch (level) {
    case "debug":
      console.debug(prefix, ...args)
      break
    case "info":
      console.info(prefix, ...args)
      break
    case "warn":
      console.warn(prefix, ...args)
      break
    case "error":
      console.error(prefix, ...args)
      break
  }
}

/** 流摘要:域名 + format + 档位 + 截断 url,日志里复用。 */
function streamSummary(stream: StreamLike): string {
  let host = ""
  try {
    host = new URL(stream.url, "https://x.invalid").hostname
  } catch {
    host = stream.url.slice(0, 60)
  }
  const path = stream.url.length > 100 ? `…${stream.url.slice(-60)}` : stream.url
  const q = stream.rate != null ? `${stream.quality ?? stream.rate}` : ""
  return `${host} ${stream.format ?? "?"}${q ? ` ${q}` : ""} ${path}`
}

/**
 * 错误对象 → 可读文本。兼容三类:Error 实例(hls.js/flv.js 的 JS 错误)、
 * hls.js 的 ErrorData(`{type, details}` 普通对象,非 Error)、dash.js 的
 * `{message}` 对象。String(对象) 会退化成 `[object Object]`,必须显式提取。
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>
    const parts = [o.message, o.type, o.details].filter((v) => v != null).map(String)
    if (parts.length) return parts.join(" ")
  }
  return String(err)
}

/** 媒体元素事件 → (级别, 文案),级别/文案集中管理,调用处只写事件名。 */
const MEDIA_EVENT_TEXT: Record<string, { level: "debug" | "info"; text: string }> = {
  play: { level: "debug", text: "play 事件" },
  pause: { level: "debug", text: "pause 事件" },
  ended: { level: "debug", text: "ended 事件" },
  waiting: { level: "debug", text: "waiting 事件(缓冲)" },
  playing: { level: "info", text: "playing 事件(起播/恢复成功)" },
}

export const log = {
  // ── resolve:懒解析 ──────────────────────────────
  resolveStart(): void {
    emit("info", "resolve", "开始(手势内解锁 autoplay)")
  },
  resolveSuccess(count: number): void {
    emit("info", "resolve", "成功:", count, "条流")
  },
  resolveFailed(err: unknown): void {
    emit("error", "resolve", "失败:", err)
  },

  // ── select:选流 / 切档 / 引擎选择 ───────────────
  streamSelected(stream: StreamLike, headerKeys: string[]): void {
    emit("info", "select", "选中流:", streamSummary(stream), "| headers:", headerKeys.join(",") || "-")
  },
  qualitySwitched(stream: StreamLike): void {
    emit("info", "select", "切档 →", streamSummary(stream))
  },
  engineSelected(mode: "stream" | "video" | "audio" | "fallback", format?: string): void {
    const text =
      mode === "stream"
        ? `流媒体引擎(${format ?? "?"})接管`
        : mode === "video"
          ? "原生 <video> 播放"
          : mode === "audio"
            ? "原生 <audio> 播放"
            : `未知格式 ${format ?? "?"} 兜底`
    emit("debug", "engine", text)
  },

  // ── engine:流媒体引擎 ────────────────────────────
  hlsLevelLoaded(info: { live: boolean; level: number; height?: number; bitrate?: number }): void {
    const desc = info.height != null ? `${info.height}p/${Math.round((info.bitrate ?? 0) / 1000)}kbps` : `#${info.level}`
    emit("debug", "engine", "hls 播放档位", info.live ? "live" : "vod", desc)
  },
  dashManifestReady(len: number, autoPlay: boolean): void {
    emit("info", "engine", "dash: dashManifest 到达", len, "字符, autoPlay:", autoPlay)
  },
  engineError(engine: string, err: unknown, fatal = false): void {
    emit("error", "engine", `${engine} 错误:`, describeError(err), fatal ? "(fatal)" : "")
  },

  // ── play:起播 + 媒体元素事件 ────────────────────
  /** play() 调用结束(resolve 或 finally,不论成败)——成败看 playFailed/降级静音。 */
  playSettled(): void {
    emit("debug", "play", "起播调用结束")
  },
  playMutedFallback(reason: string): void {
    emit("warn", "play", `被 autoplay policy 拦(${reason}),降级静音重试`)
  },
  playFailed(err: unknown): void {
    emit("error", "play", "起播失败:", err)
  },
  mediaEvent(name: keyof typeof MEDIA_EVENT_TEXT): void {
    const entry = MEDIA_EVENT_TEXT[name]
    emit(entry.level, "play", entry.text)
  },
  mediaError(code: number | undefined, msg: string): void {
    emit("error", "play", `media error(code=${code ?? "?"})`, msg)
  },
  userRetry(): void {
    emit("info", "play", "用户重试 → 重建播放实例")
  },

  // ── loader:隧道请求错误 ─────────────────────────
  loaderHttpError(engine: string, status: number, url: string): void {
    emit("warn", "loader", `${engine} 隧道 HTTP`, status, "for", url.slice(0, 80))
  },
  loaderError(engine: string, msg: string): void {
    emit("warn", "loader", `${engine} 隧道错误:`, msg)
  },
}
