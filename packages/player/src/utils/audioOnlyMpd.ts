/**
 * audioOnlyMpd —— 把自家 buildMpd 产的 DASH MPD 剥成「只含音轨」的 MPD(听视频)。
 *
 * bili / youtube 的 DASH 是音视频分离:每档流的 dashManifest 里嵌着同一条
 * 最高码率 AAC 音轨(见 resolve/utils/mpd.ts 的 buildMpd)。听视频不需要动
 * resolve/协议 —— 在 player 侧把 video AdaptationSet 剥掉,dash.js 就只会
 * 拉/解码音轨,隧道(DashHostLoader)、续播、队列推进全部沿用视频路径。
 *
 * ⚠️ 只认自家 buildMpd 的模板形状(video 块在前、audio 块在后,Representation
 * 内不含 `</AdaptationSet>`);外部 MPD(未来若有)不该进这里。剥不动(无音轨/
 * 形状不识)返回 null —— 调用方回退正常视频播放,不产出空 Period 的坏 MPD。
 */

/** 剥掉 video AdaptationSet;MPD 没有音轨可留时返回 null(调用方回退播视频)。 */
export function audioOnlyMpd(mpd: string): string | null {
  if (!/mimeType="audio\/mp4"/.test(mpd)) return null
  const out = mpd.replace(/[ \t]*<AdaptationSet mimeType="video\/mp4"[^>]*>[\s\S]*?<\/AdaptationSet>\n?/, "")
  return out === mpd ? null : out
}
