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
import { useEffect, useMemo, useState } from "react"
import DOMPurify from "dompurify"
import { useDesktop } from "../../store/index.ts"
import { Modal } from "../Modal.tsx"
import { Icon } from "../Icon.tsx"
import { MediaImage, fmtCount } from "@amoeba/ui"
import { videoReferrerFor } from "@amoeba/host"
import { fmtAgo, httpsify, itemKey, mediaUrl, socialRatio } from "../../lib/media.ts"
import { openExternalSafely } from "../../lib/host.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { looksLikeHtml } from "../../lib/html.ts"

/**
 * 实况视频经宿主隧道拉成 Blob URL。
 *
 * 详情里**切到实况图即自动拉取并播放**（不再需要点按钮）；`attempt` 递增 = 失败重试。
 *
 * ⚠️ 不能直接 `<video src={直链}>`：CDN 对页面源 Referer（dev `localhost:1420` /
 * 生产 `tauri://localhost`）返回 403 text/html，浏览器再按 ORB 拦成
 * `MEDIA_ELEMENT_ERROR: Format error`。媒体错误**不进 console**，表现为「实况
 * 不播且无报错」。`<video>` 上也没有 `referrerPolicy` 可用，只能走 Rust 隧道。
 * Referer 规则归 host 层（videoReferrerFor），这里不写死域名。
 */
function useLiveVideoBlob(src: string | undefined, attempt: number) {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    setBlobUrl(undefined)
    setError(undefined)
    if (!src) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const referrer = videoReferrerFor(src)
    void (async () => {
      const res = await globalThis.appHost.http.request({
        url: src,
        method: "GET",
        responseType: "arraybuffer",
        timeoutMs: 20_000,
        // 媒体直链不计入平台 RPM / 冷却（与图片隧道同一语义）。
        policy: { metered: false },
        ...(referrer ? { headers: { Referer: referrer } } : {}),
      })
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      const ct = (res.headers["content-type"] ?? res.headers["Content-Type"] ?? "video/mp4") as string
      // arraybuffer 解码出的是独立 ArrayBuffer（无 byteOffset），直接取 buffer。
      const buf = (res.body as Uint8Array).buffer as ArrayBuffer
      const url = URL.createObjectURL(new Blob([buf], { type: ct }))
      if (cancelled) {
        URL.revokeObjectURL(url)
        return
      }
      // 所有权交给下面的 blobUrl 清理 effect（取消时在上面已 revoke）。
      setBlobUrl(url)
    })()
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    // 取消后由上面创建处紧邻的 cancelled 分支 revoke（两步之间没有 await）。
    return () => {
      cancelled = true
    }
  }, [src, attempt])

  // blobUrl 被替换 / 组件卸载时释放上一个 Blob（视频数据在内存里，不 revoke 会泄漏）。
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [blobUrl])

  return { blobUrl, loading, error }
}

export function SocialDetailModal() {
  const detail = useDesktop((s) => s.socialDetail)
  const close = useDesktop((s) => s.closeSocialDetail)
  const item = detail?.full ?? detail?.item
  const imgs = (item as { images?: Array<{ url: string }> } | undefined)?.images ?? []
  const multi = imgs.length > 1
  /** 当前展示第几张(仅多图时有意义)。 */
  const [imgIndex, setImgIndex] = useState(0)
  /** 实况重试计数：递增触发 hook 重新拉取。 */
  const [liveRetry, setLiveRetry] = useState(0)
  /** 视频解码失败（隧道成功但编码不支持等），与隧道错误分开记。 */
  const [liveDecodeError, setLiveDecodeError] = useState<string | undefined>(undefined)
  /** 当前图若是实况，取视频直链（统一 https：源站给的是 http，WebView 里会被混合内容拦）。 */
  const liveVideo = httpsify((imgs[imgIndex] as { liveVideo?: string } | undefined)?.liveVideo)
  const live = useLiveVideoBlob(liveVideo, liveRetry)
  const liveFailure = live.error ?? liveDecodeError
  useEffect(() => setLiveDecodeError(undefined), [imgIndex, item?.id])
  /**
   * ⚠️ 所有 hook 必须在 `if (!detail) return null` **之前**调用。
   * 曾把 useState/useEffect 放在 early return 之后:detail 为 null 时提前返回(少调),
   * 有值时多调 → React 抛「Rendered more/fewer hooks than expected」,弹窗整块崩掉打不开。
   */
  useEffect(() => setImgIndex(0), [item?.id])
  useEffect(() => {
    // ⚠️ 只在弹窗真正打开时挂监听:本组件常驻在 App 里,无条件监听会让 ←/→ 在
    // 任何页面(阅读视图、播放页)被吞掉 —— 播放页的左右键是跳转/快进。
    if (!detail || !multi) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setImgIndex((i) => (i - 1 + imgs.length) % imgs.length)
      else if (e.key === "ArrowRight") setImgIndex((i) => (i + 1) % imgs.length)
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [detail, multi, imgs.length])
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
  /** 当前图片真实比例。容器比例 === 图片比例时 contain 恰好填满,不留缝也不裁切。 */
  const imgRatio = (() => {
    const it = item as { aspectRatio?: number; width?: number; height?: number; images?: Array<{ width?: number; height?: number }> }
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
  return (
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
            <button className="btn btn-quiet" onClick={() => openExternalSafely(item.url)}>
              <Icon name="external" size={14} /> 打开原文
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn btn-secondary" onClick={close}>
            关闭
          </button>
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
            {cover ? (
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
                {/* 实况图：切到即自动拉取并静音循环播；点一下暂停/续播。
                    隧道完成前继续显示静态图（比黑屏/碎播放器可解释）。 */}
                {liveVideo && live.blobUrl && !liveDecodeError ? (
                  <video
                    className="social-detail-video"
                    src={live.blobUrl}
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
                    // 解码失败（编码不支持等）→ 退回静态图，脚注说明原因。
                    onError={() => setLiveDecodeError("视频无法解码")}
                  />
                ) : (
                  <MediaImage src={cover} alt={item.title} loading="eager" contain />
                )}
                {/* 自动播失败时才出现的重试入口（隧道 403/超时/过期）。 */}
                {liveVideo && live.error && !live.loading ? (
                  <button
                    className="btn btn-secondary btn-sm social-detail-live"
                    onClick={() => setLiveRetry((n) => n + 1)}
                  >
                    <Icon name="refresh" size={13} /> 重试
                  </button>
                ) : null}
              </span>
            ) : (
              <span className="cover-missing">
                <Icon name="image" size={24} />
              </span>
            )}
          </div>

          <div className="social-detail-info" {...overlayBlock("social-detail-info", `social:detail:info:${itemKey(item)}`)}>
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
              <div className="social-detail-text social-detail-html" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: bodyHtml }} />
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
            {/* 状态脚注:只在「补全中 / 补全失败 / 实况加载中 / 实况失败」时出现。
                完整内容 + 正常播放不需要解释。 */}
            {resolving || resolveFailed || (liveVideo && (live.loading || liveFailure)) ? (
              <p className="social-detail-note">
                {resolving || live.loading ? (
                  <Icon name="loader" size={13} className="animate-spin" />
                ) : (
                  <Icon name="alert" size={13} />
                )}
                <span>
                  {resolving
                    ? "正在向源站补全详情…"
                    : liveVideo && live.loading
                      ? "正在加载实况视频…"
                      : resolveFailed
                        ? `详情补全失败：${detail.error}（列表页只带封面与标题）`
                        : `实况视频加载失败：${liveFailure}（已显示静态图）`}
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
  )
}
