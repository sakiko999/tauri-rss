/**
 * proto — 手写 protobuf wire 解码(仅 B站 seg.so 弹幕需要)。
 *
 * 不引 protobufjs:只解 DmSegMobileReply 的 DanmakuElem 字段,~50 行足够。
 * wire format:tag = varint(field<<3 | wireType);0=varint,1=fixed64,2=length,5=fixed32。
 *
 * DanmakuElem 字段号(实测 hex 分解确认,与社区 proto 一致):
 *   id=1(int64) progress=2(int64 毫秒) mode=3(int32) fontsize=4(int32)
 *   color=5(uint32 ARGB) midHash=6(string) content=7(string) ctime=8(int64)
 *   weight=9(int32) idStr=12(string)
 */

export interface DanmakuElem {
  /** 出现位置,毫秒。 */
  progress: number
  /** 1/2/3 滚动,4 底,5 顶,6 逆向,7 高级。 */
  mode: number
  /** 十进制 ARGB。 */
  color: number
  content: string
}

/** 解析 seg.so 的 DmSegMobileReply,返回弹幕列表。 */
export function decodeDanmakuSeg(buf: Uint8Array): DanmakuElem[] {
  const out: DanmakuElem[] = []
  let p = 0

  const varint = (): number => {
    let v = 0
    let shift = 0
    while (p < buf.length) {
      const b = buf[p++]!
      v |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) return v >>> 0
      shift += 7
    }
    return v >>> 0
  }
  const skip = (wire: number): void => {
    if (wire === 0) varint()
    else if (wire === 1) p += 8
    else if (wire === 2) p += varint()
    else if (wire === 5) p += 4
  }

  // 外层 DmSegMobileReply:field1 = elems(repeated message),其余字段(state 等)跳过。
  while (p < buf.length) {
    const tag = varint()
    const field = tag >>> 3
    const wire = tag & 7
    if (field === 1 && wire === 2) {
      const end = p + varint()
      let progress = 0
      let mode = 1
      let color = 0xffffff
      let content = ""
      while (p < end) {
        const t2 = varint()
        const f2 = t2 >>> 3
        const w2 = t2 & 7
        if (w2 === 0) {
          const v = varint()
          if (f2 === 2) progress = v
          else if (f2 === 3) mode = v
          else if (f2 === 5) color = v
        } else if (w2 === 2) {
          const len = varint()
          if (f2 === 7) content = new TextDecoder().decode(buf.subarray(p, p + len))
          p += len
        } else {
          p += w2 === 1 ? 8 : 4
        }
      }
      if (content) out.push({ progress, mode, color, content })
    } else {
      skip(wire)
    }
  }
  return out
}
