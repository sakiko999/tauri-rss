/**
 * injectNodeHost — 注入 Node 环境宿主能力。
 * 真实网络(node fetch)+ new Function + 内存存储。供 example / 测试。
 * ws:nodeWsBackend(ws 包带 header)——example 测 douyin 弹幕握手需要。
 */
import { initAppHost, setHostCaps } from "../runtime.ts"
import { nodeBackend } from "./node-backend.ts"
import { nodeJsBackend } from "./node-js.ts"
import { memStorage } from "./mem-storage.ts"
import { nodeWsBackend } from "./node-ws.ts"

export function injectNodeHost(): void {
  initAppHost()
  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage: memStorage(),
    ws: nodeWsBackend(),
  })
}
