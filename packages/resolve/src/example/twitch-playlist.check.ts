/**
 * Twitch master 解析 / login 归一化自检 ——
 * `bun packages/resolve/src/example/twitch-playlist.check.ts`
 *
 * 守护三个**静默错值**：
 *   1. `normalizeTwitchLogin` / router 把站内路由（`/videos/123`、clip 多段路径、
 *      `clips.twitch.tv/<slug>` 单段路径）或保留字当成频道名 —— 会产出永远离线的假频道；
 *   2. `normalizeTwitchCategory` 把任意 URL/多段路径当成分类 slug，或漏掉目录页链接 ——
 *      前者会拼出必然空结果的 `game(slug)`，后者让 `twitch:category` 永远报「分类无效」；
 *   3. usher master 的档位顺序**不是高→低**（实测 audio_only 夹在中间、1080p 靠后），
 *      而播放器选流契约是「取 `streams[0]`」。排序错了不会报错，只会静默降画质。
 */
import { parseTwitchMaster, twitchStreamsFromMaster } from "../platform/twitch/live.ts"
import { resolveRoute } from "../resolver/router.ts"
import { normalizeTwitchCategory, normalizeTwitchLogin } from "../utils/twitch.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

// ── 1. login 归一化 ────────────────────────────────────────────────────────────
console.log("login 归一化:")
const norm = (input: string | null | undefined, expected: string | null) => {
  const got = normalizeTwitchLogin(input)
  ok(got === expected, `${JSON.stringify(input)} → ${JSON.stringify(expected)}（得 ${JSON.stringify(got)}）`)
}

norm("shroud", "shroud")
norm("SHROUD", "shroud")
norm("@Shroud", "shroud")
norm("https://www.twitch.tv/shroud", "shroud")
norm("https://twitch.tv/Shroud?ref=x", "shroud")
norm("twitch.tv/shroud", "shroud")
norm("https://m.twitch.tv/shroud", "shroud")
norm("https://www.twitch.tv/%73hroud", "shroud") // 百分号编码
norm("  shroud  ", "shroud")

console.log("保留字 / 非频道路径:")
norm("videos", null)
norm("directory", null)
norm("search", null)
norm("settings", null)
norm("https://www.twitch.tv/videos/123", null)
norm("https://www.twitch.tv/shroud/clip/ObscureSlug", null)
norm("https://www.twitch.tv/", null)
// ⚠️ clip 页面是**单段路径**的另一个 host:不卡 host 会被归一成频道名。
norm("https://clips.twitch.tv/FunnySlug", null)
norm("clips.twitch.tv/FunnySlug", null)
norm("https://player.twitch.tv/shroud", null)
norm("https://dashboard.twitch.tv/xyz", null)

console.log("非法输入:")
norm("", null)
norm("   ", null)
norm(null, null)
norm(undefined, null)
norm("@", null)
norm("ab", null) // 少于 3 位
norm("a".repeat(26), null) // 超过 25 位
norm("shroud!", null)
norm("shroud-name", null) // 连字符不在 login 字符集
norm("sh rou", null)
norm("https://example.com/shroud", null) // 非 twitch 域
norm("https://nottwitch.tv/shroud", null)

// ── 1b. 分类 slug 归一化（twitch:category 的 `category` 参数）────────────────
console.log("分类 slug 归一化:")
const cat = (input: string | null | undefined, expected: string | null) => {
  const got = normalizeTwitchCategory(input)
  ok(got === expected, `${JSON.stringify(input)} → ${JSON.stringify(expected)}（得 ${JSON.stringify(got)}）`)
}

cat("just-chatting", "just-chatting") // 裸 slug
cat("JUST-CHATTING", "just-chatting") // 小写归一
cat("  just-chatting  ", "just-chatting")
cat("https://www.twitch.tv/directory/category/just-chatting", "just-chatting") // 目录页链接
cat("https://www.twitch.tv/directory/category/Just-Chatting?foo=1", "just-chatting")
cat("https://www.twitch.tv/directory/category/just-chatting/", "just-chatting") // 尾斜杠
cat("https://m.twitch.tv/directory/category/just-chatting", "just-chatting")
cat("twitch.tv/directory/category/just-chatting", "just-chatting") // 无 scheme
cat("https://www.twitch.tv/directory/category/just%2Dchatting", "just-chatting") // 百分号编码

console.log("分类非法输入:")
cat("", null)
cat("   ", null)
cat(null, null)
cat(undefined, null)
cat("a", null) // 少于 2 位
cat("a".repeat(65), null) // 超过 64 位
cat("just_chatting", null) // 下划线不在 slug 字符集
cat("just chatting", null)
cat("https://www.twitch.tv/just-chatting", null) // 单段路径不是目录页
cat("https://www.twitch.tv/directory", null)
cat("https://www.twitch.tv/directory/category", null)
cat("https://www.twitch.tv/directory/game/just-chatting", null) // 路径段不是 category
cat("https://www.twitch.tv/directory/category/just-chatting/extra", null) // 多段
cat("https://www.twitch.tv/directory/category/just%2Fchatting", null) // 解码后含斜杠
cat("https://example.com/directory/category/just-chatting", null) // 非 twitch 域
cat("https://clips.twitch.tv/directory/category/just-chatting", null) // 非频道域

