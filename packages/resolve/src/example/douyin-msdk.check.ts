/**
 * 抖音签名脚本完整性自检 —— `bun packages/resolve/src/example/douyin-msdk.check.ts`
 *
 * 脚本被误改/替换后，签名会静默失效（抖音只返回空/415），排查成本很高。这里跑一次
 * `assertMsdkIntegrity()`：不匹配直接失败，并提示把新校验和写回。
 */

import { assertMsdkIntegrity, kWebMsSDK } from "../platform/douyin/msdk-sign.ts"

assertMsdkIntegrity()
if (kWebMsSDK.length < 100_000) throw new Error(`签名脚本长度异常：${kWebMsSDK.length}`)
console.log(`✔ 抖音签名脚本完整性通过（${kWebMsSDK.length} 字符）`)
