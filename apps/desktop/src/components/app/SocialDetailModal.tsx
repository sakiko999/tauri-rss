/**
 * SocialDetailModal —— 社交条目详情弹窗(点瀑布流卡片打开)。
 *
 * bili/weibo 的列表数据已完整,xhs 缺详情 → store.openSocialDetail 会异步
 * 调 resolveDetail 补全,这里在 full 未就绪时显示「正在补全」。
 *
 * ⚠️ 布局契约(照 new_desktop):flush 弹窗**不滚不 pad**,高度沿容器链传导到
 * `.social-detail` → 图片区/信息列。媒体框必须有**确定的 height**,图片百分比
 * 尺寸才有基准(只给 max-height → 容器退化 auto → 图按自然尺寸画完再被
 * overflow:hidden 裁掉 ≡ 撑满 + 截断)。竖图/横图都由 object-fit:contain 装进
 * 同一可用高度,不再按源比例撑高把正文挤到图片下方。
 */

import { fmtCount, MediaImage } from "@amoeba/ui"
import DOMPurify from "dompurify"
import { useEffect, useMemo, useState } from "react"

import { openExternalSafely } from "../../lib/host.ts"
import { looksLikeHtml } from "../../lib/html.ts"
import { fmtAgo, httpsify, itemKey, mediaUrl, socialRatio } from "../../lib/media.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useDesktop } from "../../store/index.ts"
import { Button } from "../Button.tsx"
import { Icon } from "../Icon.tsx"
import { Modal } from "../Modal.tsx"
import { Lightbox } from "./Lightbox.tsx"

/**
 * 实况视频直连：WebView2 原生网络层由 Rust 注入 Referer
 * (`apps/src-tauri/src/media_referer.rs` 的 `VIDEO_REFERRERS`，规则权威在
 * resolve `videoReferrerFor`)，保留原生 Range/seek/缓存。
 *
 * 2026-10-28 删掉 blob 隧道回退（整段下载 → Blob URL）——与图片同一决策：
 * 过度防御没有意义。直连失败(403 / 解码不支持)→ 退回静态图 + 重试。
 * `attempt` 递增 = 重试（清失败态，`<video>` 重新挂载触发新请求）。
 */
function useLiveVideoSource(src: string | undefined, attempt: number) {
  const [failed, setFailed] = useState(false)
  // 换图 / 换条目 / 点重试 → 清失败态。
  useEffect(() => setFailed(false), [src, attempt])
  return {
    /** 失败后不挂 src（退回静态图）；否则恒为源直链。 */
    url: failed ? undefined : src,
    failed,
    onError: () => setFailed(true),
  }
}

