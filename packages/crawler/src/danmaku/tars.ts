/**
 * Tars codec —— 虎牙弹幕专用二进制编解码(tag<<4|type 格式,非 protobuf)。
 *
 * 复刻 tars_dart(TarsInputStream/TarsOutputStream),只覆盖 huya 弹幕所需子集:
 *   头:1B `type = b&15`, `tag = (b>>4)&15`;tag==15 时下一字节是实际 tag。
 *   类型:0 BYTE 1 SHORT 2 INT 3 LONG 4 FLOAT 5 DOUBLE 6 STRING1 7 STRING4
 *         8 MAP 9 LIST 10 STRUCT_BEGIN 11 STRUCT_END 12 ZERO_TAG 13 SIMPLE_LIST
 *   整数按值域选字节宽度(0 用 ZERO_TAG);字符串 STRING1(≤255)/STRING4;
 *   字节数组 SIMPLE_LIST(BYTE 头 + 长度 + 数据);struct = BEGIN + 字段 + END。
 */
import type { DanmakuItem } from "../index.ts"

const T = {
  BYTE: 0,
  SHORT: 1,
  INT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  STRING1: 6,
  STRING4: 7,
  MAP: 8,
  LIST: 9,
  STRUCT_BEGIN: 10,
  STRUCT_END: 11,
  ZERO_TAG: 12,
  SIMPLE_LIST: 13,
} as const

// ── 编码(TarsOutputStream) ───────────────────────────────────────────────

export class TarsWriter {
  private out: number[] = []

  get bytes(): Uint8Array {
    return Uint8Array.from(this.out)
  }

  private head(type: number, tag: number): void {
    if (tag < 15) {
      this.out.push((tag << 4) | type)
    } else {
      this.out.push((15 << 4) | type)
      this.out.push(tag)
    }
  }

  writeInt(n: number, tag: number): void {
    if (n === 0) {
      this.head(T.ZERO_TAG, tag)
    } else if (n >= -128 && n <= 127) {
      this.head(T.BYTE, tag)
      this.out.push(n & 0xff)
    } else if (n >= -32768 && n <= 32767) {
      this.head(T.SHORT, tag)
      this.out.push(...be2(n))
    } else if (n >= -2147483648 && n <= 2147483647) {
      this.head(T.INT, tag)
      this.out.push(...be4(n))
    } else {
      this.head(T.LONG, tag)
      this.out.push(...be8(n))
    }
  }

  writeBool(b: boolean, tag: number): void {
    this.writeInt(b ? 1 : 0, tag)
  }

  writeString(s: string, tag: number): void {
    const bytes = new TextEncoder().encode(s)
    if (bytes.length <= 255) {
      this.head(T.STRING1, tag)
      this.out.push(bytes.length)
      this.out.push(...bytes)
    } else {
      this.head(T.STRING4, tag)
      this.out.push(...be4(bytes.length))
      this.out.push(...bytes)
    }
  }

  writeBytes(b: Uint8Array, tag: number): void {
    this.head(T.SIMPLE_LIST, tag)
    this.head(T.BYTE, 0)
    this.writeInt(b.length, 0)
    this.out.push(...b)
  }
}

