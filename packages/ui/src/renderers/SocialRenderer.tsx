/**
 * SocialRenderer — 社交内容卡片(瀑布流用,参考 Folo picture-waterfall)。
 *
 * 瀑布流里图片是主角、高度随原始比例(CSS columns / VirtuosoGrid 行自适应排布)。
 * 卡片结构:内容文本 → 图片(占满列宽,高度随比例) → 互动数(赞/转/评) + 作者。
 * 不内嵌播放器——social 是「浏览/发现」形态,点卡片打开原文。
 *
 * 每张图有自己的宽高(SocialImage):有则按 width/height 撑比例,未知退化 4:3。
 */
import type { SocialItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"
import { MediaCard } from "./atoms/MediaCard.tsx"
import { MediaImage } from "./atoms/MediaImage.tsx"
import { fmtCount } from "./atoms/format.ts"

/** 图片宽高比:优先图的 width/height,无则 4:3。 */
function imgRatio(img: { width?: number; height?: number }): number {
  if (img.width && img.height && img.height > 0) return img.width / img.height
  return 4 / 3
}

export function SocialRenderer({ item, onOpen }: { item: SocialItem } & RendererCallbacks) {
  const url = item.url
  // 不传 h-full:瀑布流 cell 高度由 MasonryGrid 渲染后测量(自然内容高)修正,撑满 cell
  // 会让测量拿到 cell 高(=估算)而非真实内容高,估算偏差无法修正。
  return (
    <MediaCard onOpen={url ? () => onOpen?.(url) : undefined}>
      <div className="flex flex-col gap-2.5 p-3">
        {/* 正文 */}
        {item.content && (
          <p className="line-clamp-6 text-sm leading-relaxed text-foreground">{item.content}</p>
        )}

        {/* 图片:高度随原始比例(瀑布流核心) */}
        {item.images?.length ? (
          <div className="space-y-2">
            {item.images.map((img, i) => (
              // eager:masonic 虚拟化已限 DOM(视口+overscan),lazy 在视口外不加载
              // → 新增 item 渲染在 overscan 区空白,滚动才出图。eager 立即可见。
              <MediaImage key={i} src={img.url} ratio={imgRatio(img)} className="rounded" loading="eager" />
            ))}
          </div>
        ) : null}
      </div>

      {/* 底栏:作者 + 互动数 */}
      <div className="mt-auto flex items-center justify-between px-3 pb-3 text-xs text-muted-foreground">
        <span className="truncate">{item.author?.name ?? "未知作者"}</span>
        <div className="flex shrink-0 gap-3">
          {item.likes !== undefined && <span>↑ {fmtCount(item.likes)}</span>}
          {item.reposts !== undefined && <span>↻ {fmtCount(item.reposts)}</span>}
          {item.replies !== undefined && <span>💬 {fmtCount(item.replies)}</span>}
        </div>
      </div>
    </MediaCard>
  )
}
