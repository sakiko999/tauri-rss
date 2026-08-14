/**
 * 验证 YouTube 直链提取(真实网络)。
 *
 * 注入 Node host,走 crawler 的 youtube client:
 *   1. resolveYoutubeStreams → 直链/DASH 流
 *   2. 打印 format/quality/rate/url/dashManifest
 *   3. DASH 流断言 MPD 含目标 Representation + Initialization Range
 *
 * 用法:bun run packages/crawler/src/example/youtube_play.ts [videoId|直播id]
 */
import { injectNodeHost } from "@tauri-playground/host"
import { resolveYoutubeStreams } from "../platform/youtube"

const VIDEO_ID = process.argv[2] ?? "dQw4w9WgXcQ" // 默认:Rick Astley(人人可播)

injectNodeHost()

async function main() {
  console.log("videoId:", VIDEO_ID)
  const streams = await resolveYoutubeStreams(VIDEO_ID)
  console.log("流数:", streams.length)
  for (const s of streams) {
    console.log("  format:", s.format, "| quality:", s.quality ?? "-", "| rate:", s.rate ?? "-")
    console.log("  headers:", JSON.stringify(s.headers))
    if (s.dashManifest) {
      console.log("  dashManifest:", s.dashManifest.length, "字符")
      // 断言 MPD 含 Representation + Initialization range(分片拉取依据)。
      const hasRep = /<Representation id="\d+"/.test(s.dashManifest)
      const hasInit = /<Initialization range="\d+-\d+"/.test(s.dashManifest)
      console.log(`  MPD 断言: Representation=${hasRep ? "✓" : "✗"} Initialization=${hasInit ? "✓" : "✗"}`)
    } else {
      console.log("  url:", s.url.slice(0, 120) + (s.url.length > 120 ? "…" : ""))
    }
  }
  const f0 = streams[0]?.format
  if (f0 === "dash") {
    console.log("\n✅ 拿到 DASH 流(音视频分离,dash.js 合成播放)")
  } else if (f0 === "mp4") {
    console.log("\n⚠️ 只有渐进式 mp4(无 avc1 DASH 档或装配失败),原生播放")
  } else if (f0 === "hls") {
    console.log("\n⚠️ HLS 直链(直播/受限),hls.js 播放")
  }
}

main().catch((e) => {
  console.error("❌ 失败:", e)
  process.exit(1)
})
