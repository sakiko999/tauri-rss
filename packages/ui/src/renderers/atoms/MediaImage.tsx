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
 * 不做 Folo 的 proxy/blurhash/fitContent —— 无代理部署场景下是死代码。
 */
import { useEffect, useState } from "react"
import { Skeleton } from "./Skeleton.tsx"
import { ImageOffIcon } from "./icons.tsx"

/** 已成功加载的图片 URL(模块级,跨组件实例共享)。 */
const loadedUrls = new Set<string>()

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
      {src && (
        <img
          src={src}
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
