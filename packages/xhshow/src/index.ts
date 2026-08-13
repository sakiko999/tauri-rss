/**
 * @tauri-playground/xhshow —— 小红书签名 xhshow-js 的 fork 适配包装。
 *
 * vendor/xhshow.js 是 xhshow-js 的 MIT fork(MIT 允许修改,已保留原版权声明):
 * 把顶层 `import from "crypto"` 改为包内 crypto-shim(纯 JS crypto-js.MD5)→ **node/
 * browser 同一份源码可跑**,消费方(crawler)只 import 本包,不感知补丁、不需要 vite
 * alias。全局 Buffer(xhshow 仍引用)由本模块加载时注入(browser);node 用原生跳过。
 *
 * package.json exports 带 browser/default 双条件(browser 供 Vite 打包,default 供
 * Node/Bun 测试),当前指向同一份——为将来差异预留扩展点。
 */
import "./buffer-polyfill.ts"
export { Client, PUBLIC_USER_AGENT, generateA1 } from "../vendor/xhshow.js"
export type { CookieDict, RequestPayload } from "../vendor/xhshow.js"
