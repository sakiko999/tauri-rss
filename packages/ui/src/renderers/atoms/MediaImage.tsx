/**
 * MediaImage — 轻量图片(无代理、无 blurhash)。
 *
 * 职责:
 *   - lazy 加载 + referrerPolicy=no-referrer(跨源防盗链图)
 *   - aspect-ratio 容器撑开高度,加载前显示 Skeleton → 布局不跳动
 *   - onError → 居中 ImageOff 占位(403 防盗链图不裂图)
 *   - 模块级 loadedUrls 缓存:虚拟化滚动反复卸载/挂载同一 item 时,
 *     重挂载直接命中缓存显示图,不闪骨架
 *
 * 关键实现:<img> **始终渲染**(opacity 控制显隐),而非条件渲染——
 *   否则 loaded=false 时 img 不挂载,onLoad/onError 永远不会触发,
 *   永远显示 skeleton(死锁)。skeleton 作为底层占位,loaded 后淡出。
 *
 * 防盗链图床(sinaimg.cn 等)对空 Referer / 非站内 Referer 返回 403——`<img>`
 * 原生加载必带页面源 Referer(tauri://localhost),无解。命中图床的 src 经
 * appHost.http(Rust reqwest 可设任意 header)带站内 Referer 拉取 → Blob URL 显示。
 * 图床 → Referer 规则在 host 层(mediaReferrerFor),本组件只调宿主、不写死域名。
 *
 * 不做 Folo 的 proxy/blurhash/fitContent —— 无代理部署场景下是死代码。
 */
import { useEffect, useState } from "react"
import { mediaReferrerFor } from "@tauri-playground/host"
import { Skeleton } from "./Skeleton.tsx"
import { ImageOffIcon } from "./icons.tsx"

/** 成功/失败 URL 集合的 LRU 上限(防虚拟化滚动大量图导致集合无限增长)。
 * Set 迭代序 = 插入序,超限删最早插入——够用即可,不必精确 LRU(淘汰后重挂走浏览器 HTTP 缓存)。 */
const IMG_CACHE_MAX = 500
function cappedAdd(set: Set<string>, v: string): void {
  set.add(v)
  while (set.size > IMG_CACHE_MAX) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

/** 已成功加载的图片 URL(模块级,跨组件实例共享)。 */
const loadedUrls = new Set<string>()
/**
 * 图床隧道缓存:src → blob URL(防重复请求 + 滚动重挂载复用),**LRU 上限**。
 * 虚拟化滚动浏览大量图,缓存无限增长会让 blob(内存中的图片数据)永不释放——
 * 上限 + 淘汰时 revokeObjectURL 释放。命中把 src 重插到末尾(最近使用)。
 */
const BLOB_CACHE_MAX = 300
const proxyCache = new Map<string, string>()
/** 隧道拉取失败的 src(模块级)——重挂不再重试,否则虚拟化滚动反复请求同一失败图。 */
const failedSrcs = new Set<string>()

/** 命中缓存(src 重插到末尾 = 最近使用),未命中 undefined。 */
function proxyGet(src: string): string | undefined {
  const v = proxyCache.get(src)
  if (v !== undefined) {
    proxyCache.delete(src)
    proxyCache.set(src, v)
  }
  return v
}
/** 写入缓存;超上限淘汰最久未用(头部),revoke 释放 blob 内存。 */
function proxySet(src: string, blobUrl: string): void {
  proxyCache.set(src, blobUrl)
  while (proxyCache.size > BLOB_CACHE_MAX) {
    const oldest = proxyCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    const url = proxyCache.get(oldest)
    proxyCache.delete(oldest)
    if (url) URL.revokeObjectURL(url)
  }
}

/** in-flight 去重:同一 src 首次并发 mount 只发一次隧道请求,其余实例 await 同一 promise。 */
const inflight = new Map<string, Promise<string>>()
/** 隧道拉图(带 Referer)→ blob URL。命中缓存 / in-flight 合并;失败抛错由调用方记负缓存。 */
async function loadProxiedBlob(src: string, referrer: string): Promise<string> {
  const cached = proxyGet(src)
  if (cached) return cached
  const pending = inflight.get(src)
  if (pending) return pending
  const p = (async () => {
    const res = await globalThis.appHost.http.request({
      url: src,
      method: "GET",
      responseType: "arraybuffer",
      headers: { Referer: referrer },
    })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    const ct = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "image/jpeg") as string
    // base64ToBytes 生成的是独立 ArrayBuffer(无 byteOffset),直接取 buffer。
    const buf = (res.body as Uint8Array).buffer as ArrayBuffer
    const blobUrl = URL.createObjectURL(new Blob([buf], { type: ct }))
    proxySet(src, blobUrl)
    return blobUrl
  })().finally(() => {
    inflight.delete(src)
  })
  inflight.set(src, p)
  return p
}

