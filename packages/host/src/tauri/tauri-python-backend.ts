/**
 * TauriPythonBackend — PythonBackend 实现,通过 Rust `xhs_sign` command
 * (rustpython-xhs 嵌入)生成小红书签名 headers。桌面生产 Python 后端。
 */
import { invoke } from "@tauri-apps/api/core"

/** rustpython-xhs 返回的 headers(serde rename 后即真实 header 名)。 */
interface XhsSignHeadersPayload {
  "x-s": string
  "x-s-common": string
  "x-t": string
  "x-b3-traceid": string
  "x-xray-traceid": string
  "x-mns": string
  "xy-direction": string
}

export class TauriPythonBackend implements PythonBackend {
  async signXhs(
    uri: string,
    params: Record<string, string>,
    cookie: string,
  ): Promise<Record<string, string>> {
    const h = await invoke<XhsSignHeadersPayload>("xhs_sign", { uri, params, cookie })
    // 具名 interface 缺 index signature,展开成普通 Record。
    return Object.fromEntries(Object.entries(h))
  }
}
