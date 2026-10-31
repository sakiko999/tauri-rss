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

import type { ChannelInfo } from "@amoeba/core"
import { cookieFieldFor } from "@amoeba/core/pure"
import { browserCookieHostsOf, LOGIN_PLATFORMS, platformDef } from "@amoeba/platform"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "../../components/Button.tsx"
import { Icon } from "../../components/Icon.tsx"
import { Modal } from "../../components/Modal.tsx"
import { QrImage } from "../../components/QrImage.tsx"
import { Banner, InfoRow, SideCard } from "../../components/StateBlock.tsx"
import { confirmAction } from "../../lib/confirm.ts"
import { platformOf } from "../../lib/subscriptions.ts"
import { overlayBlock } from "../../lib/uiOverlay.ts"
import { useDesktop } from "../../store/index.ts"

type PlatformMeta = {
  label: string
  field: "bilibiliCookie" | "weiboCookie" | "xhsCookie" | "douyinCookie"
  note: string
  /** 未配置时渠道完全不可用（不是「降级为匿名」）。 */
  needsLogin?: boolean
}

/**
 * UI 文案（架构层只放平台身份/展示名/字段，见 `@amoeba/platform`）。
 * 平台 id 与登录字段来自单一权威表，这里不再重复。
 */
const PLATFORM_NOTES: Record<string, { note: string; needsLogin?: boolean }> = {
  bili: { note: "解锁视频 1080P / 直播原画档位；弹幕与动态也依赖登录态。" },
  weibo: { note: "关注人时间线与热搜词流需要登录。" },
  xhs: {
    note: "所有小红书渠道都需要登录；桌面抓取使用抓取浏览器的登录态，扫码登录才生效（手填 cookie 不会同步到浏览器）。",
    needsLogin: true,
  },
  douyin: { note: "解锁直播原画档位；搜索类能力始终需要账号。" },
}

/** 平台 → 展示名 + settings cookie 字段（平台表派生，R9）。 */
const PLATFORM_META: Record<string, PlatformMeta> = Object.fromEntries(
  LOGIN_PLATFORMS.map((id) => {
    const def = platformDef(id)!
    return [
      id,
      {
        label: def.label,
        field: def.cookieField as PlatformMeta["field"],
        ...(PLATFORM_NOTES[id] ?? { note: "" }),
      },
    ]
  }),
)

/**
 * 桌面抓取实际用的是抓取浏览器（WebView2）profile 的登录态，不是 settings 里的 cookie 串。
 * 「清除凭证」必须同时登出这些站点，否则只是清掉 UI 显示，下一次刷新仍以真实账号导航。
 * 只列**浏览器登录路径**的平台（表里的 browserCookieHosts）：B站是纯 HTTP 扫码，清
 * settings 即可，不该为此拉起抓取浏览器。
 */
const COOKIE_HOSTS: Record<string, string[]> = Object.fromEntries(
  LOGIN_PLATFORMS.flatMap((id) => {
    const hosts = browserCookieHostsOf(id)
    return hosts ? [[id, hosts] as const] : []
  }),
)

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
          <p className="page-lead">凭证只存本地，也只会随对应平台的请求发出。填了凭证就自动应用到同平台的所有订阅。</p>

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
  const dl = useDesktop((s) => s.dl)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const dirty = draft !== value

  // 外部(扫码成功写库 / 启动时的浏览器快照同步)改了值 → 同步进输入框。
  // ⚠️ 只在**未编辑**时跟随:启动 1.5s 后的后台同步可能落在用户粘贴到一半的瞬间,
  // 无条件 setDraft 会把未保存的输入静默覆盖掉(保存按钮还因 dirty 复位而置灰)。
  useEffect(() => {
    if (!dirty) setDraft(value)
  }, [value, dirty])

  const configured = !!value

  return (
    <SideCard title={meta.label} icon={platform === "bili" ? "radio" : "message"}>
      <div style={{ padding: "var(--sp-3) 0" }}>
        <InfoRow k="状态">
          {configured ? (
            <span className="tag tag-ok">已配置</span>
          ) : (
            <span className="tag">{meta.needsLogin ? "未配置（不可用）" : "未配置（匿名）"}</span>
          )}
        </InfoRow>
        <InfoRow k="用途">{meta.note}</InfoRow>
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
        <Button
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
        </Button>
        {canScan ? (
          <Button variant="secondary" onClick={onScan}>
            <Icon name="qr" size={14} /> 扫码登录
          </Button>
        ) : null}
        <Button
          variant="quiet"
          disabled={!configured || busy}
          onClick={async () => {
            const hosts = COOKIE_HOSTS[platform] ?? []
            const extra = hosts.length ? "会同时退出抓取浏览器里该平台的登录态（无法撤销）。\n\n" : ""
            const after = meta.needsLogin ? "相关订阅会因未登录而无法刷新。" : "相关订阅会退回匿名档位。"
            const ok = await confirmAction({
              title: `清除 ${meta.label} 凭证？`,
              desc: `${extra}${after}`,
              danger: true,
            })
            if (!ok) return
            setBusy(true)
            try {
              // 清浏览器登录态走 diagnostics（远端 = 服务端浏览器；本地 = appHost.browser），
              // 先清 cookie 再清 settings：中途失败不会出现「设置已清、账号还挂着」。
              await dl?.diagnostics.clearCookies(hosts)
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
        </Button>
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
    // ⚠️ 关闭弹窗必须 abort:登录持 `login:<platform>` lane 直到成功/超时(平台截止 5 分钟),
    // 不取消的话同平台登录重试会被旧 job 排队挡着,重开弹窗也出不了码（其它 lane 不受影响）。
    const ac = new AbortController()
    dl.scanLogin(
      channel.key,
      (dataUrl) => {
        if (!mounted.current || !dataUrl) return
        setQr(dataUrl)
        setPhase("qr")
      },
      { signal: ac.signal },
    )
      .then(async (r) => {
        if (!mounted.current) return
        setAlready(r.alreadyLoggedIn === true)
        setPhase("success")
        // core 已按平台前缀写库(scanLogin 内部),这里把 UI 的 settings 同步过来,
        // 凭证卡片的输入框才会立刻显示新 cookie。
        // ⚠️ 用**扫码返回值**而不是重读 dl.settings:镜像尚未收到 settings.changed 时
        // 会读到旧值并把它写回去,把刚登录的 cookie 覆盖掉(WS 断连时必然命中)。
        const field = cookieFieldFor(channel.key)
        if (field) await setSetting(field, r.cookie)
        toast("ok", "登录成功", `${channel.name} 的凭证已保存。`)
      })
      .catch((e) => {
        if (!mounted.current) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase("error")
      })
    return () => {
      mounted.current = false
      ac.abort()
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
          <Button variant="secondary" onClick={onClose}>
            {phase === "success" ? "完成" : "关闭"}
          </Button>
        </>
      }
    >
      <div className="qr-wrap">
        {phase === "idle" ? (
          <>
            <Icon name="loader" size={40} className="t-dim animate-spin" />
            <p className="t-small t-muted">正在准备二维码…</p>
          </>
        ) : null}
        {phase === "qr" ? (
          <>
            {/* 载荷可能是 data URL(xhs)或待编码文本(bili),QrImage 两者都吃。 */}
            <QrImage payload={qr} />
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
        {phase === "error" ? (
          <Banner tone="error" icon="alert">
            {error}
          </Banner>
        ) : null}
      </div>
    </Modal>
  )
}
