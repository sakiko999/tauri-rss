/**
 * SocialRenderer — 社交内容卡片(瀑布流用)。
 *
 * 瀑布流里图片是主角、高度各异(CSS columns 排布)。卡片结构:
 *   内容文本 → 图片(占满列宽,高度随原始比例) → 互动数(赞/转/评) + 作者。
 * 不内嵌播放器——social 是"浏览/发现"形态,点卡片打开原文。
 */
import type { SocialItem } from "@tauri-playground/core"
import type { RendererCallbacks } from "./types.ts"

function fmtCount(n?: number): string {
  if (n === undefined) return ""
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function SocialRenderer({
  item,
  onOpen,
}: { item: SocialItem } & RendererCallbacks) {
  return (
    <article
      className="mb-3 break-inside-avoid rounded-lg border border-zinc-200 bg-white p-3 transition-shadow hover:shadow-md"
      onClick={() => item.url && onOpen?.(item.url)}
    >
      {/* 正文 */}
      {item.content && <p className="mb-2 text-sm leading-relaxed text-zinc-800 line-clamp-6">{item.content}</p>}

      {/* 图片:占满列宽,高度随比例(瀑布流的核心) */}
      {item.images?.length ? (
        <div className="mb-2 space-y-2">
          {item.images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full rounded object-cover"
            />
          ))}
        </div>
      ) : null}

      {/* 底栏:作者 + 互动数 */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="truncate">{item.author?.name ?? "未知作者"}</span>
        <div className="flex shrink-0 gap-3">
          {item.likes !== undefined && <span>↑ {fmtCount(item.likes)}</span>}
          {item.reposts !== undefined && <span>↻ {fmtCount(item.reposts)}</span>}
          {item.replies !== undefined && <span>💬 {fmtCount(item.replies)}</span>}
        </div>
      </div>
    </article>
  )
}