/**
 * 防盗链图床的宿主隧道加载。语义:
 *   - 非防盗链图床 → 原样返回 src(走原生 <img>),failed=false;
 *   - 命中图床未就绪 → undefined(不挂原 src,避免先发一个必 403 的请求 → 闪骨架);
 *   - 隧道失败(纯前端调试 CORS/forbidden header 等)→ src undefined + failed=true,
 *     由调用方显示 ImageOff 占位;**不回退原 src**——防盗链原样必 403,回退会反复
 *     请求同一失败图(虚拟化滚动放大)。
 */
function useProxiedImage(src?: string): { src?: string; failed: boolean } {
  const referrer = src ? mediaReferrerFor(src) : undefined
  // 失败负缓存:该 src 曾隧道失败 → 直接占位,重挂不再请求(防虚拟化滚动反复请求同一失败图)。
  const failedBefore = src ? failedSrcs.has(src) : false
  // 首渲染同步读缓存:滚动重挂载同图直接命中,不闪骨架。
  const [proxy, setProxy] = useState<string | undefined>(src && referrer ? proxyGet(src) : undefined)
  const [failed, setFailed] = useState(failedBefore)

  useEffect(() => {
    setFailed(failedBefore)
    if (!src || !referrer || failedBefore) return
    const cached = proxyGet(src)
    setProxy(cached)
    if (cached) return
    let cancelled = false
    // in-flight 合并:同一 src 并发首次 mount 只发一次隧道请求。
    void loadProxiedBlob(src, referrer)
      .then((blobUrl) => {
        if (!cancelled) setProxy(blobUrl)
      })
      .catch(() => {
        if (!cancelled) {
          cappedAdd(failedSrcs, src)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [src])

  // 非防盗链图床:原样。
  if (!referrer) return { src, failed: false }
  // 隧道失败(含负缓存):不挂原 src(防盗链原样必 403 → 重挂重复请求),failed 由调用方出占位。
  if (failedBefore || failed) return { src: undefined, failed: true }
  // 命中未就绪 → undefined(不挂原 src);就绪 → blob URL。
  return { src: proxy, failed: false }
}

export function MediaImage({
  src,
  alt = "",
  ratio = 16 / 9,
  className,
  imgClassName,
  loading = "lazy",
}: {
  src?: string
  alt?: string
  /** 宽高比(默认 16:9)。容器按此撑开高度。 */
  ratio?: number
  className?: string
  imgClassName?: string
  /**
   * 加载策略。默认 lazy;**虚拟化瀑布流(masonic 已限 DOM 为视口+overscan)应传 eager**——
   * lazy 在视口外不加载,新增 item 渲染在 overscan 区会显示空白,滚动进视口才出图。
   */
  loading?: "lazy" | "eager"
}) {
  // 初始命中缓存 → 直接显示图(避免虚拟化重挂载闪骨架)。
  const [loaded, setLoaded] = useState(() => (src ? loadedUrls.has(src) : false))
  const [failed, setFailed] = useState(false)
  // 防盗链图床(sinaimg 等)经宿主隧道加载,未就绪返回 undefined 不挂原 src;
  // proxiedFailed = 隧道失败(不走原生 <img> onError,须在此出 ImageOff)。
  const { src: imgSrc, failed: proxiedFailed } = useProxiedImage(src)

  // src 变化时重置状态(React 不自动做,列表 item 复用实例时 src 会变)。
  useEffect(() => {
    setLoaded(src ? loadedUrls.has(src) : false)
    setFailed(false)
  }, [src])

  const showImage = !!src && !failed && !proxiedFailed && (loaded || loadedUrls.has(src))

  return (
    <div
      className={`relative w-full overflow-hidden bg-muted ${className ?? ""}`}
      style={{ aspectRatio: ratio }}
    >
      {/* img 始终渲染:opacity 控制显隐(loaded 淡入)。onLoad/onError 只在 img 挂载后触发,
          条件渲染会因 loaded=false 永不挂载 → 永远 skeleton。 */}
      {imgSrc && (
        <img
          src={imgSrc}
          alt={alt}
          loading={loading}
          referrerPolicy="no-referrer"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${
            showImage ? "opacity-100" : "opacity-0"
          } ${imgClassName ?? ""}`}
          onLoad={() => {
            if (src) cappedAdd(loadedUrls, src)
            setLoaded(true)
          }}
          onError={() => setFailed(true)}
        />
      )}
      {/* skeleton 底层占位:img 淡入前显示;原生 onError(failed)或隧道失败(proxiedFailed)时叠 ImageOff */}
      {!showImage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="absolute inset-0 rounded-none" />
          {(failed || proxiedFailed) && <ImageOffIcon className="relative size-5 text-muted-foreground/60" />}
        </div>
      )}
    </div>
  )
}
