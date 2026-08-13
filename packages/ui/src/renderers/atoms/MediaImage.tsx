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

/** 已成功加载的图片 URL(模块级,跨组件实例共享)。 */
const loadedUrls = new Set<string>()
/** 图床隧道缓存:src → blob URL(防重复请求 + 滚动重挂载复用)。 */
const proxyCache = new Map<string, string>()

/**
 * 防盗链图床的宿主隧道加载。语义:
 *   - 非防盗链图床 → 原样返回 src(走原生 <img>);
 *   - 命中图床未就绪 → undefined(不挂原 src,避免先发一个必 403 的请求 → 闪骨架);
 *   - 隧道失败(纯前端调试 CORS/forbidden header 等)→ 回退原 src,由 <img> onError
 *     出占位(与非防盗链图行为一致)。桌面宿主(Tauri)隧道生效即目标。
 */
function useProxiedImage(src?: string): { src?: string } {
  const referrer = src ? mediaReferrerFor(src) : undefined
  // 首渲染同步读缓存:滚动重挂载同图直接命中,不闪骨架。
  const [proxy, setProxy] = useState<string | undefined>(src && referrer ? proxyCache.get(src) : undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (!src || !referrer) return
    const cached = proxyCache.get(src)
    setProxy(cached)
    if (cached) return
    let cancelled = false
    void (async () => {
      try {
        const res = await globalThis.appHost.http.request({
          url: src,
          method: "GET",
          responseType: "arraybuffer",
          headers: { Referer: referrer },
        })
        if (cancelled) return
        if (res.status !== 200) {
          setFailed(true)
          return
        }
        const ct =
          (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "image/jpeg") as string
        // base64ToBytes 生成的是独立 ArrayBuffer(无 byteOffset),直接取 buffer。
        const buf = (res.body as Uint8Array).buffer as ArrayBuffer
        const blobUrl = URL.createObjectURL(new Blob([buf], { type: ct }))
        proxyCache.set(src, blobUrl)
        setProxy(blobUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [src])

  // 非防盗链图床:原样。
  if (!referrer) return { src }
  // 隧道失败:回退原 src,由 <img> onError 出占位。
  if (failed) return { src }
  // 命中未就绪 → undefined(不挂原 src);就绪 → blob URL。
  return { src: proxy }
}

export function MediaImage({
  src,
  alt = "",
  ratio = 16 / 9,
  className,
  imgClassName,
}: {
  src?: string
  alt?: string
  /** 宽高比(默认 16:9)。容器按此撑开高度。 */
  ratio?: number
  className?: string
  imgClassName?: string
}) {
  // 初始命中缓存 → 直接显示图(避免虚拟化重挂载闪骨架)。
  const [loaded, setLoaded] = useState(() => (src ? loadedUrls.has(src) : false))
  const [failed, setFailed] = useState(false)
  // 防盗链图床(sinaimg 等)经宿主隧道加载,未就绪返回 undefined 不挂原 src。
  const { src: imgSrc } = useProxiedImage(src)

  // src 变化时重置状态(React 不自动做,列表 item 复用实例时 src 会变)。
  useEffect(() => {
    setLoaded(src ? loadedUrls.has(src) : false)
    setFailed(false)
  }, [src])

  const showImage = !!src && !failed && (loaded || loadedUrls.has(src))

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
          loading="lazy"
          referrerPolicy="no-referrer"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-200 ${
            showImage ? "opacity-100" : "opacity-0"
          } ${imgClassName ?? ""}`}
          onLoad={() => {
            if (src) loadedUrls.add(src)
            setLoaded(true)
          }}
          onError={() => setFailed(true)}
        />
      )}
      {/* skeleton 底层占位:img 淡入前显示;failed 时叠 ImageOff */}
      {!showImage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="absolute inset-0 rounded-none" />
          {failed && <ImageOffIcon className="relative size-5 text-muted-foreground/60" />}
        </div>
      )}
    </div>
  )
}
