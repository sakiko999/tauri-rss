/**
 * signature —— YouTube base.js 的 n 参数(节流)解密。
 *
 * HTML5 client 的流 URL 带 `n=xxx`(节流混淆参数)。不解 n → 限速 ~50KB/s 或 403。
 * 解密步骤(参照 NewPipe 的 YoutubeThrottlingParameterUtils + YoutubeSignatureUtils):
 *   1. 从 URL 提取 `n=xxx`
 *   2. 挖 n 解密函数名(8 个正则候选)
 *   3. 挖函数体(lexer 匹配到闭合大括号;失败用正则)
 *   4. fixup:删掉 early-return(函数依赖函数外定义,单独跑会误返)
 *   5. host.js 执行解密函数 → 替换回 URL
 *
 * base.js 缓存:player 文件大(~1MB)且函数提取慢,缓存一次(带签名时间戳校验)。
 */
import { now } from "../../host.ts"

/** 缓存:player js URL → { code, fetchedAt, key },避免重复下载。 */
let playerCodeCache: { url: string; code: string; fetchedAt: number } | null = null

const PLAYER_JS_URL_RE =
  /"jsUrl"\s*:\s*"((?:\/[^"\/\\]+\/|)(?:[^"\\]+\/)?(?:player\/)?(?:[^"\\]+?\/)?base(?:\.js)?(?:\?[^"\\]*)?)"/i

/** 从 playerResponse 或 watch 页 HTML 拿 base.js URL。 */
function extractPlayerJsUrl(html: string): string | null {
  const m = html.match(PLAYER_JS_URL_RE)
  if (!m) return null
  const path = m[1].replace(/\\\//g, "/").replace(/\\\u002F/g, "/")
  return path.startsWith("http") ? path : `https://www.youtube.com${path}`
}

async function fetchText(url: string): Promise<string> {
  const res = await globalThis.appHost.http.request({ url, method: "GET", responseType: "text" })
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${url}`)
  return typeof res.body === "string" ? res.body : String(res.body)
}

/** 拿 base.js(带缓存;URL 变化时重新下载)。 */
async function getPlayerCode(playerJsUrl: string): Promise<string> {
  if (playerCodeCache && playerCodeCache.url === playerJsUrl) {
    return playerCodeCache.code
  }
  const code = await fetchText(playerJsUrl)
  playerCodeCache = { url: playerJsUrl, code, fetchedAt: now() }
  return code
}

/** 从 URL 提取 n 参数;无则 null。 */
export function hasThrottlingParam(url: string): boolean {
  return url.includes("&n=") || url.includes("?n=")
}

function extractNParam(url: string): string | null {
  const m = url.match(/[&?]n=([^&]+)/)
  return m?.[1] ?? null
}

// ── n 解密函数名提取(8 个正则,NewPipe 同款)───────────────────────
// ⚠️ 全用正则字面量(/.../),字符类直接内联,不用字符串/模板拼接——
//    因为 Bun 对字符串 `\(` / 模板 `` `\\(` `` 都会丢反斜杠(未知转义),
//    只有字面量由引擎原生解析转义才可靠。
// 逐条对照 NewPipe YoutubeThrottlingParameterUtils.DEOBFUSCATION_FUNCTION_NAME_REGEXES。
const NAME_REGEXES: RegExp[] = [
  // 1. m85=function( ... return Y[45]
  /([A-Za-z0-9_\$]{2,})=function.*return [A-Z]\[\d+\]/,
  // 2. a.D&&(b="nn"[+a.D],WL(a),c=a.j[b]||null)&&(c=SDa[0](c),a.set(b,c),SDa.length||Wma("")
  /[a-zA-Z0-9$_]="nn"\[\+[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+\([a-zA-Z0-9$_]+\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+\[[a-zA-Z0-9$_]+]\|\|null\)&&\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)\[(\d+)]/,
  // 3. ...SDa.length||Wma("")
  /[a-zA-Z0-9$_]="nn"\[\+[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+\([a-zA-Z0-9$_]+\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+\[[a-zA-Z0-9$_]+]\|\|null\).+\|\|([a-zA-Z0-9$_]+)\(""\)/,
  // 4. ,Vb(m),W=m.j[c]||null)&&(W=cvb[0](W),m.set(c,W)
  /,[a-zA-Z0-9$_]+\([a-zA-Z0-9$_]+\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+\[[a-zA-Z0-9$_]+]\|\|null\)&&\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)\[(\d+)]\([a-zA-Z0-9$_]+\),[a-zA-Z0-9$_]+\.set\((?:"n+"|[a-zA-Z0-9$_]+),[a-zA-Z0-9$_]+\)/,
  // 5. a.D&&(b="nn"[+a.D],c=a.get(b))&&(c=rDa[0](c),a.set(b,c),rDa.length||rma("")
  /[a-zA-Z0-9$_]="nn"\[\+[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\.get\([a-zA-Z0-9$_]+\)\).+\|\|([a-zA-Z0-9$_]+)\(""\)/,
  // 6. ...&&(c=rDa[0](c),a.set(b,c),rDa.length||rma("")
  /[a-zA-Z0-9$_]="nn"\[\+[a-zA-Z0-9$_]+\.[a-zA-Z0-9$_]+],[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\.get\([a-zA-Z0-9$_]+\)\)&&\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)\[(\d+)]/,
  // 7. (b=String.fromCharCode(110),c=a.get(b))&&(c=BDa[0](c)
  /\([a-zA-Z0-9$_]+=String\.fromCharCode\(110\),[a-zA-Z0-9$_]+=[a-zA-Z0-9$_]+\.get\([a-zA-Z0-9$_]+\)\)&&\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)(?:\[(\d+)])?\([a-zA-Z0-9$_]+\)/,
  // 8. .get("n"))&&(b=Yva[0](b)
  /\.get\("n"\)\)&&\([a-zA-Z0-9$_]+=([a-zA-Z0-9$_]+)(?:\[(\d+)])?\([a-zA-Z0-9$_]+\)/,
]

function extractFunctionName(code: string): { name: string; arrayIndex?: number } | null {
  for (const re of NAME_REGEXES) {
    const m = code.match(re)
    if (m) {
      const name = m[1]
      const arrayIndex = m[2] !== undefined ? Number(m[2]) : undefined
      return { name, arrayIndex }
    }
  }
  return null
}

/**
 * 名字指向一个数组槽位时,从数组里取真正的函数名。
 * `var cvb=["BqJ"][...]` 或 `cvb="abc".split(...)` 型。
 */
function resolveArrayFunctionName(code: string, name: string, arrayIndex?: number): string {
  if (arrayIndex === undefined) return name
  // 数组:var XX=["a","b"...];(末尾逗号可选)
  const arrRe = new RegExp(`var\\s+${name.replace(/[$]/g, "\\$&")}\\s*=\\s*\\[([^\\]]+)]\\s*;`)
  const arrM = code.match(arrRe)
  if (arrM) {
    const names = arrM[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    const target = names[arrayIndex]
    if (target) return target
  }
  return name
}

/** lexer 匹配到闭合大括号(处理嵌套)。 */
function matchToClosingBrace(code: string, start: string): string {
  const idx = code.indexOf(start)
  if (idx === -1) return ""
  // 从 start 末尾 `{` 开始扫描。
  const openIdx = code.indexOf("{", idx)
  if (openIdx === -1) return ""
  let depth = 0
  let inString: string | null = null
  let inTemplate = false
  for (let i = openIdx; i < code.length; i++) {
    const ch = code[i]
    const prev = code[i - 1]
    if (inString) {
      if (ch === inString && prev !== "\\") inString = null
      continue
    }
    if (inTemplate) {
      if (ch === "`" && prev !== "\\") inTemplate = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch
    } else if (ch === "`") {
      inTemplate = true
    } else if (ch === "{") {
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0) return code.slice(idx, i + 1)
    }
  }
  return ""
}

/** 提取解密函数体,返回可执行的 `function <name>(...) {...}`。 */
function extractFunction(code: string, name: string): string {
  const fnName = name.replace(/[$]/g, "\\$&")
  // 1. lexer:name=function(...){...}(处理嵌套大括号)
  const lexerStart = `${name}=function`
  const lexerBody = matchToClosingBrace(code, lexerStart)
  if (lexerBody) {
    const m = lexerBody.match(new RegExp(`${fnName}=function([\\S\\s]*)$`))
    if (m) return `function ${name}${m[1]}`
  }
  // 2. 正则兜底:name=function(...){ ... return x.join("") };
  const re = new RegExp(`${fnName}=\\s*function([\\S\\s]*?}\\s*return [\\w$]+?\\.join\\(\\"\\"\\)\\s*\\};)`)
  const m = code.match(re)
  if (m) return `function ${name}${m[1]}`
  throw new Error(`YouTube n 参数解密函数提取失败(${name})`)
}

/** 删掉 early-return(typeof X === "undefined")return arg; —— 单独执行会误返。 */
function fixupFunction(fn: string): string {
  const argM = fn.match(/=\s*function\s*\(\s*([^)]*)\s*\)/)
  const firstArg = argM?.[1]?.split(",")[0]?.trim()
  if (!firstArg) return fn
  const re = new RegExp(`;\\s*if\\s*\\(\\s*typeof\\s+[a-zA-Z0-9_\\$]+\\s*===?\\s*(["'])undefined\\1\\s*\\)\\s*return\\s+${firstArg.replace(/[$]/g, "\\$&")}\\s*;`, "g")
  return fn.replace(re, ";")
}

let cachedNDeobfuscator: ((n: string) => string) | null = null

/**
 * 从 base.js 里挖出 n 解密函数并缓存执行器。
 * playerJsUrl 可省:拿不到时抛错。
 */
async function getNDeobfuscator(playerJsUrl: string): Promise<(n: string) => string> {
  if (cachedNDeobfuscator) return cachedNDeobfuscator
  const code = await getPlayerCode(playerJsUrl)
  const found = extractFunctionName(code)
  if (!found) throw new Error("YouTube n 参数解密函数名未找到")
  const realName = resolveArrayFunctionName(code, found.name, found.arrayIndex)
  const fn = fixupFunction(extractFunction(code, realName))
  // 用 host.js 执行:`new Function(fn); return fn(args)` —— fn 定义了解密函数。
  const runner = `(${fn})\nreturn ${realName}(arguments[0])`
  cachedNDeobfuscator = (n: string) => {
    const result = globalThis.appHost.js.call(runner, "", [n])
    return String(result ?? "")
  }
  return cachedNDeobfuscator
}

/** 尝试从任意上下文拿 base.js URL(解析 watch 页 HTML)。 */
async function fetchPlayerJsUrl(videoId: string): Promise<string | null> {
  // 优先:playerResponse 的 videoDetails 不带 jsUrl,需单独拿 watch 页。
  try {
    const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=en`)
    return extractPlayerJsUrl(html)
  } catch {
    return null
  }
}

/**
 * 解密 URL 的 n 参数并替换回。失败抛错(上层放弃该流)。
 * 每次失败都尝试重新下载 base.js(URL 可能过期)。
 */
export async function deobfuscateNParam(url: string): Promise<string> {
  const n = extractNParam(url)
  if (n === null) return url
  const videoId = url.match(/[/v|vi\/|v=]([\w-]{6,})/)?.[1] ?? ""
  // 已解过(URL 里 n 值被替换成合法值,再解会错)——不做,信任调用方。
  const playerJsUrl = await fetchPlayerJsUrl(videoId)
  if (!playerJsUrl) throw new Error("YouTube base.js URL 获取失败")
  const deobf = await getNDeobfuscator(playerJsUrl)
  const decoded = deobf(n)
  if (!decoded) throw new Error("YouTube n 参数解密返回空")
  return url.replace(/[&?]n=[^&]+/, (m) => m.replace(/n=[^&]+/, `n=${encodeURIComponent(decoded)}`))
}
