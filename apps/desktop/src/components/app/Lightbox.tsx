/**
 * Lightbox —— 社交图集灯箱(从详情弹窗点图打开)。
 *
 * ⚠️ 图片**必须**走 MediaImage:微博/小红书的图床要带 Referer 的隧道,裸 `<img>` 是
 * 403 破图(详情弹窗的主图同理)。也**不要**用原生 `<dialog>`:它的 `::backdrop` 与
 * 本仓的 `--scrim` / radix 遮罩是两套,深浅主题下会叠成两层黑,且焦点陷阱与 Esc
 * 都要自己写。这里用 components/Modal.tsx(radix):Esc / 背景点击 / 焦点陷阱现成。
 *
 * 索引由调用方持有(SocialDetailModal 的 imgIndex):灯箱翻到哪张,关掉后详情就停在
 * 哪张 —— 两个视图共用一份「当前第几张」,不各记一份。
 */

import { MediaImage } from "@amoeba/ui"
import { useEffect } from "react"

import { httpsify } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { Icon } from "../Icon.tsx"
import { Modal } from "../Modal.tsx"

export interface LightboxImage {
  url: string
}

export function Lightbox({
  open,
  images,
  index,
  onIndexChange,
  onClose,
}: {
  open: boolean
  images: LightboxImage[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
}) {
  const count = images.length
  // 图集可能在打开期间变化(详情补全把 1 张换成 9 张 / 反过来):索引先夹到合法区间,
  // 否则会出现「10 / 5」这种计数和空画面。
  const current = count > 0 ? Math.min(Math.max(index, 0), count - 1) : 0
  const step = (d: number) => {
    if (count < 2) return
    onIndexChange((current + d + count) % count)
  }

  // 左右键翻页。⚠️ 只在灯箱打开时挂:本组件常驻在详情弹窗里,无条件监听会把
  // 阅读页/播放页的左右键一并吞掉(播放页的 ←/→ 是跳转)。
  useEffect(() => {
    if (!open || count < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        onIndexChange((current - 1 + count) % count)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        onIndexChange((current + 1) % count)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, count, current, onIndexChange])

  const src = httpsify(images[current]?.url)

  return (
    <Modal open={open} onOpenChange={(o) => (o ? undefined : onClose())} size="wide" flush title="图片预览">
      <div className="lightbox" {...overlayBlock("lightbox", `lightbox:${current}`)}>
        <div className="lightbox-stage">{src ? <MediaImage src={src} contain loading="eager" /> : null}</div>
        {count > 1 ? (
          <div className="lightbox-nav">
            <button className="lightbox-arrow" data-dir="prev" aria-label="上一张" onClick={() => step(-1)}>
              <Icon name="back" size={16} />
            </button>
            <span className="lightbox-count num">
              {current + 1} / {count}
            </span>
            <button className="lightbox-arrow" data-dir="next" aria-label="下一张" onClick={() => step(1)}>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
