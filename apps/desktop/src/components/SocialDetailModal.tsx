/**
 * SocialDetailModal — social 内容详情弹窗(点卡片打开,类似小红书网页弹窗)。
 *
 * 数据:
 *   - bili/weibo:列表已含完整图文(content + images),直接展示(零网络)。
 *   - xhs:列表只有单图摘要,进入异步拉 noteDetail 补全(store.openSocialDetail 处理),
 *     弹窗消费 full(若完成)否则 item——full 到货后原位刷新。
 *
 * 布局(frontend-design,2026-08-31):图文笔记详情预览,图片是第一主角。
 *   左图轮播(swiper,55%)→ 纯黑沉浸(图片含防盗链隧道);右信息(45%)→ 留白呼吸(shadcn 令牌)。
 *   签名元素 = 轮播 + 图区/文区的沉浸-留白对比。去外层 border(扩黑/白 split 背景上边线闪烁),
 *   rounded-lg + shadow-2xl;文区单一 border-l 与图区分隔。
 *   关闭:ESC / 遮罩点击 / ✕ 按钮,锁 body 滚动。
 */
import { useEffect, useState } from "react"
import { Swiper, SwiperSlide } from "swiper/react"
import { Navigation, Pagination } from "swiper/modules"
import "swiper/css"
import "swiper/css/navigation"
import "swiper/css/pagination"
import type { SocialItem, SocialImage } from "@tauri-playground/core"
import { MediaImage, fmtCount } from "@tauri-playground/ui"
import { X } from "lucide-react"
import { useDesktop } from "../store.ts"

