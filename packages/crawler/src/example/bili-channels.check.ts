/**
 * B 站合集 / 视频列表 / 收藏夹参数自检 ——
 * `bun packages/crawler/src/example/bili-channels.check.ts`
 *
 * 只测纯归一化逻辑(不联网):
 *   - 合集:裸 ID、collectiondetail?sid=、season_id=、视频链接/BV 号;
 *   - 视频列表:裸 ID、/lists/<sid>、seriesdetail?sid=、list/<mid>?sid=;
 *   - 收藏夹:裸 ID、favlist?fid=;
 *   - 非 bilibili host / 缺 ID / 空串 → null。
 */

import { parseBiliFavlistRef, parseBiliSeasonRef, parseBiliSeriesRef } from "../channels/bili/refs.ts"
import { ugc } from "../channels/bili/video-common.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

console.log("合集:")
ok(parseBiliSeasonRef("2974525")?.seasonId === "2974525", "裸 seasonId")
ok(
  parseBiliSeasonRef("https://space.bilibili.com/1557073149/channel/collectiondetail?sid=2974525")?.seasonId ===
    "2974525",
  "collectiondetail?sid=",
)
ok(parseBiliSeasonRef("bilibili.com/x?season_id=2974525")?.seasonId === "2974525", "season_id=（无 scheme）")
ok(parseBiliSeasonRef("https://www.bilibili.com/video/BV1Tb421b7mi")?.videoId === "BV1Tb421b7mi", "视频链接 → videoId")
ok(parseBiliSeasonRef("BV1Tb421b7mi")?.videoId === "BV1Tb421b7mi", "裸 BV 号 → videoId")
ok(parseBiliSeasonRef("av12345")?.videoId === "av12345", "av 号 → videoId")
ok(parseBiliSeasonRef("https://example.com/video/BV1Tb421b7mi") === null, "非 B 站 host → null")
ok(parseBiliSeasonRef("hello") === null, "非法输入 → null")
ok(parseBiliSeasonRef("") === null, "空串 → null")

console.log("视频列表:")
ok(parseBiliSeriesRef("358495")?.seriesId === "358495", "裸 seriesId")
ok(
  parseBiliSeriesRef("https://space.bilibili.com/1557073149/lists/358495?type=series")?.seriesId === "358495",
  "/lists/<sid>",
)
ok(
  parseBiliSeriesRef("https://space.bilibili.com/1557073149/channel/seriesdetail?sid=358495")?.seriesId === "358495",
  "seriesdetail?sid=",
)
ok(parseBiliSeriesRef("https://www.bilibili.com/list/1557073149?sid=358495")?.seriesId === "358495", "list/<mid>?sid=")
ok(parseBiliSeriesRef("space.bilibili.com/1557073149/lists/abc") === null, "非数字 sid → null")
ok(parseBiliSeriesRef("https://example.com/lists/358495") === null, "非 B 站 host → null")

console.log("收藏夹:")
ok(parseBiliFavlistRef("1052622027")?.mediaId === "1052622027", "裸 mediaId")
ok(
  parseBiliFavlistRef("https://space.bilibili.com/686127/favlist?fid=1052622027&ftype=create")?.mediaId ===
    "1052622027",
  "favlist?fid=",
)
ok(parseBiliFavlistRef("bilibili.com/x?media_id=1052622027")?.mediaId === "1052622027", "media_id=（无 scheme）")
ok(parseBiliFavlistRef("https://space.bilibili.com/686127/favlist") === null, "缺 fid → null")
ok(parseBiliFavlistRef("https://example.com/favlist?fid=1052622027") === null, "非 B 站 host → null")

// 会员/充电专属标记：两个字段来源都要覆盖。
// space arc/search 没有 rights 对象，只有 is_charging_arc（2026-10-26 线上漏标回归）。
console.log("会员/充电专属:")
{
  const base = { title: "t", bvid: "BV1xx411c7mD", pubdate: 1_700_000_000 }
  ok(ugc("bili:user_video", 0, { ...base, charging: true }).membersOnly === true, "is_charging_arc=true → membersOnly")
  ok(ugc("bili:user_video", 0, { ...base, charging: false }).membersOnly === undefined, "非充电不出标记")
  ok(ugc("bili:user_video", 0, { ...base, rights: { ugc_pay: 1 } }).membersOnly === true, "rights.ugc_pay 仍生效")
  ok(
    ugc("bili:user_video", 0, { ...base, rights: { pay: 0, arc_pay: 0 } }).membersOnly === undefined,
    "rights 全 0 不误标",
  )
}

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
