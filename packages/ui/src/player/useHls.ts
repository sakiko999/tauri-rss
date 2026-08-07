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
import type { MediaStream } from "@tauri-playground/core"

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

export function useMediaStream({
  stream,
  videoRef,
  onError,
}: {
  /** 当前要播的 m3u8/flv 流;null / 非流媒体时 no-op。 */
  stream: MediaStream | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  onError?: (err: unknown) => void
}): void {
  const hlsRef = useRef<Hls | null>(null)
  const flvRef = useRef<flvjs.Player | null>(null)
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
      if (stream.headers) {
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
      // 静音起播:先确保 muted(浏览器 autoplay policy 允许 muted 自动播放),
      // 再在 MANIFEST_PARSED + canplay 后 play(数据真正就绪时才调)。
      video.muted = true
      const attemptPlay = () => {
        if (!video.isConnected) return
        const p = video.play() as Promise<void> | void
        if (p && typeof p.catch === "function") {
          p.catch((e: unknown) => {
            console.warn("[useMediaStream] hls autoplay 失败:", e)
            report?.(e)
          })
        }
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
      // 静音起播(浏览器自动播放策略要求 muted)。
      video.muted = true
      // 延迟 play:StrictMode 下第一个挂载的 video 会被立即移除,此时 play() 会
      // 报 "media was removed"。延迟到下一个 tick 并检查 isConnected,移除的跳过。
      const raf = requestAnimationFrame(() => {
        if (!video.isConnected) return
        const p = flv.play() as Promise<void> | void
        if (p && typeof p.catch === "function") p.catch((e: unknown) => report?.(e))
      })
      // 记录 raf 供 cleanup 取消。
      pendingRaf.current = raf
      return cleanup
    }

    return cleanup
  }, [stream, videoRef])

  // 组件卸载时兜底销毁(独立 effect,不依赖 stream 状态)。
  useEffect(() => {
    return () => {
      if (pendingRaf.current !== null) {
        cancelAnimationFrame(pendingRaf.current)
        pendingRaf.current = null
      }
      hlsRef.current?.destroy()
      flvRef.current?.destroy()
      hlsRef.current = null
      flvRef.current = null
    }
  }, [])
}
