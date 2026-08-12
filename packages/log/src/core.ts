/**
 * core — @tauri-playground/log 核心:域注册 + 模板事件 + 颜色输出。
 *
 * 每个模块 `createLogDomain(name, config)` 注册自己的日志域:
 *   - name → 前缀 `[${name}]`(如 "player:resolve" → `[player:resolve]`);
 *   - color(devtools %c CSS 色)/ansi(终端 256 色)→ 模块辨识度;
 *   - events → 模板事件表,key 成语义方法,ctx 类型由 text 函数参数推断。
 *
 * 域对象 = 模板语义方法(按 events key 生成)+ 自由级别方法(log/debug/info/warn/error)。
 * 幂等:同名重复注册**返回同一引用**,合并/覆盖 events、应用新颜色(HMR 友好)——域方法
 * 每次调用动态读 registry 最新 entry,新模板/新颜色/新增 key 即时生效。
 * 开关:localStorage["log"]="0" 全局关 info/debug;`log:<name>`="0" 按域关;
 *       legacyKey 兼容旧 key(如 "player-log")。warn/error 永保留。
 * 环境:浏览器(WebView devtools)走 %c CSS 着色;node/bun 终端走 ANSI 256 色。
 */
import { isBrowser, readSwitch } from "./env.ts"

export type LogLevel = "debug" | "info" | "warn" | "error"

/** 单个模板事件:级别 + 文案(静态字符串或由 ctx 生成的函数)。 */
export interface LogEvent<T> {
  level: LogLevel
  /** 静态文案,或 (ctx) => 文案;函数参数类型同时约束语义方法入参。 */
  text: string | ((ctx: T) => string)
}

/** createLogDomain 的域配置。 */
export interface DomainLogConfig<E extends Record<string, LogEvent<any>>> {
  /** devtools %c CSS 颜色(hex)。 */
  color: string
  /** 终端 ANSI 256 色索引(`\x1b[38;5;N`)。 */
  ansi: number
  /** 旧开关兼容:如 "player-log"/"host-log";未设置则不查。 */
  legacyKey?: string
  /** 模板事件表。⚠️ key 勿与 log/debug/info/warn/error 同名(会被自由方法覆盖)。 */
  events?: E
}

/**
 * 域日志对象 = 模板事件语义方法(ctx 类型由 text 函数参数推断)+ 自由级别方法。
 * text 为函数时: `(ctx: C, ...args) => void`;text 为字符串时: `(...args) => void`。
 */
export type DomainLog<E extends Record<string, LogEvent<any>>> = {
  [K in keyof E]: E[K]["text"] extends (ctx: infer C) => string
    ? (ctx: C, ...args: unknown[]) => void
    : (...args: unknown[]) => void
} & {
  log(level: LogLevel, msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

interface RegistryEntry {
  name: string
  color: string
  ansi: number
  legacyKey?: string
  events?: Record<string, LogEvent<any>>
  domain: DomainLog<Record<string, LogEvent<any>>>
}

const registry = new Map<string, RegistryEntry>()

function consoleFn(level: LogLevel): (msg?: unknown, ...args: unknown[]) => void {
  switch (level) {
    case "debug":
      return console.debug
    case "info":
      return console.info
    case "warn":
      return console.warn
    case "error":
      return console.error
  }
}

function emit(entry: RegistryEntry, level: LogLevel, msg: string, args: unknown[]): void {
  // warn/error 永保留;info/debug 受开关控制。
  if (level !== "warn" && level !== "error" && readSwitch(entry.name, entry.legacyKey) === "0") return
  const prefix = `[${entry.name}]`
  const fn = consoleFn(level)
  if (isBrowser()) {
    // 只有前缀在格式串里(我们控制的文本),msg/args 作普通参数 —— 用户数据里的 % 不会被当格式符。
    fn(`%c${prefix}`, `color:${entry.color};font-weight:600`, msg, ...args)
  } else {
    // 终端:前缀域色;warn/error 消息体额外黄/红(与 devtools 原生配色对齐)。
    const pre = `\x1b[38;5;${entry.ansi}m${prefix}\x1b[0m`
    const body = level === "error" ? `\x1b[31m${msg}\x1b[0m` : level === "warn" ? `\x1b[33m${msg}\x1b[0m` : msg
    fn(pre, body, ...args)
  }
}

/** 模板事件方法:每次调用动态读 registry 最新模板(幂等更新生效)。 */
function makeEventMethod(name: string, key: string): (ctx: unknown, ...args: unknown[]) => void {
  return (ctx, ...args) => {
    const e = registry.get(name)
    const ev = e?.events?.[key]
    if (!e || !ev) return
    const text = typeof ev.text === "function" ? ev.text(ctx) : ev.text
    emit(e, ev.level, text, args)
  }
}

/** 自由级别方法:动态读 registry(幂等更新生效)。 */
function makeFreeMethod(name: string, level: LogLevel): (msg: string, ...args: unknown[]) => void {
  return (msg, ...args) => {
    const e = registry.get(name)
    if (e) emit(e, level, msg, args)
  }
}

function buildDomain(name: string): DomainLog<Record<string, LogEvent<any>>> {
  const domain: Record<string, unknown> = {
    log: (level: LogLevel, msg: string, ...args: unknown[]) => {
      const e = registry.get(name)
      if (e) emit(e, level, msg, args)
    },
    debug: makeFreeMethod(name, "debug"),
    info: makeFreeMethod(name, "info"),
    warn: makeFreeMethod(name, "warn"),
    error: makeFreeMethod(name, "error"),
  }
  // 模板方法集 = 当前注册 events 的 key(buildDomain 前 registry 已 set)。
  for (const key of Object.keys(registry.get(name)?.events ?? {})) {
    domain[key] = makeEventMethod(name, key)
  }
  return domain as DomainLog<Record<string, LogEvent<any>>>
}

/**
 * 注册(或幂等复用)一个日志域。同名重复调用:
 * 返回**同一引用**,合并/覆盖 events、应用新 color/ansi,legacyKey 保留首建;
 * HMR 新增模板 key 自动补方法。调用方持有的旧引用立即看到新模板/新颜色。
 */
export function createLogDomain<E extends Record<string, LogEvent<any>>>(
  name: string,
  config: DomainLogConfig<E>,
): DomainLog<E> {
  const prev = registry.get(name)
  const events = { ...prev?.events, ...config.events }
  if (prev) {
    prev.color = config.color ?? prev.color
    prev.ansi = config.ansi ?? prev.ansi
    prev.events = events
    // HMR 新增模板 key:动态补方法。
    const dom = prev.domain as Record<string, unknown>
    for (const key of Object.keys(events)) {
      if (typeof dom[key] === "function") continue
      dom[key] = makeEventMethod(name, key)
    }
    return prev.domain as DomainLog<E>
  }
  // 先注册再 build(buildDomain 需读 registry 拿 events key)。
  const entry: RegistryEntry = {
    name,
    color: config.color,
    ansi: config.ansi,
    legacyKey: config.legacyKey,
    events,
    domain: {} as DomainLog<Record<string, LogEvent<any>>>,
  }
  registry.set(name, entry)
  entry.domain = buildDomain(name)
  return entry.domain as DomainLog<E>
}

/** 读已注册域(未注册返回 undefined;返回同一实例)。 */
export function getLogDomain(name: string): DomainLog<Record<string, LogEvent<any>>> | undefined {
  return registry.get(name)?.domain
}

/** 清空 registry(测试用)。 */
export function resetLogDomains(): void {
  registry.clear()
}
