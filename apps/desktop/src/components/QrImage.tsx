/**
 * QrImage —— 把 `scanLogin` 推回来的字符串渲染成二维码。
 *
 * ⚠️ emitQr 的载荷有两种语义(见 crawler 的 Loginable):
 *   - 已是 `data:image/...` 的 data URL(xhs 浏览器路径)→ 直接用;
 *   - 其余视作**二维码内容**(bili 纯 HTTP 协议只给一段 URL)→ 本地编码。
 * 编码放在这里而不是 crawler:这是展示关切,也免得把 QR 库拖进抓取层。
 */
import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { Icon } from "./Icon.tsx"

export function QrImage({ payload, size = 200 }: { payload: string; size?: number }) {
  const isDataUrl = payload.startsWith("data:image/")
  const [src, setSrc] = useState<string | null>(isDataUrl ? payload : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
    if (isDataUrl) {
      setSrc(payload)
      return
    }
    let cancelled = false
    // 纠错级别 M:二维码中心有平台 logo 时也能扫(留出容错)。
    void QRCode.toDataURL(payload, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        // 编码失败要落到失败态,否则 src 一直是 null → 永久转圈的 loader。
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [payload, isDataUrl, size])

  return (
    <div className="qr-frame" style={{ width: size + 24, height: size + 24 }}>
      {src ? (
        <img src={src} alt="登录二维码" width={size} height={size} />
      ) : failed ? (
        <span className="stack" style={{ gap: "var(--sp-2)", alignItems: "center", textAlign: "center" }}>
          <Icon name="alert" size={24} />
          <span className="t-micro t-dim">二维码生成失败,请关闭后重试</span>
        </span>
      ) : (
        <Icon name="loader" size={24} className="animate-spin" />
      )}
    </div>
  )
}