export function SocialDetailModal() {
  const detail = useDesktop((s) => s.socialDetail)
  const close = useDesktop((s) => s.closeSocialDetail)
  const item = detail?.full ?? detail?.item
  const imgs = (item as { images?: Array<{ url: string }> } | undefined)?.images ?? []
  const multi = imgs.length > 1
  /** 当前展示第几张(仅多图时有意义)。 */
  const [imgIndex, setImgIndex] = useState(0)
  /** 灯箱是否打开。索引与详情**共用** imgIndex —— 关灯箱后详情停在同一张。 */
  const [zoom, setZoom] = useState(false)
  /** 视频重试计数：递增让视频重新挂载再试一次（实况与帖子级视频共用）。 */
  const [liveRetry, setLiveRetry] = useState(0)
  /** 当前图若是实况，取视频直链（统一 https：源站给的是 http，WebView 里会被混合内容拦）。 */
  const liveVideo = httpsify((imgs[imgIndex] as { liveVideo?: string } | undefined)?.liveVideo)
  const live = useLiveVideoSource(liveVideo, liveRetry)
  /** 帖子级视频（视频微博随列表落库；xhs 视频笔记在详情补全后才有）。 */
  const postVideo = httpsify((item as { video?: string } | undefined)?.video)
  const post = useLiveVideoSource(postVideo, liveRetry)
  /** 视频帖加载中（起播/卡缓冲）：poster 只有图没有声音，不标出来与普通图片无法区分。 */
  const [videoWaiting, setVideoWaiting] = useState(false)
  useEffect(() => {
    setImgIndex(0)
    setVideoWaiting(false)
    // 换条目时灯箱必须一起关:否则它停在上一条的图上,而 indices 已归零。
    setZoom(false)
  }, [item?.id])
  /**
   * ⚠️ 所有 hook 必须在 `if (!detail) return null` **之前**调用。
   * 曾把 useState/useEffect 放在 early return 之后:detail 为 null 时提前返回(少调),
   * 有值时多调 → React 抛「Rendered more/fewer hooks than expected」,弹窗整块崩掉打不开。
   */
  useEffect(() => {
    // ⚠️ 只在弹窗真正打开时挂监听:本组件常驻在 App 里,无条件监听会让 ←/→ 在
    // 任何页面(阅读视图、播放页)被吞掉 —— 播放页的左右键是跳转/快进。
    // 灯箱打开时也停掉:两边都监听会让一次按键翻两格(灯箱自己监听左右键)。
    if (!detail || !multi || zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setImgIndex((i) => (i - 1 + imgs.length) % imgs.length)
      else if (e.key === "ArrowRight") setImgIndex((i) => (i + 1) % imgs.length)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [detail, multi, imgs.length, zoom])
  /**
   * 正文可能是原始 HTML(weibo 的 text 带 `<a href=…>`/`<br />`)——直接 `{text}` 会把
   * 标签当字面量显示(用户看到 `<a href="...">@xxx</a> <br />` 一串源码)。经 DOMPurify
   * 消毒后按 HTML 渲染。⚠️ useMemo 必须在 early return **之前**(hook 顺序稳定)。
   */
  const rawContent = ((detail?.full ?? detail?.item) as { content?: string } | undefined)?.content ?? ""
  // ⚠️ FORBID_TAGS:["img"] —— 正文 HTML 里的 <img>(weibo 的 panda 页脚/表情)走原生
  // DOM,不过 MediaImage 的防盗链隧道 → sinaimg 403 破图,且无占位兜底。主图本就走
  // images 列(MediaImage),正文里剔除 img 只损失 logo 噪声。per-call 配置不污染
  // ReaderMain 的正文消毒(那里要保留 img)。
  const bodyHtml = useMemo(
    () => (looksLikeHtml(rawContent) ? DOMPurify.sanitize(rawContent, { FORBID_TAGS: ["img"] }) : ""),
    [rawContent],
  )

  if (!detail || !item) return null

  /** 正文 <a> 一律拦下交宿主打开(同 ReaderMain:不拦的话 WebView 会整页导航走)。 */
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a")
    if (!a) return
    e.preventDefault()
    const href = a.getAttribute("href")
    if (!href || href.startsWith("#")) return
    openExternalSafely(href)
  }

  const text = (item as { content?: string }).content ?? item.summary ?? ""
  /** 媒体源兼容:SocialItem 走 images[0];article 类兜 thumbnail/poster。 */
  const cover = mediaUrl(item, imgIndex)
  const stepImg = (d: number) => setImgIndex((i) => (i + d + imgs.length) % imgs.length)
  /**
   * 灯箱图集:优先 images 全部,没有图集时退回封面(article 类兜 thumbnail)。
   * ⚠️ 不滤掉空 URL 的项:灯箱的 index = 详情弹窗的 imgIndex,过滤会让两者错位
   * (翻到第 3 张时详情显示的是另一张)。
   */
  const lightboxImages =
    imgs.length > 0 ? imgs.map((_, i) => ({ url: mediaUrl(item, i) ?? "" })) : cover ? [{ url: cover }] : []
  /** 当前图片真实比例。容器比例 === 图片比例时 contain 恰好填满,不留缝也不裁切。 */
  const imgRatio = (() => {
    const it = item as {
      aspectRatio?: number
      width?: number
      height?: number
      images?: Array<{ width?: number; height?: number }>
    }
    // 视频帖无图集时按 16:9 给媒体框（视频封面比例的常见口径）。
    if (postVideo && imgs.length === 0) return 16 / 9
    return socialRatio(it.images?.[imgIndex] ?? { width: it.width, height: it.height })
  })()
  const likes = (item as { likes?: number }).likes
  const replies = (item as { replies?: number }).replies
  const reposts = (item as { reposts?: number }).reposts
  /**
   * 是否在补全中。⚠️ 不能用 `full === null` 判断——resolveDetail 对**无详情能力**
   * 的源(bili/weibo,列表数据已完整)原样返回 item,`full` 永远停在 null,
   * 那样会把完整内容一直显示成「正在补全」。只有 xhs 靠 xsec_token 拉详情。
   */
  const resolving = detail.full === null && !detail.error && !!(item as { xsecToken?: string }).xsecToken
  const resolveFailed = !!detail.error
  /**
   * 视频帖**补全中**：xhs 的播放直链只在详情 SSR 里（列表只给 `hasVideo` 标记），
   * 所以点开详情后媒体区会先显示封面、过一两秒才变成 `<video>` —— 这段时间看起来
   * 就是一张普通图片，用户不知道视频还在路上。补一个和缓冲期同样的 spinner。
   */
  const videoResolving = resolving && !postVideo && (item as { hasVideo?: boolean }).hasVideo === true
  return (
    <>
      <Modal
        open
        onOpenChange={(o) => !o && close()}
        size="wide"
        flush
        title={item.title || item.author?.name || "详情"}
        desc={item.author?.name ? `${item.author.name} — ${fmtAgo(item.publishedAt)}` : fmtAgo(item.publishedAt)}
        footer={
          <>
            {/* ⚠️ 社交条目没有可播流,`addToQueue` 会**拒绝**它(入队收口处有护栏)——
              原按钮点了不生效却弹「已加入播放队列」(说谎)。这里不摆队列按钮。 */}
            {item.url ? (
              /* ⚠️ 走宿主门面(WebView 拦 window.open)。 */
              <Button variant="quiet" onClick={() => openExternalSafely(item.url)}>
                <Icon name="external" size={14} /> 打开原文
              </Button>
            ) : null}
            <span className="spacer" />
            <Button variant="secondary" onClick={close}>
              关闭
            </Button>
          </>
        }
      >
        <div id="social-detail">
          <div className="social-detail" {...overlayBlock("social-detail", `social:detail:${itemKey(item)}`)}>
            {/* ⚠️ 缩略图条**不能**放在 media 与 info 之间:它 grid-column:1/-1 会占满
              第一行两列,把 info 自动推到第三行。放在 info 之后,自动放置才会是
              media=1/1 → info=1/2 → thumbs=第二行整行。 */}
            {/* 媒体列的宽度按**当前图片的比例**反推(--detail-media-ratio),media
              容器再按同一比例定宽。这样网格的 1.4fr/1fr 折中值就不会把竖图挤成一条。
              比例异常的图(超长截图 / 超宽 banner)在 CSS 里被 clamp 到 0.5~1.9,
              此时 contain 留一点缝是有意的(完整显示 > 填满裁剪)。 */}
            <div
              className="social-detail-media"
              style={{ "--detail-media-ratio": String(imgRatio) } as React.CSSProperties}
              {...overlayBlock("social-detail-media", `social:detail:media:${itemKey(item)}`)}
            >
              {cover || (postVideo && post.url) ? (
                <span className="social-detail-cover">
                  {imgs.length > 1 ? (
                    <div className="social-detail-controls">
                      <button
                        className="social-detail-nav"
                        data-dir="prev"
                        aria-label="上一张"
                        onClick={() => stepImg(-1)}
                      >
                        <Icon name="back" size={15} />
                      </button>
                      <span className="social-detail-count num">
                        {imgIndex + 1} / {imgs.length}
                      </span>
                      <button
                        className="social-detail-nav"
                        data-dir="next"
                        aria-label="下一张"
                        onClick={() => stepImg(1)}
                      >
                        <Icon name="chevronRight" size={15} />
                      </button>
                    </div>
                  ) : null}
                  {/* ⚠️ style 上的比例必须与图片**真实比例**一致:每张图换比例,
                    媒体列的宽度就跟着变。 */}
                  {/* 视频帖（视频微博/视频笔记）：原生 <video> 直连（Referer 由 Rust 注入），
                    带控件、直接有声起播（WebView2 已开 no-user-gesture）；失败退回封面（下方出重试）。 */}
                  {postVideo && post.url ? (
                    <video
                      className="social-detail-video"
                      src={post.url}
                      poster={cover}
                      controls
                      autoPlay
                      playsInline
                      // 加载态：起播/卡缓冲时叠 spinner —— poster 只有图，不标就与普通图片无差别。
                      onLoadStart={() => setVideoWaiting(true)}
                      onCanPlay={() => setVideoWaiting(false)}
                      onPlaying={() => setVideoWaiting(false)}
                      onWaiting={() => setVideoWaiting(true)}
                      onError={() => {
                        setVideoWaiting(false)
                        post.onError()
                      }}
                    />
                  ) : liveVideo && live.url ? (
                    // 实况图：切到即直连播放、静音循环；点一下暂停/续播。
                    <video
                      className="social-detail-video"
                      src={live.url}
                      poster={cover}
                      autoPlay
                      muted
                      loop
                      playsInline
                      onClick={(e) => {
                        const v = e.currentTarget
                        if (v.paused) void v.play()
                        else v.pause()
                      }}
                      // 直连失败/解码不支持 → 退回静态图（下方出重试）。
                      onError={() => live.onError()}
                    />
                  ) : cover ? (
                    // 点静态图 → 灯箱(完整大图 + 左右翻页)。实况视频那一支不挂:
                    // 它自己接管点击(暂停/续播),再套一层灯箱会两个动作抢同一次点击。
                    <button
                      type="button"
                      className="social-detail-zoom"
                      aria-label="查看大图"
                      onClick={() => setZoom(true)}
                    >
                      <MediaImage src={cover} alt={item.title} loading="eager" contain />
                    </button>
                  ) : null}
                  {/* 视频加载中：叠在 poster 上（补全中 + 起播/卡缓冲）。 */}
                  {(postVideo && post.url && videoWaiting) || videoResolving ? (
                    <span className="social-detail-video-loading" aria-hidden>
                      <span className="social-detail-video-loading-chip">
                        <Icon name="loader" size={22} className="animate-spin" />
                      </span>
                    </span>
                  ) : null}
                  {/* 直连失败时才出现的重试入口（403/网络抖动/签名过期）。 */}
                  {(liveVideo && live.failed) || (postVideo && post.failed) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="social-detail-live"
                      onClick={() => setLiveRetry((n) => n + 1)}
                    >
                      <Icon name="refresh" size={13} /> 重试
                    </Button>
                  ) : null}
                </span>
              ) : (
                <span className="cover-missing">
                  <Icon name="image" size={24} />
                </span>
              )}
            </div>

            <div
              className="social-detail-info"
              {...overlayBlock("social-detail-info", `social:detail:info:${itemKey(item)}`)}
            >
              <div className="social-detail-head">
                <span className="social-avatar social-avatar-letter avatar-round" style={{ width: 34, height: 34 }}>
                  {(item.author?.name?.[0] ?? "?").toUpperCase()}
                </span>
                <span className="stack" style={{ gap: 0 }}>
                  <span style={{ fontWeight: 560 }}>{item.author?.name ?? "未知作者"}</span>
                  <span className="t-micro t-dim">{fmtAgo(item.publishedAt)}</span>
                </span>
              </div>
              {resolving ? (
                <span className="stack" style={{ gap: "var(--sp-2)" }}>
                  <span className="skeleton sk-line" style={{ width: "92%" }} />
                  <span className="skeleton sk-line" style={{ width: "78%" }} />
                  <span className="skeleton sk-line" style={{ width: "64%" }} />
                </span>
              ) : bodyHtml ? (
                // ⚠️ HTML 正文走 social-detail-html 覆盖掉 white-space:pre-wrap ——
                // 平台给的 HTML 里 <a>/<span> 周围本来就带源码换行,pre-wrap 会把这些
                // 纯排版换行也当真换行渲染,段落被拆开、行距错乱(看着像文字重叠)。
                // HTML 分支的换行交给 <br>,不靠 white-space。
                <div
                  className="social-detail-text social-detail-html"
                  onClick={onBodyClick}
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              ) : text ? (
                <p className="social-detail-text">{text}</p>
              ) : (
                // 空正文占位:没有这一支时,正文区是一大片空白,用户分不清
                // 「还在加载」还是「本来就没正文」。
                <p className="social-detail-text t-dim">（这条没有正文，只有图片）</p>
              )}
              {/* 三项统计全为 0/缺失时不渲染 —— 否则只剩一条纯噪声的横线。 */}
              {likes || replies || reposts ? (
                <div className="social-detail-stats">
                  {likes ? (
                    <span>
                      <Icon name="heart" size={13} /> {fmtCount(likes)}
                    </span>
                  ) : null}
                  {replies ? (
                    <span>
                      <Icon name="message" size={13} /> {fmtCount(replies)}
                    </span>
                  ) : null}
                  {reposts ? (
                    <span>
                      <Icon name="refresh" size={13} /> {fmtCount(reposts)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {/* 状态脚注:只在「补全中 / 补全失败 / 实况播放失败」时出现。
                完整内容 + 正常播放不需要解释。 */}
              {resolving || resolveFailed || (liveVideo && live.failed) || (postVideo && post.failed) ? (
                <p className="social-detail-note">
                  {resolving ? (
                    <Icon name="loader" size={13} className="animate-spin" />
                  ) : (
                    <Icon name="alert" size={13} />
                  )}
                  <span>
                    {resolving
                      ? "正在向源站补全详情…"
                      : resolveFailed
                        ? `详情补全失败：${detail.error}（列表页只带封面与标题）`
                        : postVideo && post.failed
                          ? "视频播放失败（已显示封面）"
                          : "实况视频播放失败（已显示静态图）"}
                  </span>
                </p>
              ) : null}
            </div>

            {/* 多图缩略图条:直接点选,不必靠左右键一张张翻。放在 info 之后是刻意的
              ——它横跨整行,插在 media 与 info 之间会把 info 挤到第三行。 */}
            {imgs.length > 1 ? (
              <div className="social-detail-thumbs" role="tablist" aria-label="图片">
                {imgs.map((img, i) => (
                  <button
                    key={`${img.url}-${i}`}
                    className="social-detail-thumb"
                    role="tab"
                    aria-selected={i === imgIndex}
                    aria-label={`第 ${i + 1} 张`}
                    onClick={() => setImgIndex(i)}
                  >
                    <MediaImage src={mediaUrl(item, i)} ratio={1} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Modal>
      {/* 灯箱是**兄弟**不是子节点:radix 的 DismissableLayer 把「后开的层」视为内部,
        但把灯箱嵌在外层 Dialog.Content 的 children 里会让外层的滚动/焦点作用域多包一层。
        索引共用 imgIndex —— 灯箱翻到第 N 张,关掉后详情也停在第 N 张。 */}
      <Lightbox
        open={zoom}
        images={lightboxImages}
        index={imgIndex}
        onIndexChange={setImgIndex}
        onClose={() => setZoom(false)}
      />
    </>
  )
}