console.log("router 只认频道域:")
ok(resolveRoute("https://www.twitch.tv/shroud")?.id === "shroud", "www 频道页命中")
ok(resolveRoute("https://m.twitch.tv/shroud")?.id === "shroud", "移动端频道页命中")
ok(resolveRoute("https://www.twitch.tv/%73hroud")?.id === "shroud", "百分号编码 login 命中")
ok(resolveRoute("https://clips.twitch.tv/FunnySlug") === null, "clip 页(单段路径)不命中")
ok(resolveRoute("https://www.twitch.tv/shroud/clip/ObscureSlug") === null, "频道内 clip 不命中")
ok(resolveRoute("https://www.twitch.tv/videos/123") === null, "VOD 页不命中")
ok(resolveRoute("https://nottwitch.tv/shroud") === null, "伪造域不命中")

// ── 2. master 解析 / 排序 ─────────────────────────────────────────────────────
// 刻意乱序：720p 在前、audio_only 排第二、1080p 倒数第二、480p 最后。
// 720p 用旧属性 NAME；1080p 用 usher v2 的 IVS-NAME；480p 两者都不给（走 URL 兜底）。
console.log("master 解析 / 排序:")
const MASTER = `#EXTM3U
#EXT-X-TWITCH-INFO:NODE="video-weaver.example",MANIFEST-CLUSTER="example"
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="720p60",AUTOSELECT=YES,DEFAULT=YES
#EXT-X-STREAM-INF:BANDWIDTH=3400000,RESOLUTION=1280x720,FRAME-RATE=60.000,CODECS="avc1.4d001f,mp4a.40.2",NAME="720p60"
https://video-weaver.example/hls/720p60/index-dvr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,CODECS="mp4a.40.2",IVS-NAME="audio_only"
https://video-weaver.example/hls/audio_only/index-dvr.m3u8
#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="1080p60",AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002a,mp4a.40.2",IVS-NAME="1080p60 (source)"
https://video-weaver.example/hls/1080p60/index-dvr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=852x480,FRAME-RATE=30.000,CODECS="avc1.4d001e,mp4a.40.2"
https://video-weaver.example/hls/480p30/index-dvr.m3u8
`

const variants = parseTwitchMaster(MASTER)
ok(variants.length === 4, `解析出 4 档（得 ${variants.length}）`)
ok(variants[0]?.height === 1080, `最高档在前 = 1080p（得 ${variants[0]?.height}）`)
ok(variants[0]?.quality === "1080p60 (source)", `1080p quality 取 IVS-NAME（得 ${variants[0]?.quality}）`)
ok(variants[0]?.bandwidth === 6_000_000, `1080p bandwidth（得 ${variants[0]?.bandwidth}）`)
ok(variants[0]?.frameRate === 60, `1080p frameRate（得 ${variants[0]?.frameRate}）`)
ok(variants[1]?.height === 720, `第二档 = 720p（得 ${variants[1]?.height}）`)
ok(variants[1]?.quality === "720p60", `720p quality 取旧属性 NAME（得 ${variants[1]?.quality}）`)
ok(variants[2]?.height === 480, `第三档 = 480p（得 ${variants[2]?.height}）`)
ok(variants[2]?.quality === "480p30", `480p quality 由 URL 兜底（得 ${variants[2]?.quality}）`)
ok(variants[3]?.height === undefined, `audio_only 无 RESOLUTION（得 ${variants[3]?.height}）`)
ok(variants[3]?.quality === "audio_only", `audio_only 排在最后（得 ${variants[3]?.quality}）`)
ok(variants[3]?.url.includes("/audio_only/"), "audio_only URL 正确")
ok(
  variants.every((v, i) => i === 0 || (variants[i - 1]!.height ?? -1) >= (v.height ?? -1)),
  "高度非递增（audio_only 的无高度视为最低）",
)

console.log("master → Stream[]（选流契约）:")
const streams = twitchStreamsFromMaster(MASTER)
ok(streams.length === 4, `4 条流（得 ${streams.length}）`)
ok(streams[0]?.rate === 1080, `streams[0].rate = 1080（播放器取首条；得 ${streams[0]?.rate}）`)
ok(streams[0]?.format === "hls", `format = hls（得 ${streams[0]?.format}）`)
ok(streams[0]?.quality === "1080p60 (source)", `quality 透传（得 ${streams[0]?.quality}）`)
ok(streams[3]?.quality === "audio_only" && streams[3]?.rate === undefined, "audio_only 最后且无 rate")
ok(
  streams.every((s) => s.format === "hls"),
  "全部为 hls",
)
ok(
  streams[0]?.url === "https://video-weaver.example/hls/1080p60/index-dvr.m3u8",
  "Stream.url 是 variant playlist（不是无 CORS 的 master）",
)

console.log("空 / 畸形 master:")
ok(parseTwitchMaster("").length === 0, "空串 → 0 档")
ok(parseTwitchMaster("#EXTM3U\n#EXT-X-ENDLIST\n").length === 0, "无 STREAM-INF → 0 档")
let threw = false
try {
  twitchStreamsFromMaster("#EXTM3U\n")
} catch {
  threw = true
}
ok(threw, "无可用档位必须抛错（不能静默返回空数组）")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
