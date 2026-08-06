/**
 * injectNodeHost — 注入 Node 环境宿主能力。
 * 真实网络(node fetch)+ new Function + 内存存储。供 example / 测试。
 */
import { initAppHost, setHostCaps } from "../runtime.ts"
import { nodeBackend } from "./node-backend.ts"
import { nodeJsBackend } from "./node-js.ts"
import { memStorage } from "./mem-storage.ts"

export function injectNodeHost(): void {
  initAppHost()
  setHostCaps({
    http: nodeBackend(),
    js: nodeJsBackend(),
    storage: memStorage(),
  })
}
