/**
 * Node/Bun 的 CDP 文本帧传输 —— `ws` 包。
 *
 * 不复用 `nodeWsBackend`：那条路径是弹幕二进制帧（Uint8Array），CDP 是 JSON 文本帧，
 * 且需要明确区分 binary/text（二进制帧直接忽略）。Node 的 `ws` 默认不发 Origin，
 * 所以 WebView2 不需要 `--remote-allow-origins=*`。
 */
import WebSocket, { type RawData } from "ws"

import type { CdpConnector, CdpTransport, CdpTransportHandlers } from "../browser/transport.ts"

/** RawData → utf8 文本（ws 的 message 可能是 Buffer / ArrayBuffer / Buffer[]）。 */
function decodeText(data: RawData): string {
  if (typeof data === "string") return data
  if (Buffer.isBuffer(data)) return data.toString("utf8")
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  return Buffer.from(data).toString("utf8")
}

export function nodeCdpConnector(): CdpConnector {
  return {
    async connect(wsUrl: string, handlers: CdpTransportHandlers): Promise<CdpTransport> {
      const ws = new WebSocket(wsUrl, {
        // CDP 是大量小 JSON 帧；压缩只会增加 CPU 与延迟。
        perMessageDeflate: false,
        handshakeTimeout: 10_000,
        maxPayload: 64 * 1024 * 1024,
      })

      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          cleanup()
          resolve()
        }
        const onError = (e: Error) => {
          cleanup()
          reject(e)
        }
        const cleanup = () => {
          ws.off("open", onOpen)
          ws.off("error", onError)
        }
        ws.once("open", onOpen)
        ws.once("error", onError)
      })

      let closed = false
      const closeOnce = (reason: string) => {
        if (closed) return
        closed = true
        handlers.onClose(reason)
      }
      ws.on("message", (data, isBinary) => {
        if (isBinary) return // CDP 只用文本帧
        handlers.onText(decodeText(data))
      })
      ws.on("close", (code, reason) => closeOnce(`CDP 连接已断开(close ${code} ${reason.toString()})`))
      ws.on("error", (e) => closeOnce(`CDP 连接错误: ${e.message}`))

      return {
        send(text: string): Promise<void> {
          return new Promise<void>((resolve, reject) => {
            ws.send(text, (err) => (err ? reject(err) : resolve()))
          })
        },
        close(): Promise<void> {
          try {
            ws.close()
          } catch {
            /* 已关闭 */
          }
          return Promise.resolve()
        },
      }
    },
  }
}
