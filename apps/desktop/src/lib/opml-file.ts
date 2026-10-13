/**
 * opml-file — OPML 的文件进出(纯前端,零 Rust 依赖)。
 *
 * 导入:原生 `<input type="file">` 选文件 → FileReader 读文本。
 * 导出:`<a download>` + Blob 触发下载 —— WebView2 支持下载并把文件落到系统下载目录
 *   (`window.open` 会被 WebView 拦,但这种同源 blob 下载不会)。
 *   ⚠️ 若将来加 tauri-plugin-dialog/fs,可换成原生保存框(需重编 Rust)。
 */

/** 弹出文件选择器,读回文本。取消 → 返回 null。 */
export function pickOpmlFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".opml,.xml,text/xml,application/xml"
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"))
      reader.readAsText(file)
    }
    // 取消不触发 onchange(无可靠事件),靠 input 被回收即可;不 reject。
    input.click()
  })
}

/** 触发浏览器下载一个 .opml 文件。 */
export function exportOpmlFile(xml: string, filename = "tauri-rss-subscriptions.opml"): void {
  const blob = new Blob([xml], { type: "text/xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 会让部分环境下载失败(下载尚未起跳);延迟回收。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
