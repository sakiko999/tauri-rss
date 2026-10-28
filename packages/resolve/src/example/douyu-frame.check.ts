/**
 * douyu 弹幕帧自检 —— `bun packages/resolve/src/example/douyu-frame.check.ts`
 * 守护:一个 WebSocket 帧合并多个 STT 包时,必须**逐包全解**而非只解首包。
 *
 * ⚠️ 守护的 bug 类:斗鱼服务器在弹幕密集时把多包粘进一个 WS 帧;只读首包 →
 * 其后每包静默丢弃(观感「弹幕丢一半」)。长度字段 = body+头的 9+N,实际帧长 = fullMsgLength+4。
 */
import { parseDouyuFrame } from "../platform/douyu/danmaku.ts"

let fails = 0
const ok = (c: unknown, l: string) => {
  if (c) console.log(`  ✓ ${l}`)
  else {
    fails++
    console.error(`  ✗ ${l}`)
  }
}

const TE = new TextEncoder()
/** 造一个 server→client(690) STT 包。 */
function mkPacket(stt: string): Uint8Array {
  const body = TE.encode(stt)
  const full = 9 + body.length
  const f = new Uint8Array(full + 4)
  const dv = new DataView(f.buffer)
  dv.setUint32(0, full, true)
  dv.setUint32(4, full, true)
  dv.setUint16(8, 690, true)
  f[10] = 0
  f[11] = 0
  f.set(body, 12)
  f[12 + body.length] = 0
  return f
}

const chat = (txt: string, nn: string, col = 0) => `type@=chatmsg/txt@=${txt}/nn@=${nn}/col@=${col}/dms@=1/`

console.log("单包:")
const one = parseDouyuFrame(mkPacket(chat("hello", "userA")))
ok(
  one.length === 1 && one[0]?.text === "hello" && one[0]?.user === "userA",
  `单包解出 1 条(得 ${JSON.stringify(one)}）`,
)

console.log("多包粘帧(核心回归):")
const p1 = mkPacket(chat("第一条", "A"))
const p2 = mkPacket(chat("第二条", "B", 1))
const p3 = mkPacket(chat("第三条", "C"))
const merged = new Uint8Array(p1.length + p2.length + p3.length)
merged.set(p1, 0)
merged.set(p2, p1.length)
merged.set(p3, p1.length + p2.length)
const multi = parseDouyuFrame(merged)
ok(multi.length === 3, `3 包全解出(得 ${multi.length} 条)`)
ok(
  multi.map((m) => m.text).join(",") === "第一条,第二条,第三条",
  `顺序/内容正确(得 ${multi.map((m) => m.text).join(",")}）`,
)

console.log("非 chatmsg / 截断:")
const nonChat = mkPacket("type@=uenter/nn@=X/")
ok(parseDouyuFrame(nonChat).length === 0, "非 chatmsg 跳过")
ok(parseDouyuFrame(merged.subarray(0, merged.length - 3)).length === 2, "截断尾包 → 前两包仍解出(不死循环)")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
