/**
 * 二进制工具 —— 播放器包内的纯函数(无 React / 无副作用)。
 */

/** Uint8Array → 精确切片的 ArrayBuffer(消除 SharedArrayBuffer 视图边界)。
 * appHost.http 的 arraybuffer 响应返回 Uint8Array,各播放器库(hls.js/dash.js)
 * 期望 ArrayBuffer;直接 `.buffer` 可能带 byteOffset/超长,必须 slice 出精确区间。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** 播放进度/Seek 可用的时长:直播 = 缓冲边缘(bufferedEnd),VOD = duration。
 * 直播无固定时长(duration=0/Infinity),进度条用已缓冲段;VOD 用总时长。 */
export function playableDuration(state: {
  live: boolean
  bufferedEnd: number
  duration: number
}): number {
  return state.live ? state.bufferedEnd : state.duration
}
