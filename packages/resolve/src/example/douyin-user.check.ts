/**
 * 自检 —— 抖音用户/直播间标识归一（纯函数，无网络）。
 * 跑：bun packages/resolve/src/example/douyin-user.check.ts
 */

import { isDouyinProfileUrl, normalizeDouyinRoomId, parseDouyinSecUid } from "../platform/douyin/ids.ts"

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok  ${msg}`)
}
const eq = (a: unknown, b: unknown, msg: string) => assert(JSON.stringify(a) === JSON.stringify(b), msg)
const throws = (fn: () => unknown, msg: string) => {
  try {
    fn()
  } catch {
    console.log(`ok  ${msg}`)
    return
  }
  throw new Error(`FAIL: ${msg}(应抛错)`)
}

const SEC = "MS4wLjABAAAAexample-sec-uid"

// 主页链接 → sec_uid
eq(parseDouyinSecUid(`https://www.douyin.com/user/${SEC}?from_tab_name=main`), SEC, "主页链接（带 query）")
eq(parseDouyinSecUid(`www.douyin.com/user/${SEC}`), SEC, "无 scheme 的主页链接")
eq(parseDouyinSecUid(`https://www.iesdouyin.com/share/user/${SEC}`), SEC, "iesdouyin share/user 旧路径")
eq(parseDouyinSecUid(`@${SEC}`), SEC, "@sec_uid 去前缀")
eq(parseDouyinSecUid(SEC), SEC, "裸 sec_uid 原样")
throws(() => parseDouyinSecUid("https://live.douyin.com/123"), "直播间链接不能当主页链接")
throws(() => parseDouyinSecUid("https://www.douyin.com/"), "缺少 /user/ 的链接应抛错")
throws(() => parseDouyinSecUid("抖音号：pvcyinse"), "抖音号输入应提示改用 live:douyin")
throws(() => parseDouyinSecUid("   "), "空输入应抛错")

assert(isDouyinProfileUrl(`https://www.douyin.com/user/${SEC}`), "识别主页链接")
assert(isDouyinProfileUrl(`www.douyin.com/user/${SEC}`), "识别无 scheme 主页链接")
assert(isDouyinProfileUrl(`https://www.iesdouyin.com/share/user/${SEC}`), "识别 iesdouyin 旧链接")
assert(!isDouyinProfileUrl("https://live.douyin.com/6753235366"), "直播间链接不是主页链接")

// 直播间输入归一
eq(normalizeDouyinRoomId(" @pvcyinse "), "pvcyinse", "@抖音号 去前缀/空白")
eq(normalizeDouyinRoomId("抖音号：pvcyinse"), "pvcyinse", "「抖音号：」前缀")
eq(normalizeDouyinRoomId("https://live.douyin.com/6753235366?foo=1"), "6753235366", "直播间链接取末段")
eq(normalizeDouyinRoomId("live.douyin.com/6753235366"), "6753235366", "无 scheme 直播间链接")
eq(normalizeDouyinRoomId("6753235366"), "6753235366", "裸数字 ID 原样")
eq(normalizeDouyinRoomId("pvcyinse"), "pvcyinse", "裸抖音号原样")
eq(normalizeDouyinRoomId("   "), "", "空输入 → 空串")
