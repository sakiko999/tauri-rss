/** Node 宿主子路径入口 —— CLI / example 只加载 node 后端,不连带 Tauri 实现。 */
export { injectNodeHost } from "./inject-node.ts"
export { nodeBackend } from "./node-backend.ts"
export { nodeCdpConnector } from "./cdp-connector.ts"
export {
  createSidecarBrowser,
  defaultSidecarProfileDir,
  locateSidecarBinary,
} from "./browser-sidecar.ts"
export { nodeWsBackend } from "./node-ws.ts"
export { nodeJsBackend } from "./node-js.ts"
export { memStorage } from "./mem-storage.ts"
