/**
 * useMediaStream —— hls.js / flv.js 生命周期 hook(一个 hook 管两种流)。
 *
 * 给 <video> 挂 m3u8(HLS)或 http-flv 播放:
 *   - HLS:能原生播(Safari/iOS)→ video.src;否则 Hls.js attach。
 *   - FLV:浏览器无原生支持 → flv.js(flvjs.isSupported 时),MSE 播放。
 *
 * StrictMode 双挂载安全:effect 始终返回 cleanup(销毁当前实例),
 * 重跑时先销毁旧实例再建新。
 */
import { useEffect, useRef } from "react"
import Hls from "hls.js"
import flvjs from "flv.js"
import * as dashjs from "dashjs"
import type { MediaStream } from "@tauri-playground/core"
import { HlsHostLoader } from "./hlsHostLoader.ts"
import { DashHostLoader } from "./dashHostLoader.ts"
import { attemptPlayWithMuteFallback } from "./attemptPlay.ts"

/** 是否为 m3u8/HLS 流。 */
export function isHlsStream(stream: MediaStream): boolean {
  return stream.format === "hls" || /\.m3u8(\?|#|$)/i.test(stream.url)
}

/** 是否为 http-flv 流(douyu 等;真 rtmp:// 协议 flv.js 也播不了)。 */
export function isFlvStream(stream: MediaStream): boolean {
  const f = stream.format?.toLowerCase()
  const isHttpFlv = /^https?:\/\//i.test(stream.url) && /\.flv(\?|#|$)/i.test(stream.url)
  return f === "flv" && isHttpFlv
}

/** 是否为 DASH 流(B 站视频音视频分离,带 dashManifest 拼的 MPD → dash.js 合成播放)。 */
export function isDashStream(stream: MediaStream): boolean {
  return stream.format === "dash"
}

export function useMediaStream({
  stream,
  videoRef,
  onError,
  autoPlay = true,
  retryKey = 0,
}: {
  /** 当前要播的 m3u8/flv 流;null / 非流媒体时 no-op。 */
  stream: MediaStream | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  onError?: (err: unknown) => void
  /** 是否自动播放:true 带声起播(需 unlockAudioPlayback 已解锁),被拦降级静音。 */
  autoPlay?: boolean
  /** 变化时强制销毁旧实例重建(错误重试)。 */
  retryKey?: number
}): void {
  const hlsRef = useRef<Hls | null>(null)
  const flvRef = useRef<flvjs.Player | null>(null)
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null)
  const dashUrlRef = useRef<string | null>(null)
  const pendingRaf = useRef<number | null>(null)
  // onError 用 ref 持有:调用方每次渲染传新函数,但 effect 不该因它重跑
  // (否则 hls.js/flv.js 反复 destroy/重建,直播流被中断)。
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!stream) return
    const video = videoRef.current
    if (!video) return
    const report = onErrorRef.current
    // 取消上一步残留的 raf(StrictMode 双挂载时第一个的 raf 不该再 play)。
    if (pendingRaf.current !== null) {
      cancelAnimationFrame(pendingRaf.current)
      pendingRaf.current = null
    }

    const cleanup = () => {
      if (pendingRaf.current !== null) {
        cancelAnimationFrame(pendingRaf.current)
        pendingRaf.current = null
      }
      flvRef.current?.destroy()
      flvRef.current = null
      hlsRef.current?.destroy()
      hlsRef.current = null
      dashRef.current?.reset()
      dashRef.current = null
      // blob URL 不在 effect cleanup revoke——dash.js 播放中会 refresh MPD(manifest
      // refresh / load-error 重试),过早 revoke 会 GET blob 404。只在组件卸载兜底 effect revoke。
    }

    // HLS 分支
    if (isHlsStream(stream)) {
      // 桌面 Chromium/WebView2 的 canPlayType 对 m3u8 也返回非空,但实际不支持原生
      // HLS(只有 iOS Safari 支持)。所以 **hls.js 优先**,canPlayType 仅作 iOS 兜底。
      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = stream.url
        } else {
          report?.(new Error("当前环境不支持 HLS 播放"))
        }
        return cleanup
      }
      // 标准模式:bilibili 直播本身已是 LL-HLS(EXT-X-VERSION:7 + fMP4),
      // 再开 hls.js 的 lowLatencyMode 双重低延迟可能不兼容。
      const hls = new Hls()
      hlsRef.current = hls
      // 档位策略:video/live 都锁最高档起播,不走 ABR 自动降档。
      // 原因:宿主隧道(Rust reqwest + base64)的固定开销让 ABR 带宽估算严重失真
      // ——1080p 4561kbps 的流测得仅 ~1Mbps,ABR 会骤降 144p 且永不回升。
      // `currentLevel = max` 是手动档位模式,ABR 完全关闭,恒定最高清晰度。
      // 档位选择后续在播放器开放,用户手动选(当前默认最高档)。
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const max = hls.levels.length - 1
        if (max < 0) return
        hls.currentLevel = max
      })
      // YouTube HLS(googlevideo.com)无 CORS 头,hls.js 默认 XHR 被浏览器拦。
      // 走 HlsHostLoader(appHost.http:Rust reqwest 隧道无 CORS / 浏览器 fetch)。
      if (/googlevideo\.com/i.test(stream.url)) {
        hls.config.loader = HlsHostLoader
      } else if (stream.headers) {
        hls.config.xhrSetup = (xhr) => {
          for (const [k, v] of Object.entries(stream.headers!)) {
            // 浏览器禁止 JS 设置 forbidden headers(referer/user-agent 等),
            // 设置会被忽略并 console 报 Refused to set unsafe header。
            // 跳过它们——浏览器自动带 referer/UA,无需手动设。
            if (/^(referer|user-agent|origin|cookie|host)$/i.test(k)) continue
            try {
              xhr.setRequestHeader(k, v)
            } catch {
              // 个别环境仍拒绝,忽略即可。
            }
          }
        }
      }
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) report?.(data)
      })
      // 流信息:LEVEL_LOADED 打印实际播放档位(高度/码率),排查清晰度来源。
      hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => {
        const lvl = hls.levels[d.level]
        console.debug(
          "[hls] 播放档位",
          d.details?.live ? "live" : "vod",
          lvl ? `${lvl.height ?? "?"}p/${Math.round((lvl.bitrate ?? 0) / 1000)}kbps` : `#${d.level}`,
        )
      })
      // 起播:autoPlay=true 带声(PlayableMedia 点击时 unlockAudioPlayback 已解除
      // autoplay policy),被拦降级静音重试。在 MANIFEST_PARSED + canplay 后 play
      // (数据真正就绪时才调)。
      video.muted = !autoPlay
      const attemptPlay = () => {
        if (!video.isConnected) return
        attemptPlayWithMuteFallback(video, () => video.play(), { autoPlay, onFail: report })
      }
      hls.on(Hls.Events.MANIFEST_PARSED, attemptPlay)
      // 兜底:分段缓冲到可播时再试一次(部分 LL-HLS 时序 MANIFEST_PARSED 早于数据)。
      video.addEventListener("canplay", attemptPlay, { once: true })
      hls.loadSource(stream.url)
      hls.attachMedia(video)
      return cleanup
    }

    // FLV 分支(仅 http-flv;rtmp:// 播不了)。
    if (isFlvStream(stream)) {
      if (!flvjs.isSupported()) {
        report?.(new Error("当前环境不支持 FLV 播放"))
        return cleanup
      }
      const flv = flvjs.createPlayer(
        { type: "flv", url: stream.url, isLive: true },
        // flv.js 不直接支持自定义 header;referer 靠页面本身,UA 走默认。
      )
      flvRef.current = flv
      flv.on(flvjs.Events.ERROR, (_t, _d, e) => report?.(e))
      flv.attachMediaElement(video)
      flv.load()
      // 起播:autoPlay=true 带声(已 unlock),被拦降级静音。
      video.muted = !autoPlay
      // 延迟 play:StrictMode 下第一个挂载的 video 会被立即移除,此时 play() 会
      // 报 "media was removed"。延迟到下一个 tick 并检查 isConnected,移除的跳过。
      const raf = requestAnimationFrame(() => {
        if (!video.isConnected) return
        attemptPlayWithMuteFallback(video, () => flv.play(), { autoPlay, onFail: report })
      })
      // 记录 raf 供 cleanup 取消。
      pendingRaf.current = raf
      return cleanup
    }

    // DASH 分支(B站视频:音视频分离,MPD 由 crawler 拼好存 dashManifest)。
    // MPD 生成 blob URL 喂 attachSource——dash.js 走 fetch 解析 XML,分片 BaseURL
    // 是绝对直链,直接请求真实 CDN。dash.js 双 SourceBuffer 同步音视频(等价 B 站官方)。
    if (isDashStream(stream) && stream.dashManifest) {
      console.info("[dash] dashManifest 到达:", stream.dashManifest.length, "字符, autoPlay:", autoPlay)
      const blob = new Blob([stream.dashManifest], { type: "application/dash+xml" })
      const mpdUrl = URL.createObjectURL(blob)
      dashUrlRef.current = mpdUrl
      const player = dashjs.MediaPlayer().create()
      dashRef.current = player
      player.on(dashjs.MediaPlayer.events.ERROR, (e: unknown) => {
        const msg = (e as { message?: string })?.message
        console.warn("[dash] ERROR:", msg ?? e)
        report?.(msg ? new Error(`dash: ${msg}`) : new Error(`dash 播放错误: ${String(e)}`))
      })
      player.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, () => console.info("[dash] MANIFEST_LOADED"))
      player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => console.info("[dash] STREAM_INITIALIZED"))
      player.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, () => console.info("[dash] PLAYBACK_STARTED"))
      player.initialize()
      // B 站分片(mcdn)/ YouTube 分片(googlevideo)无 CORS 头 → 替换 HTTPLoader
      // 走 appHost.http 隧道(无 CORS)。blob MPD 由 DashHostLoader 内部 fetch 原样拉;
      // 分片走 Rust/浏览器宿主,并透传 stream.headers(referer/UA)。
      player.extend("HTTPLoader", () => DashHostLoader({ headers: stream.headers }), true)
      // 锁最高档:MPD 已按档单 Representation,关 ABR 防止带宽估算降档(走隧道估算失真)。
      player.updateSettings({
        streaming: {
          buffer: { fastSwitchEnabled: true },
          abr: { autoSwitchBitrate: { video: false, audio: false } },
        },
      })
      player.attachView(video)
      player.attachSource(mpdUrl)
      video.muted = !autoPlay
      const raf = requestAnimationFrame(() => {
        if (!video.isConnected) return
        attemptPlayWithMuteFallback(video, () => video.play(), { autoPlay, onFail: report })
      })
      pendingRaf.current = raf
      return cleanup
    }

    return cleanup
  }, [stream, videoRef, retryKey])

  // 组件卸载时兜底销毁(独立 effect,不依赖 stream 状态)。
  useEffect(() => {
    return () => {
      if (pendingRaf.current !== null) {
        cancelAnimationFrame(pendingRaf.current)
        pendingRaf.current = null
      }
      hlsRef.current?.destroy()
      flvRef.current?.destroy()
      dashRef.current?.reset()
      hlsRef.current = null
      flvRef.current = null
      dashRef.current = null
      if (dashUrlRef.current) {
        URL.revokeObjectURL(dashUrlRef.current)
        dashUrlRef.current = null
      }
    }
  }, [])
}
