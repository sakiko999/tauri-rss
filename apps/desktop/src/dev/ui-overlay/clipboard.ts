/** 复制文本：Clipboard API 优先，失败回退到 textarea + execCommand。 */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // 回退
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.position = "fixed"
  ta.style.left = "-9999px"
  ta.style.top = "0"
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand("copy")
  } catch {
    // 忽略
  }
  ta.remove()
}
