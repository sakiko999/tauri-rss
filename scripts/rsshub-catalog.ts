/**
 * scripts/rsshub-catalog.ts
 *
 * 从 tmp/RSSHub 静态摘录「简单路由购物清单」——不跑 RSSHub 运行时。
 *
 * 动机：测试数据源不足。RSSHub 列举了 1600+ 个可抓站点，但整包复用成本
 * 太高（@/ alias、config、cache、registry、build 产物）。多数 handler 是
 * 定制 scraper（打 JSON API / cheerio 解析），**没有现成的原生 feed URL**
 * 可静态提取；真正值钱的是「这些站点存在、且标记了简单/无反爬」这件事。
 *
 * 所以本脚本不产出「开箱即用的 feed 列表」，而是产出一份**最小复刻起点清单**：
 *   - 筛 requirePuppeteer:false & antiCrawler:false & requireConfig:false 的路由
 *   - 标注 namespace 名、上游域名、分类、example、媒体能力（podcast/BT/scihub）
 *   - 尽力静态识别真·原生 feed 直传（handler 里直接 ofetch 一个 .xml/.rss/.atom）
 *
 * 用法：
 *   bun run scripts/rsshub-catalog.ts            # 默认扫 tmp/RSSHub，写 docs/
 *   bun run scripts/rsshub-catalog.ts --limit 50 # 调试：只取前 N 个 namespace
 *
 * 产物：
 *   docs/rsshub-catalog.json   结构化清单（按分类分组）
 *   docs/rsshub-catalog.md     人类可读摘要 + 统计
 *
 * 设计约束（CLAUDE.md）：scripts 走纯 node tsconfig（lib: ESNext），不拖 DOM；
 * 零运行时依赖——只读文件系统，用 bun 自带 API。
 */
import { readdir, readFile, stat } from "node:fs/promises"
import { join, sep } from "node:path"

const RSSHUB_ROOT = join(import.meta.dir, "..", "tmp", "RSSHub")
const ROUTES_DIR = join(RSSHUB_ROOT, "lib", "routes")
const OUT_DIR = join(import.meta.dir, "..", "docs")

// ── 类型（只取 RSSHub Route 的子集，够用即可，避免耦合其类型源）──────────────

interface RouteFeatures {
  requireConfig?: unknown
  requirePuppeteer?: boolean
  antiCrawler?: boolean
  supportBT?: boolean
  supportPodcast?: boolean
  supportScihub?: boolean
}
interface CatalogRoute {
  namespace: string
  name: string
  path: string
  example?: string
  url?: string
  categories?: string[]
  nativeFeedUrl?: string
  mediaHints: string[]
  file: string
}
interface NamespaceInfo {
  namespace: string
  name: string
  url?: string
  categories?: string[]
  lang?: string
}
interface Catalog {
  generatedBy: string
  scanned: number
  processed: number
  simpleRoutes: number
  nativeFeedRoutes: number
  byCategory: Record<string, CatalogRoute[]>
  namespaces: NamespaceInfo[]
}

// ── 文件发现 ────────────────────────────────────────────────────────────────

/** 递归找所有 .ts/.tsx（排除 test），返回相对 ROUTES_DIR 的 posix 路径。 */
async function findRouteFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await findRouteFiles(full, base)))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full.split(base).pop()!.split(sep).join("/").replace(/^\//, ""))
    }
  }
  return out
}

// ── 静态解析（正则，不执行 TS）──────────────────────────────────────────────

/** 从 namespace.ts 抽 { name, url, categories, lang }。 */
function parseNamespace(rel: string, src: string): NamespaceInfo | undefined {
  // namespace.ts 形如 export const namespace: Namespace = { name: '...', url: '...', ... }
  if (!/namespace\.ts$/.test(rel)) return undefined
  const name = strField(src, "name") ?? deriveNameFromPath(rel)
  return {
    namespace: nsKeyFromPath(rel),
    name,
    url: strField(src, "url"),
    categories: arrField(src, "categories"),
    lang: strField(src, "lang"),
  }
}

