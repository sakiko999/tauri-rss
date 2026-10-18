/**
 * AccountPage —— 账号与凭证。
 *
 * 每个可登录平台一张卡:cookie 贴入 / 保存 / 清除,以及**真实扫码登录**
 * (core `dl.scanLogin(channelKey, emitQr)` 驱动 Rust 侧的浏览器扫码,二维码是
 * 后端推回来的真图 —— new_desktop 的假 QR 不移植)。
 *
 * cookie 落 core settings 对应字段(bilibiliCookie / weiboCookie / xhsCookie),
 * refresh 时按 channelKey 前缀自动注入。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { ChannelInfo } from "@amoeba/core"
import { useDesktop } from "../../store/index.ts"
import { Banner, InfoRow, SideCard } from "../../components/StateBlock.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Modal } from "../../components/Modal.tsx"
import { QrImage } from "../../components/QrImage.tsx"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { platformOf } from "../../lib/subscriptions.ts"

/** 平台前缀 → 展示名 + 对应的 settings cookie 字段。 */
const PLATFORM_META: Record<
  string,
  { label: string; field: "bilibiliCookie" | "weiboCookie" | "xhsCookie" | "douyinCookie"; note: string }
> = {
  bili: {
    label: "B站",
    field: "bilibiliCookie",
    note: "解锁视频 1080P / 直播原画档位；弹幕与动态也依赖登录态。",
  },
  weibo: { label: "微博", field: "weiboCookie", note: "关注人时间线与热搜词流需要登录。" },
  xhs: { label: "小红书", field: "xhsCookie", note: "用户主页需要登录；推荐流不登录也能看。" },
  douyin: { label: "抖音", field: "douyinCookie", note: "解锁直播原画档位；搜索类能力始终需要账号。" },
}

export function AccountPage() {
  const dl = useDesktop((s) => s.dl)
  const settings = useDesktop((s) => s.settings)
  const setSetting = useDesktop((s) => s.setSetting)
  const toast = useDesktop((s) => s.toast)
  const [scanTarget, setScanTarget] = useState<ChannelInfo | null>(null)

  // 每个平台取第一个可登录渠道(用于扫码)。⚠️ 平台提取用 platformOf:抖音渠道前缀是
  // live:douyin,裸 split(":") 会得 "live" 而永远匹配不到抖音卡。
  const loginable = useMemo(() => {
    const m: Record<string, ChannelInfo> = {}
    for (const c of dl?.listChannels() ?? []) {
      if (!c.loginable) continue
      const p = platformOf(c.key)
      if (!m[p]) m[p] = c
    }
    return m
  }, [dl])

  if (!settings) return null

  return (
    <div className="page" {...overlayBlock("account-page", "page:account")}>
      <div className="scroll-area page-scroll" {...overlayBlock("account-scroll", "page:account:scroll")}>
        <div className="page-wrap" {...overlayBlock("account-wrap", "page:account:wrap")}>
          <h1 className="page-title">账号与凭证</h1>
          <p className="page-lead">
            凭证只存本地，也只会随对应平台的请求发出。填了凭证就自动应用到同平台的所有订阅。
          </p>

          <Banner tone="info" icon="info">
            <span className="banner-title">凭证到期了怎么办</span>
            登录态有期限（各平台从几天到数月不等）。失效时抓取会失败、侧栏对应订阅标红，
            但旧内容会保留，不会空窗。重新扫码或粘贴新凭证即可恢复。
          </Banner>

          <div className="stack" style={{ marginTop: "var(--sp-6)" }}>
            {(Object.keys(PLATFORM_META) as Array<keyof typeof PLATFORM_META>).map((p) => (
              <CredentialCard
                key={p}
                platform={p}
                value={settings[PLATFORM_META[p].field]}
                onSave={(v) => setSetting(PLATFORM_META[p].field, v)}
                onToast={toast}
                canScan={!!loginable[p]}
                onScan={() => setScanTarget(loginable[p] ?? null)}
              />
            ))}
          </div>

          <SideCard title="不登录能用什么" icon="info">
            <ul className="platform-notes" style={{ padding: "var(--sp-2) 0" }}>
              <li>B站：热门 / 排行榜 / 视频 720P 与直播弹幕；动态与高清档位要登录。</li>
              <li>微博：热搜列表；关注人时间线与热搜词流要登录。</li>
              <li>小红书：推荐流；用户主页要登录。</li>
              <li>斗鱼 / 虎牙 / YouTube 直播：全部可用；抖音直播可看，登录后解锁原画。</li>
            </ul>
          </SideCard>
        </div>
      </div>

      <ScanLoginModal channel={scanTarget} onClose={() => setScanTarget(null)} />
    </div>
  )
}

