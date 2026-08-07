/**
 * 验证 YouTube 直链提取(真实网络)。
 *
 * 注入 Node host,走 crawler 的 youtube client:
 *   1. fetch RSS 拿 3Blue1Brown 最新 videoId
 *   2. resolveYoutubeStreams → 真实 mp4 直链
 *   3. 打印直链 + headers
 *
 * 用法:bun run packages/crawler/src/example/youtube_play.ts
 */
import { injectNodeHost } from "@tauri-playground/host"
import { resolveYoutubeStreams } from "../channels/youtube/client.ts"

const VIDEO_ID = process.argv[2] ?? "dQw4w9WgXcQ" // 默认:Rick Astley(人人可播)

injectNodeHost()

async function main() {
  console.log("videoId:", VIDEO_ID)
  const streams = await resolveYoutubeStreams(VIDEO_ID)
  console.log("直链数:", streams.length)
  for (const s of streams) {
    console.log("  format:", s.format)
    console.log("  url:", s.url.slice(0, 200) + (s.url.length > 200 ? "…" : ""))
    console.log("  headers:", JSON.stringify(s.headers))
  }
  if (streams[0]?.format === "mp4") {
    console.log("\n✅ 拿到渐进式 mp4 直链,可原生播放")
  } else if (streams[0]?.format === "hls") {
    console.log("\n⚠️ 只有 HLS 直链(直播/受限),需 hls.js")
  }
}

main().catch((e) => {
  console.error("❌ 失败:", e)
  process.exit(1)
})
