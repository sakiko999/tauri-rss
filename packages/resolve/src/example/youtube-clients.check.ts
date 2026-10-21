/**
 * YouTube client 请求体自检 —— `bun packages/resolve/src/example/youtube-clients.check.ts`
 *
 * 守护「静默降级」链路:ANDROID_VR 退役后,VISIONOS 是唯一免 POT 还能给直链的兜底
 * (`WEB` 2026 起 SABR-only,`WEB_EMBEDDED_PLAYER` 纯 HTTP 被 embedder identity 拦)。
 *
 * 两个**静默错值**:
 *   1. 设备字段(`deviceMake`/`deviceModel`/`osName`/`osVersion`)缺失 —— 上游静默改判
 *      playability(表现为「视频不可播」,不报字段错误),排查时会误判成风控;
 *   2. `visitorData` 没透传 —— 直接 `LOGIN_REQUIRED`,与「IP 被风控」的现象**一模一样**。
 */
import { VISIONOS_CLIENT_VERSION, visionosPlayerBody } from "../platform/youtube/client.ts"

let fails = 0
const ok = (c: unknown, label: string) => {
  if (c) console.log(`  ✓ ${label}`)
  else {
    fails++
    console.error(`  ✗ ${label}`)
  }
}

console.log("VISIONOS 请求体:")
const body = visionosPlayerBody("TxeCpgGK9Ok", "VISITOR_DATA_X", "CPN1234567890")
const c = body.context.client

ok(c.clientName === "VISIONOS", `clientName = VISIONOS(${c.clientName})`)
ok(c.clientVersion === VISIONOS_CLIENT_VERSION, `clientVersion = ${VISIONOS_CLIENT_VERSION}(${c.clientVersion})`)
ok(c.deviceMake === "Apple", `deviceMake = Apple(${c.deviceMake})`)
ok(c.deviceModel === "RealityDevice17,1", `deviceModel 透传(${c.deviceModel})`)
ok(c.osName === "visionOS", `osName = visionOS(${c.osName})`)
ok(/^26\./.test(c.osVersion), `osVersion 形如 26.x(${c.osVersion})`)
ok(c.visitorData === "VISITOR_DATA_X", `visitorData 透传(${c.visitorData})`)
ok(body.videoId === "TxeCpgGK9Ok", `videoId 透传(${body.videoId})`)
ok(body.cpn === "CPN1234567890", "cpn 可用外部注入(自检/复现用)")
ok(body.contentCheckOk === true && body.racyCheckOk === true, "contentCheckOk / racyCheckOk 都开")

console.log(fails ? `\n${fails} 项失败` : "\n全部通过")
if (fails) process.exit(1)
