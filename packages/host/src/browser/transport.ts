/**
 * CDP 文本帧传输 —— 桌面(Tauri ws 隧道)与 Node(ws 包 / Bun WebSocket)的共同下界。
 *
 * CdpChannel 只认这一层：Tauri 用 invoke + Channel 把文本帧走 Rust ws 隧道，
 * Node 直接用 ws 连接。base64/UTF-8 编解码属于各自的 connector，不属于 channel
 * —— 那是「隧道怎么搬字节」的实现细节，与 CDP 的消息配对/超时无关。
 */
export interface CdpTransportHandlers {
  /** 收到一条完整文本帧（CDP 的 JSON 消息）。 */
  onText(text: string): void
  /** 连接断开（只投递一次；channel 负责作废 pending 并允许下次重连）。 */
  onClose(reason: string): void
}

export interface CdpTransport {
  /** 发一条文本帧；失败 reject（channel 会把错误归到对应命令）。 */
  send(text: string): Promise<void>
  /** 关闭底层连接（幂等）。 */
  close(): Promise<void>
}

export interface CdpConnector {
  /** 连上 `wsUrl` 并交出文本帧传输（Tauri: invoke ws_connect；Node: ws 连接）。 */
  connect(wsUrl: string, handlers: CdpTransportHandlers): Promise<CdpTransport>
}
