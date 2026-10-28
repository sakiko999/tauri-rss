/**
 * danmaku-proto 自检 —— `bun packages/resolve/src/example/danmaku-proto.check.ts`
 * 守护:bili VOD 弹幕 protobuf 解码对**截断/畸形帧**必须返回而非死循环。
 *
 * ⚠️ 守护的 bug 类:内层 `while (p < end)` 中,若帧声明长度超出缓冲(网络截断),
 * `varint()` 在 p 到底后不再前进 → 循环条件永真 → **同步死循环,冻结整个事件循环**
 * (实测 120s+ 未返回,连 setTimeout 逃生定时器都不触发)。已修:clamp end + 未前进即 break。
 */
import { decodeDanmakuSeg } from "../platform/bili/danmaku-proto.ts"

let fails = 0
const ok = (c: unknown, l: string) => {
  if (c) console.log(`  ✓ ${l}`)
  else {
    fails++
    console.error(`  ✗ ${l}`)
  }
}

// 每次调用都套一层超时护栏:若死循环,setTimeout 也跑不了 → 进程挂住即视为失败
// (本脚本靠「能跑到最后的 print」自证)。为免真挂死 CI,先跑截断用例(修复前必挂)。
const guard = <T>(fn: () => T, label: string): T | undefined => {
  const timer = setTimeout(() => {
    console.error(`  ✗ ${label}: 死循环未返回(挂住)`)
    process.exit(1)
  }, 2000)
  try {
    const r = fn()
    clearTimeout(timer)
    return r
  } catch (e) {
    clearTimeout(timer)
    console.error(`  ✗ ${label}: 抛错 ${e}`)
    fails++
    return undefined
  }
}

console.log("截断帧(长度声明超出缓冲):")
const truncated = new Uint8Array([0x0a, 0x64, 0x10, 0x01, 0x18])
const r1 = guard(() => decodeDanmakuSeg(truncated), "截断帧")
ok(Array.isArray(r1), "返回数组而非死循环")

console.log("未知 wire(group 3)不卡:")
ok(Array.isArray(guard(() => decodeDanmakuSeg(new Uint8Array([0x0b, 0x0c])), "group-wire")), "group-wire 返回")

console.log("正常帧仍正确解码:")
const good = new Uint8Array([0x0a, 0x0b, 0x10, 0x64, 0x18, 0x01, 0x3a, 0x04, 0x41, 0x42, 0x43, 0x44])
const r2 = guard(() => decodeDanmakuSeg(good), "正常帧")
ok(
  r2?.length === 1 && r2[0]?.content === "ABCD" && r2[0]?.progress === 100,
  `正常帧解出 ABCD(得 ${JSON.stringify(r2)}）`,
)

console.log("空缓冲:")
ok(guard(() => decodeDanmakuSeg(new Uint8Array([])), "空")?.length === 0, "空缓冲返回 []")

console.log(fails === 0 ? "\n全部通过" : `\n${fails} 项失败`)
process.exit(fails === 0 ? 0 : 1)
