/**
 * audioOnlyMpd 自检 —— `bun packages/player/src/utils/audio-only-mpd.check.ts`
 *
 * 输入样例镜像 resolve/utils/mpd.ts 的 buildMpd 模板(两层:MPD→Period→
 * AdaptationSet(video/audio)→Representation→BaseURL/SegmentBase)。player 不能
 * 依赖 resolve(分层),所以这里手抄模板形状 —— buildMpd 改版时此处跟着改。
 */
import assert from "node:assert/strict"

import { audioOnlyMpd } from "./audioOnlyMpd.ts"

const FULL_MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" mediaPresentationDuration="PT612.340S" minBufferTime="PT1.500S">
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">
<Representation id="80" mimeType="video/mp4" codecs="avc1.640028" bandwidth="2000000" width="1920" height="1080">
  <BaseURL>https://upos.example.com/v.mp4?e=rtt&amp;oi=1</BaseURL>
  <SegmentBase indexRange="907-1158">
    <Initialization range="0-906" />
  </SegmentBase>
</Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1">
<Representation id="30280" mimeType="audio/mp4" codecs="mp4a.40.2" bandwidth="320000">
  <BaseURL>https://upos.example.com/a.m4s?e=rtt&amp;oi=2</BaseURL>
  <SegmentBase indexRange="318-569">
    <Initialization range="0-317" />
  </SegmentBase>
</Representation>
    </AdaptationSet>
  </Period>
</MPD>`

// ① 正常剥离:只剩音轨,且 duration/MPD 骨架/音轨 BaseURL 原样保留。
const audio = audioOnlyMpd(FULL_MPD)
assert.ok(audio, "video+audio MPD 应剥出 audio-only")
assert.ok(!audio!.includes('mimeType="video/mp4"'), "剥后不应再有 video Representation")
assert.ok(audio!.includes("https://upos.example.com/a.m4s?e=rtt&amp;oi=2"), "音轨 BaseURL(含转义)必须原样保留")
assert.ok(audio!.includes('mediaPresentationDuration="PT612.340S"'), "duration 属性保留")
assert.ok(audio!.startsWith('<?xml version="1.0"'), "XML 头保留")
assert.equal((audio!.match(/<Representation /g) ?? []).length, 1, "只剩一个 Representation")
assert.equal(
  (audio!.match(/<AdaptationSet /g) ?? []).length,
  (audio!.match(/<\/AdaptationSet>/g) ?? []).length,
  "开合标签配平(没剥半个块)",
)

// ② 无音轨(理论上不出现,防御):返回 null,调用方回退正常视频播放。
const VIDEO_ONLY = FULL_MPD.replace(/[ \t]*<AdaptationSet mimeType="audio\/mp4"[\s\S]*?<\/AdaptationSet>\n?/, "")
assert.equal(audioOnlyMpd(VIDEO_ONLY), null, "没有音轨可留时应返回 null(回退播视频)")

// ③ 已经是 audio-only(没有 video 块可剥):同样返回 null 回退,不产出空操作。
const AUDIO_ONLY = FULL_MPD.replace(/[ \t]*<AdaptationSet mimeType="video\/mp4"[\s\S]*?<\/AdaptationSet>\n?/, "")
assert.equal(audioOnlyMpd(AUDIO_ONLY), null, "没有 video 块可剥时返回 null(幂等回退)")

console.log("✔ audioOnlyMpd 自检通过(剥 video 留音轨 / 无音轨回退 null)")
