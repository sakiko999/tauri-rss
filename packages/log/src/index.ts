/** @tauri-playground/log — 域注册语义化日志(颜色 + 模板事件 + 统一开关)。 */
export type { LogLevel, LogEvent, DomainLogConfig, DomainLog } from "./core.ts"
export { createLogDomain, getLogDomain, resetLogDomains } from "./core.ts"
export { formatError } from "./format.ts"
