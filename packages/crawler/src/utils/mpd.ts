/**
 * MPD 装配器 —— 把音视频分离流的 Representation 拼成 DASH MPD XML(dash.js 消费)。
 *
 * 从 bili/client.ts 抽出(buildBiliMpd/videoRepresentation/audioRepresentation/escXml
 * 原为 bili 私有),供 bili / youtube 两个 client 复用。各 client 写薄映射层把
 * 上游字段归一化成 MpdVideoRep/MpdAudioRep,本模块只做纯模板装配。
 *
 * 关键设计:每档 MPD 只含该档 video Representation(+ 公共最高音轨)——dash.js 无档
 * 可选,天然锁目标档,不会 ABR 降档。切档时下游返回对应档的 MPD。
 */
export interface MpdVideoRep {
  id: number | string
  /** 分片绝对直链(BaseURL)。 */
  baseUrl: string
  width: number
  height: number
  /** 视频编码,如 "avc1.640028"。 */
  codecs: string
  bandwidth: number
  /** init 段 Range(裸 "start-end",无 bytes= 前缀)。 */
  initRange: string
  indexRange: string
}

export interface MpdAudioRep {
  id: number | string
  baseUrl: string
  /** 音频编码,如 "mp4a.40.2"。 */
  codecs: string
  bandwidth: number
  initRange: string
  indexRange: string
}

/** MPD `<Representation>`(BaseURL + SegmentBase)。 */
function videoRepresentation(v: MpdVideoRep): string {
  return [
    `<Representation id="${v.id}" mimeType="video/mp4" codecs="${escXml(v.codecs)}" bandwidth="${v.bandwidth}" width="${v.width}" height="${v.height}">`,
    `  <BaseURL>${escXml(v.baseUrl)}</BaseURL>`,
    `  <SegmentBase indexRange="${v.indexRange}">`,
    `    <Initialization range="${v.initRange}" />`,
    `  </SegmentBase>`,
    `</Representation>`,
  ].join("\n")
}

/** MPD `<Representation>`(音频)。 */
function audioRepresentation(a: MpdAudioRep): string {
  return [
    `<Representation id="${a.id}" mimeType="audio/mp4" codecs="${escXml(a.codecs)}" bandwidth="${a.bandwidth}">`,
    `  <BaseURL>${escXml(a.baseUrl)}</BaseURL>`,
    `  <SegmentBase indexRange="${a.indexRange}">`,
    `    <Initialization range="${a.initRange}" />`,
    `  </SegmentBase>`,
    `</Representation>`,
  ].join("\n")
}

/**
 * 拼 DASH MPD XML。每档 video 一个 Representation;audio 可选(无则视频无声)。
 * duration 省略时不写 mediaPresentationDuration(on-demand 仍可播)。
 */
export function buildMpd(opts: {
  videos: MpdVideoRep[]
  audio?: MpdAudioRep
  duration?: number
  minBufferTime?: number
}): string {
  const videoReps = opts.videos.map(videoRepresentation).join("\n")
  const audioRep = opts.audio ? audioRepresentation(opts.audio) : ""
  const duration = opts.duration ? `mediaPresentationDuration="PT${opts.duration.toFixed(3)}S"` : ""
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" ${duration} minBufferTime="PT${(opts.minBufferTime || 1.5).toFixed(3)}S">`,
    `  <Period>`,
    `    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1">`,
    videoReps,
    `    </AdaptationSet>`,
    audioRep
      ? `    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1">\n${audioRep}\n    </AdaptationSet>`
      : "",
    `  </Period>`,
    `</MPD>`,
  ]
    .filter(Boolean)
    .join("\n")
}

/** XML 转义(分片 baseUrl 含 & 等)。 */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
