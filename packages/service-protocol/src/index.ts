/**
 * 数据服务协议 —— desktop / CLI / rss --service 共用的类型与常量。
 *
 * v1 只含阶段 0 需要的握手/健康/快照/事件信封；命令与 job 的类型随阶段 1 增加。
 * 约定：HTTP/WS 只绑 127.0.0.1；token 走 Authorization 或 WS 首帧，绝不进 URL。
 */

/** 协议整数：不兼容变更才 +1；同版本内只做加法。 */
export const SERVICE_PROTOCOL = 1
export const SERVICE_VERSION = "0.1.0"
export const ENDPOINT_SCHEMA = "amoeba-service/1"

/** endpoint.json 的内容（owner token 不在其中；client token 单独下发）。 */
export interface EndpointInfo {
  schema: typeof ENDPOINT_SCHEMA
  pid: number
  bootId: string
  port: number
  protocol: number
  serviceVersion: string
  dataDir: string
  dbFile: string
  profileDir: string
  startedAt: number
  parentPid?: number
}

export interface HelloResponse {
  protocol: number
  minClientProtocol: number
  serviceVersion: string
  bootId: string
  pid: number
  rev: number
  features: string[]
}

export interface HealthResponse {
  ok: boolean
  uptimeMs: number
  jobs: number
  rev: number
  bootId: string
}

export interface RpcRequest {
  method: string
  params?: unknown
  /** 幂等键；写命令必带。 */
  opId?: string
}

export interface RpcResponse {
  ok: boolean
  result?: unknown
  error?: { kind: string; message: string; retryable?: boolean }
  rev?: number
}

/** WS 事件信封。合帧后的提交 rev 连续；caller-only 帧不占 rev。 */
export interface ServiceEvent<T = unknown> {
  type: string
  rev?: number
  data?: T
}

/** 认证失败的统一形状（HTTP 401 / WS close）。 */
export interface AuthError {
  kind: "unauthorized"
  message: string
}
