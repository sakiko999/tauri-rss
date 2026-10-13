/**
 * 虎牙 Tars 解码截断帧自检 —— 跑:`bun packages/resolve/src/example/huya-tars.check.ts`
 *
 * 为什么单列:解码器按 WS 消息**同步**跑在事件循环上。截断帧(帧边界截断 / 畸形包)若让
 * 游标越界后**不前进**,会变成同步死循环 —— 整个应用(含 setTimeout)冻住,只能强杀。
 * bili/douyu 的 codec 都显式防了截断帧,huya 的 Tars 解码曾漏掉。
 *
 * 用「STRUCT_BEGIN 后无 STRUCT_END」的截断帧复现:修复前此脚本**永不返回**(需强杀)。
 */
import assert from "node:assert/strict"
import { TarsWriter, TarsReader, decodeHuyaDanmakuFrame } from "../platform/huya/danmaku-tars.ts"

/** Tars struct 的 BEGIN/END 头字节(type=10/11,tag 放高 4 位)。 */
const begin = (tag: number): number => ((tag << 4) | 10) & 0xff
const end = (tag: number): number => ((tag << 4) | 11) & 0xff

/** HYMessage 字节:tag0=sender 结构(内含 tag2 用户名)+ tag3 正文。 */
function hyMessage(user: string, text: string, withEnd: boolean): Uint8Array {
  const senderBody = new TarsWriter()
  senderBody.writeString(user, 2)
  const textW = new TarsWriter()
  textW.writeString(text, 3)
  const body = [begin(0), ...senderBody.bytes, ...(withEnd ? [end(0)] : []), ...textW.bytes]
  return Uint8Array.from(body)
}

/** 把 HYMessage 包成完整帧:outer{tag0=7, tag1=push{tag1=1400(uri), tag2=hyBytes}}。 */
function frame(hyBytes: Uint8Array): Uint8Array {
  const push = new TarsWriter()
  push.writeInt(1400, 1)
  push.writeBytes(hyBytes, 2)
  const outer = new TarsWriter()
  outer.writeInt(7, 0)
  outer.writeBytes(push.bytes, 1)
  return outer.bytes
}

// ── 正常帧 → 解析出弹幕(证明修复未破坏 happy path)────────────────────────
{
  const items = decodeHuyaDanmakuFrame(frame(hyMessage("abc", "hello", true)))
  assert.equal(items.length, 1, "正常帧应解析出 1 条弹幕")
  assert.equal(items[0]!.text, "hello")
  assert.equal(items[0]!.user, "abc")
}

// ── 截断帧:sender 结构声明 BEGIN 但缓冲在 END 前结束 → 不得死循环 ──────────────
{
  const truncated = frame(hyMessage("abc", "hello", false)) // 去掉 sender 的 STRUCT_END
  // 关键断言:能**返回**(修复前此处永久挂起,整个事件循环冻住)。
  const items = decodeHuyaDanmakuFrame(truncated)
  assert.ok(Array.isArray(items), "截断帧应返回数组(不死循环)")
}

// ── 直接压 TarsReader:越界后 readStructAt 仍须终止 ────────────────────────────
{
  // STRUCT_BEGIN tag4 + STRING1 tag2(长度 3)+ 3 字节 —— 无 END。
  const r = new TarsReader(Uint8Array.from([begin(4), 0x26, 0x03, 0x61, 0x62, 0x63]))
  const s = r.readStructAt(4)
  assert.ok(s === null || s instanceof TarsReader, "readStructAt 截断时须返回而非自旋")
}

console.log("✔ huya-tars 自检通过(正常帧可解 + 截断帧不死循环)")