/** 抽 `export const route: Route = { ... }` 块（粗切到匹配括号层数）。 */
function extractRouteObject(src: string): string | undefined {
  const m = src.match(/export\s+const\s+route\b[\s\S]*?=\s*\{/)
  if (!m) return undefined
  const start = m.index! + m[0].length - 1 // 指向 '{'
  return sliceBalanced(src, start, "{", "}")
}

/** 从 route 对象块里抠字段。 */
function parseRouteFields(block: string): {
  features?: RouteFeatures
  path?: string | string[]
  name?: string
  example?: string
  url?: string
  categories?: string[]
} {
  return {
    path: pathField(block),
    name: strField(block, "name"),
    example: strField(block, "example"),
    url: strField(block, "url"),
    categories: arrField(block, "categories"),
    features: parseFeatures(block),
  }
}

function parseFeatures(block: string): RouteFeatures | undefined {
  const fm = block.match(/features:\s*\{([\s\S]*?)\n\s{4,}\}/)
  if (!fm) return undefined
  const f = fm[1]
  const isFalse = (k: string) => new RegExp(`\\b${k}:\\s*false`).test(f)
  // requireConfig 可能是 false / [array] / 变量名；只认 false 为「无需配置」。
  const rcFalse = /\brequireConfig:\s*false\b/.test(f)
  const rcArray = /\brequireConfig:\s*\[/.test(f)
  return {
    requireConfig: rcFalse ? false : rcArray ? "array" : undefined,
    requirePuppeteer: !isFalse("requirePuppeteer") && /\brequirePuppeteer:\s*true/.test(f) ? true : isFalse("requirePuppeteer") ? false : undefined,
    antiCrawler: /\bantiCrawler:\s*true/.test(f) ? true : isFalse("antiCrawler") ? false : undefined,
    supportBT: /\bsupportBT:\s*true/.test(f) || undefined,
    supportPodcast: /\bsupportPodcast:\s*true/.test(f) || undefined,
    supportScihub: /\bsupportScihub:\s*true/.test(f) || undefined,
  }
}

/** 在整个文件源里找真·原生 feed 直传：ofetch('https://….{xml,rss,atom,feed}')。 */
function findNativeFeedUrl(src: string): string | undefined {
  // 匹配 URL 直到遇到空白/引号/括号/反引号；末尾容忍的尾字符在下方统一剥离。
  const re = /(https?:\/\/[^\s'"`)\]>]+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(src))) {
    let u = match[1]!
    // 剥离被正则带上的尾字符（模板串闭合、TSX/JSX、行尾标点）
    u = u.replace(/[,;)\]>'"`]+$/, "")
    // 只认以 feed 扩展名结尾的（真·原生 feed），且非纯模板占位
    if (/\.(?:xml|rss|atom|feed)\b/i.test(u)) return u
  }
  return undefined
}

// ── 小工具 ──────────────────────────────────────────────────────────────────

function sliceBalanced(src: string, start: number, open: string, close: string): string | undefined {
  let depth = 0
  let inStr: string | null = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]!
    if (inStr) {
      if (c === inStr && src[i - 1] !== "\\") inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === "`") inStr = c
    else if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return undefined
}

function strField(src: string, key: string): string | undefined {
  const m = src.match(new RegExp(`\\b${key}:\\s*['"\`]([^'"\`]+)['"\`]`))
  return m?.[1]
}

function arrField(src: string, key: string): string[] | undefined {
  const m = src.match(new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`))
  if (!m) return undefined
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/['"]/g, ""))
    .filter(Boolean)
}

function pathField(block: string): string | string[] | undefined {
  // path: '/x' 或 path: ['/x', '/y']
  const m = block.match(/\bpath:\s*(\[[\s\S]*?\]|['"`][^'"`]+['"`])/)
  if (!m) return undefined
  const v = m[1]!
  if (v.startsWith("[")) {
    return arrField(`path: ${v}`, "path") ?? []
  }
  return v.replace(/^['"`]|['"`]$/g, "")
}

function nsKeyFromPath(rel: string): string {
  // 'foo/namespace.ts' → 'foo'；'foo/bar/namespace.ts' → 'foo/bar'
  return rel.split("/").slice(0, -1).join("/")
}
function deriveNameFromPath(rel: string): string {
  return nsKeyFromPath(rel)
}

function isSimple(f?: RouteFeatures): boolean {
  if (!f) return false
  return (
    f.requirePuppeteer === false &&
    f.antiCrawler === false &&
    (f.requireConfig === false || f.requireConfig === undefined)
  )
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const limit = parseLimitFlag() // 调试用：截断处理的 namespace 数量
  const exists = await stat(RSSHUB_ROOT).then(() => true).catch(() => false)
  if (!exists) {
    console.error(`❌ 找不到 ${RSSHUB_ROOT}（请确认 RSSHub 已 clone 到 tmp/RSSHub）`)
    process.exit(1)
  }

  const allFiles = await findRouteFiles(ROUTES_DIR)
  const files = limit ? allFiles.slice(0, limit) : allFiles
  console.log(`扫描 ${files.length}${limit ? `/${allFiles.length}` : ""} 个路由文件 …`)

  const namespaceInfos = new Map<string, NamespaceInfo>()
  const simpleRoutes: CatalogRoute[] = []

  for (const rel of files) {
    const abs = join(ROUTES_DIR, rel)
    let src: string
    try {
      src = await readFile(abs, "utf8")
    } catch {
      continue
    }
    const ns = parseNamespace(rel, src)
    if (ns) namespaceInfos.set(ns.namespace, ns)

    const block = extractRouteObject(src)
    if (!block) continue
    const f = parseRouteFields(block)
    if (!isSimple(f.features)) continue

    const nsKey = nsKeyFromPath(rel)
    const nativeFeedUrl = findNativeFeedUrl(src)
    const mediaHints: string[] = []
    if (f.features?.supportPodcast) mediaHints.push("podcast")
    if (f.features?.supportBT) mediaHints.push("BT")
    if (f.features?.supportScihub) mediaHints.push("scihub")
    if (nativeFeedUrl) mediaHints.push("native-feed")

    const pathStr = Array.isArray(f.path) ? f.path.join(" | ") : f.path
    simpleRoutes.push({
      namespace: nsKey,
      name: f.name ?? "(unnamed)",
      path: pathStr ?? "",
      example: f.example,
      url: f.url ?? namespaceInfos.get(nsKey)?.url,
      categories: f.categories ?? namespaceInfos.get(nsKey)?.categories,
      nativeFeedUrl,
      mediaHints,
      file: rel,
    })
  }

  // native feed 直传单独高亮（最值得直接接 RssSource 的）
  const nativeFeedRoutes = simpleRoutes.filter((r) => r.nativeFeedUrl)

  // 按首个分类分组
  const byCategory: Record<string, CatalogRoute[]> = {}
  for (const r of simpleRoutes) {
    const cat = r.categories?.[0] ?? "uncategorized"
    ;(byCategory[cat] ??= []).push(r)
  }
  for (const k of Object.keys(byCategory)) byCategory[k]!.sort((a, b) => a.namespace.localeCompare(b.namespace))

  const catalog: Catalog = {
    generatedBy: "scripts/rsshub-catalog.ts (static extraction, no RSSHub runtime)",
    scanned: allFiles.length,
    processed: files.length,
    simpleRoutes: simpleRoutes.length,
    nativeFeedRoutes: nativeFeedRoutes.length,
    byCategory,
    namespaces: [...namespaceInfos.values()].sort((a, b) => a.namespace.localeCompare(b.namespace)),
  }

  await writeJSON(catalog)
  await writeMarkdown(catalog)

  console.log(`\n✅ simple routes: ${catalog.simpleRoutes} / ${catalog.scanned} files`)
  console.log(`✅ native-feed direct-passthrough: ${catalog.nativeFeedRoutes}`)
  console.log(`✅ categories: ${Object.keys(byCategory).length}`)
  console.log(`✅ namespaces: ${catalog.namespaces.length}`)
  console.log(`✅ wrote docs/rsshub-catalog.json + docs/rsshub-catalog.md`)
}

function parseLimitFlag(): number | undefined {
  const i = process.argv.indexOf("--limit")
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1])
  return undefined
}

async function writeJSON(c: Catalog) {
  const { writeFile, mkdir } = await import("node:fs/promises")
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, "rsshub-catalog.json"), JSON.stringify(c, null, 2) + "\n", "utf8")
}

async function writeMarkdown(c: Catalog) {
  const { writeFile } = await import("node:fs/promises")
  const lines: string[] = []
  lines.push("# RSSHub 简单路由购物清单（静态摘录）")
  lines.push("")
  lines.push("> 由 `scripts/rsshub-catalog.ts` 生成。不跑 RSSHub 运行时，仅静态扫 `tmp/RSSHub/lib/routes`，")
  lines.push("> 筛 `requirePuppeteer:false & antiCrawler:false & requireConfig:false` 的路由。")
  lines.push("> 这是后续「逐路由最小复刻」的**起点清单**，不是开箱即用的 feed URL 列表。")
  lines.push("")
  lines.push("## 概况")
  lines.push("")
  lines.push(`| 指标 | 数量 |`)
  lines.push(`| --- | --- |`)
  lines.push(`| 扫描文件（全量基线） | ${c.scanned} |`)
  lines.push(`| 本次处理 | ${c.processed} |`)
  lines.push(`| 简单路由 | ${c.simpleRoutes} |`)
  lines.push(`| 其中真·原生 feed 直传 | ${c.nativeFeedRoutes} |`)
  lines.push(`| 分类 | ${Object.keys(c.byCategory).length} |`)
  lines.push(`| namespace | ${c.namespaces.length} |`)
  lines.push("")

  // 原生 feed 直传（最值得直接接现有 RssSource）
  const native = c.byCategory
  const nativeFlat = Object.values(native).flat().filter((r) => r.nativeFeedUrl)
  if (nativeFlat.length) {
    lines.push("## ⭐ 原生 feed 直传（最易复刻）")
    lines.push("")
    lines.push("handler 里直接 `ofetch(….{xml,rss,atom})`，最接近「开箱即用」。**仍需逐个 curl 验证**：")
    lines.push("")
    lines.push("| namespace | route | 上游 feed | 域名 |")
    lines.push("| --- | --- | --- | --- |")
    for (const r of nativeFlat.slice(0, 80)) {
      lines.push(`| ${r.namespace} | ${r.name} | ${r.nativeFeedUrl} | ${r.url ?? ""} |`)
    }
    lines.push("")
  }

  lines.push("## 按分类")
  lines.push("")
  for (const cat of Object.keys(c.byCategory).sort()) {
    const list = c.byCategory[cat]!
    lines.push(`### ${cat} (${list.length})`)
    lines.push("")
    lines.push("| namespace | route | example | 域名 | 媒体 |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const r of list.slice(0, 200)) {
      const ex = r.example ? `\`${r.example}\`` : ""
      const media = r.mediaHints.join(", ")
      lines.push(`| ${r.namespace} | ${r.name} | ${ex} | ${r.url ?? ""} | ${media} |`)
    }
    if (list.length > 200) lines.push(`| … | _+${list.length - 200} more_ | | | |`)
    lines.push("")
  }

  await writeFile(join(OUT_DIR, "rsshub-catalog.md"), lines.join("\n") + "\n", "utf8")
}

main().catch((err) => {
  console.error("❌ catalog failed:", err)
  process.exit(1)
})
