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
 * 防盗链图床(sinaimg.cn 等)对空 Referer / 非站内 Referer 返回 403,统一由
 * 宿主在 WebView2 网络层改写 Referer(`apps/src-tauri/src/media_referer.rs`,
 * 规则表见 resolve/media-referrer.ts)——图片**只走原生 `<img>`**,保留 HTTP
 * 缓存/HTTP2/渐进解码,无 JS 隧道。未注入的环境(纯浏览器调试)防盗链图直接
 * 403 → ImageOff 占位,不回退。图床规则 → resolve(mediaReferrerFor)。
 *
 * 不做 Folo 的 proxy/blurhash/fitContent —— 无代理部署场景下是死代码。
 */
import { useEffect, useState } from "react"

import { ImageOffIcon } from "./Icons.tsx"
import { Skeleton } from "./Skeleton.tsx"

/** 成功/失败 URL 集合的 LRU 上限(防虚拟化滚动大量图导致集合无限增长)。
 *  Set 迭代序 = 插入序,超限删最早插入——够用即可,不必精确 LRU(淘汰后重挂走浏览器 HTTP 缓存)。 */
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

/** 省流模式开关(宿主门面镜像,设置页可切;未注入的环境默认关闭)。 */
function dataSaverOn(): boolean {
  try {
    return (globalThis as { appHost?: { dataSaver?: boolean } }).appHost?.dataSaver === true
  } catch {
    return false
  }
}

export function MediaImage({
  src,
  alt = "",
  ratio = 16 / 9,
  className,
  imgClassName,
  loading = "lazy",
  fill = false,
  contain = false,
}: {
  src?: string
  alt?: string
  /** 宽高比(默认 16:9)。容器按此撑开高度,fill 且无 imageRatio 时用。 */
  ratio?: number
  className?: string
  imgClassName?: string
  /**
   * 加载策略。默认 lazy;**虚拟化瀑布流(masonic 已限 DOM 为视口+overscan)应传 eager**——
   * lazy 在视口外不加载,新增 item 渲染在 overscan 区会显示空白,滚动进视口才出图。
   */
  loading?: "lazy" | "eager"
  /**
   * 填充容器(详情轮播/封面等):容器 w-full h-full,img object-cover 填满。
   * 调用方负责给容器定比例(详情弹窗图区按图片比例 swiper/flex 定高定宽)——
   * 父容器与图片同比例时 cover=contain,恰好填满,无 contain 留缝、无 cover 裁剪。
   */
  fill?: boolean
  /** 完整显示模式(比例超范围的图,如 16:9 banner/超竖长图):容器定高,img object-contain 完整显示,可留背景缝。 */
  contain?: boolean
}) {
  // 初始命中缓存 → 直接显示图(避免虚拟化重挂载闪骨架)。
  const [loaded, setLoaded] = useState(() => (src ? loadedUrls.has(src) : false))
  const [failed, setFailed] = useState(false)
  // 省流模式:完全不请求图片,只留骨架占位(卡片/列表高度由容器 aspect-ratio 撑住)。
  const dataSaver = dataSaverOn()
  const imgSrc = dataSaver ? undefined : src

  // src 变化时重置状态(React 不自动做,列表 item 复用实例时 src 会变)。
  useEffect(() => {
    setLoaded(src ? loadedUrls.has(src) : false)
    setFailed(false)
  }, [src])

  const showImage = !dataSaver && !!src && !failed && (loaded || loadedUrls.has(src))

  // contain:容器 w-full h-full,img object-contain(完整显示,可留背景缝)。
  // fill:容器 w-full h-full,img object-cover(填满,调用方定等比容器则无缝隙无裁剪)。
  // 普通:按 ratio 撑高 object-cover(标准卡片/瀑布流)。
  const isFillOrContain = fill || contain
  return (
    <div
      className={`relative overflow-hidden bg-muted ${isFillOrContain ? "h-full w-full" : "w-full"} ${className ?? ""}`}
      style={isFillOrContain ? undefined : { aspectRatio: ratio }}
    >
      {/* img 始终渲染:opacity 控制显隐(loaded 淡入)。onLoad/onError 只在 img 挂载后触发,
          条件渲染会因 loaded=false 永不挂载 → 永远 skeleton。 */}
      {imgSrc && (
        <img
          src={imgSrc}
          alt={alt}
          loading={loading}
          // 始终 no-referrer:未命中宿主规则时不泄露页面源。WebView2 的
          // WebResourceRequested 在 referrer 策略之后执行，实测 no-referrer
          // 下仍能把头改写成站内 Referer。
          referrerPolicy="no-referrer"
          className={`absolute inset-0 size-full ${contain ? "object-contain" : "object-cover"} transition-opacity duration-200 ${
            showImage ? "opacity-100" : "opacity-0"
          } ${imgClassName ?? ""}`}
          onLoad={() => {
            if (src) cappedAdd(loadedUrls, src)
            setLoaded(true)
          }}
          onError={() => setFailed(true)}
        />
      )}
      {/* skeleton 底层占位:img 淡入前显示;onError(failed)时叠 ImageOff */}
      {!showImage && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Skeleton className="absolute inset-0 rounded-none" />
          {failed && <ImageOffIcon className="relative size-5 text-muted-foreground/60" />}
        </div>
      )}
    </div>
  )
}