/** 话题 #tag# 高亮(正文里以 #...##...# 形式标签)。 */
function renderContent(content: string): React.ReactNode {
  // 标签形如 #文学[话题]# 或 #刘楚昕[话题]#;拆成文本 + 蓝 tag 片段。
  const parts = content.split(/(#+[^#\n]+#+)/g)
  return parts.map((p, i) =>
    /^#.+#$/.test(p.trim()) ? (
      <span key={i} className="text-blue-500">
        {p.trim()}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

export function SocialDetailModal() {
  const socialDetail = useDesktop((s) => s.socialDetail)
  const closeSocialDetail = useDesktop((s) => s.closeSocialDetail)

  // 当前图索引(轮播切换时图区宽随当前图比例变化)。hooks 全在条件 return 之前。
  const [idx, setIdx] = useState(0)
  const imgCount = ((socialDetail?.full ?? socialDetail?.item) as SocialItem | undefined)?.images?.length ?? 0
  useEffect(() => {
    setIdx(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgCount])

  // 关闭:ESC + 锁 body 滚动(ExpandedPlayer 同款)。
  const closeRef = { current: closeSocialDetail }
  closeRef.current = closeSocialDetail
  useEffect(() => {
    if (!socialDetail) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [socialDetail])

  if (!socialDetail) return null
  // 详情优先(异步补全);未完成用列表数据(经 store 校验 item.id 防串窗)。
  // 弹窗只对 social 打开 → item 必是 SocialItem(判别联合收窄)。
  const item = (socialDetail.full ?? socialDetail.item) as SocialItem
  const images = item.images ?? []
  const content = item.content
  const author = item.author
  const likes = item.likes
  const reposts = item.reposts
  const replies = item.replies
  const url = item.url

  // xhs 列表 item 带 xsecToken(需 async 拉详情补全);bili/weibo 列表即完整、无 xsecToken。
  // full 未到且需详情 → 图区骨架(不让「列表封面→详情首图」URL 切换闪);否则显示 full??item 的图。
  const needsDetail = item.xsecToken !== undefined
  const detailReady = socialDetail.full !== null || !needsDetail

  // 当前图(轮播显示的)-> 决定图区档位(范围=等比自适应 / 超范围=固定宽 contain)。
  const curImage = images[idx]
  const curRatio = curImage?.width && curImage?.height ? curImage.width / curImage.height : undefined
  const curInRange = curRatio !== undefined && curRatio >= 0.65 && curRatio <= 1.35

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeRef.current()
      }}
    >
      <div
        className="flex h-[min(88vh,44rem)] w-[min(56rem,94vw)] flex-col overflow-hidden rounded-lg bg-background shadow-2xl sm:flex-row"
        role="dialog"
        aria-modal="true"
        aria-label="内容详情"
      >
        {/* ✕ 关闭(浮在图/文区上方,始终可见) */}
        <button
          onClick={closeRef.current}
          className="absolute right-3 top-3 z-20 rounded-full bg-black/40 p-1.5 text-white/80 hover:bg-black/60 hover:text-white"
          title="关闭 (Esc)"
        >
          <X className="h-4 w-4" />
        </button>

        {/* 左图轮播:图区高度 h-full(定死)。图片比例分两档——
            ① 在合理范围(0.65~1.35,竖图到中等横图):图区宽随图比例(宽=高×比例),MediaImage fill(cover)
               填满等比容器 → 严丝合缝,无 contain 留缝、无 cover 裁剪。
            ② 超范围(16:9 banner/超竖长图,填满会过度裁剪主体):图区固定 55% 宽,MediaImage contain
               完整显示主体,可留背景缝(主体不外泄)。
            onSlideChange 更新 idx → 档位/宽度随当前图重算。 */}
        <div
          className="relative h-full min-h-0 shrink-0 overflow-hidden bg-black/40"
          style={
            curInRange
              ? { aspectRatio: curRatio, maxWidth: "58%" } // ① 范围:等比自适应
              : { width: "55%" } // ② 超范围:固定宽 + contain
          }
        >
          {!detailReady ? (
            /* xhs 详情拉取中:图区骨架(不显示列表封面——它和详情首图 URL 不同,先显示会闪)。 */
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            </div>
          ) : images.length ? (
            <Swiper
              modules={[Navigation, Pagination]}
              navigation
              pagination={{ clickable: true }}
              slidesPerView={1}
              className="h-full w-full"
              observer
              observeParents
              onSlideChange={(s) => setIdx(s.activeIndex)}
            >
              {images.map((img, i) => {
                const socialImg = img as SocialImage
                const ratio = socialImg.width && socialImg.height ? socialImg.width / socialImg.height : undefined
                const inRange = ratio !== undefined && ratio >= 0.65 && ratio <= 1.35
                return (
                  <SwiperSlide key={socialImg.url ?? i} className="!h-full">
                    {/* 范围:fill(cover)填满;超范围:contain(完整显示,主体不外泄)。 */}
                    <MediaImage
                      src={socialImg.url}
                      className="h-full w-full"
                      loading="eager"
                      fill={inRange}
                      contain={!inRange}
                    />
                  </SwiperSlide>
                )
              })}
            </Swiper>
          ) : (
            /* 无图:占位(正文为主,如纯文字状态)。 */
            <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
              无图片
            </div>
          )}
        </div>

        {/* 右信息(45%):border-l 与图区分隔(单一分隔线,无外层闪烁边框)。 */}
        <div className="flex min-h-0 flex-1 flex-col border-l border-border">
          {/* 作者头:头像/名/时间 + 打开原文 */}
          <div className="flex items-center gap-2 px-4 py-3 shrink-0">
            {author?.avatar ? (
              <img src={author.avatar} alt="" className="size-8 rounded-full bg-muted" />
            ) : (
              <div className="size-8 rounded-full bg-muted" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{author?.name ?? "未知作者"}</div>
              {item.publishedAt && (
                <div className="text-xs text-muted-foreground">
                  {new Date(item.publishedAt).toLocaleString()}
                </div>
              )}
            </div>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto shrink-0 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                打开原文
              </a>
            )}
          </div>

          {/* 正文全文(可滚动) */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {content ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                {renderContent(content)}
              </p>
            ) : (
              <span className="text-sm text-muted-foreground">暂无正文</span>
            )}
          </div>

          {/* 互动数 */}
          <div className="flex items-center gap-4 border-t border-border px-4 py-3 text-xs text-muted-foreground shrink-0">
            {likes !== undefined && <span>👍 {fmtCount(likes)}</span>}
            {reposts !== undefined && <span>↻ {fmtCount(reposts)}</span>}
            {replies !== undefined && <span>💬 {fmtCount(replies)}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
