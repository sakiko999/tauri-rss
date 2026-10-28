/**
 * YouTube 频道 InnerTube 解析自检 —— `bun packages/resolve/src/example/youtube-channel.check.ts`
 *
 * 守住两件事：
 *   1. 会员专属标记（新版 lockup 的 metadataRows badges / 旧版 videoRenderer 的
 *      BADGE_STYLE_TYPE_MEMBERS_ONLY）不能漏；
 *   2. 新版 lockup 的标题/封面/观看数/相对时间/continuation 都能取到。
 * 纯 fixture，不联网。
 */

import { parseYoutubeChannelVideos } from "../platform/youtube/channel.ts"

let failed = 0
const ok = (cond: unknown, msg: string): void => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failed += 1
    console.error(`  ✗ ${msg}`)
  }
}

function lockup(videoId: string, member: boolean): unknown {
  return {
    lockupViewModel: {
      contentId: videoId,
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: {
        lockupMetadataViewModel: {
          title: { content: `标题 ${videoId}` },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                {
                  metadataParts: [{ text: { content: "2.5M views" } }, { text: { content: "9 days ago" } }],
                  ...(member ? { badges: [{ badgeViewModel: { badgeText: "Members only" } }] } : {}),
                },
              ],
            },
          },
        },
      },
      contentImage: {
        thumbnailViewModel: {
          image: {
            sources: [
              { url: "https://x/s.jpg", width: 100 },
              { url: "https://x/l.jpg", width: 800 },
            ],
          },
        },
      },
    },
  }
}

const page = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  { richItemRenderer: { content: lockup("v1", true) } },
                  { richItemRenderer: { content: lockup("v2", false) } },
                  { richItemRenderer: { content: lockup("v1", true) } }, // 重复项
                  {
                    continuationItemRenderer: {
                      continuationEndpoint: { continuationCommand: { token: "tok-next" } },
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

const parsed = parseYoutubeChannelVideos(page)
console.log("新版 lockup:")
ok(parsed.videos.length === 2, `去重后 2 条(得 ${parsed.videos.length})`)
ok(parsed.videos[0]?.videoId === "v1", `videoId(得 ${parsed.videos[0]?.videoId})`)
ok(parsed.videos[0]?.membersOnly === true, "会员标记 true")
ok(parsed.videos[1]?.membersOnly === false, "公开视频 false")
ok(parsed.videos[0]?.title === "标题 v1", `标题(得 ${parsed.videos[0]?.title})`)
ok(parsed.videos[0]?.thumb === "https://x/l.jpg", `封面取最大宽(得 ${parsed.videos[0]?.thumb})`)
ok(parsed.videos[0]?.viewsText === "2.5M views", `观看数文本(得 ${parsed.videos[0]?.viewsText})`)
ok(parsed.videos[0]?.publishedText === "9 days ago", `相对时间(得 ${parsed.videos[0]?.publishedText})`)
ok(parsed.continuation === "tok-next", `continuation(得 ${parsed.continuation})`)

// 旧版 videoRenderer（NewPipe 同款判据）
const legacy = {
  contents: {
    sectionListRenderer: {
      contents: [
        {
          itemSectionRenderer: {
            contents: [
              {
                videoRenderer: {
                  videoId: "v3",
                  title: { runs: [{ text: "旧布局" }] },
                  badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_MEMBERS_ONLY" } }],
                  thumbnail: { thumbnails: [{ url: "https://x/legacy.jpg", width: 320 }] },
                  viewCountText: { simpleText: "1K views" },
                  publishedTimeText: { simpleText: "1 hour ago" },
                },
              },
              {
                videoRenderer: {
                  videoId: "v4",
                  title: { simpleText: "公开" },
                  badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_VERIFIED" } }],
                },
              },
            ],
          },
        },
      ],
    },
  },
}
const legacyParsed = parseYoutubeChannelVideos(legacy)
console.log("旧版 videoRenderer:")
ok(legacyParsed.videos.length === 2, `2 条(得 ${legacyParsed.videos.length})`)
ok(legacyParsed.videos[0]?.membersOnly === true, "MEMBERS_ONLY badge 识别")
ok(legacyParsed.videos[1]?.membersOnly === false, "其它 badge 不误判")
ok(legacyParsed.videos[0]?.thumb === "https://x/legacy.jpg", "旧版封面")
ok(legacyParsed.continuation === undefined, "没有 continuation")

// 非视频 lockup（频道页也混着 playlist/channel）必须跳过
const mixed = {
  contents: {
    lockupViewModel: {
      contentId: "PL123",
      contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST",
      metadata: { lockupMetadataViewModel: { title: { content: "播放列表" } } },
    },
  },
}
ok(parseYoutubeChannelVideos(mixed).videos.length === 0, "playlist lockup 不计入视频")

console.log(failed ? `\n${failed} 项失败` : "\n全部通过")
process.exit(failed ? 1 : 0)
