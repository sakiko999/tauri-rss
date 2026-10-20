/**
 * YouTube 频道扩展自检 —— `bun packages/crawler/src/example/youtube-channels.check.ts`
 *
 * 不联网,锁三件纯逻辑:
 *   - `parseYoutubeLiveShelves`:实测布局(richGridRenderer → richSectionRenderer →
 *     richShelfRenderer)的栏目/条目解析、LIVE badge 过滤、"watching"/"views" 区分;
 *   - `youtubeShelfSlug` / `normalizeYoutubeLiveCategory`:栏目名 → slug;
 *   - `normalizeYoutubePlaylistId`:裸 ID / 三种 URL / 私有列表拒收。
 */
import { normalizeYoutubeLiveCategory, parseYoutubeLiveShelves, youtubeShelfSlug } from "@amoeba/resolve"
import { normalizeYoutubePlaylistId } from "../channels/youtube/refs.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

// ── 1. 栏目名 → slug ─────────────────────────────────────────────────────────
console.log("栏目 slug:")
ok(youtubeShelfSlug("Live Now") === "hot", `Live Now → hot（得 ${youtubeShelfSlug("Live Now")}）`)
ok(
  youtubeShelfSlug("Live Now - Gaming") === "gaming",
  `Live Now - Gaming → gaming（得 ${youtubeShelfSlug("Live Now - Gaming")}）`,
)
ok(
  youtubeShelfSlug("Live Now - News") === "news",
  `Live Now - News → news（得 ${youtubeShelfSlug("Live Now - News")}）`,
)
ok(
  youtubeShelfSlug("Recent Live Streams") === "recent-live-streams",
  `非 Live Now 栏目小写连字符（得 ${youtubeShelfSlug("Recent Live Streams")}）`,
)
ok(normalizeYoutubeLiveCategory("Gaming") === "gaming", "裸栏目名大小写归一")
ok(normalizeYoutubeLiveCategory("Live Now - Sports") === "sports", "完整栏目名归一")
ok(normalizeYoutubeLiveCategory("gaming!") === "gaming", "标点归一成连字符后去掉")
ok(normalizeYoutubeLiveCategory("") === null, "空串 → null")
ok(normalizeYoutubeLiveCategory("a") === null, "过短 → null")

// ── 2. 直播页解析（结构按 2026-10-20 实测） ──────────────────────────────────
console.log("直播页解析:")
const video = (id: string, title: string, viewers: string, live: boolean, owner = "Channel") => ({
  videoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: owner }] },
    viewCountText: { simpleText: viewers },
    thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 480 }] },
    thumbnailOverlays: [
      live
        ? { thumbnailOverlayTimeStatusRenderer: { text: { runs: [{ text: "LIVE" }] } } }
        : { thumbnailOverlayTimeStatusRenderer: { text: { simpleText: "57:17" } } },
    ],
  },
})
const raw = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  // 顶部轮播：没有 richShelfRenderer / 标题，跳过
                  { richSectionRenderer: { content: { carouselItemRenderer: {} } } },
                  {
                    richSectionRenderer: {
                      content: {
                        richShelfRenderer: {
                          title: { runs: [{ text: "Live Now" }] },
                          contents: [
                            { richItemRenderer: { content: video("aaa", "Live A", "19,926 watching", true) } },
                            { richItemRenderer: { content: video("bbb", "Replay B", "25,198,023 views", false) } },
                          ],
                        },
                      },
                    },
                  },
                  {
                    richSectionRenderer: {
                      content: {
                        richShelfRenderer: {
                          title: { simpleText: "Live Now - News" },
                          contents: [
                            { richItemRenderer: { content: video("ccc", "News C", "2,472 watching", true) } },
                            { richItemRenderer: { content: video("ddd", "Upcoming D", "5 waiting", false) } },
                          ],
                        },
                      },
                    },
                  },
                  // 旧布局兼容：直接 richShelfRenderer
                  {
                    richShelfRenderer: {
                      title: { simpleText: "Live Now - Sports" },
                      contents: [{ richItemRenderer: { content: video("eee", "Sport E", "740 watching", true) } }],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
}
const shelves = parseYoutubeLiveShelves(raw)
ok(shelves.length === 3, `解析出 3 个栏目（得 ${shelves.length}）`)
const hot = shelves.find((s) => s.slug === "hot")
ok(hot?.title === "Live Now", `Live Now 标题（得 ${hot?.title}）`)
ok(hot?.hits.length === 1, `Live Now 只留 LIVE 条目（得 ${hot?.hits.length}）`)
ok(hot?.hits[0]?.videoId === "aaa", `LIVE 条目 id（得 ${hot?.hits[0]?.videoId}）`)
ok(hot?.hits[0]?.viewers === 19926, `"19,926 watching" → 19926（得 ${hot?.hits[0]?.viewers}）`)
ok(hot?.hits[0]?.title === "Live A", `标题（得 ${hot?.hits[0]?.title}）`)
ok(hot?.hits[0]?.channelTitle === "Channel", `频道名（得 ${hot?.hits[0]?.channelTitle}）`)
const news = shelves.find((s) => s.slug === "news")
ok(news?.hits.length === 1, `News 过滤掉 "waiting" 预告（得 ${news?.hits.length}）`)
ok(news?.hits[0]?.viewers === 2472, `News 观看数（得 ${news?.hits[0]?.viewers}）`)
const sports = shelves.find((s) => s.slug === "sports")
ok(sports?.hits.length === 1, "旧布局 richShelfRenderer 也解析")
ok(parseYoutubeLiveShelves({}).length === 0, "空响应 → 空数组（不抛错）")

// ── 3. playlistId 归一 ──────────────────────────────────────────────────────
console.log("playlistId:")
const PL = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI"
ok(normalizeYoutubePlaylistId(PL) === PL, "裸 ID")
ok(normalizeYoutubePlaylistId(`https://www.youtube.com/playlist?list=${PL}`) === PL, "playlist URL")
ok(normalizeYoutubePlaylistId(`https://www.youtube.com/watch?v=abc12345678&list=${PL}`) === PL, "watch URL")
ok(normalizeYoutubePlaylistId(`youtu.be/abc12345678?list=${PL}`) === PL, "youtu.be 无 scheme")
ok(normalizeYoutubePlaylistId(`https://music.youtube.com/playlist?list=${PL}`) === PL, "music.youtube.com")
ok(normalizeYoutubePlaylistId("RDabc12345678") === null, "RD（Mix）拒收")
ok(normalizeYoutubePlaylistId("WLabc12345678") === null, "WL（稍后再看）拒收")
ok(normalizeYoutubePlaylistId("LLabc12345678") === null, "LL（点赞）拒收")
ok(normalizeYoutubePlaylistId("https://example.com/playlist?list=" + PL) === null, "非 YouTube host 拒收")
ok(normalizeYoutubePlaylistId("") === null, "空串 → null")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
