/**
 * BrowserHost — a `PlatformHost` built only from web-standard APIs
 * (`fetch`, `localStorage`, `console`, `Date.now`).
 *
 * Use cases:
 *   - Development / smoke tests.
 *   - Desktop webview where the host does NOT inject a native fetch.
 *
 * ⚠️ CORS limitation: `fetch()` in a browser context honors CORS. RSS feeds
 * and live-platform APIs do not send CORS headers, so direct fetches here will
 * fail. For production desktop/mobile, inject a host whose `http` backend
 * bypasses CORS (native fetch on desktop; `@capacitor/http` on mobile). This
 * host is fine for CORS-permitted feeds only.
 *
 * Storage is namespaced by `keyPrefix` so multiple data-layer instances can
 * coexist in one origin.
 */
import type {
  HttpBackend,
  HttpRequest,
  HttpResponse,
  Logger,
  PlatformHost,
  StorageBackend,
} from "../types/platform.ts"

export interface BrowserHostOptions {
  /** Storage key namespace. Defaults to "media-sub:". */
  keyPrefix?: string
  /** Inject a logger; defaults to `console`. */
  logger?: Logger
}

/** HTTP backend backed by the global `fetch`. */
export class FetchHttpBackend implements HttpBackend {
  async request(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController()
    const timeout = req.timeoutMs ?? 20000
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(req.url, {
        method: req.method ?? "GET",
        headers: req.headers,
        body: req.body as BodyInit | undefined,
        signal: controller.signal,
      })
      const body: string | Uint8Array =
        req.responseType === "arraybuffer"
          ? new Uint8Array(await res.arrayBuffer())
          : await res.text()
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        headers[k] = v
      })
      // Preserve ALL Set-Cookie values (forEach collapses multiple into one).
      // `getSetCookie()` is standard in Bun/modern browsers and returns an array.
      const setCookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      if (setCookies && setCookies.length) {
        headers["set-cookie"] = setCookies.join("\n")
      }
      return { status: res.status, headers, body }
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Storage backend. Prefers `localStorage` (browser/webview); falls back to an
 * in-memory `Map` when `localStorage` is absent (Bun/Node non-browser host).
 * This keeps the "default dev host" usable in `bun` scripts/tests without a
 * real DOM, while preserving persistence inside an actual webview.
 */
export class LocalStorageBackend implements StorageBackend {
  private readonly prefix: string
  private readonly mem = new Map<string, string>()
  private readonly useMem: boolean

  constructor(prefix: string = "media-sub:") {
    this.prefix = prefix
    this.useMem = typeof localStorage === "undefined"
  }

  private key(k: string): string {
    return `${this.prefix}${k}`
  }

  async get(key: string): Promise<string | null> {
    const k = this.key(key)
    if (this.useMem) return this.mem.get(k) ?? null
    return localStorage.getItem(k)
  }
  async set(key: string, value: string): Promise<void> {
    const k = this.key(key)
    if (this.useMem) this.mem.set(k, value)
    else localStorage.setItem(k, value)
  }
  async delete(key: string): Promise<void> {
    const k = this.key(key)
    if (this.useMem) this.mem.delete(k)
    else localStorage.removeItem(k)
  }
  async keys(prefix?: string): Promise<string[]> {
    const match = this.key(prefix ?? "")
    if (this.useMem) {
      return [...this.mem.keys()].filter((k) => k.startsWith(match)).map((k) => k.slice(this.prefix.length))
    }
    const out: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k !== null && k.startsWith(match)) out.push(k.slice(this.prefix.length))
    }
    return out
  }
}

/** Default logger: routes to `console`. */
export class ConsoleLogger implements Logger {
  log(level: "debug" | "info" | "warn" | "error", msg: string, ctx?: Record<string, unknown>): void {
    const fn =
      level === "error"
        ? console.error
        : level === "warn"
          ? console.warn
          : level === "debug"
            ? console.debug
            : console.info
    if (ctx) fn(msg, ctx)
    else fn(msg)
  }
}

/**
 * JS backend using `new Function` / indirect `eval`. Runs in any JS engine.
 * ⚠️ CSP: a strict Content-Security-Policy that forbids `unsafe-eval` blocks
 * this. Production desktop/mobile hosts should inject a node:vm/Capacitor
 * backend; this default is for dev/tests where CSP is relaxed.
 *
 * `call` loads the blob into a function scope, calls the named fn, and
 * JSON-round-trips the result so it's plain data crossing the boundary.
 */
export class FunctionJsBackend {
  eval(code: string): unknown {
    const fn = new Function(`${code}; return undefined;`) as () => unknown
    return fn()
  }

  call(code: string, fn: string, args: (string | number)[]): unknown {
    const argsLiteral = args
      .map((a) => (typeof a === "string" ? JSON.stringify(a) : String(a)))
      .join(",")
    const wrapper = new Function(
      `${code}; return ${fn}(${argsLiteral});`,
    ) as () => unknown
    return wrapper()
  }
}

export function createBrowserHost(options: BrowserHostOptions = {}): PlatformHost {
  return {
    http: new FetchHttpBackend(),
    storage: new LocalStorageBackend(options.keyPrefix),
    js: new FunctionJsBackend(),
    log: options.logger ?? new ConsoleLogger(),
    now: () => Date.now(),
  }
}
