/**
 * ua — 跨平台共享 User-Agent 常量。
 *
 * 桌面 Chrome/126 完整串在 bili/youtube/weibo/rss 的 client 重复 7 份,统一此处。
 * 平台专属 UA(QQBrowser/Chrome 150/Oculus VR 等)留在各自平台模块,不混入。
 */

/** 桌面 Chrome 126(全平台通用;反爬按整串匹配,勿随意改)。 */
export const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