function CredentialCard({
  platform,
  value,
  onSave,
  onToast,
  canScan,
  onScan,
}: {
  platform: string
  value: string
  onSave: (v: string) => Promise<void>
  onToast: (tone: "ok" | "warn" | "error", title: string, text?: string) => void
  canScan: boolean
  onScan: () => void
}) {
  const meta = PLATFORM_META[platform]!
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)

  // 外部(扫码成功写库)改了值 → 同步进输入框。
  useEffect(() => setDraft(value), [value])

  const dirty = draft !== value
  const configured = !!value

  return (
    <SideCard title={meta.label} icon={platform === "bili" ? "radio" : "message"}>
      <div style={{ padding: "var(--sp-3) 0" }}>
        <InfoRow k="状态">
          {configured ? <span className="tag tag-ok">已配置</span> : <span className="tag">未配置（匿名）</span>}
        </InfoRow>
        <InfoRow k="用途">{meta.note}</InfoRow>
        <InfoRow k="长度">{configured ? `${value.length} 字符` : "—"}</InfoRow>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`ck-${platform}`}>
          登录凭证
        </label>
        <textarea
          id={`ck-${platform}`}
          className="textarea mono"
          value={draft}
          placeholder="从浏览器已登录页面复制完整凭证"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>

      <div className="inline-row" style={{ paddingTop: "var(--sp-3)" }}>
        <button
          className="btn btn-primary"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(draft.trim())
              onToast("ok", `${meta.label} 凭证已保存`, "后续同平台订阅的抓取会自动带上。")
            } catch (e) {
              // 保存失败必须可见(旧代码无 catch → 只有 unhandled rejection,界面静默)。
              onToast("error", `${meta.label} 凭证保存失败`, e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon name="check" size={14} /> 保存
        </button>
        {canScan ? (
          <button className="btn btn-secondary" onClick={onScan}>
            <Icon name="qr" size={14} /> 扫码登录
          </button>
        ) : null}
        <button
          className="btn btn-quiet"
          disabled={!configured || busy}
          onClick={async () => {
            if (!window.confirm(`清除 ${meta.label} 凭证？相关订阅会退回匿名档位。`)) return
            setBusy(true)
            try {
              await onSave("")
              onToast("warn", `${meta.label} 凭证已清除`)
            } catch (e) {
              onToast("error", `${meta.label} 凭证清除失败`, e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Icon name="trash" size={14} /> 清除
        </button>
      </div>
    </SideCard>
  )
}

/** 扫码登录(真实:core scanLogin 驱动后端出码)。 */
function ScanLoginModal({ channel, onClose }: { channel: ChannelInfo | null; onClose: () => void }) {
  const dl = useDesktop((s) => s.dl)
  const setSetting = useDesktop((s) => s.setSetting)
  const toast = useDesktop((s) => s.toast)
  const [qr, setQr] = useState("")
  const [phase, setPhase] = useState<"idle" | "qr" | "success" | "error">("idle")
  const [error, setError] = useState("")
  const [already, setAlready] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    if (!channel || !dl) return
    mounted.current = true
    setPhase("idle")
    setQr("")
    setError("")
    setAlready(false)
    dl.scanLogin(channel.key, (dataUrl) => {
      if (!mounted.current || !dataUrl) return
      setQr(dataUrl)
      setPhase("qr")
    })
      .then(async (r) => {
        if (!mounted.current) return
        setAlready(r.alreadyLoggedIn === true)
        setPhase("success")
        // core 已按平台前缀写库(scanLogin 内部),这里把 UI 的 settings 同步过来,
        // 凭证卡片的输入框才会立刻显示新 cookie。
        const field = cookieFieldOf(channel.key)
        if (field) {
          const s = await dl.settings.get()
          await setSetting(field as "bilibiliCookie", s[field as "bilibiliCookie"])
        }
        toast("ok", "登录成功", `${channel.name} 的凭证已保存。`)
      })
      .catch((e) => {
        if (!mounted.current) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase("error")
      })
    return () => {
      mounted.current = false
    }
  }, [channel?.key, dl])

  if (!channel) return null
  const label = PLATFORM_META[platformOf(channel.key)]?.label ?? channel.name

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`扫码登录 ${label}`}
      desc="用手机 App 扫码并在手机端确认"
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-secondary" onClick={onClose}>
            {phase === "success" ? "完成" : "关闭"}
          </button>
        </>
      }
    >
      <div className="qr-wrap">
        {phase === "idle" ? (
          <>
            <Icon name="loader" size={40} className="animate-spin t-dim" />
            <p className="t-small t-muted">正在准备二维码…</p>
          </>
        ) : null}
        {phase === "qr" ? (
          <>
            {/* 载荷可能是 data URL(xhs)或待编码文本(bili),QrImage 两者都吃。 */}
            <QrImage payload={qr} />
            <p className="qr-status t-small t-muted">用 {label} App 扫码,并在手机上确认登录</p>
          </>
        ) : null}
        {phase === "success" ? (
          <div className="qr-success">
            <span className="state-glyph state-glyph-ok">
              <Icon name="checkCircle" size={26} />
            </span>
            <p className="t-small">{already ? `${label}已登录（无需重复扫码）` : `${label} 已登录,凭证已保存`}</p>
          </div>
        ) : null}
        {phase === "error" ? <Banner tone="error" icon="alert">{error}</Banner> : null}
      </div>
    </Modal>
  )
}

function cookieFieldOf(channelKey: string): string {
  if (channelKey.startsWith("bili:")) return "bilibiliCookie"
  if (channelKey.startsWith("weibo:")) return "weiboCookie"
  if (channelKey.startsWith("xhs:")) return "xhsCookie"
  if (channelKey.startsWith("live:douyin") || channelKey.startsWith("douyin:")) return "douyinCookie"
  return ""
}
