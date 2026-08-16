/**
 * ScanLoginDialog — 扫码登录弹窗。
 *
 * 遍历可用渠道找到支持扫码登录的(channel 级能力 Loginable,core ChannelInfo
 * 投影 `loginable`),按平台前缀去重取第一个(先 xhs),调 DataLayer.scanLogin
 * 驱动浏览器扫码。二维码 data URL 经 emitQr 回调推给 UI 渲染 <img>。
 * 状态:等待二维码 → 出码 → 扫码确认 → 成功 / 失败。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { useDesktop } from "../store.ts"

/** 平台前缀 → 展示名(先 xhs;weibo 等后续扩展)。 */
const PLATFORM_LABEL: Record<string, string> = {
  xhs: "小红书",
  weibo: "微博",
  bili: "哔哩哔哩",
}

type Phase = "idle" | "qr" | "success" | "error"

export function ScanLoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const dl = useDesktop((s) => s.dl)
  const [phase, setPhase] = useState<Phase>("idle")
  const [qr, setQr] = useState("")
  const [error, setError] = useState("")
  // 原本就已登录(未触发扫码即检测到),提示而非重新出码。
  const [alreadyLoggedIn, setAlreadyLoggedIn] = useState(false)
  // 组件卸载/关闭后,异步回调不再 setState。
  const mounted = useRef(true)

  // 可登录渠道:按平台前缀去重,取第一个(先 xhs)。
  const loginTarget = useMemo(() => {
    if (!dl) return undefined
    const seen = new Set<string>()
    for (const c of dl.listChannels()) {
      if (!c.loginable) continue
      const platform = c.key.split(":")[0]
      if (seen.has(platform)) continue
      seen.add(platform)
      return { key: c.key, label: PLATFORM_LABEL[platform] ?? platform }
    }
    return undefined
  }, [dl])

  // 打开即驱动扫码(自动开始);登录进行中关闭 Dialog 只卸载 UI,scanLogin 继续跑。
  useEffect(() => {
    mounted.current = true
    if (!open || !dl || !loginTarget) return
    setPhase("idle")
    setQr("")
    setError("")
    setAlreadyLoggedIn(false)
    const emitQr = (dataUrl: string | null) => {
      if (!mounted.current) return
      if (dataUrl) {
        setQr(dataUrl)
        setPhase("qr")
      }
    }
    dl
      .scanLogin(loginTarget.key, emitQr)
      .then((r) => {
        if (!mounted.current) return
        setAlreadyLoggedIn(r.alreadyLoggedIn === true)
        setPhase("success")
      })
      .catch((e) => {
        if (!mounted.current) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase("error")
      })
    return () => {
      mounted.current = false
    }
  }, [open, dl, loginTarget])

  if (!open) return null
  const label = loginTarget?.label ?? "平台"

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[360px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-xl focus:outline-none"
        >
          {/* 头 */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-sm font-semibold">扫码登录</Dialog.Title>
            <Dialog.Close className="p-1 hover:bg-muted rounded">
              <X className="h-4 w-4 text-muted-foreground" />
            </Dialog.Close>
          </div>

          {/* 体 */}
          <div className="flex flex-col items-center gap-3 px-6 py-6">
            {phase === "idle" && (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">正在准备{label}二维码…</p>
              </>
            )}

            {phase === "qr" && (
              <>
                <img src={qr} alt="登录二维码" className="h-44 w-44 rounded border border-border" />
                <p className="text-sm text-muted-foreground">
                  用{label} App 扫码,并在手机上确认登录
                </p>
              </>
            )}

            {phase === "success" && (
              <>
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <p className="text-center text-sm">
                  {alreadyLoggedIn
                    ? `${label}已登录(无需重复扫码)`
                    : `${label}已登录,登录态将用于后续抓取`}
                </p>
              </>
            )}

            {phase === "error" && (
              <>
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="text-center text-sm text-destructive">{error}</p>
              </>
            )}
          </div>

          {/* 脚 */}
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Dialog.Close className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              {phase === "success" ? "完成" : "关闭"}
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