function be2(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff]
}
function be4(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
function be8(n: number): number[] {
  // JS number 双精度安全到 2^53;huya 数值(uid/在线数)足够。
  const hi = Math.floor(n / 0x100000000)
  const lo = n >>> 0
  return [
    (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
    (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff,
  ]
}

// ── 解码(TarsInputStream) ────────────────────────────────────────────────

export class TarsReader {
  private p = 0
  constructor(private buf: Uint8Array) {}

  private byte(): number {
    return this.buf[this.p++]!
  }
  private intBE(len: number): number {
    let v = 0
    for (let i = 0; i < len; i++) v = v * 256 + (this.buf[this.p++] ?? 0)
    return v | 0 // 32 位截断够用(uri/在线数等小值)
  }
  private head(): { type: number; tag: number } {
    const b = this.byte()
    const type = b & 15
    let tag = (b >> 4) & 15
    if (tag === 15) tag = this.byte()
    return { type, tag }
  }
  /** head 之后的值对应的整数。 */
  private intValue(h: { type: number }): number {
    switch (h.type) {
      case T.ZERO_TAG:
        return 0
      case T.BYTE:
        return this.intBE(1)
      case T.SHORT:
        return this.intBE(2)
      case T.INT:
        return this.intBE(4)
      case T.LONG:
        return this.intBE(8)
      default:
        return 0
    }
  }
  private skipField(type: number): void {
    switch (type) {
      case T.BYTE:
        this.p += 1
        break
      case T.SHORT:
        this.p += 2
        break
      case T.INT:
        this.p += 4
        break
      case T.LONG:
        this.p += 8
        break
      case T.FLOAT:
        this.p += 4
        break
      case T.DOUBLE:
        this.p += 8
        break
      case T.STRING1:
        this.p += 1 + this.byte()
        break
      case T.STRING4:
        this.p += 4 + this.intBE(4)
        break
      case T.SIMPLE_LIST: {
        this.head() // 内层 BYTE 头
        const len = this.intValue(this.head())
        this.p += len
        break
      }
      case T.MAP: {
        const size = this.intValue(this.head())
        for (let i = 0; i < size * 2; i++) this.skipField(this.head().type)
        break
      }
      case T.LIST: {
        const size = this.intValue(this.head())
        for (let i = 0; i < size; i++) this.skipField(this.head().type)
        break
      }
      case T.STRUCT_BEGIN:
        this.skipToStructEnd()
        break
      case T.STRUCT_END:
      case T.ZERO_TAG:
        break
    }
  }
  private skipToStructEnd(): void {
    let h = this.head()
    while (h.type !== T.STRUCT_END) {
      this.skipField(h.type)
      h = this.head()
    }
  }

  /** 定位到 tag 的字段 head(不消费),找不到返回 false。 */
  skipToTag(tag: number): boolean {
    while (this.p < this.buf.length) {
      const save = this.p
      const h = this.head()
      if (h.type === T.STRUCT_END) {
        this.p = save
        return false
      }
      if (h.tag >= tag) {
        this.p = save
        return h.tag === tag
      }
      this.skipField(h.type)
    }
    return false
  }

  readInt(tag: number): number {
    if (!this.skipToTag(tag)) return 0
    const h = this.head()
    return this.intValue(h)
  }

  readBool(tag: number): boolean {
    return this.readInt(tag) !== 0
  }

  readString(tag: number): string {
    if (!this.skipToTag(tag)) return ""
    const h = this.head()
    let len: number
    if (h.type === T.STRING1) len = this.byte()
    else if (h.type === T.STRING4) len = this.intBE(4)
    else return ""
    const out = new TextDecoder().decode(this.buf.subarray(this.p, this.p + len))
    this.p += len
    return out
  }

  readBytes(tag: number): Uint8Array {
    if (!this.skipToTag(tag)) return new Uint8Array(0)
    const h = this.head()
    if (h.type !== T.SIMPLE_LIST) return new Uint8Array(0)
    this.head() // 内层 BYTE 头
    const len = this.intValue(this.head())
    const out = this.buf.slice(this.p, this.p + len)
    this.p += len
    return out
  }

  /** 读 tag 处的 struct,返回子 reader(不含 BEGIN/END 标记),缺省 null。 */
  readStructAt(tag: number): TarsReader | null {
    if (!this.skipToTag(tag)) return null
    const start = this.p
    const h = this.head()
    if (h.type !== T.STRUCT_BEGIN) {
      this.p = start
      return null
    }
    const bodyStart = this.p
    this.skipToStructEnd()
    // skipToStructEnd 消费到并包含 STRUCT_END;子 reader 排除它。
    return new TarsReader(this.buf.subarray(bodyStart, this.p - 1))
  }
}

// ── huya 弹幕结构(专用解析,非通用反射) ───────────────────────────────────

/**
 * 解析虎牙一帧 → 弹幕。
 * 外层 Tars:tag0=type(int),type==7 → tag1 bytes(HYPushMessage)。
 * HYPushMessage:tag1=uri, tag2=msg bytes。uri==1400 → HYMessage{tag0 userInfo,
 * tag3 content, tag6 bulletFormat}。uri==8006 → online(忽略)。
 */
export function decodeHuyaDanmakuFrame(data: Uint8Array): DanmakuItem[] {
  const outer = new TarsReader(data)
  if (outer.readInt(0) !== 7) return []
  const push = new TarsReader(outer.readBytes(1))
  const uri = push.readInt(1)
  if (uri !== 1400) return []
  const hy = new TarsReader(push.readBytes(2))
  let user = ""
  let text = ""
  let color: string | undefined
  const sender = hy.readStructAt(0)
  if (sender) user = sender.readString(2)
  text = hy.readString(3)
  const bullet = hy.readStructAt(6)
  if (bullet) {
    const fontColor = bullet.readInt(0)
    if (fontColor > 0) color = intToHex(fontColor)
  }
  if (!text) return []
  return [{ text, user, color }]
}

/** 0xRRGGBB → #RRGGBB(dart LiveMessageColor.numberToColor 对应)。 */
function intToHex(rgb: number): string {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`
}
